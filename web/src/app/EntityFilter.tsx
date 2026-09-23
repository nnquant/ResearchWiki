import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorBlock } from './ui';
import { ENTITY_TYPE_LABELS, entityStatusLabel, useEntityResolve, type EntityCandidate } from './library/useEntityResolve';

/** Shared entity resolution for graph, library and search. Never auto-select ambiguous matches. */
export function EntityFilter() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(''), [query, setQuery] = useState('');
  const { data, error, isFetching } = useEntityResolve(query);
  const choose = (entity?: EntityCandidate) => {
    const next = new URLSearchParams(params); next.delete('page'); next.delete('cursor');
    if (entity) { next.set('entity_id', entity.entity_id); next.set('entity_label', entity.name); }
    else { next.delete('entity_id'); next.delete('entity_label'); }
    setParams(next); setQuery(''); setDraft('');
  };
  return <section className="entity-filter" aria-label="实体与别名筛选">
    <h3>实体与别名</h3>
    {params.get('entity_id') && <button className="chip chip-button" onClick={() => choose()} title="移除实体范围">{params.get('entity_label') ?? params.get('entity_id')} ×</button>}
    <form className="row" onSubmit={e => { e.preventDefault(); setQuery(draft.trim()); }}>
      <input className="input" aria-label="实体名称或别名" placeholder="公司名称、别名或证券标识…" value={draft} onChange={e => setDraft(e.target.value)} />
      <button className="btn sm" disabled={!draft.trim() || isFetching}>{isFetching ? '查找中…' : '查找实体'}</button>
    </form>
    {error && <ErrorBlock error={error} title="实体查询失败" />}
    {query && data && <>
      {data.ambiguous && <p className="small muted">找到多个候选，请选择具体对象。</p>}
      <div className="graph-materials">{data.results.map(entity => <button key={entity.entity_id} onClick={() => choose(entity)}>
        <span>{entity.name} · {entity.document_count.toLocaleString()} 份材料</span>
        <span className="small muted">{ENTITY_TYPE_LABELS[entity.entity_type]} · {entityStatusLabel(entity)}</span>
      </button>)}</div>
      {!data.results.length && <p className="small muted">没有匹配实体，可改用原始标签筛选。</p>}
      {data.next_cursor && <p className="small muted">当前展示前 20 项，请补充名称缩小范围。</p>}
    </>}
  </section>;
}
