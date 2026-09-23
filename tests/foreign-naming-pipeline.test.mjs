import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const testRoot=path.resolve('work/naming-pipeline-'+process.pid);process.env.WIKI_DATA_ROOT=testRoot;
const {config,sha,dataPath}=await import('../scripts/common.mjs');
const {applyForeignReportNaming}=await import('../scripts/apply-foreign-naming.mjs');
test('future foreign ingestion names the raw file, updates Wiki title while retaining IDs and existing industry fields, and remains idempotent',async()=>{
  const original=config.foreignReportNaming;config.foreignReportNaming={enabled:true,pdfCache:path.join(testRoot,'pdf-cache'),catalogPath:path.join(testRoot,'catalog.csv')};
  try{
    await fs.mkdir(dataPath('raw/doc/r1'),{recursive:true});await fs.mkdir(config.foreignReportNaming.pdfCache,{recursive:true});
    const bytes=Buffer.from('fixture bytes'),hash=sha(bytes);await fs.writeFile(dataPath('raw/doc/r1/旧标题.pdf'),bytes);
    const pdf={pages:3,metadata:{},sample_pages:[{page:1,text:'1 September 2026\nStacy A. Rasgon\nstacy.rasgon@bernsteinsg.com\nNVIDIA (NVDA)\nSemiconductors outlook\n'+'Company evidence. '.repeat(30),lines:[{text:'Stacy A. Rasgon',size:10,x:350,y:60},{text:'NVIDIA (NVDA)',size:24,x:30,y:100},{text:'Semiconductors outlook',size:18,x:30,y:130}]}]};
    await fs.writeFile(path.join(config.foreignReportNaming.pdfCache,hash+'.json'),JSON.stringify(pdf));
    const record={id:'doc',revision:'r1',filename:'旧标题.pdf',raw_path:'raw/doc/r1/旧标题.pdf',sha256:hash,title:'20260901-伯恩斯坦-英伟达',source_meta:{report_category:'外资'},article_metadata:{industries:['原行业'],summary:'私人摘要',institutions:['Sanford C. Bernstein']}};
    await applyForeignReportNaming(record);
    assert.equal(record.naming.status,'ready');assert.match(record.filename,/_Bernstein_stacy-rasgon_/);assert.equal(record.filename.split('_').length,7);assert.deepEqual(record.article_metadata.institutions,['Bernstein']);
    assert.equal(sha(await fs.readFile(dataPath(record.raw_path))),hash);assert.equal(sha(await fs.readFile(dataPath('raw/doc/r1/旧标题.pdf'))),hash);
    assert.equal(record.id,'doc');assert.equal(record.revision,'r1');assert.equal(record.title,record.filename.slice(0,-4));assert.deepEqual(record.article_metadata.industries,['原行业']);assert.equal(record.article_metadata.topic_primary,'Semis');assert.ok(record.article_metadata.aliases.includes('20260901-伯恩斯坦-英伟达'));
    const before=JSON.stringify(record);await applyForeignReportNaming(record);assert.equal(JSON.stringify(record),before);
  }finally{config.foreignReportNaming=original;await fs.rm(testRoot,{recursive:true,force:true});}
});
test('historical migration preserves Wiki IDs, body evidence and domestic records while changing the visible title',async()=>{
  const {manifestPath,atomicJson}=await import('../scripts/common.mjs');
  const {buildForeignName}=await import('../scripts/foreign-report-naming.mjs');
  const folder=path.join(testRoot,'migration');await fs.mkdir(folder,{recursive:true});
  const bytes=Buffer.from('migration PDF'),hash=sha(bytes),raw=dataPath('raw/doc/r1/old.pdf');await fs.mkdir(path.dirname(raw),{recursive:true});await fs.writeFile(raw,bytes);
  const record={id:'doc',revision:'r1',sha256:hash,filename:'old.pdf',title:'20260901-伯恩斯坦-旧标题',raw_path:'raw/doc/r1/old.pdf',wiki_slug:'sources/doc',source_meta:{report_category:'外资'},article_metadata:{industries:['原行业'],markets:['美国']}};
  const pdf={pages:3,sample_pages:[{page:1,text:'1 September 2026\nStacy Rasgon\nstacy.rasgon@bernstein.com\nSemiconductors outlook\n'+'Original evidence. '.repeat(30),lines:[{text:'Semiconductors outlook',size:24,x:30,y:100}]}]};
  const n=buildForeignName(record,pdf);assert.equal(n.status,'ready');
  const domestic={id:'domestic',title:'国内原名',article_metadata:{institutions:['原机构']}};
  await atomicJson(manifestPath,{documents:{doc:record,domestic}});await fs.mkdir(dataPath('wiki/sources'),{recursive:true});await fs.writeFile(dataPath('wiki/sources/doc.md'),'---\ntitle: 旧标题\n---\n# 旧标题\n\n正文证据不变\n');
  for(const service of ['report-discovery','article-enrichment']){await fs.mkdir(dataPath('state',service),{recursive:true});await fs.writeFile(dataPath('state',service,'pause'),'foreign-naming-20260922');}
  const plan=path.join(folder,'plan.json');await atomicJson(plan,{rows:[{id:'doc',sha256:hash,raw_path:raw,source_files:[],exports:[],...n}]});
  const argv=process.argv;process.argv=['node','migration',plan,'--apply'];
  try{await import('../scripts/migrate-foreign-naming.mjs');const m=JSON.parse(await fs.readFile(manifestPath,'utf8'));assert.equal(m.documents.doc.title,n.report_key);assert.equal(m.documents.doc.revision,'r1');assert.equal(m.documents.doc.wiki_slug,'sources/doc');assert.deepEqual(m.documents.domestic,domestic);assert.deepEqual(m.documents.doc.article_metadata.industries,['原行业']);assert.match(await fs.readFile(dataPath('wiki/sources/doc.md'),'utf8'),/正文证据不变/);assert.equal(sha(await fs.readFile(dataPath(m.documents.doc.raw_path))),hash);assert.ok(await fs.stat(path.join(folder,'backup/manifest.json')));}finally{process.argv=argv;await fs.rm(testRoot,{recursive:true,force:true});}
});
