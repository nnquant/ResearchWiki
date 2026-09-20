import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadRegistry } from '../scripts/query/entities.mjs';
import { evaluateEntityCases } from '../scripts/query/entity-benchmark.mjs';
test('curated entity regression: ambiguity, separate companies, codes and contextual meanings',{skip:process.env.RESEARCH_ENTITY_LOCAL_TEST!=='1'},async()=>{
  const cases=JSON.parse(await fs.readFile(new URL('./fixtures/entity-quality.json',import.meta.url),'utf8'));
  const report=evaluateEntityCases(await loadRegistry(),cases);
  assert.deepEqual(report.results.filter(r=>!r.passed),[]);assert.equal(report.false_merges,0);assert.equal(report.identity_recall,1);
});
