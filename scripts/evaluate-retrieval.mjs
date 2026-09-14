import fs from 'node:fs/promises';
import { agentRequest } from './agent/client.mjs';

// JSONL: {id, query, filters?, relevant_documents:[document_id], relevant_blocks?:[block_id]}
const args = process.argv.slice(2), file = args[0];
if (!file) { console.error('Usage: node scripts/evaluate-retrieval.mjs questions.jsonl [lexical|hybrid|deep]'); process.exitCode = 2; }
else {
  const cases = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim()).map(JSON.parse);
  const results = [];
  for (const c of cases) {
    if (typeof c.query !== 'string' || !Array.isArray(c.relevant_documents) || !c.relevant_documents.length) throw new Error('Each case needs query and nonempty relevant_documents');
    try {
      const found = await agentRequest('search', { query: c.query, filters: c.filters, mode: args[1] ?? 'lexical', group_by: 'document', limit: 20, max_response_tokens: 32000, timeout_ms: 60000, explain: true });
      const ids = found.results.slice(0, 20).map(x => x.document_id), relevant = new Set(c.relevant_documents);
      const gains = ids.slice(0, 10).map(id => relevant.has(id) ? 1 : 0);
      const dcg = gains.reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
      const ideal = Array.from({ length: Math.min(10, relevant.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
      const first = ids.findIndex(id => relevant.has(id));
      const blocks = new Set(found.results.flatMap(x => x.evidence ? [x.evidence.block_id] : []));
      results.push({ id: c.id, recall_at_20: new Set(ids.filter(id => relevant.has(id))).size / relevant.size, reciprocal_rank: first < 0 ? 0 : 1 / (first + 1), ndcg_at_10: dcg / ideal,
        evidence_recall: c.relevant_blocks?.length ? c.relevant_blocks.filter(b => blocks.has(b)).length / c.relevant_blocks.length : null,
        latency_ms: found.latency_ms, degraded: found.degraded, returned_count: ids.length, response_truncated: found.truncated, snapshot_id: found.snapshot_id });
    } catch (e) { results.push({ id: c.id, error: e.code ?? e.message }); }
    console.error(`Evaluated ${results.length}/${cases.length}`);
  }
  const average = key => results.length ? results.reduce((sum, r) => sum + (r[key] ?? 0), 0) / results.length : null;
  const latencies = results.filter(r => !r.error).map(r => r.latency_ms).sort((a, b) => a - b);
  const quantile = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)] : null;
  console.log(JSON.stringify({ mode: args[1] ?? 'lexical', cases: results.length,
    summary: { recall_at_20: average('recall_at_20'), mrr: average('reciprocal_rank'), ndcg_at_10: average('ndcg_at_10'),
      errors: results.filter(r => r.error).length, p50_ms: quantile(.5), p95_ms: quantile(.95), failures_count_as_zero: true }, results }, null, 2));
}
