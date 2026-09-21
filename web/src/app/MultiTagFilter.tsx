import { useState } from 'react';
import { TagFilter } from './TagFilter';
import type { TagCount } from '../api/types';

export type TagSelection = { tags_all: string[]; tags_any: string[]; tags_none: string[] };
export function readTagSelection(params: URLSearchParams): TagSelection {
  return { tags_all: [...new Set([...params.getAll('tags_all'), ...params.getAll('tag')])], tags_any: params.getAll('tags_any'), tags_none: params.getAll('tags_none') };
}
export function writeTagSelection(params: URLSearchParams, selected: TagSelection) {
  params.delete('tag');
  for (const key of ['tags_all', 'tags_any', 'tags_none'] as const) { params.delete(key); selected[key].forEach(t => params.append(key, t)); }
}
const labels = { tags_all: '同时包含', tags_any: '包含任意', tags_none: '排除' };
export function MultiTagFilter({ tags, value, onChange, onSearch }: { tags: TagCount[]; value: TagSelection; onChange: (v: TagSelection) => void; onSearch?: (q: string) => void }) {
  const [mode, setMode] = useState<keyof TagSelection>('tags_all');
  const selected = Object.values(value).some(v => v.length);
  return <div className="multi-tag-filter">
    <div className="row">
      <select className="select" value={mode} onChange={e => setMode(e.target.value as keyof TagSelection)} aria-label="标签组合方式">
        {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <TagFilter tags={tags} value="" onSearch={onSearch} onChange={tag => { if (tag) onChange({ ...value, [mode]: [...new Set([...value[mode], tag])] }); }} canClear={selected} onClear={() => onChange({ tags_all: [], tags_any: [], tags_none: [] })} />
    </div>
    {Object.entries(value).map(([key, values]) => values.length > 0 && <div className="row multi-tag-selected" key={key}>
      <span className="muted small">{labels[key as keyof TagSelection]}</span>
      {values.map(tag => <button className="chip chip-button" key={tag} onClick={() => onChange({ ...value, [key]: values.filter(t => t !== tag) })} aria-label={`移除${tag}`}>{tag} ×</button>)}
    </div>)}
  </div>;
}
