/** Reading categories are independent of source storage and edit permissions. */
export const ARTICLE_CATEGORIES = ['company', 'industry', 'macro', 'theme', 'event', 'valuation', 'meeting', 'strategy', 'source'];

const companyCode = /[（(]\s*(?:\d{4,6}(?:\.(?:HK|SH|SZ|SS|T|KS|KQ|TW))?|[A-Z][A-Z0-9.-]{0,9}\.(?:US|HK|N|O|L|T)|[A-Z]{1,5})\s*[)）]/;
const companyName = /\b(?:Inc\.?|Corp\.?|Corporation|Co\.,?\s*Ltd\.?|Holdings?\s+Ltd\.?|plc)\b|股份有限公司|控股有限公司/i;
const industry = /行业|产业链|板块|供应链|互联网|半导体|软件|硬件|汽车|新能源|光伏|储能|锂电|电池|矿业|有色|钢铁|煤炭|石油|石化|化工|航空|航运|物流|银行业|保险业|券商|房地产|地产|医药|医疗|生物科技|食品|饮料|烟草|零售|奢侈品|旅游|酒店|电力|公用事业|通信|电信|传媒|游戏|机械|制造业|建筑|建材|水泥|农业|农产品|消费品|\b(?:sector|industry|industrials|internet|semiconductors?|software|hardware|autos?|automotive|mining|metals|energy|utilities|healthcare|biotech|banks|insurance|retail|consumer|food|beverage|tobacco|real estate|property|telecom|shipping|airlines)\b/i;
const macro = /宏观|经济|通胀|通缩|央行|美联储|降息|加息|降准|货币政策|财政政策|就业|失业|非农|关税|贸易|国际收支|汇率|外汇|利率|国债|美债|欧债|债市|固收|固定收益|流动性|资金面|社融|信贷|住房改革|\b(?:macro|economy|economic|economics|inflation|deflation|GDP|CPI|PPI|PMI|PCE|FOMC|ECB|BOJ|BOE|payrolls?|unemployment|tariffs?|FX|forex|rates|treasuries|fixed income|monetary|fiscal)\b/i;
const strategy = /资产配置|市场展望|市场策略|投资策略|股票策略|量化|因子|多空|择时|选股|风险溢价|期权策略|组合构建|组合管理|Q[_ -]?Score|\b(?:strategy|strategies|asset allocation|market outlook|markets outlook|portfolio|quantitative|factor investing|stock selection)\b/i;
const meeting = /纪要|访谈|调研记录|电话会记录|业绩会实录|\b(?:transcript|interview notes|meeting notes)\b/i;
const valuation = /估值框架|估值方法|估值模型|估值分析|\b(?:valuation framework|valuation methodology|valuation model|valuation analysis)\b/i;
const theme = /投资主题|主题投资|主题研究|超级周期|碳中和|能源转型|人工智能|机器人|\b(?:thematic|megatrends?|energy transition|artificial intelligence|robotics)\b/i;
const companyResults = /业绩|财报|盈利预测|首次覆盖|目标价|回购|公司研究|个股|风险回报|\b(?:earnings|results|initiat(?:e|ing|ion)|price target|risk[ /_-]*reward)\b/i;

function inferTitle(text) {
  if (!text) return null;
  // Ignore filename date and publisher; neither is the research subject.
  const title = text.normalize('NFKC').replace(/^\d{8}[-_][^-_]+[-_]/, '');
  const head = title.split(/[:：]/)[0];
  if (/^(?:中国|美国|欧洲|日本|英国|韩国|印度|全球)(?:观察|数据)|^(?:China|US|U\.S\.|Europe|Japan|UK|Korea|India)\s+(?:Watch|Data)/i.test(head)) return 'macro';
  if (/动量配置|\bmomentum allocator\b/i.test(head)) return 'strategy';
  if (meeting.test(title)) return 'meeting';
  if (valuation.test(head)) return 'valuation';
  if (companyCode.test(head) || companyName.test(head)) return 'company';
  if (macro.test(head)) return 'macro';
  if (strategy.test(head)) return 'strategy';
  if (industry.test(head)) return 'industry';
  if (theme.test(head)) return 'theme';
  if (companyCode.test(title) || companyName.test(title) || companyResults.test(title)) return 'company';
  if (macro.test(title)) return 'macro';
  if (strategy.test(title)) return 'strategy';
  if (industry.test(title)) return 'industry';
  if (theme.test(title)) return 'theme';
  if (/事件跟踪|事件点评|公告点评|\bevent (?:review|update|monitor)\b/i.test(title)) return 'event';
  return null;
}

export function articleCategory(fields = {}, type = 'source') {
  if (type !== 'source') return type;
  if (ARTICLE_CATEGORIES.includes(fields.research_category)) return fields.research_category;
  const titleCategory = inferTitle(typeof fields.title === 'string' ? fields.title : '');
  if (titleCategory) return titleCategory;
  // Use topical metadata only when the title cannot be classified. Do not scan
  // the full text, which mentions many unrelated companies and risk factors.
  const topics = [fields.research_topics, fields.tags].flatMap(value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : []);
  const votes = topics.map(inferTitle).filter(Boolean);
  const counts = new Map();
  for (const category of votes) counts.set(category, (counts.get(category) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : 'source';
}
