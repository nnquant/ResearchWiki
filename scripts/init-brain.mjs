import fs from 'node:fs/promises';
import { config,dataPath,gb,atomicJson,ensureDirs } from './common.mjs';
await ensureDirs();
const cfg=dataPath('runtime','.gbrain','config.json');
let exists=true;try{await fs.access(cfg);}catch{exists=false;}
if(!exists) {
  const envText=await fs.readFile(dataPath('runtime','compose.env'),'utf8');
  const password=envText.match(/^GBRAIN_PG_PASSWORD=(.+)$/m)?.[1]?.trim();
  if(!password)throw new Error('运行 setup.ps1 初始化本地数据库凭证');
  const result=await gb(['init','--url',`postgresql://gbrain:${password}@127.0.0.1:5436/gbrain`,
    '--embedding-model',config.embeddingModel,'--embedding-dimensions',String(config.embeddingDimensions),
    '--skip-embed-check','--non-interactive'],{timeout:600000});
  await fs.writeFile(dataPath('logs','gbrain-init.log'),(result.stdout+'\n'+result.stderr).replaceAll(password,'[REDACTED]'));
}
for(const [key,value] of Object.entries({'search.mode':'balanced','search.reranker.enabled':'false','search.expansion.enabled':'false','content_sanity.bytes_block':'2000000','sync.repo_path':dataPath('wiki')})) {
  await gb(['config','set',key,value]);
}
// Keep installation and the running API on the same schema contract.
const { researchSchema: pack } = await import('./research-schema.mjs');
const packPath=dataPath('runtime','.gbrain','schema-packs',pack.name,'pack.json');
await atomicJson(packPath,pack);
const active=await gb(['schema','use',pack.name]);
console.log(active.stdout);
console.log('投资研究 GBrain 已初始化：PostgreSQL + 向量检索 + 投资研究关系');
