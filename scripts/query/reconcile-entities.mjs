import fs from 'node:fs/promises';
import path from 'node:path';
import { reconcileNames } from './entity-reconciliation.mjs';
import { withRead } from './store.mjs';
import { closeDb } from '../server/db.mjs';

// Produces a reviewable proposal; publishing remains entity-admin apply + graph-index.
const output = path.resolve(process.argv[2] ?? 'work/entity-reconciliation');
try {
  const current = JSON.parse(await fs.readFile('config/entity-registry.json', 'utf8'));
  const master = JSON.parse(await fs.readFile('config/entity-masterdata.json', 'utf8'));
  const reviewed = JSON.parse(await fs.readFile('config/entity-reviewed-aliases.json', 'utf8'));
  const names = await withRead(run => run(`SELECT m.entity_type,m.normalized_name,min(m.raw_value) example,
    count(DISTINCT m.document_id)::int documents FROM research_query.entity_mentions m JOIN research_query.documents d
    ON d.document_id=m.document_id AND d.revision_id=m.revision_id WHERE NOT d.deleted
    GROUP BY m.entity_type,m.normalized_name ORDER BY documents DESC,m.entity_type,m.normalized_name`));
  const result = reconcileNames(names, current, master, reviewed);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'registry.proposed.json'), JSON.stringify(result.proposal, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'decisions.json'), JSON.stringify(result.decisions, null, 2) + '\n');
  const summary = { ...result.summary, created_at: new Date().toISOString(), by_type: {}, review_reasons: {} };
  for (const row of result.decisions) {
    const type = summary.by_type[row.entity_type] ??= { mapped: 0, review: 0 }; type[row.action]++;
    if (row.action === 'review') summary.review_reasons[row.reason] = (summary.review_reasons[row.reason] ?? 0) + 1;
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...summary }, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await closeDb(); }
