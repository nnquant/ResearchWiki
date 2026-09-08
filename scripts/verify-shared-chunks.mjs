// Run with Bun and WIKI_SHARED_API=1 after patch-gbrain.mjs.
import assert from 'node:assert/strict';
import { chunkText, MARKDOWN_CHUNKER_VERSION } from '../vendor/gbrain/src/core/chunkers/recursive.ts';
import { buildContextualPrefix, wrapChunkForEmbedding } from '../vendor/gbrain/src/core/embedding-context.ts';
assert.equal(MARKDOWN_CHUNKER_VERSION, 10003);
for (const text of [Array.from({length:800},(_,i)=>`公司${i}的盈利质量与竞争优势。`).join(''), '长段落没有空格'.repeat(2000), 'https://example.com/' + 'a'.repeat(9000), '😀'.repeat(3000), 'Industry analysis and valuation. '.repeat(300)]) {
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 1300);
    const wrapped = wrapChunkForEmbedding(chunk.text, buildContextualPrefix('长标题'.repeat(200), '摘要'.repeat(300)), 'body');
    assert.ok([...wrapped].length <= 2000);
    assert.equal(chunk.text.isWellFormed(), true);
  }
  // Sliding windows may overlap, but the final source tail must still be represented.
  assert.ok(chunks.at(-1).text.endsWith(text.trim().slice(-40)));
}
console.log('长中文、英文、URL、emoji 均完整分块；含最长上下文后每段仍不超过 2000 字。');
