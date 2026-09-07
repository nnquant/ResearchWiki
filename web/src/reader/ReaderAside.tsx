import { Link } from 'react-router';
import type { Page, LinkRef, RelationRef } from '../api/types';
import { pageUrl, graphUrl } from '../api/client';
import { Outline } from './Outline';
import { RELATION_LABELS, RELATION_INCOMING_LABELS } from '../lib/types';
import { formatDate, formatNumber, shortHash } from '../lib/format';
import type { PdfSection } from '../lib/outline';

interface Props {
  page: Page;
  sections: PdfSection[] | null;
  activeId: string | null;
  onNavigate: (id: string) => void;
}

const MAX = 6;

function RelList({ items, label, incoming = false }: { items: RelationRef[]; label: string; incoming?: boolean }) {
  return (
    <>
      {items.slice(0, MAX).map(item => (
        <Link key={`${label}:${item.slug}`} to={pageUrl(item.slug)} className={item.exists ? '' : 'missing'} title={item.slug}>
          <small>{incoming ? `${label} ←` : `${label} →`}</small>
          <span className="title">{item.title}</span>
        </Link>
      ))}
      {items.length > MAX && <span className="more">还有 {items.length - MAX} 项</span>}
    </>
  );
}

function MentionList({ items, label }: { items: LinkRef[]; label: string }) {
  const seen = new Set<string>();
  const unique = items.filter(i => { if (seen.has(i.slug)) return false; seen.add(i.slug); return true; });
  return (
    <>
      {unique.slice(0, MAX).map(item => (
        <Link key={item.slug} to={pageUrl(item.slug)} title={item.context ?? item.slug}>
          <small>{label}</small>
          <span className="title">{item.title}</span>
        </Link>
      ))}
      {unique.length > MAX && <span className="more">还有 {unique.length - MAX} 项</span>}
    </>
  );
}

/** Side notes rendered inside the reading column: page grid, outline, relations, provenance. */
export function ReaderAside({ page, sections, activeId, onNavigate }: Props) {
  const out = Object.entries(page.relations.out);
  const incoming = Object.entries(page.relations.in);
  const mentionsIn = page.backlinks.filter(l => l.link_type === 'mentions');
  const mentionsOut = page.links_out.filter(l => l.link_type === 'mentions');
  const hasRelations = out.length + incoming.length + mentionsIn.length + mentionsOut.length > 0;
  const p = page.provenance;
  return (
    <aside className="reader-aside">
      <Outline markdown={page.markdown} sections={sections} activeId={activeId} onNavigate={onNavigate} />
      <section>
        <h4>关联</h4>
        {!hasRelations && <div className="rail-empty">{page.indexed ? '还没有任何关联。' : '索引更新后显示关联。'}</div>}
        <div className="aside-rel">
          {out.map(([type, items]) => <RelList key={`o:${type}`} items={items} label={RELATION_LABELS[type] ?? type} />)}
          {incoming.map(([type, items]) => <RelList key={`i:${type}`} items={items} label={RELATION_INCOMING_LABELS[type] ?? type} incoming />)}
          {mentionsIn.length > 0 && <MentionList items={mentionsIn} label="反链 ←" />}
          {mentionsOut.length > 0 && <MentionList items={mentionsOut} label="引用 →" />}
        </div>
        <div style={{ marginTop: 10 }}><Link to={graphUrl(page.slug)} className="muted">打开关联图 →</Link></div>
      </section>
      <section>
        <h4>{p ? '溯源' : '页面'}</h4>
        <dl className="kv">
          {p?.parser && <><dt>解析器</dt><dd>{p.parser}</dd></>}
          {p?.llm_model && <><dt>字段整理</dt><dd>{p.llm_model}</dd></>}
          {p?.llm_processed_at && <><dt>整理时间</dt><dd>{formatDate(p.llm_processed_at)}</dd></>}
          {p?.sha256 && <><dt>SHA-256</dt><dd className="mono" title={p.sha256}>{shortHash(p.sha256, 10)}…</dd></>}
          {p?.knowledge_base && <><dt>知识库</dt><dd>{p.knowledge_base}</dd></>}
          {p?.source_url && <><dt>来源链接</dt><dd><a href={p.source_url} target="_blank" rel="noopener noreferrer">{p.source_url}</a></dd></>}
          {p?.received_at && <><dt>接收</dt><dd>{formatDate(p.received_at)}</dd></>}
          {p?.published_at && <><dt>发布</dt><dd>{formatDate(p.published_at)}</dd></>}
          {p?.characters && <><dt>字符</dt><dd>{formatNumber(p.characters)}</dd></>}
          {p?.page_map_url && <><dt>页码映射</dt><dd><a href={p.page_map_url}>page-map.json</a></dd></>}
          {!p && <><dt>索引</dt><dd>{page.indexed ? (page.stale ? '待更新' : '已索引') : '未索引'}</dd></>}
          {!p && page.created_at && <><dt>创建</dt><dd>{formatDate(page.created_at)}</dd></>}
          {page.aliases.length > 0 && <><dt>别名</dt><dd>{page.aliases.join('、')}</dd></>}
          <dt>哈希</dt><dd className="mono">{shortHash(page.hash, 10)}</dd>
        </dl>
        {p && <p className="faint small" style={{ marginTop: 8 }}>印刷页码可能与文件页号不同，关键引用请打开原始文件核对。</p>}
      </section>
    </aside>
  );
}
