import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedArticles, checkTranslation, translateArticle } from '../scripts/enrich-articles.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isForeignReport } from '../scripts/report-priority.mjs';

test('latest date wins; foreign publishers win ties without classifying subjects as publishers',()=>{
  const doc=(id,date,source_meta={})=>({id,status:'parsed',parsed_path:'test.md',source_meta:{sort_date:date,...source_meta}});
  const docs=[
    doc('domestic','2026-09-10',{batch_order:1,import_path:'D:/data/reports/raw1/a.pdf'}),
    doc('foreign','2026-09-10',{batch_order:99,import_path:'D:\\data\\reports\\raw\\a.pdf'}),
    doc('newest','2026-09-11',{report_category:'内资'}),
    doc('old-foreign','2026-09-09',{report_category:'外资'}),
  ];
  assert.deepEqual(orderedArticles(docs).map(d=>d.id),['newest','foreign','domestic','old-foreign']);
  assert.equal(isForeignReport({title:'高盛观点',source_meta:{import_path:'D:/data/reports/raw1/a.pdf'}}),false);
  assert.equal(isForeignReport({source_meta:{report_category:'内资',import_path:'D:/data/reports/raw/a.pdf'}}),false);
  assert.equal(isForeignReport({}),false);
});

test('article queue uses publication dates, then source dates, and deterministic batch order',()=>{
  const doc=(id,extra)=>({id,status:'parsed',parsed_path:'test.md',...extra});
  const docs=[doc('older',{source_meta:{sort_date:'2026-08-01'}}),doc('b',{source_meta:{sort_date:'2026-09-04',batch_order:2}}),doc('a',{source_meta:{sort_date:'2026-09-04',batch_order:1}}),doc('verified',{article_metadata:{published_at:'2026-09-05'},source_meta:{sort_date:'2026-01-01'}}),doc('failed',{status:'failed'}),doc('undated',{})];
  assert.deepEqual(orderedArticles(docs).map(d=>d.id),['verified','a','b','older','undated']);
});
test('fulltext translation sends every page in ONE request and caches the whole response',async()=>{
  const folder=path.resolve('work','translation-test-'+process.pid);await fs.mkdir(folder,{recursive:true});
  const text='## PDF 第 1 页\n\n'+('正文 content.\n'.repeat(4000))+'## PDF 第 2 页\n\n第二页内容。';
  const originalFetch=globalThis.fetch;const requests=[];
  globalThis.fetch=async(url,init)=>{
    requests.push(JSON.parse(init.body));
    const translated=text.replaceAll('content','内容');
    const events=[{choices:[{delta:{content:translated.slice(0,15000)}}]},{choices:[{delta:{content:translated.slice(15000)},finish_reason:'stop'}]},{choices:[],usage:{total_tokens:123}}];
    return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  try {
    const cfg={model:'fixture',baseUrl:'https://test.invalid/v1',apiKey:'test'};
    const result=await translateArticle(cfg,text,path.join(folder,'fulltext.json'));
    assert.equal(result.mode,'fulltext');assert.equal(result.pages,2);assert.equal(requests.length,1);
    assert.ok(requests[0].messages[1].content.includes(text));assert.equal(requests[0].max_tokens,65536);
    assert.equal(requests[0].stream,true);assert.equal(result.usage.total_tokens,123);
    await translateArticle(cfg,text,path.join(folder,'fulltext.json'));assert.equal(requests.length,1);
  } finally {globalThis.fetch=originalFetch;await fs.rm(folder,{recursive:true,force:true});}
});
test('translation validation rejects truncated tables, missing images, and untranslated text',()=>{
  const source='Title ![](images/a.jpg)\n<table><tr><td>Value</td></tr><tr><td>1</td></tr></table>';
  checkTranslation(source,'标题 ![](images/a.jpg)\n<table><tr><td>数值</td></tr><tr><td>1</td></tr></table>');
  assert.throws(()=>checkTranslation(source,'标题很长，但是图片引用已经被删除了'),/图片/);
  assert.throws(()=>checkTranslation(source,'标题 ![](images/a.jpg)<table><tr><td>1</td></tr></table>'),/表格/);
  assert.throws(()=>checkTranslation(source,source),/中文/);
  assert.throws(()=>checkTranslation(source,'标题 ![](images/a.jpg)<table><tr><td>数值</td></tr><tr><td>2</td></tr></table>'),/数字/);
  assert.throws(()=>checkTranslation('## PDF 第 1 页\n\n'+source,'## PDF 第 2 页\n\n标题 ![](images/a.jpg)<table><tr><td>数值</td></tr><tr><td>1</td></tr></table>'),/页号/);
});
