import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileRegistry, registryFile } from './entities.mjs';
import { getSql, closeDb } from '../server/db.mjs';
import { atomicRename } from '../atomic-rename.mjs';

// Local-only maintenance. Not exposed on the read-only Agent server.
const [operation = 'help', file] = process.argv.slice(2);
try {
  if (operation === 'validate') {
    const catalog = compileRegistry(JSON.parse(await fs.readFile(file ?? registryFile, 'utf8')));
    console.log(JSON.stringify({ valid: true, entities: catalog.entities.size, ambiguous_aliases: [...catalog.aliases].filter(([, ids]) => ids.size > 1).map(([alias, ids]) => ({ alias, candidates: [...ids] })) }, null, 2));
  } else if (operation === 'apply') {
    if (!file) throw new Error('apply 需要完整映射 JSON 文件路径');
    const raw = await fs.readFile(file, 'utf8'); compileRegistry(JSON.parse(raw));
    const target = fileURLToPath(registryFile), previous = await fs.readFile(target, 'utf8');
    const backup = `${target}.${Date.now()}.bak`, temp = path.join(path.dirname(target), `.entity-registry-${randomUUID()}.tmp`);
    await fs.writeFile(backup, previous, { flag: 'wx' });
    await fs.writeFile(temp, raw, { flag: 'wx' });
    try { await atomicRename(temp, target); } finally { await fs.rm(temp, { force: true }); }
    console.log(JSON.stringify({ applied: true, backup, next: 'npm run research:graph-index' }));
  } else if (operation === 'pending') {
    const sql = await getSql();
    const rows = await sql`SELECT m.entity_type,m.normalized_name,m.status,m.candidates,count(DISTINCT m.document_id)::int AS documents,
      min(m.raw_value) AS example FROM research_query.entity_mentions m JOIN research_query.documents d ON d.document_id=m.document_id AND d.revision_id=m.revision_id
      WHERE NOT d.deleted AND m.status IN ('observed','ambiguous') GROUP BY m.entity_type,m.normalized_name,m.status,m.candidates ORDER BY documents DESC,m.normalized_name LIMIT 200`;
    console.log(JSON.stringify({ results: rows, limit: 200, note: '高频待治理名称；observed 不表示已验证身份。' }, null, 2));
  } else if (operation === 'help') console.log('research:entities validate [registry.json] | pending | apply registry.json\n修改或撤销映射：apply 完整映射表，再运行 research:graph-index；原始标签不变。');
  else throw new Error('未知操作');
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await closeDb(); }
