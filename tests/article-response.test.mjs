import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArticleJson,normalizeArticleResponse,evidenceText} from '../scripts/article-response.mjs';
import {groundedMetadata} from '../scripts/article-llm.mjs';

test('HTML tables and escaped entities match visible text while retaining signs and page boundaries',()=>{
  const source='## PDF 第 1 页\r\n<table><tr><td>002436.SZ</td><td>FASTPRINT</td><td>-3.2 &amp; 4.0</td></tr></table>\r\n## PDF 第 2 页\r\nOther evidence.\r\n';
  const entry={name:'FASTPRINT (002436.SZ)',quote:'002436.SZ FASTPRINT -3.2 & 4.0',page:1};
  assert.deepEqual(groundedMetadata({metadata:{companies:[entry]}},source).metadata.companies,['FASTPRINT (002436.SZ)']);
  assert.equal(groundedMetadata({metadata:{companies:[{...entry,page:2}]}},source).metadata.companies,null);
  assert.equal(groundedMetadata({metadata:{companies:[{...entry,quote:entry.quote.replace('-3.2','3.2')}]}},source).metadata.companies,null);
  assert.equal(evidenceText('Ping He<sup>†</sup>'),'Ping He†');
  assert.equal(evidenceText('2 < 3 and A &lt; B'),'2 < 3 and A < B');
  assert.equal(evidenceText('EPS of \\$3.70 was \\~6% higher.'),'EPS of $3.70 was ~6% higher.');
});

test('inline entity proofs preserve names and cannot supply evidence to unsupported siblings',()=>{
  const raw={metadata:{companies:[{name:'NVIDIA',quote:'NVIDIA supplies GPU products.',page:1},{name:'Invented',quote:'Invented supplies products.',page:1}]},evidence:[]};
  const normalized=normalizeArticleResponse(raw);
  assert.deepEqual(normalized.metadata.companies,['NVIDIA','Invented']);
  assert.equal(normalized.evidence[0].item,'NVIDIA');
  const checked=groundedMetadata(raw,'## PDF 第 1 页\nNVIDIA supplies GPU products.');
  assert.deepEqual(checked.metadata.companies,['NVIDIA']);
  assert.equal(checked.discarded[0].item,'Invented');
  assert.equal(typeof raw.metadata.companies[0],'object','do not mutate the recorded raw response');
  assert.deepEqual(normalizeArticleResponse({metadata:{},companies:raw.metadata.companies}).metadata.companies,['NVIDIA','Invented']);
  assert.deepEqual(normalizeArticleResponse({metadata:{companies:[]},companies:raw.metadata.companies}).metadata.companies,[]);
});

test('only literal controls are repaired; ambiguous quotes and truncation stay invalid',()=>{
  const valid={metadata:{summary:'normal "quote" and \\ backslash'}};
  assert.deepEqual(parseArticleJson(JSON.stringify(valid)),{value:valid,repairedControls:false});
  const repaired=parseArticleJson('{"quote":"price\tand\nreturn\rline"}');
  assert.equal(repaired.value.quote,'price\tand\nreturn\rline');
  assert.equal(repaired.repairedControls,true);
  assert.throws(()=>parseArticleJson('{"quote":"bad "quoted" words"}'),SyntaxError);
  assert.throws(()=>parseArticleJson('{"quote":"truncated'),SyntaxError);
});
