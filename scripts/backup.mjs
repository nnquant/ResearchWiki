import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { dataPath,root,withLock,atomicJson,now,repo } from './common.mjs';
await withLock(async()=>{
 const dir=dataPath('backups',now().replaceAll(/[:.]/g,'-'));await fs.mkdir(dir,{recursive:true});
 const dump=path.join(dir,'gbrain.dump');
 await new Promise((resolve,reject)=>{
  const child=spawn('docker',['compose','--env-file',dataPath('runtime','compose.env'),'exec','-T','postgres','pg_dump','-U','gbrain','-d','gbrain','-Fc'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const out=createWriteStream(dump);let error='';child.stdout.pipe(out);child.stderr.on('data',b=>error+=b);
  let exited=false,closed=false;
  const done=()=>{if(exited&&closed)resolve();};
  out.on('close',()=>{closed=true;done();});out.on('error',reject);
  child.on('error',reject);child.on('close',code=>{if(code!==0){out.destroy();reject(new Error(error));}else{exited=true;done();}});
 });
 for(const name of ['raw','parsed','wiki','state'])await fs.cp(dataPath(name),path.join(dir,name),{recursive:true});
 // A running ingest lock is not a restorable data artifact.
 await fs.unlink(path.join(dir,'state','ingest.lock'));
 await fs.mkdir(path.join(dir,'runtime'),{recursive:true});
 await fs.cp(dataPath('runtime','.gbrain'),path.join(dir,'runtime','.gbrain'),{recursive:true,filter:file=>!file.includes(path.sep+'run'+path.sep)&&!file.endsWith(path.sep+'run')});
 for(const name of ['compose.env','mcp-read-token'])await fs.copyFile(dataPath('runtime',name),path.join(dir,'runtime',name));
 await atomicJson(path.join(dir,'backup.json'),{at:now(),dataRoot:root,postgres_dump:'gbrain.dump',includes:['PostgreSQL','raw','parsed','wiki','state','runtime configuration'],excluded:['model weights','Python runtime','caches'],bytes:(await fs.stat(dump)).size});
 console.log(dir);
});
