import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { agentSettings,createAgentHttpServer } from '../scripts/agent/http-server.mjs';
import { createShareGuide } from '../scripts/agent/create-share-guide.mjs';
import { installDownloads } from '../scripts/agent/install-downloads.mjs';

const work=path.resolve('work',`public-install-test-${process.pid}`),shareId='p'.repeat(32),token='public-fixture-token';
const internalBase='http://100.64.0.1:8020';
await fs.mkdir(work,{recursive:true});
const settings=agentSettings({host:'127.0.0.1',port:18018,agent:{port:18020}});settings.basePath='/agent';
const backend=createAgentHttpServer({settings,authorize:async req=>req.headers.authorization===`Bearer ${token}`,
  installHandler:installDownloads(work),execute:async operation=>({schema_version:'research-query-v1',request_id:'fixture',next_cursor:null,truncated:false,results:[{operations:['describe','search'],operation}],provenance:{raw_url:'/assets/raw/fixture.pdf'}}),
  assetHandler:async(req,res,url)=>{assert.equal(url.pathname,'/assets/raw/fixture.pdf');res.end('fixture PDF');}});
await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
const backendHost=`127.0.0.1:${backend.address().port}`;settings.allowedHosts.push(backendHost);
const proxy=http.createServer((req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:backend.address().port,path:req.url.replace(/^\/kb/,''),method:req.method,headers:{...req.headers,host:backendHost}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${proxy.address().port}/kb/agent`;settings.publicBaseUrl=base;
const output=await createShareGuide({baseUrl:internalBase,token,outputDir:work,downloadBaseUrl:`${internalBase}/install/${shareId}`});
await fs.writeFile(path.join(work,'install-share.json'),JSON.stringify({id:shareId,enabled:true,base_url:internalBase}));
function run(args,overrides={}) {
  return new Promise((resolve,reject)=>{
    const env={...process.env};for(const key of ['RESEARCHWIKI_URL','RESEARCHWIKI_TOKEN','RESEARCHWIKI_TOKEN_FILE'])delete env[key];
    const child=spawn(process.execPath,args,{windowsHide:true,cwd:work,env:{...env,...overrides}});let stdout='',stderr='';
    child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
}
test.after(async()=>{
  proxy.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(resolve=>proxy.close(resolve)),new Promise(resolve=>backend.close(resolve))]);
  assert.ok(work.startsWith(path.resolve('work')+path.sep));await fs.rm(work,{recursive:true,force:true});
});

test('rewriting proxy serves a self-contained installer using public origin and path prefix',async()=>{
  const documentUrl=`${base}/install/${shareId}/researchwiki-install.md`;
  const doc=await(await fetch(documentUrl)).text();assert.ok(doc.includes(base));assert.ok(!doc.includes(internalBase));
  const script=await(await fetch(documentUrl.replace(/\.md$/,'.mjs'))).text();
  assert.equal(doc.match(/```javascript\n([\s\S]+?)\n```/)[1],script.trim());
  const file=path.join(work,'downloaded.mjs');await fs.writeFile(file,script);
  const target=path.join(work,'auto');const result=await run([file,'--target',target]);assert.equal(result.code,0,result.stdout+result.stderr);assert.ok(!result.stdout.includes(token));
  assert.equal(JSON.parse(await fs.readFile(path.join(target,'connection.json'),'utf8')).base_url,base);
  const response=await fetch(base+'/api/research/describe',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'});
  const body=await response.json();assert.equal(body.provenance.raw_url,base+'/assets/raw/fixture.pdf');
  assert.equal(await(await fetch(body.provenance.raw_url,{headers:{authorization:`Bearer ${token}`}})).text(),'fixture PDF');
  const head=await fetch(documentUrl,{method:'HEAD'});assert.equal(Number(head.headers.get('content-length')),Buffer.byteLength(doc));assert.equal(await head.text(),'');
  const spoof=await fetch(documentUrl,{headers:{'x-forwarded-host':'attacker.example','x-forwarded-proto':'https'}});assert.ok(!(await spoof.text()).includes('attacker.example'));
});

test('offline installers support explicit URL/from-URL overrides and installed helpers honor environment overrides',async()=>{
  for(const [name,flags] of [['explicit',['--base-url',base]],['source',['--from-url',`${base}/install/${shareId}/researchwiki-install.md`]]]){
    const target=path.join(work,name);const result=await run([output.script,...flags,'--target',target]);assert.equal(result.code,0,result.stdout+result.stderr);
    const file=path.join(target,'connection.json'),connection=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(connection.base_url,base);
    connection.base_url=internalBase;await fs.writeFile(file,JSON.stringify(connection));
    const query=await run([path.join(target,'scripts/research.mjs'),'describe'],{RESEARCHWIKI_URL:base});assert.equal(query.code,0,query.stdout+query.stderr);
  }
  for(const value of ['file:///tmp/skill','http://user:secret@example.test','https://example.test/?token=x']){
    const result=await run([output.script,'--base-url',value,'--target',path.join(work,'invalid')]);assert.equal(result.code,1);await assert.rejects(fs.access(path.join(work,'invalid')));
  }
});

test('prefixed MCP remains read-only and requires Bearer on API, files and health',async()=>{
  for(const route of ['/api/research/describe','/mcp','/assets/raw/fixture.pdf','/health'])assert.equal((await fetch(base+route)).status,401);
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  assert.equal((await fetch(base+'/api/edit',{method:'POST',headers,body:'{}'})).status,404);
  const client=new Client({name:'public-gateway-test',version:'1'});
  try{await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers}}));assert.equal((await client.listTools()).tools.length,7);assert.ok(!(await client.callTool({name:'research_describe',arguments:{}})).isError);}
  finally{await client.close();}
});
