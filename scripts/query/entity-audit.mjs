import fs from 'node:fs/promises';
import path from 'node:path';
import { withRead } from './store.mjs';
import { closeDb } from '../server/db.mjs';

// Read-only, current-version audit. Names are not counts of real-world identities.
const output = path.resolve(process.argv[2] ?? 'work/entity-reconciliation/audit');
try {
  const result = await withRead(async run => {
    const types = await run(`SELECT m.entity_type,m.status,count(DISTINCT m.normalized_name)::int names,
      count(DISTINCT m.document_id)::int documents FROM research_query.entity_mentions m JOIN research_query.documents d
      ON d.document_id=m.document_id AND d.revision_id=m.revision_id WHERE NOT d.deleted GROUP BY m.entity_type,m.status ORDER BY m.entity_type,m.status`);
    const [coverage] = await run(`SELECT count(DISTINCT m.document_id)::int documents_with_names,
      count(DISTINCT m.document_id) FILTER(WHERE m.status='curated')::int documents_with_curated_names,
      count(DISTINCT m.document_id) FILTER(WHERE m.status='observed')::int documents_with_pending_names
      FROM research_query.entity_mentions m JOIN research_query.documents d ON d.document_id=m.document_id AND d.revision_id=m.revision_id WHERE NOT d.deleted`);
    const pending = await run(`SELECT m.entity_type,m.normalized_name,min(m.raw_value) example,m.status,
      count(DISTINCT m.document_id)::int documents FROM research_query.entity_mentions m JOIN research_query.documents d
      ON d.document_id=m.document_id AND d.revision_id=m.revision_id WHERE NOT d.deleted AND m.status<>'curated'
      GROUP BY m.entity_type,m.normalized_name,m.status ORDER BY documents DESC,m.entity_type,m.normalized_name LIMIT 200`);
    for (const name of pending) name.examples = await run(`SELECT DISTINCT d.document_id,d.title,d.revision_id,d.slug
      FROM research_query.entity_mentions m JOIN research_query.documents d ON d.document_id=m.document_id AND d.revision_id=m.revision_id
      WHERE NOT d.deleted AND m.entity_type=$1 AND m.normalized_name=$2 ORDER BY d.document_id LIMIT 3`, [name.entity_type, name.normalized_name]);
    return { created_at: new Date().toISOString(), types, coverage, pending_top200: pending };
  });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify(result, null, 2) + '\n');
  const cell = text => String(text).replace(/[\r\n|]/g, ' ');
  const rows = result.pending_top200.map(r => `| ${cell(r.entity_type)} | ${cell(r.example)} | ${r.documents} | ${r.status} | ${r.examples.map(d => cell(d.title)).join('；')} |`);
  await fs.writeFile(path.join(output, 'pending-top200.md'), `# 剩余高频实体名称\n\n审计时间：${result.created_at}。按活动文档版本统计；材料数量为优先级，不是同一主体的证明。完整决策见上一层 decisions.json。\n\n| 类型 | 原名称 | 材料数 | 状态 | 代表材料标题（最多 3 个） |\n| --- | --- | ---: | --- | --- |\n${rows.join('\n')}\n`);
  console.log(JSON.stringify({ output, created_at: result.created_at, types: result.types, coverage: result.coverage }, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await closeDb(); }
