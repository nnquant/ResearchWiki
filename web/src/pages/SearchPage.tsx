import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSearch, useGraphTags, useTypes } from '../api/hooks';
import { MultiTagFilter, readTagSelection, writeTagSelection } from '../app/MultiTagFilter';
import { pageUrl } from '../api/client';
import { useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeBadge, Empty } from '../app/ui';
import { Highlight, snippetAround } from '../lib/highlight';
import { typeColor, typeLabel } from '../lib/types';

export function SearchPage() {
  useCrumbs([{ label: '检索' }]);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const mode = params.get('mode') === 'lexical' ? 'lexical' : params.get('mode') === 'deep' ? 'deep' : 'hybrid';
  const typeFilter = (params.get('types') ?? '').split(',').filter(Boolean);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const [tagQuery, setTagQuery] = useState('');
  const { data: tagOptions } = useGraphTags(tagQuery);
  const tags = tagOptions?.tags;
  const { data: types } = useTypes();
  const tagSelection = readTagSelection(params);
  const { data, isLoading, error, isFetching } = useSearch({ q, mode, types: typeFilter, ...tagSelection, cursor: params.get('cursor') ?? undefined, limit: 30 }, q.length > 0);

  const facets = useMemo(() => {
    return (types ?? []).filter(t => t.n > 0).map(t => [t.type, t.n] as const);
  }, [types]);

  const results = data?.results ?? [];

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
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
          <button type="button" className={`btn ${mode === 'lexical' ? 'active' : ''}`} onClick={() => update({ mode: 'lexical' })}>关键词</button>
          <button type="button" className={`btn ${mode === 'hybrid' ? 'active' : ''}`} onClick={() => update({ mode: 'hybrid' })}>混合</button>
          <button type="button" className={`btn ${mode === 'deep' ? 'active' : ''}`} onClick={() => update({ mode: 'deep' })} title="扩大候选范围；尚未配置模型扩展与重排">扩展</button>
        </div>
        <button className="btn primary" type="submit">检索</button>
      </form>
      <MultiTagFilter onSearch={setTagQuery} tags={tags ?? []} value={tagSelection} onChange={value => { const next = new URLSearchParams(params); writeTagSelection(next, value); next.delete('cursor'); setParams(next); }} />

      {q && isLoading && <Loading label={mode === 'deep' ? '深度检索中…' : '检索中…'} />}
      {error && <ErrorBlock error={error} title="检索失败" />}

      {data && (
        <>
          <div className="search-meta">
            <span>{data.results.length} 条结果</span>
            {data.coverage && <span>范围内 {data.coverage.documents} 份 · 正文可检索 {data.coverage.text_ready} 份</span>}
            {isFetching && <span className="spinner" />}
            {data.degraded.length > 0 && <span className="chip warn" title={data.degraded.map(d => d.stage).join(', ')}>检索降级：{data.degraded.map(d => d.stage).join('、')}</span>}
            <span className="spacer" style={{ flex: 1 }} />
            {facets.map(([type, n]) => (
              <button key={type} className={`chip chip-button ${typeFilter.includes(type) ? 'active' : ''}`} onClick={() => toggleType(type)} style={{ color: typeColor(type), borderColor: typeColor(type) }}>
                {typeLabel(type)} <span title="全库分类数量">{n}</span>
              </button>
            ))}
          </div>

          {results.length === 0 && data.results.length === 0 && (
            <Empty title="没有命中">
              <p>{data.empty_reason === 'no_documents_match_filters' ? '当前标签或分类条件下没有登记材料。' : data.degraded.length ? '检索未完整完成，请查看诊断信息或使用关键词模式。' : '范围内未命中正文，可调整关键词或标签条件。'}</p>
            </Empty>
          )}

          {results.map(hit => {
            const target = `${pageUrl(hit.slug)}?find=${encodeURIComponent(hit.chunk_text.replace(/\s+/g, ' ').trim().slice(0, 80))}${hit.pdf_page ? `#pdf-page-${hit.pdf_page}` : ''}`;
            return (
              <div className="result" key={`${hit.slug}:${hit.chunk_index}`}>
                <div className="head">
                  <TypeBadge type={hit.category ?? hit.type} />
                  <Link className="title" to={target}>{hit.title}</Link>
                  {hit.pdf_page && <span className="chip">PDF 第 {hit.pdf_page} 页</span>}
                  {hit.stale && <span className="chip warn">索引过期</span>}
                  {hit.score !== null && <span className="score">{hit.score.toFixed(3)}</span>}
                </div>
                <div className="snippet"><Highlight text={snippetAround(hit.chunk_text, q, 260)} query={q} /></div>
                <div className="foot">
                  <span className="mono">{hit.slug}</span>
                  <span>{hit.evidence ? `第 ${hit.chunk_index + 1} 段` : '文档级命中，请打开原文定位'}</span>
                </div>
              </div>
            );
          })}
          {data.next_cursor && <button className="btn" onClick={() => { const next = new URLSearchParams(params); next.set('cursor', data.next_cursor!); setParams(next); }}>下一页结果</button>}
          <details className="search-diagnostics"><summary>检索诊断</summary><pre>{JSON.stringify({ plan: data.query_plan, coverage: data.coverage, degraded: data.degraded }, null, 2)}</pre></details>
        </>
      )}
    </div>
  );
}
