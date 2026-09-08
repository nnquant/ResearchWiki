import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createSharedClient, extractMineruZip, validateEmbeddingInput } from '../scripts/shared-api-client.mjs';

const root = path.resolve('work', `shared-api-tests-${process.pid}`);
test.before(() => fs.mkdir(root, { recursive: true }));
test.after(() => fs.rm(root, { recursive: true, force: true }));
const pdf = Buffer.from('%PDF-1.7\nfixture\n%%EOF');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function zipResult() {
  const zip = new AdmZip();
  zip.addFile('parse-report.json', Buffer.from('{"pdf_pages":1,"device":"cuda"}'));
  zip.addFile('document/auto/document.md', Buffer.from('![图](images/image.png)'));
  zip.addFile('document/auto/pages.md', Buffer.from('## PDF 第 1 页\n\n测试内容'));
  zip.addFile('document/auto/images/image.png', Buffer.from('image fixture'));
  return zip;
}
const client = fetchImpl => createSharedClient({ baseUrl: 'http://shared.test:8019', apiKey: 'test-secret', fetchImpl, sleep: async () => {} });

test('embedding enforces Unicode length, batch size and float without truncation', () => {
  const payload = validateEmbeddingInput({ model: 'bge-m3', input: ['😀'.repeat(2000)], encoding_format: 'base64' });
  assert.equal(payload.input[0], '😀'.repeat(2000));
  assert.equal(payload.encoding_format, 'float');
  for (const input of [['中'.repeat(2001)], Array(33).fill('text'), [' '], [], [1]]) assert.throws(() => validateEmbeddingInput({ model: 'bge-m3', input }));
});

test('429 retries are delayed, auth stays at configured host, other errors are not repeated', async () => {
  let calls = 0; const delays = [];
  const api = createSharedClient({ baseUrl: 'http://shared.test', apiKey: 'test-secret', sleep: async ms => delays.push(ms), fetchImpl: async (url, init) => {
    assert.equal(url, 'http://shared.test/v1/embeddings');
    assert.equal(init.headers.authorization, 'Bearer test-secret');
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).encoding_format, 'float');
    return ++calls === 1 ? new Response('', { status: 429 }) : json({ data: [] });
  } });
  await api.embeddings(['hello']); assert.equal(calls, 2); assert.deepEqual(delays, [3000]);
  let badCalls = 0;
  await assert.rejects(client(async () => { badCalls++; return new Response('secret response', { status: 401 }); }).models(), /HTTP 401/);
  assert.equal(badCalls, 1);
});

test('MinerU posts binary once, persists ID and resumes polling after disconnect', async () => {
  const out = path.join(root, 'resume'); let posts = 0; let disconnected = false;
  const api = client(async (url, init) => {
    if (url.endsWith('/mineru/jobs')) {
      posts++; assert.equal(init.headers['content-type'], 'application/pdf'); assert.deepEqual(init.body, pdf);
      return json({ id: 'job-1' }, 202);
    }
    if (!disconnected) { disconnected = true; throw new Error('network disconnected'); }
    return url.endsWith('/result') ? new Response(zipResult().toBuffer()) : json({ status: 'succeeded' });
  });
  await assert.rejects(api.parsePdf(pdf, out), /network disconnected/);
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'remote-job.json'), 'utf8')).id, 'job-1');
  await api.parsePdf(pdf, out);
  assert.equal(posts, 1);
  assert.match(await fs.readFile(path.join(out, 'document/auto/pages.md'), 'utf8'), /第 1 页/);
  assert.equal(await fs.readFile(path.join(out, 'document/auto/images/image.png'), 'utf8'), 'image fixture');
});

test('ambiguous POST never auto-resubmits; an explicit queue rejection can be retried', async () => {
  const out = path.join(root, 'uncertain'); let posts = 0;
  const api = client(async () => { posts++; throw new Error('connection lost during upload'); });
  await assert.rejects(api.parsePdf(pdf, out), /connection lost/);
  await assert.rejects(api.parsePdf(pdf, out), /提交结果不确定/);
  assert.equal(posts, 1);
  const busy = path.join(root, 'busy'); let attempts = 0;
  await assert.rejects(client(async () => { attempts++; return new Response('', { status: 429 }); }).parsePdf(pdf, busy), /HTTP 429/);
  assert.equal(attempts, 6);
  assert.equal(JSON.parse(await fs.readFile(path.join(busy, 'remote-job.json'), 'utf8')).status, 'rejected');
});

test('terminal parse failure retains task ID and never creates a new job', async () => {
  let posts = 0; const out = path.join(root, 'failed');
  const api = client(async url => url.endsWith('/mineru/jobs') ? (posts++, json({ id: 'failed-1' }, 202)) : json({ status: 'failed' }));
  await assert.rejects(api.parsePdf(pdf, out), /远程 PDF 解析失败/);
  await assert.rejects(api.parsePdf(pdf, out), /远程 PDF 解析失败/);
  assert.equal(posts, 1);
  await assert.rejects(api.parsePdf(Buffer.concat([pdf, Buffer.from('\n% other PDF')]), out), /其他原件/);
  assert.equal(posts, 1);
});

test('concurrent state writes use independent temporary files', async () => {
  const { atomicJson } = await import('../scripts/common.mjs');
  const file = path.join(root, 'concurrent.json');
  await Promise.all(Array.from({ length: 20 }, (_, value) => atomicJson(file, { value })));
  assert.ok(Number.isInteger(JSON.parse(await fs.readFile(file, 'utf8')).value));
  assert.equal((await fs.readdir(root)).filter(name => name.startsWith('concurrent.json.')).length, 0);
});

test('ZIP extraction rejects traversal, symlinks, missing contract and CRC corruption', async () => {
  const out = path.join(root, 'unsafe');
  const traversal = zipResult();
  // Override the name after insertion: ZIP creators normally normalize traversal.
  traversal.getEntry('document/auto/document.md').entryName = '../escape.md';
  await assert.rejects(extractMineruZip(traversal.toBuffer(), out), /路径/);
  const symbolic = zipResult(); symbolic.getEntry('document/auto/document.md').attr = (0xa1ff << 16) >>> 0;
  await assert.rejects(extractMineruZip(symbolic.toBuffer(), out), /符号链接/);
  const missing = new AdmZip(); missing.addFile('parse-report.json', Buffer.from('{}'));
  await assert.rejects(extractMineruZip(missing.toBuffer(), out), /缺少/);
  const corrupt = zipResult().toBuffer();
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  // Change stored CRC in both headers so it cannot match actual decompressed data.
  const local = corrupt.readUInt32LE(central + 42);
  corrupt.writeUInt32LE(123456, central + 16); corrupt.writeUInt32LE(123456, local + 14);
  await assert.rejects(extractMineruZip(corrupt, out), /CRC|crc/);
});
