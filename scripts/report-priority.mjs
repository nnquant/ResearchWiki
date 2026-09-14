// These download roots are curated by publisher: raw = foreign, raw1 = domestic.
// Never infer the publisher from the companies mentioned in a report's body.
export function isForeignReport(record) {
  const category = record.source_meta?.report_category ?? record.report_category;
  if (category) return category === '外资';
  const source = String(record.source_meta?.import_path ?? '').replaceAll('\\', '/');
  return /(?:^|\/)reports\/raw\//i.test(source);
}

export const REPORT_PRIORITY_ORDER = 'report-date-desc,foreign-first,batch-order,id';
export const articleReportDate = record => record.article_metadata?.published_at || record.published_at || record.source_meta?.sort_date || '';

export function compareArticlePriority(a, b) {
  return articleReportDate(b).localeCompare(articleReportDate(a))
    || Number(isForeignReport(b)) - Number(isForeignReport(a))
    || (a.source_meta?.batch_order ?? Infinity) - (b.source_meta?.batch_order ?? Infinity)
    || a.id.localeCompare(b.id);
}
