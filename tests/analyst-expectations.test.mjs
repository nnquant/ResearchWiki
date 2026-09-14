import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeArticleMetadata} from '../scripts/article-metadata.mjs';
import {groundAnalystExpectations,ratingStance,needsExpectationsBackfill,EXPECTATIONS_VERSION,expectationExample} from '../scripts/analyst-expectations.mjs';
import {validateArticleResult} from '../scripts/article-llm.mjs';
import {enrichmentQueue} from '../scripts/article-enrichment-state.mjs';
import {ENTITY_VERSION} from '../scripts/article-entities.mjs';
const source='## PDF 第 1 页\r\n\r\nExample Inc. (EX)\r\nRating: Buy. Price target US$25.\r\n\r\n## PDF 第 2 页\r\n\r\n<table><tr><td>USD</td><td>2026E</td><td>2027E</td></tr><tr><td>EPS</td><td>1.00</td><td>1.20</td></tr></table>\r\n';
const fixture=()=>structuredClone(expectationExample.analyst_expectations);

test('structured expectations preserve original fiscal labels and source table proofs',()=>{
  const normalized=normalizeArticleMetadata({analyst_expectations:fixture()});
  const result=groundAnalystExpectations(normalized.analyst_expectations,source);
  assert.equal(result.value[0].rating.stance,'bullish');
  assert.equal(result.value[0].target_price.currency,'USD');
  assert.equal(result.value[0].forecasts[0].period,'2027E');
  assert.equal(result.value[0].forecasts[0].value,'1.20');
  assert.equal(result.discarded.length,0);
});

test('consensus methodology does not turn broker forecasts into market consensus',()=>{
  const legend='\n\\*\\* = Based on consensus methodology\n§ = Consensus data is provided by Refinitiv Estimates\ne = Morgan Stanley Research estimates\n';
  const input=fixture();input[0].forecasts[0].metric_label='EPS**';input[0].forecasts[0].source='consensus';input[0].forecasts[0].evidence[1].quote='EPS** 1.00 1.20';
  const text=source.replace('<td>EPS</td>','<td>EPS**</td>')+legend;
  const forecast=groundAnalystExpectations(input,text).value[0].forecasts[0];
  assert.equal(forecast.source,'analyst');assert.ok(forecast.evidence.some(e=>e.quote==='e = Morgan Stanley Research estimates'));
  input[0].forecasts[0].metric_label='EPS§';input[0].forecasts[0].source='analyst';input[0].forecasts[0].evidence[1].quote='EPS§ 1.00 1.20';
  assert.equal(groundAnalystExpectations(input,source.replace('<td>EPS</td>','<td>EPS§</td>')+legend).value[0].forecasts[0].source,'consensus');
});

test('matching a quote does not excuse an invented number, wrong year or file page',()=>{
  const input=fixture();input[0].target_price.value='250';input[0].forecasts[0].period='2028E';
  const result=groundAnalystExpectations(input,source);
  assert.equal(result.value[0].target_price,null);
  assert.equal(result.value[0].forecasts.length,0);
  const wrongPage=fixture();wrongPage[0].evidence[0].page=2;
  assert.equal(groundAnalystExpectations(wrongPage,source).value,null);
  const wrongColumn=fixture();wrongColumn[0].forecasts[0].value='1.00';
  assert.equal(groundAnalystExpectations(wrongColumn,source).value[0].forecasts.length,0,'the other year contains this number but it is the wrong column');
  const missingHeader=fixture();missingHeader[0].forecasts[0].evidence.shift();
  const restored=groundAnalystExpectations(missingHeader,source).value[0].forecasts[0];
  assert.equal(restored.value,'1.20');assert.ok(restored.evidence.some(p=>p.quote.includes('2027E')));
});

test('ratings are conservatively mapped; not rated is not neutral and dollars alone are not USD',()=>{
  assert.equal(ratingStance('Equal-weight'),'neutral');assert.equal(ratingStance('Underperform'),'bearish');
  assert.equal(ratingStance('Not Rated'),'not_rated');assert.equal(ratingStance('Sector View'),null);
  const input=fixture();input[0].target_price.evidence[0].quote='Rating: Buy. Price target $25.';
  const result=groundAnalystExpectations(input,source.replace('US$25','$25'));
  assert.equal(result.value[0].target_price.currency,'$');
});

test('an actual year cannot become a forecast; explicit empty results are valid',()=>{
  const input=fixture();input[0].forecasts[0].period='2027A';
  assert.equal(groundAnalystExpectations(input,source.replace('2027E','2027A')).value[0].forecasts.length,0);
  assert.doesNotThrow(()=>validateArticleResult({metadata:{analyst_expectations:[]}},source,{expectationsOnly:true}));
  assert.throws(()=>validateArticleResult({metadata:{}},source,{expectationsOnly:true}),/analyst_expectations/);
  assert.throws(()=>normalizeArticleMetadata({analyst_expectations:[{...fixture()[0],unsupported:'value'}]}),/不支持字段/);
});

test('the batch applies new fields prospectively and skips all completed reports',()=>{
  const company={id:'company',title:'Example Inc. (EX)',revision:'r1',status:'indexed',llm:{status:'complete',entity_version:ENTITY_VERSION}};
  const macro={...company,id:'macro',title:'Global Macro Outlook'};
  assert.equal(needsExpectationsBackfill(company),true);assert.equal(needsExpectationsBackfill(macro),false);
  assert.equal(needsExpectationsBackfill({...company,llm:{...company.llm,expectations_version:EXPECTATIONS_VERSION}}),false);
  const legacy={...company,id:'legacy',llm:{status:'complete'}};
  const fresh={...company,id:'fresh',status:'parsed',llm:undefined};
  assert.deepEqual(enrichmentQueue([company,macro,legacy,fresh],{},{model:'local',baseUrl:'http://local'},'v2').ready.map(x=>x.id),['fresh']);
});
