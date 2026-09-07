import fs from 'node:fs/promises';
import path from 'node:path';
import { config,dataPath,gb,atomicJson,ensureDirs,repo } from './common.mjs';
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
// The public schema-pack boundary preserves upstream code and migrations.
const types={source:['media','sources/'],paper:['media','papers/'],report:['media','reports/'],
  claim:['concept','claims/'],hypothesis:['concept','hypotheses/'],factor:['concept','factors/'],
  strategy:['concept','strategies/'],experiment:['media','experiments/'],dataset:['media','datasets/'],
  security:['entity','securities/'],industry:['concept','industries/'],theme:['concept','themes/'],
  metric:['concept','metrics/'],institution:['entity','institutions/']};
const relations=['supported_by','contradicted_by','derived_from','tests','uses_dataset','trades','measures'];
const pack={api_version:'gbrain-schema-pack-v1',name:'quant-research',version:'1.0.0',
  description:'量化研究：原始证据、观点、假设、因子、策略与实验',extends:'gbrain-base',
  page_types:Object.entries(types).map(([name,[primitive,prefix]])=>({name,primitive,path_prefixes:[prefix],extractable:false,expert_routing:false})),
  link_types:relations.map(name=>({name})),
  frontmatter_links:Object.keys(types).flatMap(page_type=>relations.map(name=>({page_type,fields:[name],link_type:name})))};
const packPath=dataPath('runtime','.gbrain','schema-packs','quant-research','pack.json');
await atomicJson(packPath,pack);
const active=await gb(['schema','use','quant-research']);
console.log(active.stdout);
await fs.mkdir(path.join(repo,'config'),{recursive:true});
await atomicJson(path.join(repo,'config','quant-research.schema.json'),pack);
console.log('GBrain 已初始化：PostgreSQL + 1024维向量 + balanced 检索模式');
