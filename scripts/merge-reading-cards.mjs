import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { dataPath, manifest, manifestPath, atomicJson, readJson, sha, gb, withLock, now } from './common.mjs';
import { indexWiki } from './ingest.mjs';

// Only the three initial, unedited registration cards qualify for this migration.
const cards = [
  ['b07bff7f1d80ca4738c1965e', 'reports', '研报'],
  ['b598f1afbfe2b277dc638cb3', 'papers', '论文'],
  ['061d1524285347eb245341d9', 'papers', '论文'],
];
await withLock(async () => {
  const catalog = await manifest();
  const archive = dataPath('state', 'archives', 'initial-reading-cards');
  const redirects = await readJson(dataPath('state', 'page-redirects.json'), {});
  const receipt = [];
  const plans = [];
  for (const [id, dir, category] of cards) {
    const doc = catalog.documents[id];
    if (!doc) throw new Error(`文献不存在：${id}`);
    const slug = `${dir}/${id}`;
    const file = path.resolve(dataPath('wiki', slug + '.md'));
    if (!file.startsWith(path.resolve(dataPath('wiki')) + path.sep)) throw new Error('归档路径越界');
    const backup = path.join(archive, slug + '.md');
    const text = await fs.readFile(file, 'utf8').catch(e => {
      if (e.code !== 'ENOENT') throw e;
      return fs.readFile(backup, 'utf8');
    });
    const card = matter(text), title = doc.title.replace(/\.pdf$/i, '');
    const expected = `# ${title}\n\n## 来源\n\n- [[${doc.wiki_slug}|${title}]]\n- 来源知识库：${doc.source_meta.knowledge_base}。\n- 原始文件共 ${doc.pages} 页，已由 MinerU 完整解析。\n\n## 阅读状态\n\n尚未完成研究解读。此页仅是文献登记，不表示文中策略或观点已经被验证。\n\n## 后续研究记录\n\n阅读后补充：核心问题、机制、数据与样本、方法、关键证据与页码、适用边界、可复现实验。遵循 [[concepts/研究方法]] 和 [[concepts/证据与引用]]。`;
    if (card.content.replace(/\r/g, '').trim() !== expected || card.data.review_status !== 'unread' || card.data.derived_from?.[0] !== doc.wiki_slug) {
      throw new Error(`阅读卡已改变，保留现有内容：${slug}`);
    }
    plans.push({ doc, slug, file, backup, text, category });
  }
  for (const { doc, slug, file, backup, text, category } of plans) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    try { await fs.writeFile(backup, text, { flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (sha(await fs.readFile(backup)) !== sha(text)) throw new Error('归档校验失败');
    const sourceFile = dataPath('wiki', doc.wiki_slug + '.md');
    const sourceText = await fs.readFile(sourceFile, 'utf8');
    const sourceBackup = path.join(archive, doc.wiki_slug + '.md');
    await fs.mkdir(path.dirname(sourceBackup), { recursive: true });
    try { await fs.writeFile(sourceBackup, sourceText, { flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    const source = matter(sourceText);
    source.data.document_type = category;
    if (source.data.review_status === 'unreviewed') source.data.review_status = 'unread';
    source.data.tags = [...new Set([...(source.data.tags ?? []).filter(t => !['原始证据', '待分类'].includes(t)), category])];
    const body = source.content.replace('> 原始证据，尚未经研究审核。', '> 文献全文。');
    await fs.writeFile(sourceFile, matter.stringify(body, source.data));
    doc.document_type = category;
    redirects[slug] = doc.wiki_slug;
    await atomicJson(dataPath('state', 'page-redirects.json'), redirects);
    // GBrain soft-delete removes the card from retrieval; the full Markdown archive is permanent.
    await gb(['delete', slug]);
    await fs.unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; });
    receipt.push({ from: slug, to: doc.wiki_slug, category, archive: backup, sha256: sha(text) });
  }
  await atomicJson(manifestPath, catalog);
  await indexWiki();
  // Import adds tags but does not remove old ones.
  for (const { doc } of plans) await gb(['untag', doc.wiki_slug, '原始证据']);
  await atomicJson(path.join(archive, 'receipt.json'), { completed_at: now(), cards: receipt });
  console.log(JSON.stringify({ archived_cards: receipt.length, archive, documents: receipt.map(r => ({ slug: r.to, category: r.category })) }));
});
