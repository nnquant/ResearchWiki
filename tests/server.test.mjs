import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const testRoot = path.resolve('work', 'server-tests-' + process.pid);
process.env.WIKI_DATA_ROOT = testRoot;

const { ensureDirs, dataPath, sha } = await import('../scripts/common.mjs');
const { normalizeSlug, isValidSlug, typeForSlug, editability, relationTarget } = await import('../scripts/server/slugs.mjs');
const { writePage, readPage, scanWiki, pathForSlug, invalidateScan } = await import('../scripts/server/wiki-files.mjs');
const { validatePageText } = await import('../scripts/server/validate.mjs');
const { renderTemplate, listTemplates } = await import('../scripts/server/templates.mjs');
const { createRouter } = await import('../scripts/server/router.mjs');
const { HttpError } = await import('../scripts/server/errors.mjs');
const { filterPageIndex, excerptOf, savedTranslationUrl, getIndex, getSummary, typesWithCounts } = await import('../scripts/server/pages-service.mjs');

await ensureDirs();
await fs.writeFile(dataPath('wiki', 'sources', 'doc1.md'), '---\ntitle: "Doc One"\ntype: "source"\n---\n# Doc One\n\n## PDF 第 1 页\n\ntext\n', 'utf8');
await fs.writeFile(dataPath('wiki', 'concepts', 'Agent使用协议.md'), '---\ntitle: Agent 使用协议\ntype: concept\n---\n# Agent\n', 'utf8');
invalidateScan();

test.after(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

test('translation links require an existing, nonempty file in a public directory', async () => {
  await fs.writeFile(dataPath('parsed', '译文.md'), '# 已保存的译文');
  await fs.writeFile(dataPath('parsed', 'empty.md'), '');
  await fs.writeFile(dataPath('state', 'private.md'), 'private');
  assert.equal(await savedTranslationUrl('parsed/译文.md'), '/assets/parsed/%E8%AF%91%E6%96%87.md');
  assert.equal(await savedTranslationUrl('wiki/sources/doc1.md'), '/page/sources/doc1');
  for (const value of [undefined, null, '', {}, 'parsed/missing.md', 'parsed/empty.md', 'parsed', 'state/private.md', 'parsed/../state/private.md', '../outside.md', 'https://example.com/translation.md']) {
    assert.equal(await savedTranslationUrl(value), null, JSON.stringify(value));
  }
});

test('slug normalization mirrors gbrain (lowercase, CJK kept, accents stripped, spaces to hyphens)', () => {
  assert.equal(normalizeSlug('concepts/Agent使用协议.md'), 'concepts/agent使用协议');
  assert.equal(normalizeSlug('claims/Café  Risk Premium'), 'claims/cafe-risk-premium');
  assert.equal(normalizeSlug('notes\\v1.0.0'), 'notes/v1.0.0');
  assert.equal(normalizeSlug('claims/[bad] name'), 'claims/bad-name');
});

test('slug validation rejects traversal and empty segments', () => {
  assert.equal(isValidSlug('claims/a'), true);
  assert.equal(isValidSlug('claims/../secret'), false);
  assert.equal(isValidSlug('claims//a'), false);
  assert.equal(isValidSlug(''), false);
  assert.equal(typeForSlug('claims/x'), 'claim');
  assert.equal(typeForSlug('文献目录'), 'note');
  assert.equal(editability('sources/doc1').editable, false);
  assert.equal(editability('claims/x').editable, true);
  assert.equal(relationTarget('[[sources/Doc1|Doc]]'), 'sources/doc1');
});

test('scanWiki maps normalized slugs to files on disk', async () => {
  const map = await scanWiki({ force: true });
  assert.ok(map.has('concepts/agent使用协议'));
  assert.ok(map.has('sources/doc1'));
  const page = await readPage('concepts/Agent使用协议');
  assert.equal(page.frontmatter.title, 'Agent 使用协议');
});

test('pathForSlug confines new files to the wiki directory', () => {
  assert.throws(() => pathForSlug('../outside'), HttpError);
  assert.ok(pathForSlug('claims/new-page').startsWith(dataPath('wiki')));
});

test('category lists include disk-only pages and filter before counting and pagination', () => {
  const pages = [
    { slug: 'notes/b', title: 'B', type: 'note', tags: ['reading'], review_status: 'unread', indexed: true },
    { slug: 'index', title: 'A', type: 'note', tags: ['reading'], review_status: 'unread', indexed: false },
    { slug: 'sources/c', title: 'C', type: 'source', tags: [], review_status: 'unread' },
  ];
  const filters = { type: ['note'], tag: 'reading', status: 'unread', sort: 'title', dir: 'asc', limit: 1 };
  const first = filterPageIndex(pages, filters);
  assert.equal(first.total, 2);
  assert.equal(first.items[0].slug, 'index');
  assert.equal(filterPageIndex(pages, { ...filters, offset: 1 }).items[0].slug, 'notes/b');
  assert.equal(filterPageIndex(pages, { ...filters, status: 'reviewed' }).total, 0);
  assert.equal(filterPageIndex(pages, { ...filters, q: 'B' }).total, 1);
  const dated = pages.slice(0, 2).map((p, i) => ({ ...p, updated_at: new Date(`2026-09-0${i + 6}T00:00:00Z`) }));
  assert.equal(filterPageIndex(dated, { sort: 'updated', dir: 'desc' }).items[0].slug, 'index');
});

test('article preview prefers abstract, falls back to clean body and caps at 200 Unicode characters', () => {
  const body = '# Title\n> 文献全文。接收时间：2026-09-06\n[原始文件](/assets/raw/test.pdf) · [解析 Markdown](/assets/parsed/test.md)\n---\n## PDF 第 1 页\n![图](/chart.png)\n**正文**包含[研究证据](https://example.com)。';
  assert.equal(excerptOf(body, ' 摘要优先。 '), '摘要优先。');
  assert.equal(excerptOf(body, '  '), '正文包含研究证据。');
  assert.equal(excerptOf(body, null), '正文包含研究证据。');
  assert.equal(excerptOf('', '研😀'.repeat(110)), '研😀'.repeat(100) + '…');
  assert.equal(excerptOf(''), '');
});

test('research category filters mix original documents and notes without duplicating sources', () => {
  const pages = [
    { slug: 'sources/company', title: 'A', type: 'source', category: 'company' },
    { slug: 'companies/note', title: 'B', type: 'company', category: 'company' },
    { slug: 'sources/industry', title: 'C', type: 'source', category: 'industry' },
    { slug: 'sources/unknown', title: 'D', type: 'source', category: 'source' },
  ];
  const company = filterPageIndex(pages, { type: ['company'], sort: 'title', dir: 'asc', limit: 1 });
  assert.equal(company.total, 2);
  assert.equal(company.items[0].slug, 'sources/company');
  assert.equal(company.items[0].type, 'source');
  assert.equal(filterPageIndex(pages, { type: ['source'] }).total, 1);
  assert.equal(filterPageIndex(pages, { type: ['industry'] }).items[0].slug, 'sources/industry');
  assert.equal(filterPageIndex(pages, {}).total, 4);
});

test('existing source files acquire consistent categories in index, counts and reader summaries', async () => {
  await writePage('sources/category-company', '---\ntitle: NetApp（NTAP）财报点评\ntype: source\n---\n## PDF 第 1 页\n原文。', { create: true });
  const index = await getIndex();
  const entry = index.find(p => p.slug === 'sources/category-company');
  assert.equal(entry.type, 'source');
  assert.equal(entry.category, 'company');
  assert.equal((await getSummary(entry.slug)).category, 'company');
  const counts = await typesWithCounts();
  assert.equal(counts.find(t => t.type === 'company').n, filterPageIndex(index, { type: ['company'] }).total);
  assert.equal(counts.find(t => t.type === 'source').label, '待分类文献');
  assert.equal(counts.reduce((n, t) => n + t.n, 0), index.length);
});

test('archived card links open the full text without shadowing actual notes', async () => {
  await fs.writeFile(dataPath('state', 'page-redirects.json'), JSON.stringify({ 'papers/old-card': 'sources/doc1', 'claims/actual-note': 'sources/doc1' }));
  assert.equal((await readPage('papers/old-card')).slug, 'sources/doc1');
  await writePage('claims/actual-note', '---\ntitle: Real note\ntype: claim\n---\nMy research', { create: true });
  assert.equal((await readPage('claims/actual-note')).frontmatter.title, 'Real note');
  assert.equal(await readPage('papers/missing'), null);
});

test('validatePageText enforces frontmatter, type/dir match and existing relation targets', async () => {
  const ok = await validatePageText('---\ntitle: T\ntype: claim\nsupported_by: ["sources/doc1"]\n---\n# T\n', { slug: 'claims/t' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const badType = await validatePageText('---\ntitle: T\ntype: factor\n---\n# T\n', { slug: 'claims/t' });
  assert.ok(badType.errors.some(e => e.field === 'type'));
  const badRel = await validatePageText('---\ntitle: T\ntype: claim\nderived_from: ["sources/missing"]\n---\n# T\n', { slug: 'claims/t' });
  assert.ok(badRel.errors.some(e => e.field === 'derived_from' && e.message.includes('sources/missing')));
  const noFm = await validatePageText('# no frontmatter\n', { slug: 'claims/t' });
  assert.equal(noFm.ok, false);
  const badYaml = await validatePageText('---\ntitle: [unclosed\ntype: claim\n---\n# T\n', { slug: 'claims/t' });
  assert.equal(badYaml.ok, false);
});

test('writePage creates atomically, backs up previous versions and detects concurrent edits', async () => {
  const first = await writePage('claims/atomic-test', '---\ntitle: A\ntype: claim\n---\n# A\n', { create: true });
  assert.equal(first.hash, sha('---\ntitle: A\ntype: claim\n---\n# A\n'));
  await assert.rejects(writePage('claims/atomic-test', 'x', { create: true }), e => e.status === 409);
  const second = await writePage('claims/atomic-test', '---\ntitle: A2\ntype: claim\n---\n# A2\n', { baseHash: first.hash });
  await assert.rejects(writePage('claims/atomic-test', '---\ntitle: A3\ntype: claim\n---\n# A3\n', { baseHash: first.hash }), e => {
    assert.equal(e.status, 409);
    assert.equal(e.data.current_hash, second.hash);
    assert.ok(e.data.current_content.includes('A2'));
    return true;
  });
  const forced = await writePage('claims/atomic-test', '---\ntitle: A3\ntype: claim\n---\n# A3\n', { baseHash: first.hash, force: true });
  assert.ok(forced.hash);
  const history = await fs.readdir(dataPath('state', 'edit-history', 'claims', 'atomic-test'));
  assert.equal(history.length, 2, 'two previous versions backed up');
  const leftovers = (await fs.readdir(dataPath('wiki', 'claims'))).filter(n => n.endsWith('.tmp'));
  assert.equal(leftovers.length, 0, 'no temp files left behind');
  await assert.rejects(writePage('claims/never-existed', 'x', {}), e => e.status === 404);
});

test('templates render frontmatter with declared relations', async () => {
  const templates = await listTemplates();
  assert.ok(templates.some(t => t.type === 'claim' && t.label === '观点'));
  assert.ok(!templates.some(t => t.type === 'source'));
  const text = await renderTemplate('factor', { title: '测试因子', slug: 'factors/测试因子', tags: ['a'], relations: { uses_dataset: ['datasets/x'] } });
  assert.match(text, /^---\ntitle: 测试因子\ntype: factor\n/);
  assert.match(text, /uses_dataset:\n {2}- datasets\/x/);
  assert.match(text, /# 测试因子/);
});

test('router matches wildcard slugs before suffix routes and decodes captures', () => {
  const router = createRouter();
  router.route('GET', '/api/page/*/summary', () => 'summary');
  router.route('GET', '/api/page/*', () => 'page');
  assert.equal(router.match('GET', '/api/page/a/b/summary').handler(), 'summary');
  assert.equal(router.match('GET', '/api/page/a/b/summary').params.wild, 'a/b');
  assert.equal(router.match('GET', '/api/page/%E6%96%87%E7%8C%AE').params.wild, '文献');
  assert.equal(router.match('POST', '/api/page/a'), null);
});
