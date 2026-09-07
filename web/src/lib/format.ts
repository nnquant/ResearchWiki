const DAY = 86_400_000;

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(value)} ${hh}:${mm}`;
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return String(value);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return formatDate(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN');
}

export function shortHash(value: string | null | undefined, length = 12): string {
  return value ? value.slice(0, length) : '—';
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
