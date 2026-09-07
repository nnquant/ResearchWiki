export interface TypeMeta {
  label: string;
  dir: string | null;
  cssVar: string;
  description: string;
}

export const TYPE_META: Record<string, TypeMeta> = {
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
  industry: { label: '行业', dir: 'industries', cssVar: '--t-industry', description: '行业' },
  theme: { label: '主题', dir: 'themes', cssVar: '--t-theme', description: '投资主题' },
  metric: { label: '指标', dir: 'metrics', cssVar: '--t-metric', description: '指标定义' },
  institution: { label: '机构', dir: 'institutions', cssVar: '--t-institution', description: '机构' },
  concept: { label: '概念', dir: 'concepts', cssVar: '--t-concept', description: '研究规范与方法论' },
  note: { label: '笔记', dir: 'notes', cssVar: '--t-note', description: '自由笔记' },
};

/** Full-text literature is the primary reading entry. */
export const TYPE_ORDER = [
  'source', 'note', 'paper', 'report', 'claim', 'hypothesis', 'factor', 'strategy', 'experiment', 'dataset',
  'concept', 'security', 'industry', 'theme', 'metric', 'institution',
];

export function typeLabel(type: string | null | undefined): string {
  if (!type) return '页面';
  return TYPE_META[type]?.label ?? type;
}

export function typeColor(type: string | null | undefined): string {
  const meta = type ? TYPE_META[type] : undefined;
  return `var(${meta?.cssVar ?? '--t-other'})`;
}

export const RELATION_LABELS: Record<string, string> = {
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
  supported_by: '支持的观点',
  contradicted_by: '反驳的观点',
  derived_from: '派生页面',
  tests: '被检验于',
  uses_dataset: '使用此数据的页面',
  trades: '交易此标的的策略',
  measures: '度量此指标的因子',
  mentions: '反向链接',
};

export const RELATION_FIELDS = ['supported_by', 'contradicted_by', 'derived_from', 'tests', 'uses_dataset', 'trades', 'measures'];

export const STATUS_LABELS: Record<string, string> = {
  unread: '未读',
  unreviewed: '未审核',
  reviewed: '已审核',
  draft: '草稿',
  verified: '已验证',
  rejected: '已否定',
};
