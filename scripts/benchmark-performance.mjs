import fs from 'node:fs/promises';
import path from 'node:path';
import { config, dataPath, repo } from './common.mjs';
import { getSql, closeDb } from './server/db.mjs';

const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const web = option('--url', `http://127.0.0.1:${config.port}`);
const agent = option('--agent-url', `http://127.0.0.1:${config.agent?.port ?? config.port + 2}`);
const rounds = Number(option('--rounds', '3'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('rounds must be 1–20');
const output = path.resolve(option('--output', path.join(repo,'outputs',`perf-${new Date().toISOString().slice(0,10).replaceAll('-','')}.json`)));
const token = (await fs.readFile(dataPath('runtime','mcp-read-token'),'utf8')).trim();
async function databaseMetrics() {
  if (!args.includes('--database-metrics')) return null;
  const sql = await getSql();
  const settings = await sql`SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','effective_cache_size','work_mem','maintenance_work_mem','jit','random_page_cost') ORDER BY name`;
  const [io] = await sql`SELECT sum(heap_blks_read)::text AS read,sum(heap_blks_hit)::text AS hit FROM pg_statio_user_tables`;
  return { settings, read: Number(io.read), hit: Number(io.hit) };
}
async function workerState() {
  const out = {};
  for (const name of ['article-enrichment','report-discovery']) {
    const state = await fs.readFile(dataPath('state',name,'status.json'),'utf8').then(JSON.parse).catch(()=>null);
    const paused = await fs.access(dataPath('state',name,'pause')).then(()=>true,()=>false);
    out[name] = { phase: state?.phase ?? null, updated_at: state?.updated_at ?? null, concurrency: state?.concurrency ?? null, pause_marker: paused };
  }
  return out;
}
async function measure(name, endpoint, request) {
  const start = performance.now();
  try {
    const response = await fetch(endpoint,{method:request?'POST':'GET',headers:{'accept-encoding':'gzip',...(request?{'content-type':'application/json',authorization:`Bearer ${token}`}:{})},
      ...(request?{body:JSON.stringify(request)}:{}),signal:AbortSignal.timeout(25000)});
    const body = await response.text(), data = JSON.parse(body);
    return { name, ms:Math.round(performance.now()-start),status:response.status,decoded_bytes:Buffer.byteLength(body),encoding:response.headers.get('content-encoding'),retry_after:response.headers.get('retry-after'),
      returned:data.returned_count, total:data.total, complete:data.coverage?.complete, degraded:data.degraded,matched_documents:data.query_plan?.matched_documents,timings:data.query_plan?.timings,code:data.code };
  } catch(e) { return {name,ms:Math.round(performance.now()-start),status:null,error:e.name,cause:e.cause?.code}; }
}
const cases = [
  ['describe',agent+'/api/research/describe',{}],['query_limit5',agent+'/api/research/query',{limit:5}],
  ['lexical',agent+'/api/research/search',{query:'加息 AI',mode:'lexical',limit:5,explain:true}],
  ['hybrid_filtered',agent+'/api/research/search',{query:'半导体 资本开支',mode:'hybrid',filters:{field:'tags',op:'contains_all',value:['行业:半导体']},limit:5,explain:true}],
  ['home',web+'/api/home'],['status',web+'/api/status'],['pages_limit50',web+'/api/pages?limit=50'],
  ['navigation',web+'/api/graph-navigation'],['fast_search',web+'/api/search?q='+encodeURIComponent('加息 AI')+'&mode=fast&limit=5'],
];
const report = {at:new Date().toISOString(),web,agent,label:option('--label','unspecified'),workers_before:await workerState(),rounds:[],concurrency:[],summary:{}};
report.database_before = await databaseMetrics();
for (let round=0;round<rounds;round++) {
  const rows=[];
  for (const args of cases) { const row=await measure(...args); rows.push(row); console.log(JSON.stringify({round:round+1,...row})); }
  report.rounds.push(rows);
}
report.concurrency = await Promise.all(Array.from({length:8},()=>measure('lexical_8',agent+'/api/research/search',{query:'加息 AI',mode:'lexical',limit:5,explain:true})));
for (const [name] of cases) {
  const samples=report.rounds.flat().filter(r=>r.name===name && r.status===200).map(r=>r.ms).sort((a,b)=>a-b);
  report.summary[name]={samples:samples.length,min_ms:samples[0]??null,p95_ms:samples[Math.ceil(samples.length*.95)-1]??null};
}
report.workers_after=await workerState();
report.database_after = await databaseMetrics();
if (report.database_after) {
  const read = report.database_after.read - report.database_before.read, hit = report.database_after.hit - report.database_before.hit;
  report.database_interval = {read,hit,hit_ratio:read+hit ? hit/(read+hit) : null};
}
await closeDb();
await fs.mkdir(path.dirname(output),{recursive:true}); await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,summary:report.summary,concurrency_statuses:report.concurrency.map(r=>r.status)}));
