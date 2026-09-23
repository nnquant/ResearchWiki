import { useState, type ReactNode } from 'react';
import schema from '../../../config/article-metadata.schema.json';
import { categoryLabel } from '../lib/types';
import { Link } from 'react-router';

const groups = [
  { title: '文献信息', keys: ['summary', 'research_category', 'authors', 'institutions', 'doi', 'arxiv_id', 'language', 'abstract'] },
  { title: '研究对象', keys: ['topic_primary', 'companies', 'industries', 'subfields'] },
  { title: '研究信息', keys: ['asset_classes', 'markets', 'research_topics', 'research_question', 'strategy_frequency', 'sample_start', 'sample_end', 'sample_period', 'methods', 'key_findings', 'key_evidence', 'limitations', 'reproducible_experiments', 'personal_rating'] },
];

function filled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(filled);
  return typeof value === 'number' && Number.isFinite(value);
}

function CollapsibleField({ text, children }: { text: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 280 || text.split('\n').length > 6;
  return <>
    <div className={long && !expanded ? 'metadata-preview' : undefined}>{children}</div>
    {long && <button className="metadata-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开全部'}</button>}
  </>;
}

export function ArticleMetadata({ fields }: { fields: Record<string, unknown> }) {
  return <>{groups.map(group => {
    const keys = group.keys.filter(key => filled(fields[key]));
    if (!keys.length) return null;
    return <section key={group.title} className="article-metadata" aria-label={group.title}>
      <h2>{group.title}</h2>
      <dl>{keys.map(key => {
        const value = fields[key];
        const label = schema.properties[key as keyof typeof schema.properties].title;
        const items = Array.isArray(value) ? value.filter(filled) : null;
        const isTagList = items !== null && !['key_findings', 'key_evidence', 'limitations', 'reproducible_experiments'].includes(key);
        return <div key={key} className="article-field">
          <dt>{label}</dt>
          <dd>{isTagList && items
            ? <ul className="metadata-tags" role="list">{items.map((item, i) => {
              const prefix = ({ companies: '公司', industries: '行业', subfields: '领域' } as Record<string, string>)[key];
              return <li className="chip" key={i}>{prefix ? <Link to={`/library?tag=${encodeURIComponent(`${prefix}:${String(item)}`)}`}>{String(item)}</Link> : String(item)}</li>;
            })}</ul>
            : <CollapsibleField text={items ? items.join('\n') : String(value)}>{items
              ? <ul>{items.map((item, i) => <li key={i}>{String(item)}</li>)}</ul>
              : key === 'personal_rating' ? `${value} / 5` : key === 'research_category' ? categoryLabel(String(value)) : String(value)}</CollapsibleField>}</dd>
        </div>;
      })}</dl>
    </section>;
  })}</>;
}
