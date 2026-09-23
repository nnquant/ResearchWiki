import { useEffect, useState } from 'react';
import { useTagOptions } from '../../api/hooks';
import type { TagSelection } from '../MultiTagFilter';
import { ExcludeIcon, IncludeIcon } from './icons';
import { groupLabel, includeMode, includedTags, orderGroups, setIncludeMode, setTagState, splitTag, tagState, type TagState } from './tagSelection';

/** Each tag row carries its own include/exclude toggle, so there is no mode to choose before picking. */
export function TagPanel({ value, onChange }: { value: TagSelection; onChange: (value: TagSelection) => void }) {
  const [search, setSearch] = useState('');
  // null = 全部; '' = tags without a prefix (其他).
  const [group, setGroup] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  useEffect(() => {
    const next = search.trim() || (group ? `${group}:` : '');
    const timer = setTimeout(() => setTerm(next), search.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search, group]);
  const { data, isFetching } = useTagOptions(term);
  const tags = data?.tags ?? [];
  // Groups come from the whole library, so choosing one never hides the others.
  const groups = orderGroups(data?.groups ?? []);

  const visible = tags.filter(item => search.trim() || group === null || splitTag(item.tag).group === group);
  const labels = new Map(tags.map(item => [item.tag, item.label]));
  const selected = [...includedTags(value), ...value.tags_none];
  const mode = includeMode(value);
  const toggle = (tag: string, state: Exclude<TagState, null>) =>
    onChange(setTagState(value, tag, tagState(value, tag) === state ? null : state));

  const row = (tag: string, count?: number) => {
    const state = tagState(value, tag);
    const { group: prefix, value: name } = splitTag(tag);
    const label = labels.get(tag);
    return (
      <li key={tag} className={`tag-row${state ? ` is-${state}` : ''}`}>
        <span className="tag-row-label" title={tag}>{label ?? name}</span>
        {label && <span className="tag-row-alias">{name}</span>}
        {prefix && <span className="tag-row-category">{prefix}</span>}
        {count != null && <span className="tag-row-count">{count.toLocaleString()}</span>}
        <span className="tag-row-actions">
          <button type="button" className="tag-toggle include" aria-pressed={state === 'include'} aria-label={`包含 ${tag}`} title={state === 'include' ? '取消包含' : '包含'} onClick={() => toggle(tag, 'include')}><IncludeIcon /></button>
          <button type="button" className="tag-toggle exclude" aria-pressed={state === 'exclude'} aria-label={`排除 ${tag}`} title={state === 'exclude' ? '取消排除' : '排除'} onClick={() => toggle(tag, 'exclude')}><ExcludeIcon /></button>
        </span>
      </li>
    );
  };

  return (
    <div className="tag-panel">
      <div className="tag-panel-search">
        <input className="input" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索标签、机构、作者、主题…" aria-label="搜索标签" />
      </div>
      {!search.trim() && groups.length > 0 && (
        <div className="tag-filter-categories" aria-label="标签类别">
          <button type="button" aria-pressed={group === null} onClick={() => setGroup(null)}>全部</button>
          {groups.map(g => (
            <button type="button" key={g.name} aria-pressed={group === g.name} onClick={() => setGroup(g.name)}>
              {groupLabel(g.name)} <span>{g.n.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
      <div className="tag-panel-body">
        {selected.length > 0 && (
          <section>
            <h4>已选</h4>
            <ul className="tag-rows">{selected.map(tag => row(tag))}</ul>
          </section>
        )}
        <section>
          <h4>
            {search.trim() ? '匹配标签' : group === null ? '常用标签' : groupLabel(group)}
            {isFetching && <span className="faint"> · 加载中</span>}
          </h4>
          <ul className="tag-rows">{visible.filter(item => !selected.includes(item.tag)).map(item => row(item.tag, item.n))}</ul>
          {!isFetching && visible.length === 0 && <p className="muted small">{search ? '没有匹配的标签' : '暂无可选标签'}</p>}
          {data && (search.trim() || group) && data.total > tags.length && <p className="faint small">仅显示前 {tags.length} 项，输入关键词可缩小范围。</p>}
        </section>
      </div>
      {includedTags(value).length >= 2 && (
        <div className="tag-panel-mode" role="radiogroup" aria-label="多个包含标签之间">
          <span className="muted small">多个包含标签之间：</span>
          <label><input type="radio" name="tag-include-mode" checked={mode === 'all'} onChange={() => onChange(setIncludeMode(value, 'all'))} />同时满足</label>
          <label><input type="radio" name="tag-include-mode" checked={mode === 'any'} onChange={() => onChange(setIncludeMode(value, 'any'))} />满足任一</label>
          {mode === 'mixed' && <span className="faint small">（当前为旧链接的混合条件）</span>}
        </div>
      )}
    </div>
  );
}
