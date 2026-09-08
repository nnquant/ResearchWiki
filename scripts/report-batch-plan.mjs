import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
export function within(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export function reportDate(relative, mtimeMs, year, month) {
  const parts = relative.split(/[\\/]/);
  for (const [text, source] of [[parts.at(-1), 'filename'], ...parts.slice(0, -1).reverse().map(p => [p, 'directory'])]) {
    const match = text.match(/(?<!\d)(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?([0-2]\d|3[01])(?!\d)/);
    if (!match) continue;
    const value = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return { date: value, date_source: source };
  }
  return { date: `${year}-${String(month).padStart(2, '0')}-01`, date_source: 'month-directory', fallback_mtime: mtimeMs };
}
export function compareReports(a, b) {
  return b.month - a.month || b.date.localeCompare(a.date) || (a.date_source === 'month-directory' && b.date_source === 'month-directory' ? b.mtime_ms - a.mtime_ms : 0) || a.relative.localeCompare(b.relative, 'zh-CN');
}
export function reportOutput(relative, date) {
  const id = digest(relative.replaceAll('\\', '/')).slice(0, 16);
  const stem = path.basename(relative, path.extname(relative)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const label = [...stem].slice(0, 65).join('').replace(/[. ]+$/, '') || 'report';
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('输出目录需要 YYYY-MM-DD 日期');
  return { id, output_relative: path.join(date ?? path.dirname(relative), label + '--' + id).replaceAll('\\', '/') };
}
export async function buildReportPlan({ source, output, year = 2026, fromMonth = 9, toMonth = 5 }) {
  source = path.resolve(source); output = path.resolve(output);
  if (within(source, output) || within(output, source)) throw new Error('原始目录与输出目录必须相互独立');
  if (![year, fromMonth, toMonth].every(Number.isInteger) || fromMonth > 12 || toMonth < 1 || fromMonth < toMonth) throw new Error('无效的年份或月份范围');
  const files = [];
  async function walk(folder, month) {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) await walk(file, month);
      else if (item.isFile() && /\.pdf$/i.test(item.name)) {
        const stat = await fs.stat(file), relative = path.relative(source, file);
        const dated = reportDate(relative, stat.mtimeMs, year, month);
        files.push({ ...reportOutput(relative, dated.date), relative: relative.replaceAll('\\', '/'), month, size: stat.size, mtime_ms: stat.mtimeMs, ...dated });
      }
    }
  }
  for (const dir of await fs.readdir(source, { withFileTypes: true })) {
    const match = dir.name.match(/^(\d{4})年(\d{1,2})月/);
    if (dir.isDirectory() && match && Number(match[1]) === year && Number(match[2]) >= toMonth && Number(match[2]) <= fromMonth) await walk(path.join(source, dir.name), Number(match[2]));
  }
  files.sort(compareReports);
  files.forEach((file, i) => { file.order = i + 1; });
  return { version: 2, output_layout: 'report-date', created_at: new Date().toISOString(), source, output, year, from_month: fromMonth, to_month: toMonth, order: 'month-desc, report-date-desc, relative-path', total: files.length, bytes: files.reduce((n, f) => n + f.size, 0), months: Object.fromEntries(Array.from({length: fromMonth - toMonth + 1}, (_, i) => { const month = fromMonth - i; return [month, files.filter(f => f.month === month).length]; })), files };
}

export function readEvents(text) {
  const states = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { const entry = JSON.parse(lines[i]); states.set(entry.id, { ...states.get(entry.id), ...entry }); }
    catch (error) { if (i !== lines.length - 1) throw error; } // A crash may leave only the final append incomplete.
  }
  return states;
}
