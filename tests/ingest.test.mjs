import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const testRoot=path.resolve('work','tests-'+process.pid);
process.env.WIKI_DATA_ROOT=testRoot;
const {ensureDirs,manifest,withLock,sha,dataPath,safeName}=await import('../scripts/common.mjs');
const {capture,parseRecord,extractHtml,cleanUrl,isPrivateIp,validateUrl,updateArticleMetadata}=await import('../scripts/ingest.mjs');
const {normalizeArticleMetadata}=await import('../scripts/article-metadata.mjs');

test('long archive names preserve file extensions and never end with a dot or space',()=>{
  for(const name of ['a'.repeat(149)+'.pdf','b'.repeat(148)+' .pdf','标题'.repeat(100)+'.pdf']) {
    const safe=safeName(name);assert.ok(safe.length<=150);assert.ok(safe.endsWith('.pdf'));assert.ok(!/[. ]$/.test(safe));
  }
});
const {readPage,invalidateScan}=await import('../scripts/server/wiki-files.mjs');
await ensureDirs();

test('immutable originals, content revisions and idempotent ingestion',async()=>{
  const body=Buffer.from('# 量化研究\n\n'+('样本外验证要记录交易成本和原始数据。'.repeat(15)));
  const first=await parseRecord(await capture({bytes:body,filename:'中文研究.md',source_key:'fixture:doc'}));
  const duplicate=await capture({bytes:body,filename:'中文研究.md',source_key:'fixture:doc'});
  assert.equal(duplicate.duplicate,true);assert.equal(first.id,duplicate.id);
  assert.equal(sha(await fs.readFile(dataPath(first.raw_path))),first.sha256);
  const updated=await parseRecord(await capture({bytes:Buffer.concat([body,Buffer.from('\n新增数据来源')]),filename:'中文研究.md',source_key:'fixture:doc'}));
  assert.equal(updated.id,first.id);assert.notEqual(updated.revision,first.revision);
  assert.equal(updated.history.length,1);assert.equal(sha(await fs.readFile(dataPath(first.raw_path))),first.sha256);
});
test('failed parse retains original and records error',async()=>{
  const item=await capture({bytes:Buffer.from('not a pdf'),filename:'bad.pdf',source_key:'fixture:bad'});
  await assert.rejects(()=>parseRecord(item),/仅支持/);
  const m=await manifest();assert.equal(m.documents[item.id].status,'failed');
  assert.equal((await fs.readFile(dataPath(item.raw_path))).toString(),'not a pdf');
});

test('parallel imports keep every manifest record and its completed status',async()=>{
  const results=await Promise.all(Array.from({length:8},async(_,i)=>parseRecord(await capture({bytes:Buffer.from(('并发文献'+i+'，保留完整正文。').repeat(30)),filename:`parallel-${i}.md`,source_key:`parallel:${i}`}))));
  const m=await manifest();
  for(const result of results){assert.equal(m.documents[result.id].status,'parsed');assert.equal(m.documents[result.id].sha256,result.sha256);}
});

test('metadata survives duplicate import and reparse; clearing fields preserves original evidence',async()=>{
  const body=Buffer.from('# 文献信息验证\n\n'+'保留原文，元信息仅在 frontmatter 中编辑。'.repeat(20));
  const first=await parseRecord(await capture({bytes:body,filename:'metadata.md',source_key:'fixture:metadata',metadata:{authors:['作者甲'],personal_rating:0,abstract:'摘要内容',sample_start:'2020-01-01',sample_end:'2021-01-01'}}));
  invalidateScan();
  const original=(await readPage(first.wiki_slug)).body;
  const parsedHash=sha(await fs.readFile(dataPath(first.parsed_path)));
  await updateArticleMetadata(first.id,{authors:null,abstract:'',institutions:['机构甲'],tags:[],sample_end:null});
  const page=await readPage(first.wiki_slug);
  assert.equal(page.body,original);
  assert.equal(page.frontmatter.authors,null);
  assert.equal(page.frontmatter.abstract,null);
  assert.equal(page.frontmatter.tags,null);
  assert.equal(page.frontmatter.personal_rating,0);
  assert.equal(sha(await fs.readFile(dataPath(first.raw_path))),first.sha256);
  assert.equal(sha(await fs.readFile(dataPath(first.parsed_path))),parsedHash);
  const duplicate=await capture({bytes:body,filename:'metadata.md',source_key:'fixture:metadata',metadata:{methods:['线性规划']}});
  assert.equal(duplicate.duplicate,true);
  assert.deepEqual((await readPage(first.wiki_slug)).frontmatter.methods,['线性规划']);
  await parseRecord((await manifest()).documents[first.id]);
  invalidateScan();
  assert.equal((await readPage(first.wiki_slug)).frontmatter.authors,null);
  assert.deepEqual((await readPage(first.wiki_slug)).frontmatter.institutions,['机构甲']);
});

test('optional metadata validates dates, rating, arrays and protected fields',()=>{
  assert.deepEqual(normalizeArticleMetadata({authors:[' ', 'A','A'],doi:' ',personal_rating:0}),{authors:['A'],doi:null,personal_rating:0});
  assert.throws(()=>normalizeArticleMetadata({sample_start:'2026-02-30'}),/真实日期/);
  assert.throws(()=>normalizeArticleMetadata({sample_start:'2026-09-01',sample_end:'2025-01-01'}),/晚于/);
  assert.throws(()=>normalizeArticleMetadata({personal_rating:6}),/0–5/);
  assert.throws(()=>normalizeArticleMetadata({authors:'A'}),/数组/);
  assert.throws(()=>normalizeArticleMetadata({raw_path:'elsewhere'}),/不支持/);
});
test('WeChat lazy images and Chinese article content survive Defuddle',async()=>{
  const html=`<html><head><title>量化交易研究</title><meta property="article:published_time" content="2026-09-06"></head><body><h1>量化交易研究</h1><div id="js_content" style="display:none"><h2>样本外证据</h2><p>${'讨论因子在样本外的稳定性，并记录成本、换手与容量。'.repeat(25)}</p><img data-src="https://example.com/chart.png" width="900" height="500"></div><footer>网站导航</footer></body></html>`;
  const result=await extractHtml(Buffer.from(html),'https://mp.weixin.qq.com/s/example');
  assert.match(result.text,/样本外/);assert.match(result.text,/chart\.png/);assert.equal(result.title,'量化交易研究');
});
test('blocked WeChat page is never indexed as an article',async()=>{
  await assert.rejects(()=>extractHtml(Buffer.from('<title>环境异常</title><p>验证码</p>'),'https://mp.weixin.qq.com/s/blocked'),/正文不可读取/);
});
test('X login shell is rejected, saved article HTML is accepted',async()=>{
  await assert.rejects(()=>extractHtml(Buffer.from('<html><title>X</title><body>'+('Log in to X. '.repeat(50))+'</body></html>'),'https://x.com/i/article/123'),/未提供可读取/);
  const html='<html><title>Risk premium research</title><body><article><h1>Risk premium research</h1><p>'+('Distributional forecasts document the full predictive distribution and calibration. '.repeat(25))+'</p></article></body></html>';
  const result=await extractHtml(Buffer.from(html),'https://x.com/i/article/123');
  assert.match(result.text,/Distributional forecasts/);
});
test('URL validation rejects local files and loopback, preserves meaningful query',async()=>{
  assert.equal(cleanUrl('https://example.com/article?id=42&utm_source=x#section'),'https://example.com/article?id=42');
  for(const ip of ['127.0.0.1','10.0.0.8','172.16.0.1','192.168.1.1','::1','::ffff:127.0.0.1'])assert.equal(isPrivateIp(ip),true);
  assert.equal(isPrivateIp('8.8.8.8'),false);
  await assert.rejects(()=>validateUrl('file:///etc/passwd'));
  await assert.rejects(()=>validateUrl('http://127.0.0.1:3131/admin'));
});
test('concurrent ingestion is refused without corrupting manifest',async()=>{
  await withLock(async()=>{await assert.rejects(()=>withLock(async()=>{}),/占用锁/);});
  assert.ok((await manifest()).documents);
});
