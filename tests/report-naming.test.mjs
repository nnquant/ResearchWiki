import baseTest from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {buildForeignName,validateForeignFilename,withParsedNamingFallback,authorCandidates} from '../scripts/foreign-report-naming.mjs';
import {dictionaryMatch,publisherFor,normalizeBibliography,reportDictionaries} from '../scripts/report-dictionaries.mjs';
import {verifiedRename} from '../scripts/apply-foreign-naming.mjs';
import {analystId} from '../scripts/report-identity.mjs';
import {reportDate} from '../scripts/foreign-report-naming.mjs';
import {normalizeArticleMetadata} from '../scripts/article-metadata.mjs';
import {normalizeReportMetadata,hasReportDictionaries} from '../scripts/report-dictionaries.mjs';
// These cases exercise the real broker/topic dictionary, which is local instance data kept out of git.
const test=(name,fn)=>baseTest(name,{skip:!hasReportDictionaries&&'config/report-dictionaries.json not present'},fn);
const hash=b=>createHash('sha256').update(b).digest('hex');
const dict={...reportDictionaries,authors:[{id:'Bernstein:Stacy-Rasgon',institution:'Bernstein',name:'Stacy Rasgon',surname:'Rasgon',aliases:['Stacy A. Rasgon']},{id:'Other:Stacy-Rasgon',institution:'Other',name:'Other Person',surname:'Rasgon',aliases:['Stacy A. Rasgon']}]};
const record={title:'20260904-伯恩斯坦-芯片 NVIDIA (NVDA.US)',source_meta:{import_path:'D:/data/reports/raw/2026年9月/伯恩斯坦/old.pdf',sort_date:'2026-09-04',sort_date_source:'filename'},article_metadata:{authors:['Stacy A. Rasgon'],markets:['美国'],industries:['半导体']}};
const pdf={pages:15,metadata:{creationDate:'D:20260904010000'},sample_pages:[{page:1,text:'本文由ima 广告',lines:[]},{page:2,text:'3 September 2026\nNVIDIA (NVDA)\nSemiconductors outlook\nStacy A. Rasgon\nstacy.rasgon@bernstein.com\n'+'Company evidence. '.repeat(30),lines:[{text:'NVIDIA (NVDA)',size:24,x:30,y:60},{text:'Semiconductors outlook',size:18,x:30,y:95}]}]};
test('seven fields, actual pages, original heading, precise report date, scoped author dictionary',()=>{
  const n=buildForeignName(record,pdf,{dict});assert.equal(n.status,'ready');assert.equal(n.date,'2026-09-03');assert.equal(n.analyst,'stacy-rasgon');assert.equal(n.author,'Stacy Rasgon');assert.equal(n.coverage,'Semis');assert.deepEqual(n.tickers,['NVDA']);assert.equal(n.pages,15);assert.equal(n.filename.split('_').length,7);assert.ok(n.filename.endsWith('_15p.pdf'));assert.ok(!n.slug.includes('NVDA'));
  assert.equal(dictionaryMatch('authors','Stacy A. Rasgon',{dict}),null);assert.equal(dictionaryMatch('authors','Rasgon',{dict,institution:'Bernstein'}),null);
});
test('publisher prefixes do not confuse domestic affiliates, broad names, or body mentions',()=>{
  assert.equal(publisherFor({title:'20260901-瑞银证券-A股',source_meta:record.source_meta}).foreign,false);
  assert.equal(publisherFor({title:'20260901-摩根-研究'}),null);
  assert.equal(publisherFor({title:'20260901-国投瑞银-基金公告'}),null);
  assert.equal(publisherFor({title:'20260901-摩根大通-大摩新闻'}).id,'JPMorgan');
  const local={...pdf,sample_pages:pdf.sample_pages.map(p=>({...p,text:p.text+'\nIssuer of report: HSBC Qianhai Securities Limited\n'}))};
  assert.equal(buildForeignName({title:'20260901-汇丰-报告'},local).reason,'domestic-issuer');
});
test('first analyst follows visual page order rather than PDF internal text order',()=>{
  const front={page:1,text:'Dominic Bunning\ndominic.bunning@nomura.com\nCraig Chan\ncraig.chan@nomura.com',lines:[{text:'Dominic Bunning',x:350,y:100},{text:'Craig Chan',x:20,y:100}]};
  assert.equal(authorCandidates(front,{}).at(0).name,'Craig Chan');
});
test('unknown dictionary values retain source, and invalid critical metadata stays in review',()=>{
  const mapped=normalizeBibliography({institutions:['Goldman Sachs','Goldman Sachs International'],authors:['Unlisted Analyst'],language:'英文',markets:['美国','Unlisted Market']});
  assert.deepEqual(mapped.institutions,['GoldmanSachs']);assert.deepEqual(mapped.authors,['Unlisted Analyst']);assert.equal(mapped.language,'英文');assert.deepEqual(mapped.markets,['美国','Unlisted Market']);
  const n=buildForeignName(record,pdf,{dict:{...dict,authors:[]}});assert.equal(n.author_source,'source-fallback');assert.ok(n.fallback.some(f=>f.field==='author'));assert.equal(dict.authors.length,2);
  assert.equal(buildForeignName(record,{...pdf,sample_pages:[]}).status,'review');
  assert.throws(()=>validateForeignFilename('2026-00-03_Bernstein_stacy-rasgon_Semis_NVDA_title_15p.pdf'));
  assert.throws(()=>validateForeignFilename('2026-09-03_Bernstein_stacy-rasgon_Semis_NVDA_标题_15p.pdf'));
});
test('renaming rejects different bytes at destination and retains backwards-compatible raw aliases',async()=>{
  const folder=await fs.mkdtemp(path.resolve('work/naming-test-'));const old=path.join(folder,'old.pdf'),dest=path.join(folder,'2026-09-03_Bernstein_stacy-rasgon_Semis_NVDA_title_15p.pdf');
  try{await fs.writeFile(old,'original');await fs.writeFile(dest,'other');await assert.rejects(verifiedRename(old,dest,hash('original')),/冲突/);assert.equal(await fs.readFile(old,'utf8'),'original');await fs.unlink(dest);await verifiedRename(old,dest,hash('original'),{keepAlias:true});assert.equal(await fs.readFile(old,'utf8'),'original');assert.equal(await fs.readFile(dest,'utf8'),'original');await verifiedRename(old,dest,hash('original'));await assert.rejects(fs.access(old));}finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('v3 analyst identity retains surname particles and strips credentials and middle names',()=>{
  assert.equal(analystId('Stacy A. Rasgon, Ph.D.'),'stacy-rasgon');
  assert.equal(analystId('Arpad von Nemes Ac'),'arpad-von-nemes');
  assert.equal(analystId('John van der Meer CFA'),'john-van-der-meer');
});
test('publication dates exclude body references and file/upload fallback, and keep Wiki day precision',()=>{
  const rec={title:'20260904-伯恩斯坦-Title',source_meta:{sort_date:'2026-09-04',upload_date:'2026-09-04'}};
  const front={text:'Pricing as of 3 September 2026\nSeptember 2026',lines:[]};
  assert.equal(reportDate({sample_pages:[],metadata:{}},rec,front),null);
  assert.equal(reportDate({sample_pages:[],metadata:{creationDate:'D:20260830000000'}},rec,front),null);
  const created=reportDate({sample_pages:[],metadata:{creationDate:'D:20260903000000'}},rec,front);
  assert.equal(created.date,'2026-09-03');assert.equal(created.date_precision,'day');
  assert.equal(reportDate({sample_pages:[]},rec,{text:'7 September 2026',lines:[]}).invalid,true);
  const published=reportDate({sample_pages:[{text:'First Published: 03 Sep 2026 23:45 UTC'}]},rec,{text:'4 September 2026',lines:[]});
  assert.equal(published.date,'2026-09-03');assert.equal(published.first_published_utc,'2026-09-03T23:45:00Z');
});
test('topic has a closed dictionary, and later model output cannot overwrite verified bibliography',()=>{
  assert.throws(()=>normalizeArticleMetadata({topic_primary:'US-Semis'}));
  assert.deepEqual(normalizeArticleMetadata({topic_primary:'Semis',industries:['原行业']}),{topic_primary:'Semis',industries:['原行业']});
  const n=buildForeignName(record,pdf,{dict});
  const mapped=normalizeReportMetadata({...record,naming:n},{authors:['Someone Else'],institutions:['Other'],published_at:'2020-01-01',industries:['原行业']});
  assert.deepEqual(mapped.authors,n.authors);assert.equal(mapped.published_at,n.date);assert.deepEqual(mapped.industries,['原行业']);
  validateForeignFilename('2026-09-03_Bernstein_research_Unknown_SECTOR_title_0p.pdf');
});
