import fields from '../../../config/research-fields.json';

export interface ResearchField { label: string; kind: string; options?: Record<string, string> }
export const RESEARCH_FIELDS: Record<string, ResearchField> = fields;
export const RESEARCH_STAGES = fields.research_stage.options;
export type ResearchMetadata = Record<string, string | string[] | null>;

export function researchError(field: string, value: unknown): string | null {
  if (value == null || value === '') return null;
  const spec = RESEARCH_FIELDS[field];
  const ok = spec.kind === 'date'
    ? typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
    : spec.kind === 'select' ? typeof value === 'string' && Object.hasOwn(spec.options ?? {}, value)
    : spec.kind === 'list' ? Array.isArray(value) && value.every(v => typeof v === 'string' && v.trim() && v.length <= 200)
    : typeof value === 'string' && value.length <= 200;
  return ok ? null : `${spec.label}格式无效${spec.kind === 'date' ? '，请使用有效的 YYYY-MM-DD 日期' : ''}`;
}
