import fs from 'node:fs/promises';

// One schema for API routing, directory creation, ingestion and GBrain initialization.
export const researchSchema = JSON.parse(await fs.readFile(new URL('../config/investment-research.schema.json', import.meta.url), 'utf8'));
export const researchFields = JSON.parse(await fs.readFile(new URL('../config/research-fields.json', import.meta.url), 'utf8'));
export const researchRelations = researchSchema.link_types.map(t => t.name);

export function dateOnly(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return value;
}

export function validDate(value) {
  const text = dateOnly(value);
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text)
    && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text;
}

export function researchErrors(fields) {
  const errors = [];
  for (const [field, spec] of Object.entries(researchFields)) {
    const value = fields[field];
    if (value == null || value === '') continue;
    const ok = spec.kind === 'date' ? validDate(value)
      : spec.kind === 'list' ? Array.isArray(value) && value.every(v => typeof v === 'string' && v.trim() && v.length <= 200)
      : spec.kind === 'select' ? typeof value === 'string' && Object.hasOwn(spec.options, value)
      : typeof value === 'string' && value.length <= 200;
    if (!ok) errors.push({ field, message: `${spec.label}格式无效${spec.kind === 'date' ? '，请填写有效的 YYYY-MM-DD 日期' : ''}` });
  }
  return errors;
}

export function researchMetadata(fields) {
  const invalid = new Set(researchErrors(fields).map(e => e.field));
  return Object.fromEntries(Object.entries(researchFields).map(([key, spec]) => {
    const value = invalid.has(key) ? null : fields[key] ?? null;
    return [key, spec.kind === 'date' ? dateOnly(value) : value];
  }));
}

/** Calendar dates use the deployment's local timezone; no UTC midnight drift. */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isReviewDue(entry, today = localToday()) {
  const research = entry.research;
  return research?.research_stage !== 'archived' && validDate(research?.next_review)
    && research.next_review <= today;
}
