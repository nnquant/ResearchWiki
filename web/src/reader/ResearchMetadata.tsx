import { RESEARCH_FIELDS, type ResearchMetadata as Metadata } from '../lib/research';

export function ResearchMetadata({ fields }: { fields: Metadata }) {
  const entries = Object.entries(RESEARCH_FIELDS).filter(([key]) => fields[key] != null && fields[key] !== '' && (!Array.isArray(fields[key]) || fields[key].length));
  if (!entries.length) return null;
  return <section className="research-metadata" aria-label="研究跟踪信息">
    <dl>{entries.map(([key, spec]) => {
      const value = fields[key];
      return <div key={key}><dt>{spec.label}</dt><dd>{Array.isArray(value) ? value.join('、') : spec.options?.[String(value)] ?? value}</dd></div>;
    })}</dl>
  </section>;
}
