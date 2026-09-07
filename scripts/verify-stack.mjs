import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import postgres from 'postgres';
import {config,root,dataPath,manifest,sha,gb,atomicJson,now} from './common.mjs';
const docs=Object.values((await manifest()).documents),checks=[];
for(const d of docs) {
 assert.equal(d.status,'indexed',d.title+' indexed');
 assert.equal(sha(await fs.readFile(dataPath(d.raw_path))),d.sha256,'original integrity');
 const map=JSON.parse(await fs.readFile(dataPath(d.page_map),'utf8'));
 assert.ok(map.length>0);assert.ok(map.every(b=>b.page>=1&&b.page<=d.pages));
 const paged=await fs.readFile(dataPath(d.paged_path),'utf8');
 assert.equal((paged.match(/^## PDF 第 \d+ 页$/gm)||[]).length,d.pages,'all PDF page headers');
 const source=await fs.readFile(dataPath('wiki',d.wiki_slug+'.md'),'utf8');
 let images=0;
 for(const match of source.matchAll(/!\[[^\]]*\]\((\/assets\/[^)]+)\)/g)) {
   const relative=decodeURIComponent(match[1].slice('/assets/'.length));
   await fs.access(path.join(root,relative));images++;
 }
 const page=await fetch(`http://127.0.0.1:${config.port}/api/page/${d.wiki_slug.split('/').map(encodeURIComponent).join('/')}`);
 assert.equal(page.status,200);const pageBody=await page.json();
 assert.ok(pageBody.markdown.includes('PDF 第'),'page markdown carries PDF page markers');
 assert.equal(pageBody.pdf_pages,d.pages,'API page count matches manifest');
 assert.equal(pageBody.editable,false,'source pages are read-only');
 assert.ok(pageBody.provenance?.raw_url,'provenance links original file');
 checks.push({title:d.title,pages:d.pages,blocks:map.length,images,characters:d.characters,original_sha256_verified:true});
}
const brain=JSON.parse(await fs.readFile(dataPath('runtime','.gbrain','config.json'),'utf8'));
const sql=postgres(brain.database_url,{max:1});
let database;
try {
 const pages=await sql`SELECT count(*)::int AS n FROM pages`;
 const chunks=await sql`SELECT count(*)::int AS total, count(embedding)::int AS embedded FROM content_chunks`;
 const dims=await sql`SELECT DISTINCT vector_dims(embedding) AS dims FROM content_chunks WHERE embedding IS NOT NULL`;
 const links=await sql`SELECT link_type, count(*)::int AS n FROM links GROUP BY link_type ORDER BY link_type`;
 assert.equal(chunks[0].total,chunks[0].embedded,'all chunks embedded');assert.deepEqual(dims.map(x=>x.dims),[1024]);
 assert.ok(links.some(x=>x.link_type==='derived_from'&&x.n>=3),'custom typed source relations');
 database={pages:pages[0].n,...chunks[0],dimensions:dims[0].dims,links};
}finally{await sql.end();}
const retrieval=[];
for(const [query,expected] of [['Equity Volatility Strategy','b07bff7f1d80ca4738c1965e'],['市场风险溢价的概率分布预测','061d1524285347eb245341d9'],['Dutch Books for Language Models','b598f1afbfe2b277dc638cb3']]) {
 const {stdout}=await gb(['query',query,'--json']);const hits=JSON.parse(stdout);
 const rank=hits.findIndex(x=>x.slug===`sources/${expected}`)+1;
 assert.ok(rank>0&&rank<=5,query+' returns source in top5');
 retrieval.push({query,source_rank:rank,top_titles:hits.slice(0,3).map(x=>x.title)});
}
const base=`http://127.0.0.1:${config.port}`;
const apiStatus=await fetch(`${base}/api/status`);assert.equal(apiStatus.status,200);
const statusBody=await apiStatus.json();assert.ok(statusBody.services.postgres.ok&&statusBody.services.mcp.ok,'postgres and mcp healthy');
const index=await (await fetch(`${base}/api/index`)).json();assert.ok(index.length>=docs.length,'page index covers imported documents');
const web={};
for(const [query,expected] of [['market risk premium','061d1524285347eb245341d9'],['市场风险溢价的概率分布预测','061d1524285347eb245341d9']]) {
 const r=await (await fetch(`${base}/api/search?q=${encodeURIComponent(query)}&mode=fast&limit=10`)).json();
 const rank=r.results.findIndex(x=>x.slug===`sources/${expected}`)+1;
 assert.ok(rank>0&&rank<=5,`web search "${query}" returns source in top5 (engine ${r.engine}, degraded ${JSON.stringify(r.degraded)})`);
 web[query]={rank,engine:r.engine,latency_ms:r.latency_ms};
}
const graph=await (await fetch(`${base}/api/graph/sources/${docs[0].wiki_slug.split('/')[1]}?depth=1`)).json();assert.ok(graph.nodes.length>=1,'graph has nodes');
const html=await fetch(`${base}/`);assert.equal(html.status,200);assert.ok((await html.text()).includes('/app/'),'SPA build is served');
const denied=await fetch(`${base}/api/index`,{method:'POST'});assert.equal(denied.status,403);
const deniedPut=await fetch(`${base}/api/page/claims/x`,{method:'PUT',headers:{'content-type':'application/json'},body:'{}'});assert.equal(deniedPut.status,403);
const confined=await fetch(`${base}/assets/runtime/compose.env`);assert.equal(confined.status,403);
const report={at:now(),root,documents:checks,total_pdf_pages:checks.reduce((n,x)=>n+x.pages,0),database,retrieval,web_search:web,unauthenticated_write_denied:true,secret_paths_confined:true};
await atomicJson(dataPath('state','acceptance.json'),report);console.log(JSON.stringify(report,null,2));
