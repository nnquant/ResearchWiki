import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildReportPlan, reportDate, readEvents, within, reportOutput } from '../scripts/report-batch-plan.mjs';

const folder = path.resolve('work', `report-batch-tests-${process.pid}`);
test.after(() => fs.rm(folder, { recursive: true, force: true }));
test('plan includes selected month folders only and orders by report date instead of download time', async () => {
  const source = path.join(folder, 'raw'), output = path.join(folder, 'processed');
  const names = ['2026年9月📈/2026-09-06/20260904-甲.pdf', '2026年9月📈/2026-09-02/20260905-乙.pdf', '2026年8月📈/20260831-丙.pdf', '2026年5月📈/20260531-丁.pdf', '2026年4月📈/20260430-戊.pdf', '归档-历史/20260906-不处理.pdf', '2026年9月📈/download.pdf.part'];
  for (const name of names) { const file = path.join(source, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '%PDF-fixture'); }
  const plan = await buildReportPlan({ source, output });
  assert.equal(plan.total, 4);
  assert.deepEqual(plan.files.map(f => f.date), ['2026-09-05', '2026-09-04', '2026-08-31', '2026-05-31']);
  assert.deepEqual(plan.files.map(f => f.order), [1, 2, 3, 4]);
  assert.equal(plan.months[9], 2);
  assert.equal(plan.months[6], 0);
});
test('invalid filename date falls back to dated directory; unknown dates stay labeled', () => {
  assert.deepEqual(reportDate('2026年9月/2026-09-05/20260900-无效.pdf', 1, 2026, 9), { date: '2026-09-05', date_source: 'directory' });
  assert.equal(reportDate('2026年5月/无日期.pdf', 1, 2026, 5).date_source, 'month-directory');
});
test('plan never nests output within raw and output names disambiguate truncation', async () => {
  await assert.rejects(buildReportPlan({ source: folder, output: path.join(folder, 'output') }), /相互独立/);
  assert.equal(within(folder, path.join(folder, '..', 'escape')), false);
  assert.notEqual(reportOutput('机构/' + '相同'.repeat(100) + '甲.pdf').output_relative, reportOutput('机构/' + '相同'.repeat(100) + '乙.pdf').output_relative);
});
test('journal resumes latest state, tolerates an interrupted final append, rejects middle corruption', () => {
  const entries = '{"id":"a","status":"processing","order":1}\n{"id":"a","status":"completed"}\n{"id":';
  assert.deepEqual(readEvents(entries).get('a'), { id: 'a', status: 'completed', order: 1 });
  assert.throws(() => readEvents('{invalid}\n{"id":"a"}\n'));
});

test('processed export preserves originals, relative assets and a final completion record', async () => {
  const data = path.join(folder, 'wiki-data');
  process.env.WIKI_DATA_ROOT = data;
  const { exportProcessed } = await import('../scripts/import-report-batch.mjs');
  const { sha } = await import('../scripts/common.mjs');
  const raw = path.join(data, 'raw/test.pdf'), parsed = path.join(data, 'parsed/doc/rev/document/auto');
  await fs.mkdir(path.dirname(raw), { recursive: true }); await fs.mkdir(path.join(parsed, 'images'), { recursive: true });
  const original = Buffer.from('%PDF-fixture\n%%EOF'); await fs.writeFile(raw, original);
  await fs.writeFile(path.join(parsed, 'document.md'), '![image](images/x.png)');
  await fs.writeFile(path.join(parsed, 'images/x.png'), 'fixture image');
  const plan = { source: path.join(folder, 'raw'), output: path.join(folder, 'export') };
  const item = { relative: '2026年9月/报告.pdf', output_relative: '2026年9月/报告--id', month: 9, date: '2026-09-04', date_source: 'filename' };
  const record = { id: 'doc', revision: 'rev', raw_path: 'raw/test.pdf', parsed_path: 'parsed/doc/rev/document/auto/document.md', sha256: sha(original), wiki_slug: 'sources/doc', title: '报告', pages: 1 };
  const out = await exportProcessed(plan, item, record);
  await exportProcessed(plan, item, record); // Idempotent after restart.
  assert.deepEqual(await fs.readFile(raw), original);
  assert.deepEqual(await fs.readFile(path.join(out, 'original.pdf')), original);
  assert.equal(await fs.readFile(path.join(out, 'parsed/document/auto/images/x.png'), 'utf8'), 'fixture image');
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8')).status, 'indexed');
  await fs.writeFile(path.join(out, 'original.pdf'), 'different original');
  await assert.rejects(exportProcessed(plan, item, record));
});
