import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportPlan, readEvents, within } from './report-batch-plan.mjs';
import { config, repo, root, dataPath, atomicJson, readJson, manifest, sha, now, withLock, ensureDirs } from './common.mjs';
import { capture, parseRecord, indexWiki } from './ingest.mjs';
import { completePdf } from './import-directory.mjs';
import { sharedConnection, createSharedClient } from './shared-api-client.mjs';
import { getSql, closeDb } from './server/db.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function loadOrCreatePlan(options) {
  const output = path.resolve(options.output);
  const file = path.join(output, '_batch', 'plan.json');
  const existing = await readJson(file, null);
  if (existing) {
    if (path.resolve(existing.source) !== path.resolve(options.source) || path.resolve(existing.output) !== output || existing.year !== options.year || existing.from_month !== options.fromMonth || existing.to_month !== options.toMonth) throw new Error('输出目录已包含其他批次计划，不覆盖原队列');
    return existing;
  }
  const plan = await buildReportPlan(options);
  await atomicJson(file, plan);
  return plan;
}

export function reportCompleted(entry, parseOnly) {
  return entry?.status === 'completed' && (parseOnly || entry.processing_mode !== 'parse_only');
}

export async function exportProcessed(plan, item, record, { parseOnly = false } = {}) {
  const target = path.resolve(plan.output, item.output_relative);
  if (!within(plan.output, target)) throw new Error('输出目录越界');
  await fs.mkdir(target, { recursive: true });
  const previous = await readJson(path.join(target, 'report.json'), null);
  if (previous && (previous.source_relative !== item.relative || previous.sha256 !== record.sha256)) throw new Error('处理目录已存在不同原件，拒绝覆盖');
  const raw = dataPath(record.raw_path);
  const bytes = await fs.readFile(raw);
  if (sha(bytes) !== record.sha256) throw new Error('入库原件哈希校验失败');
  const pdf = path.join(target, 'original.pdf');
  try {
    await fs.copyFile(raw, pdf, fs.constants.COPYFILE_EXCL);
  } catch (e) { if (e.code !== 'EEXIST' || sha(await fs.readFile(pdf)) !== record.sha256) throw e; }
  const parsed = dataPath('parsed', record.id, record.revision);
  await fs.cp(parsed, path.join(target, 'parsed'), { recursive: true, force: true, errorOnExist: false });
  const report = {
    status: parseOnly ? 'parsed' : 'indexed', completed_at: now(), source_relative: item.relative, source_file: path.join(plan.source, item.relative), original_filename: path.basename(item.relative),
    sha256: record.sha256, report_date_for_sort: item.date, date_source: item.date_source, month_directory: item.month,
    title: record.title, pages: record.pages, characters: record.characters, parser: record.parser, remote_parser: record.remote_parser,
    wiki_slug: record.wiki_slug, wiki_url: parseOnly ? null : `http://127.0.0.1:${config.port}/page/${record.wiki_slug.split('/').map(encodeURIComponent).join('/')}`,
    markdown: path.relative(target, path.join(target, 'parsed', path.relative(parsed, dataPath(record.parsed_path)))).replaceAll('\\','/'),
  };
  await atomicJson(path.join(target, 'report.json'), report); // Completion marker is written last.
  return target;
}

// Drain every in-flight task even if one fails, before releasing the shared ingest lock.
export async function drainParseGroup(items, parse, complete) {
  const results = await Promise.allSettled(items.map(async item => complete(item, await parse(item))));
  return results;
}

export async function runReportBatch(plan, { limit = Infinity, batchSize = 5, retryFailed = false, parseOnly = false, concurrency = 1 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20 || !(limit > 0)) throw new Error('无效的批次大小或处理数量');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || (!parseOnly && concurrency !== 1)) throw new Error('并发数须为 1–4；多路并发仅用于只解析模式');
  const client = createSharedClient(sharedConnection(config, root) ?? (() => { throw new Error('报告批次要求已启用内网服务'); })());
  const dir = path.join(plan.output, '_batch');
  await ensureDirs(); await fs.mkdir(dir, { recursive: true });
  const lockFile = path.join(dir, 'worker.lock');
  const lock = await fs.open(lockFile, 'wx');
  await lock.writeFile(JSON.stringify({ pid: process.pid, repo, started_at: now() }));
  const eventsFile = path.join(dir, 'events.jsonl');
  let journal = '';
  try { journal = await fs.readFile(eventsFile, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const states = readEvents(journal);
  // Remove only an interrupted, incomplete trailing append before adding new lines.
  if (journal && !journal.endsWith('\n')) {
    try { JSON.parse(journal.slice(journal.lastIndexOf('\n') + 1)); await fs.appendFile(eventsFile, '\n'); }
    catch { await fs.writeFile(eventsFile, journal.slice(0, journal.lastIndexOf('\n') + 1)); }
  }
  let stopping = false, active = null, handled = 0, pending = [], failedIndexGroups = 0;
  const activeItems = new Map();
  let journalWrites = Promise.resolve();
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const counts = () => {
    const out = { total: plan.total, completed: 0, failed: 0, pending: 0, parsed_only: 0, indexed: 0 };
    for (const item of plan.files) {
      const entry = states.get(item.id), status = entry?.status;
      if (reportCompleted(entry, parseOnly)) out.completed++;
      else if (status === 'failed') out.failed++;
      else out.pending++;
      if (status === 'completed') out[entry.processing_mode === 'parse_only' ? 'parsed_only' : 'indexed']++;
    }
    return out;
  };
  async function status(phase, extra = {}) {
    await atomicJson(path.join(dir, 'status.json'), { pid: process.pid, phase, mode: parseOnly ? 'parse_only' : 'index', concurrency, updated_at: now(), source: plan.source, output: plan.output, order: plan.order, months: plan.months, counts: counts(), active, active_items: [...activeItems.values()], ...extra });
  }
  async function event(item, update) {
    const write = journalWrites.then(async () => {
      const entry = { ...states.get(item.id), id: item.id, relative: item.relative, order: item.order, ...update, updated_at: now() };
      await fs.appendFile(eventsFile, JSON.stringify(entry) + '\n'); states.set(item.id, entry);
    });
    journalWrites = write.catch(() => {}); await write;
  }
  async function acquire(fn) {
    for (;;) {
      if (stopping) throw new Error('批次正在停止');
      try { return await withLock(fn); }
      catch (e) {
        if (!e.message.startsWith('已有导入任务占用锁')) throw e;
        await status('waiting_for_wiki', { detail: e.message }); await wait(5000);
      }
    }
  }
  async function finishGroup() {
    if (!pending.length) return;
    const group = pending; pending = [];
    await status(parseOnly ? 'exporting' : 'indexing', { processing: group.map(x => x.item.relative) });
    let indexError;
    if (!parseOnly) { try { await acquire(indexWiki); } catch (e) { indexError = e; } }
    let verified = 0;
    for (const { item, record } of group) {
      try {
        if (!parseOnly) {
          const sql = await getSql();
          const [check] = await sql`SELECT count(c.id)::int AS total, count(c.embedding)::int AS embedded FROM pages p JOIN content_chunks c ON c.page_id=p.id WHERE p.slug=${record.wiki_slug} AND p.deleted_at IS NULL`;
          if (!check?.total || check.total !== check.embedded) throw new Error(indexError?.message || '该文献索引或向量不完整，未标记处理完成');
        }
        verified++;
        const exported = await exportProcessed(plan, item, record, { parseOnly });
        await event(item, { status: 'completed', processing_mode: parseOnly ? 'parse_only' : 'index', document_id: record.id, wiki_slug: record.wiki_slug, output: exported, pages: record.pages, error: null });
        console.log(JSON.stringify({ at: now(), status: 'completed', order: item.order, total: plan.total, title: record.title, pages: record.pages, counts: counts() }));
      } catch (e) {
        await event(item, { status: 'failed', document_id: record.id, stage: parseOnly ? 'export' : 'index-or-export', error: e.message });
        await fs.appendFile(path.join(dir, 'failures.jsonl'), JSON.stringify({ at: now(), relative: item.relative, stage: parseOnly ? 'export' : 'index-or-export', error: e.message }) + '\n');
      }
    }
    failedIndexGroups = verified ? 0 : failedIndexGroups + 1;
    if (failedIndexGroups >= 3) throw new Error('连续三个小批次处理失败，批次已停止以便排障；已解析原件与队列均保留');
    active = null; await status('running');
  }
  async function parseItem(item, byHash) {
    const file = path.resolve(plan.source, item.relative);
    if (!within(plan.source, file)) throw new Error('原件目录越界');
    const before = await fs.stat(file);
    if (before.size !== item.size || before.mtimeMs !== item.mtime_ms) throw new Error('原件自生成队列后发生变化，保留待人工核对');
    if (before.size > 100 * 1024 * 1024) throw new Error('PDF 超过内网服务 100 MiB 上限');
    const bytes = await fs.readFile(file), after = await fs.stat(file);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || !completePdf(bytes)) throw new Error('PDF 不完整或仍在写入');
    const hash = sha(bytes), known = byHash.get(hash);
    if (known instanceof Promise) return known;
    if (known && ['parsed','indexed'].includes(known.status)) return known;
    const parsing = (async () => {
      const existing = known || await capture({ bytes, filename: path.basename(file), title: path.basename(file, '.pdf'), source_kind: 'local', source_meta: { import_method: 'report-batch', import_path: file, batch_order: item.order, month_directory: item.month, sort_date: item.date, sort_date_source: item.date_source }, metadata: { document_type: '研报' } });
      return parseRecord(existing, { skipArticleAnalysis: parseOnly });
    })();
    // Coalesce identical PDFs in this group before another task can submit the same bytes.
    byHash.set(hash, parsing);
    return parsing;
  }
  async function runParallelParsing() {
    const queue = plan.files.filter(item => !reportCompleted(states.get(item.id), true) && (retryFailed || states.get(item.id)?.status !== 'failed')).slice(0, limit);
    for (let offset = 0; offset < queue.length;) {
      if (stopping || await fs.access(path.join(dir, 'pause')).then(() => true, () => false)) break;
      try { await client.health(); }
      catch (e) { await status('waiting_for_service', { detail: e.message }); await wait(30000); continue; }
      const disk = await fs.statfs(plan.output);
      if (disk.bavail * disk.bsize < 10 * 1024 ** 3) { await status('paused_disk', { detail: '输出磁盘可用空间低于 10 GiB' }); break; }
      const group = queue.slice(offset, offset + concurrency).filter(item => item.month === queue[offset].month);
      await acquire(async () => {
        if (stopping || await fs.access(path.join(dir, 'pause')).then(() => true, () => false)) { stopping = true; return; }
        const byHash = new Map(Object.values((await manifest()).documents).map(doc => [doc.sha256, doc]));
        for (const item of group) {
          activeItems.set(item.id, { order: item.order, relative: item.relative, month: item.month, report_date: item.date });
          await event(item, { status: 'processing', attempts: (states.get(item.id)?.attempts ?? 0) + 1 });
        }
        await status('parsing');
        const results = await drainParseGroup(group, item => parseItem(item, byHash), async (item, record) => {
          await event(item, { status: 'parsed', document_id: record.id, wiki_slug: record.wiki_slug });
          const exported = await exportProcessed(plan, item, record, { parseOnly: true });
          await event(item, { status: 'completed', processing_mode: 'parse_only', document_id: record.id, wiki_slug: record.wiki_slug, output: exported, pages: record.pages, error: null });
          activeItems.delete(item.id); await status('parsing');
          console.log(JSON.stringify({ at: now(), status: 'completed', order: item.order, total: plan.total, title: record.title, pages: record.pages, counts: counts() }));
        });
        for (let i = 0; i < results.length; i++) {
          if (results[i].status !== 'rejected') continue;
          const item = group[i], error = results[i].reason?.message || String(results[i].reason);
          await event(item, { status: 'failed', stage: 'parse-or-export', error });
          await fs.appendFile(path.join(dir, 'failures.jsonl'), JSON.stringify({ at: now(), relative: item.relative, stage: 'parse-or-export', error }) + '\n');
          activeItems.delete(item.id);
        }
        await status('running');
      });
      if (stopping) break;
      offset += group.length;
    }
    const result = counts();
    await status(result.pending === 0 ? (result.failed ? 'completed_with_failures' : 'completed') : 'paused');
    return result;
  }
  try {
    await status('starting');
    if (parseOnly && concurrency > 1) return await runParallelParsing();
    const catalogue = await manifest();
    const byHash = new Map(Object.values(catalogue.documents).map(doc => [doc.sha256, doc]));
    for (const item of plan.files) {
      if (handled >= limit || stopping || await fs.access(path.join(dir, 'pause')).then(()=>true,()=>false)) { stopping = true; break; }
      const previous = states.get(item.id);
      if (reportCompleted(previous, parseOnly) || (previous?.status === 'failed' && !retryFailed)) continue;
      if (pending.length && pending.at(-1).item.month !== item.month) await finishGroup();
      active = { order: item.order, relative: item.relative, month: item.month, report_date: item.date };
      // Pause on a service-wide outage instead of burning through the queue as individual failures.
      for (;;) {
        try { await client.health(); break; }
        catch (e) {
          await status('waiting_for_service', { detail: e.message });
          if (stopping || await fs.access(path.join(dir, 'pause')).then(()=>true,()=>false)) break;
          await wait(30000);
        }
      }
      if (stopping || await fs.access(path.join(dir, 'pause')).then(()=>true,()=>false)) { stopping = true; break; }
      const disk = await fs.statfs(plan.output);
      if (disk.bavail * disk.bsize < 10 * 1024 ** 3) { await status('paused_disk', { detail: '输出磁盘可用空间低于 10 GiB' }); stopping = true; break; }
      await event(item, { status: 'processing', attempts: (previous?.attempts ?? 0) + 1 });
      await status('parsing');
      try {
        const record = await acquire(async () => {
          const file = path.resolve(plan.source, item.relative);
          if (!within(plan.source, file)) throw new Error('原件目录越界');
          const before = await fs.stat(file);
          if (before.size !== item.size || before.mtimeMs !== item.mtime_ms) throw new Error('原件自生成队列后发生变化，保留待人工核对');
          if (before.size > 100 * 1024 * 1024) throw new Error('PDF 超过内网服务 100 MiB 上限');
          const bytes = await fs.readFile(file), after = await fs.stat(file);
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || !completePdf(bytes)) throw new Error('PDF 不完整或仍在写入');
          const hash = sha(bytes);
          const known = byHash.get(hash);
          if (known && ['parsed','indexed'].includes(known.status)) return known;
          const existing = known || await capture({ bytes, filename: path.basename(file), title: path.basename(file, '.pdf'), source_kind: 'local', source_meta: { import_method: 'report-batch', import_path: file, batch_order: item.order, month_directory: item.month, sort_date: item.date, sort_date_source: item.date_source }, metadata: { document_type: '研报' } });
          const parsed = await parseRecord(existing, { skipArticleAnalysis: parseOnly });
          byHash.set(hash, parsed); return parsed;
        });
        await event(item, { status: 'parsed', document_id: record.id, wiki_slug: record.wiki_slug });
        pending.push({ item, record });
      } catch (e) {
        await event(item, { status: 'failed', stage: 'parse', error: e.message });
        await fs.appendFile(path.join(dir, 'failures.jsonl'), JSON.stringify({ at: now(), relative: item.relative, stage: 'parse', error: e.message }) + '\n');
        console.error(JSON.stringify({ at: now(), order: item.order, relative: item.relative, error: e.message }));
      }
      handled++;
      // Publish the first report immediately, then amortize indexing across small batches.
      if (parseOnly || pending.length >= batchSize || counts().completed === 0) await finishGroup();
    }
    // A normal pause drains parsed reports; forced termination is safely resumed from events + manifest.
    if (pending.length) { stopping = false; await finishGroup(); stopping = true; }
    active = null;
    const result = counts();
    await status(result.pending === 0 ? (result.failed ? 'completed_with_failures' : 'completed') : 'paused');
    console.log(JSON.stringify({ at: now(), result }));
    return result;
  } catch (error) { await status('blocked', { detail: error.message }); throw error; }
  finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    await closeDb(); await lock.close(); await fs.unlink(lockFile);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
  try {
    const source = option('--source', 'D:/data/reports/raw'), output = option('--output', 'D:/data/reports/processed');
    const plan = await loadOrCreatePlan({ source, output, year: Number(option('--year', 2026)), fromMonth: Number(option('--from-month', 9)), toMonth: Number(option('--to-month', 5)) });
    if (args.includes('--plan')) console.log(JSON.stringify({ ...plan, files: plan.files.slice(0, 8) }, null, 2));
    else await runReportBatch(plan, { limit: Number(option('--limit', Infinity)), batchSize: Number(option('--batch-size', 5)), retryFailed: args.includes('--retry-failed'), parseOnly: args.includes('--parse-only'), concurrency: Number(option('--concurrency', 1)) });
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
