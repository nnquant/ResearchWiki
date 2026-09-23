export interface ActiveFilter { key: string; kind: string; value: string; tone?: 'exclude'; onRemove: () => void }

/** Every applied condition in one place; hidden entirely when nothing is filtered. */
export function ActiveFilterBar({ filters, total, onClearAll }: { filters: ActiveFilter[]; total?: number; onClearAll: () => void }) {
  if (!filters.length) return null;
  return (
    <div className="active-filters" aria-label="已应用的筛选">
      <span className="active-filters-count">{total != null ? `已筛选 · 共 ${total.toLocaleString()} 条` : '已筛选'}</span>
      {filters.map(filter => (
        <span key={filter.key} className={`filter-chip${filter.tone ? ` is-${filter.tone}` : ''}`}>
          <span className="filter-chip-kind">{filter.kind}</span>
          <span className="filter-chip-value" title={filter.value}>{filter.value}</span>
          <button type="button" aria-label={`移除${filter.kind}：${filter.value}`} onClick={filter.onRemove}>×</button>
        </span>
      ))}
      <button type="button" className="active-filters-clear" onClick={onClearAll}>清除全部</button>
    </div>
  );
}
