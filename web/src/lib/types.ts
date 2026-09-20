import researchSchema from '../../../config/investment-research.schema.json';

export interface TypeMeta {
  label: string;
  dir: string | null;
  cssVar: string;
  description: string;
}

export const TYPE_META: Record<string, TypeMeta> = {
  tag: { label: '标签', dir: null, cssVar: '--accent', description: '连接具有共同标签的研究材料' },
  company: { label: '公司研究', dir: 'companies', cssVar: '--t-company', description: '商业模式、财务质量、竞争优势与投资论点' },
  macro: { label: '宏观研究', dir: 'macro', cssVar: '--t-macro', description: '增长、通胀、政策与资产传导机制' },
  event: { label: '事件跟踪', dir: 'events', cssVar: '--t-event', description: '公告、政策、业绩与催化剂的持续跟踪' },
  valuation: { label: '估值分析', dir: 'valuations', cssVar: '--t-valuation', description: '估值假设、可比口径、情景与敏感性' },
  meeting: { label: '调研纪要', dir: 'meetings', cssVar: '--t-meeting', description: '访谈、业绩会与实地调研记录' },
  source: { label: '文献', dir: 'sources', cssVar: '--t-source', description: '文章全文、图片与原文件；论文、研报等通过分类标签筛选' },
  paper: { label: '论文解读', dir: 'papers', cssVar: '--t-paper', description: '阅读后记录的方法、证据与适用边界' },
  report: { label: '研报解读', dir: 'reports', cssVar: '--t-report', description: '阅读后记录的研报分析' },
  claim: { label: '观点', dir: 'claims', cssVar: '--t-claim', description: '可被证据支持或反驳的论断' },
  hypothesis: { label: '假设', dir: 'hypotheses', cssVar: '--t-hypothesis', description: '待检验的可证伪假设' },
  factor: { label: '因子', dir: 'factors', cssVar: '--t-factor', description: '因子定义、口径与表现' },
  strategy: { label: '策略', dir: 'strategies', cssVar: '--t-strategy', description: '策略逻辑、参数与回测' },
  experiment: { label: '实验', dir: 'experiments', cssVar: '--t-experiment', description: '一次具体检验的设置与结果' },
  dataset: { label: '数据集', dir: 'datasets', cssVar: '--t-dataset', description: '数据来源、字段与缺陷' },
  security: { label: '证券', dir: 'securities', cssVar: '--t-security', description: '单个证券' },
  industry: { label: '行业研究', dir: 'industries', cssVar: '--t-industry', description: '供需、产业链、竞争格局与周期跟踪' },
  theme: { label: '投资主题', dir: 'themes', cssVar: '--t-theme', description: '跨行业驱动、受益路径与主题兑现条件' },
  metric: { label: '指标', dir: 'metrics', cssVar: '--t-metric', description: '指标定义' },
  institution: { label: '机构', dir: 'institutions', cssVar: '--t-institution', description: '机构' },
  concept: { label: '概念', dir: 'concepts', cssVar: '--t-concept', description: '研究规范与方法论' },
  note: { label: '笔记', dir: 'notes', cssVar: '--t-note', description: '自由笔记' },
};

export const CORE_TYPES = ['company', 'industry', 'macro'];
export const RESEARCH_TYPES = [...CORE_TYPES, 'theme', 'claim', 'event', 'valuation', 'meeting'];

/** Fundamental research first; historical quant pages remain accessible. */
export const TYPE_ORDER = [
  ...RESEARCH_TYPES, 'source', 'report', 'note', 'security', 'metric', 'institution', 'dataset', 'concept',
  'paper', 'hypothesis', 'factor', 'strategy', 'experiment',
];

export function typeLabel(type: string | null | undefined): string {
  if (!type) return '页面';
  return TYPE_META[type]?.label ?? type;
}

export function categoryLabel(category: string | null | undefined): string {
  return category === 'source' ? '待分类文献' : typeLabel(category);
}

export function typeColor(type: string | null | undefined): string {
  const meta = type ? TYPE_META[type] : undefined;
  return `var(${meta?.cssVar ?? '--t-other'})`;
}

export const RELATION_LABELS: Record<string, string> = {
  has_entity: '提及实体', has_tag: '包含标签',
  about: '研究对象', belongs_to: '所属行业 / 主题', impacts: '影响对象', compares_with: '对比对象',
  supported_by: '支持证据',
  contradicted_by: '反驳证据',
  derived_from: '来源',
  tests: '检验',
  uses_dataset: '使用数据',
  trades: '交易标的',
  measures: '度量',
  mentions: '引用',
};

/** Inverse phrasing for incoming relations: "X derived_from me" → "派生页面". */
export const RELATION_INCOMING_LABELS: Record<string, string> = {
  about: '相关研究', belongs_to: '所属成员', impacts: '影响来源', compares_with: '被比较于',
  supported_by: '支持的观点',
  contradicted_by: '反驳的观点',
  derived_from: '派生页面',
  tests: '被检验于',
  uses_dataset: '使用此数据的页面',
  trades: '交易此标的的策略',
  measures: '度量此指标的因子',
  mentions: '反向链接',
};

export const RELATION_FIELDS = researchSchema.link_types.map(t => t.name);

export const STATUS_LABELS: Record<string, string> = {
  unread: '未读',
  unreviewed: '未审核',
  reviewed: '已审核',
  draft: '草稿',
  verified: '已验证',
  rejected: '已否定',
};
