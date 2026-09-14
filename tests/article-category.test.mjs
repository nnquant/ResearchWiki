import test from 'node:test';
import assert from 'node:assert/strict';
import { articleCategory } from '../scripts/article-category.mjs';
import { normalizeArticleMetadata } from '../scripts/article-metadata.mjs';

test('routes reports by their primary subject, ignoring publisher and incidental mentions', () => {
  const cases = [
    ['20260831-摩根士丹利-雅生活服务风险回报更新 A_Living Services Co Ltd（3319.HK）：Risk Reward Update', 'company'],
    ['20260903-高盛-NetApp（NTAP）F1Q27回顾：超预期并小幅上调FY27指引', 'company'],
    ['20260903-高盛-哈默纳科（6324.T）_穗高与有明工厂参观', 'company'],
    ['20260904-美银证券-中国观察：8月数据预览——边际改善，疲态犹存', 'macro'],
    ['20260903-花旗-中国互联网2Q26总结与2H26展望：AI与非AI前景与争议', 'industry'],
    ['20260904-摩根大通-矿业日报：铁矿石、黄金、中国铝业', 'industry'],
    ['20260904-摩根大通-食品、饮料与烟草 Food, Beverage, and Tobacco', 'industry'],
    ['20260831-巴克莱-中国地产：1999年以来最大的住房改革', 'industry'],
    ['20260904-野村-全球外汇与利率月度分析', 'macro'],
    ['20260904-摩根大通-全球市场展望：为下一投资周期布局', 'strategy'],
    ['20260904-摩根大通-欧洲Q_Score：8月质量领先驱动Q_Score上涨', 'strategy'],
    ['某公司调研纪要：增长与估值', 'meeting'],
    ['估值模型比较：现金流折现和相对估值', 'valuation'],
    ['能源转型主题研究：受益路径', 'theme'],
    ['事件跟踪：重大公告汇总', 'event'],
    ['阅读材料', 'source'],
  ];
  for (const [title, category] of cases) assert.equal(articleCategory({ title }), category, title);
});

test('explicit categories win; unclear or conflicting topics remain unclassified', () => {
  assert.equal(articleCategory({ title: '中国互联网展望', research_category: 'company' }), 'company');
  assert.equal(articleCategory({ title: '公司业绩点评', research_category: 'source' }), 'source');
  assert.equal(articleCategory({ title: '新观察', research_topics: ['货币政策', '通胀'] }), 'macro');
  assert.equal(articleCategory({ title: '新观察', tags: ['通胀', '半导体'] }), 'source');
  assert.equal(articleCategory({ title: '阅读材料', summary: '提到苹果公司、银行业与通胀' }), 'source');
  assert.equal(articleCategory({ title: '宏观', research_category: 'company' }, 'note'), 'note');
  assert.throws(() => normalizeArticleMetadata({ research_category: 'garbage' }));
  assert.deepEqual(normalizeArticleMetadata({ research_category: 'industry' }), { research_category: 'industry' });
});
