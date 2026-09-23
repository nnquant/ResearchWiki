import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanWikiAds,chunkProjector} from '../scripts/wiki-ad-cleanup.mjs';
import {cleanedWikiBody} from '../scripts/query/index.mjs';
const ad='a'.repeat(64), chart='b'.repeat(64);
const options={imageHashes:[ad]};
test('advertisement cover removed with image; original research page numbers survive',()=>{
  const body=`# Report\n\n## PDF 第 1 页\n\n本文由ima -【爱分享】的财经资讯收集整理\n获取一手资料请加QQ：390278005\n![](images/${ad}.jpg)\n\n## PDF 第 2 页\n\nRevenue rose 12%.\n`;
  const result=cleanWikiAds(body,options);
  assert.equal(result.body,'# Report\n\n## PDF 第 2 页\n\nRevenue rose 12%.\n');
  assert.equal(result.removed.filter(x=>x.kind==='image').length,1);
  assert.equal(cleanWikiAds(result.body,options).changed,false);
});
test('inline author signatures and disclosures survive',()=>{
  const body='## PDF 第 7 页\r\n\r\nLloyd Byrne, Equity Analyst, +1 929-595-5312 防失联请关注微信公众号：爱分享盈策\r\n风险提示：市场有风险。防失联请关注微信公众号：爱分享盈策\r\n';
  const cleaned=cleanWikiAds(body,options).body;
  assert.match(cleaned,/Lloyd Byrne, Equity Analyst, \+1 929-595-5312/);
  assert.match(cleaned,/风险提示：市场有风险。/);assert.doesNotMatch(cleaned,/爱分享/);
});
test('unknown images and tables are preserved on mixed pages',()=>{
  const body=`## PDF 第 2 页\n![](images/${chart}.png)\n<table><tr><td>Angel Castillo</td><td>390278005</td></tr></table>\nEPS 2.30\n`;
  const cleaned=cleanWikiAds(body,options).body;
  assert.match(cleaned,new RegExp(chart));assert.match(cleaned,/<td>Angel Castillo<\/td><td><\/td>/);assert.match(cleaned,/EPS 2.30/);
});
test('legitimate references to advertising and broker disclosures are untouched',()=>{
  const body='## PDF 第 1 页\n广告行业收入同比增长 10%。\n请关注微信公众号：高盛研究。\nPlease read the analyst certification and disclosures.\n';
  assert.equal(cleanWikiAds(body,options).body,body);
});
test('Wiki headers and metadata outside parsed page sections are untouched',()=>{
  const body='---\ntitle: 【爱分享】投研独家报告\n---\n# 【爱分享】投研独家报告\n\n## PDF 第 1 页\nResearch\n';
  assert.equal(cleanWikiAds(body,options).body,body);
});
test('schedule lines require multiple advertisement signatures on that page',()=>{
  const body='## PDF 第 1 页\n晚上8点左右更新一次\n防失联请关注微信公众号：爱分享盈策\n';
  assert.match(cleanWikiAds(body,options).body,/晚上8点左右更新一次/);
});
test('known posters removed even without OCR text; unknown posters not inferred',()=>{
  const body=`## PDF 第 1 页\n![](images/${ad}.jpg)\n## PDF 第 2 页\n![](images/${chart}.jpg)\n`;
  const result=cleanWikiAds(body,options);assert.doesNotMatch(result.body,/第 1 页/);assert.match(result.body,new RegExp(chart));
});
test('spaced OCR contact and promoter text are removed, adjacent data is retained',()=>{
  const body='## PDF 第 4 页\n数据来源：Wind 防失联请关注微信公众号：爱分享盈策\nEPS 请9:390278005 3.14\n更多资讯请加QQ:390278005\n';
  const result=cleanWikiAds(body,options).body;assert.match(result,/数据来源：Wind/);assert.match(result,/EPS  3.14/);assert.doesNotMatch(result,/390278005|更多资讯/);
});
test('query projection uses only marked cleaned Wiki PDF sections',()=>{
  const text='# Report\n[Original file](example.pdf)\n\n## PDF 第 3 页\nReal report\n';
  assert.equal(cleanedWikiBody({},text),null);
  assert.equal(cleanedWikiBody({wiki_ad_cleanup:{version:'unknown'}},text),null);
  assert.equal(cleanedWikiBody({wiki_ad_cleanup:{version:'wiki-ads-20260923-v1'}},text),'## PDF 第 3 页\nReal report\n');
  assert.equal(cleanedWikiBody({wiki_ad_cleanup:{version:'wiki-ads-20260923-v1'}},'# Advertising-only document\n'),'');
});
test('exact deletion trace cleans overlapping chunks even when the ad is split',()=>{
  const source='## PDF 第 1 页\n报告😀\n收入增长10%。防失联请关注微信公众号：爱分享盈策\n正文图表保留。\n';
  const result=cleanWikiAds(source,{...options,trace:true}),project=chunkProjector(source,result);
  assert.equal(project('收入增长10%。防失联请关注微信'),'收入增长10%。');
  assert.equal(project('请关注微信公众号：爱分享盈策\n正文图表保留。'),'正文图表保留。');
  assert.equal(project('报告😀 收入增长10%。'),'报告😀 收入增长10%。');
  assert.throws(()=>project('不存在于原文的句子'),/source span/);
});
test('deletion trace removes split poster references without touching chart bytes',()=>{
  const source=`## PDF 第 1 页\n![](images/${ad}.jpg)\n## PDF 第 2 页\n![](images/${chart}.jpg)\n`;
  const project=chunkProjector(source,cleanWikiAds(source,{...options,trace:true}));
  assert.equal(project(ad.slice(0,20)), '');
  assert.equal(project(`![](images/${chart}.jpg)`),`![](images/${chart}.jpg)`);
});
