import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSearch } from '../api/hooks';
import { pageUrl } from '../api/client';
import { useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeBadge, Empty } from '../app/ui';
import { Highlight, snippetAround } from '../lib/highlight';
import { typeColor, typeLabel } from '../lib/types';

export function SearchPage() {
  useCrumbs([{ label: '检索' }]);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const mode = params.get('mode') === 'deep' ? 'deep' : 'fast';
  const typeFilter = (params.get('types') ?? '').split(',').filter(Boolean);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const { data, isLoading, error, isFetching } = useSearch({ q, mode, limit: 30 }, q.length > 0);

  const facets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const hit of data?.results ?? []) counts.set(hit.type ?? 'other', (counts.get(hit.type ?? 'other') ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const results = (data?.results ?? []).filter(hit => !typeFilter.length || typeFilter.includes(hit.type ?? 'other'));

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next);
  };

  const toggleType = (type: string) => {
    const set = new Set(typeFilter);
    if (set.has(type)) set.delete(type); else set.add(type);
    update({ types: [...set].join(',') || null });
  };

  return (
    <div className="content-inner">
      <form className="search-bar" onSubmit={e => { e.preventDefault(); update({ q: draft.trim() || null }); }}>
        <input className="input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="输入研究问题、术语或论文标题…" aria-label="检索" autoFocus />
        <div className="btn-group">
          <button type="button" className={`btn ${mode === 'fast' ? 'active' : ''}`} onClick={() => update({ mode: null })} title="适合精确术语和论文名">快速</button>
          <button type="button" className={`btn ${mode === 'deep' ? 'active' : ''}`} onClick={() => update({ mode: 'deep' })} title="适合跨文档问题">深度</button>
        </div>
        <button className="btn primary" type="submit">检索</button>
      </form>

      {q && isLoading && <Loading label={mode === 'deep' ? '深度检索中…' : '检索中…'} />}
      {error && <ErrorBlock error={error} title="检索失败" />}

      {data && (
        <>
          <div className="search-meta">
            <span>{data.results.length} 条结果</span>
            {isFetching && <span className="spinner" />}
            {data.degraded.length > 0 && <span className="chip warn" title={data.degraded.map(d => d.stage).join(', ')}>检索降级：{data.degraded.map(d => d.stage).join('、')}</span>}
            <span className="spacer" style={{ flex: 1 }} />
            {facets.map(([type, n]) => (
              <button key={type} className={`chip chip-button ${typeFilter.includes(type) ? 'active' : ''}`} onClick={() => toggleType(type)} style={{ color: typeColor(type), borderColor: typeColor(type) }}>
                {typeLabel(type)} {n}
              </button>
            ))}
          </div>

          {results.length === 0 && data.results.length === 0 && (
            <Empty title="没有命中">
              <p>{data.degraded.some(d => d.stage.startsWith('embed')) ? '向量检索未能完成（embedding 超时或不可用），可稍后重试。' : '换个说法，或改用深度模式。'}</p>
            </Empty>
          )}

          {results.map(hit => {
            const target = `${pageUrl(hit.slug)}?find=${encodeURIComponent(hit.chunk_text.replace(/\s+/g, ' ').trim().slice(0, 80))}${hit.pdf_page ? `#pdf-page-${hit.pdf_page}` : ''}`;
            return (
              <div className="result" key={`${hit.slug}:${hit.chunk_index}`}>
                <div className="head">
                  <TypeBadge type={hit.type} />
                  <Link className="title" to={target}>{hit.title}</Link>
                  {hit.pdf_page && <span className="chip">PDF 第 {hit.pdf_page} 页</span>}
                  {hit.stale && <span className="chip warn">索引过期</span>}
                  {hit.score !== null && <span className="score">{hit.score.toFixed(3)}</span>}
                </div>
                <div className="snippet"><Highlight text={snippetAround(hit.chunk_text, q, 260)} query={q} /></div>
                <div className="foot">
                  <span className="mono">{hit.slug}</span>
                  <span>第 {hit.chunk_index + 1} 段</span>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
