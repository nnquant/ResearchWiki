import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const testRoot = path.resolve('work', 'investment-tests-' + process.pid);
process.env.WIKI_DATA_ROOT = testRoot;
const { ensureDirs, dataPath } = await import('../scripts/common.mjs');
const { researchSchema, researchRelations, researchErrors, isReviewDue, localToday } = await import('../scripts/research-schema.mjs');
const { renderTemplate, listTemplates } = await import('../scripts/server/templates.mjs');
const { validatePageText } = await import('../scripts/server/validate.mjs');
const { writePage, readPage } = await import('../scripts/server/wiki-files.mjs');
const { typeForSlug, dirForType } = await import('../scripts/server/slugs.mjs');
const { getPage, getIndex, homeData, filterPageIndex } = await import('../scripts/server/pages-service.mjs');
const { createRouter } = await import('../scripts/server/router.mjs');
const { registerEditRoutes } = await import('../scripts/server/routes/edit.mjs');
const { registerPageRoutes } = await import('../scripts/server/routes/pages.mjs');
const { activeJob, queueLength } = await import('../scripts/server/jobs.mjs');
await ensureDirs();

test.after(async () => {
  // Writes queue indexing independently; this fixture intentionally has no GBrain.
  for (let i = 0; i < 100 && (activeJob() || queueLength()); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(activeJob(), null);
  await new Promise(r => setTimeout(r, 30));
  await fs.rm(testRoot, { recursive: true, force: true });
});

test('all investment templates create valid, editable pages with no invented as-of date', async () => {
  const templates = await listTemplates();
  for (const type of ['company', 'industry', 'macro', 'event', 'valuation', 'meeting', 'theme', 'claim']) {
    const dir = dirForType(type);
    const slug = `${dir}/fixture`;
    const tpl = templates.find(t => t.type === type);
    assert.ok(tpl?.description);
    assert.equal(typeForSlug(slug), type);
    for (const field of tpl.fields) assert.ok(researchRelations.includes(field));
    const text = await renderTemplate(type, { title: `${type}研究`, slug });
    const validation = await validatePageText(text, { slug });
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    assert.equal(validation.frontmatter.as_of, null);
    assert.equal(validation.frontmatter.research_stage, 'draft');
    await writePage(slug, text, { create: true });
    const page = await getPage(slug);
    assert.equal(page.type, type);
    assert.equal(page.editable, true);
    assert.equal(page.research.as_of, null);
  }
  for (const type of ['company', 'industry', 'macro', 'note']) for (const link of ['about', 'belongs_to', 'impacts', 'compares_with']) {
    assert.ok(researchSchema.frontmatter_links.some(l => l.page_type === type && l.link_type === link));
  }
});

test('new typed relations are validated and returned in the reader before indexing', async () => {
  const slug = 'events/announcement';
  const text = await renderTemplate('event', {
    title: '公告事件', slug, relations: { about: ['companies/fixture'], impacts: ['industries/fixture'], derived_from: ['macro/fixture'] },
    research: { as_of: '2026-09-07', tickers: ['600000.SH'], region: '中国', research_stage: 'tracking', next_review: '2000-01-01' },
  });
  assert.equal((await validatePageText(text, { slug })).ok, true);
  await writePage(slug, text, { create: true });
  const page = await getPage(slug);
  assert.equal(page.relations.out.about[0].slug, 'companies/fixture');
  assert.equal(page.relations.out.impacts[0].exists, true);
  assert.equal(page.research.as_of, '2026-09-07');
  const invalid = text.replace('companies/fixture', 'companies/missing');
  assert.ok((await validatePageText(invalid, { slug })).errors.some(e => e.field === 'about'));
  const index = await getIndex();
  assert.equal(filterPageIndex(index, { q: '600000.sh', stage: 'tracking', due: true }).total, 1);
  const home = await homeData();
  assert.equal(home.due_total, 1);
  assert.equal(home.due[0].slug, slug);
});

test('date and metadata validation rejects impossible dates, timestamps, wrong stages and non-string codes', async () => {
  for (const scalar of ['2026-02-30', '2026-09', '2026-09-07T12:00:00Z', '2026-13-01']) {
    for (const value of [scalar, JSON.stringify(scalar)]) {
      const text = `---\ntitle: 日期测试\ntype: macro\nnext_review: ${value}\n---\n正文`;
      assert.ok((await validatePageText(text, { slug: 'macro/date-test' })).errors.some(e => e.field === 'next_review'), value);
    }
  }
  const valid = await validatePageText('---\ntitle: 日期测试\ntype: macro\nas_of: 2024-02-29\nnext_review: null\n---\n正文', { slug: 'macro/date-test' });
  assert.equal(valid.ok, true);
  assert.equal(researchErrors({ research_stage: 'verified', tickers: [600000], region: {} }).length, 3);
  assert.deepEqual(researchErrors({ as_of: null, next_review: '', tickers: [], horizon: '未来一年' }), []);
});

test('review queue includes today and overdue pages, excludes archived and future dates, filters before pagination', () => {
  const today = '2026-09-07';
  const entries = [
    ['a', 'tracking', '2026-09-06'], ['b', 'reviewed', today], ['c', 'archived', '2026-09-01'], ['d', 'draft', '2026-09-08'], ['e', 'tracking', null],
  ].map(([slug, stage, next]) => ({ slug, title: slug, type: 'company', tags: [], aliases: ['别名' + slug], research: { research_stage: stage, next_review: next } }));
  assert.deepEqual(entries.filter(x => isReviewDue(x, today)).map(x => x.slug), ['a', 'b']);
  assert.equal(isReviewDue({ research: { next_review: '2026-02-30' } }, today), false);
  assert.equal(localToday(new Date(2026, 8, 7, 0, 0)), today);
  const pages = entries.map(x => ({ ...x, research: { ...x.research, next_review: '2000-01-01' } }));
  assert.equal(filterPageIndex(pages, { due: true, sort: 'title', dir: 'asc', limit: 1, offset: 1 }).total, 4);
  assert.equal(filterPageIndex(pages, { due: true, sort: 'title', dir: 'asc', limit: 1, offset: 1 }).items[0].slug, 'b');
  assert.equal(filterPageIndex(pages, { q: '别名a' }).items[0].slug, 'a');
});

test('page API creates, filters and edits research metadata, rejects invalid updates without changing the file', async () => {
  const router = createRouter();
  registerEditRoutes(router); registerPageRoutes(router);
  const call = (method, pathname, body = {}) => {
    const url = new URL(pathname, 'http://localhost');
    const matched = router.match(method, url.pathname);
    return matched.handler({ req: Readable.from([Buffer.from(JSON.stringify(body))]), params: matched.params, url });
  };
  const response = await call('POST', '/api/pages', { type: 'company', title: 'API公司', slug: 'companies/api-company', research: { tickers: ['TEST.HK'], research_stage: 'tracking', next_review: '2000-01-01' } });
  assert.equal(response.status, 201);
  const slug = response.data.slug;
  const page = await call('GET', `/api/page/${slug}`);
  assert.deepEqual(page.research.tickers, ['TEST.HK']);
  const results = await call('GET', '/api/pages?type=company&q=test.hk&stage=tracking&due=true');
  assert.equal(results.total, 1);
  const raw = await call('GET', `/api/page/${slug}/raw`);
  await assert.rejects(call('PUT', `/api/page/${slug}`, { content: raw.content.replace('tracking', 'invalid'), base_hash: raw.hash }), e => e.status === 422);
  assert.equal((await readPage(slug)).hash, raw.hash);
  await call('PUT', `/api/page/${slug}`, { content: raw.content.replace('tracking', 'archived'), base_hash: raw.hash });
  assert.equal((await call('GET', '/api/pages?q=test.hk&due=true')).total, 0);
  await assert.rejects(call('POST', '/api/pages', { type: 'macro', title: 'Bad research', research: [] }), e => e.status === 422);
  assert.ok((await fs.readdir(dataPath('wiki', 'companies'))).includes('api-company.md'));
});
