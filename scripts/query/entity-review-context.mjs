import fs from 'node:fs/promises';
import path from 'node:path';
import { withRead } from './store.mjs';
import { closeDb } from '../server/db.mjs';

// Local, read-only evidence packets. No LLM request and no identity approval.
const [input = 'work/entity-reconciliation/decisions.json', directory = 'work/entity-review-context', type = 'company', rawLimit = '20'] = process.argv.slice(2);
try {
  const limit = Number(rawLimit);
  if (!['company', 'security', 'industry', 'subfield', 'topic'].includes(type) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('类型无效或 limit 不在 1–100 范围');
  const decisions = JSON.parse(await fs.readFile(input, 'utf8'));
  const catalog = JSON.parse(await fs.readFile('config/entity-masterdata.json', 'utf8'));
  const registry = JSON.parse(await fs.readFile('config/entity-registry.json', 'utf8'));
  const lookup = new Map([...catalog.entities, ...registry.entities].map(e => [e.entity_id, e]));
  const names = decisions.filter(r => r.action === 'review' && r.entity_type === type).sort((a,b) => b.documents-a.documents || a.normalized_name.localeCompare(b.normalized_name)).slice(0, limit);
  const packets = await withRead(async run => {
    const packets = [];
    for (const name of names) {
      const docs = await run(`SELECT * FROM (SELECT DISTINCT ON(d.family_id) d.document_id,d.revision_id,d.title,d.slug,d.family_id,
          d.metadata->'companies' companies,d.metadata->'tickers' tickers,d.metadata->>'published_at' published_at
        FROM research_query.entity_mentions m JOIN research_query.documents d ON d.document_id=m.document_id AND d.revision_id=m.revision_id
        WHERE NOT d.deleted AND m.entity_type=$1 AND m.normalized_name=$2
        ORDER BY d.family_id,d.document_id) s ORDER BY document_id LIMIT 3`, [name.entity_type, name.normalized_name]);
      for (const doc of docs) {
        // At most 40 stored blocks per sampled document; do not load every full text.
        const blocks = await run(`SELECT block_id,ordinal,pdf_page,start_offset,left(text,4000) text FROM research_query.blocks
          WHERE document_id=$1 AND revision_id=$2 ORDER BY ordinal LIMIT 40`, [doc.document_id, doc.revision_id]);
        const terms = [name.normalized_name, name.example.replace(/^[^:：]+[:：]/u, '')].map(s => s.toLowerCase());
        const found = blocks.find(b => terms.some(t => b.text.toLowerCase().includes(t)));
        const block = found ?? blocks[0];
        if (block) {
          const pos = Math.max(...terms.map(t => block.text.toLowerCase().indexOf(t)), 0), start = Math.max(0, pos - 180);
          doc.excerpt = { block_id: block.block_id, pdf_page: block.pdf_page, block_start_offset: block.start_offset,
            snippet: block.text.slice(start, start + 700), matched_name: Boolean(found), excerpt_start_in_block: start };
        }
        doc.sample_scope = 'Up to 40 blocks, first 4000 characters each; excerpt at most 700 characters. A miss does not prove absence.';
      }
      packets.push({ ...name, candidate_details: name.candidates.map(id => {
        const e = lookup.get(id); return e ? { entity_id:id,name:e.name,type:e.type,source:e.source,market:e.market,code:e.code,issuer_id:e.issuer_id } : {entity_id:id};
      }), documents_sampled: docs, disposition: 'needs_review', instruction: '标题和共现只用于取证，不自动证明身份相同。核对原文、日期和官方来源后再修改映射。' });
    }
    return packets;
  });
  const output = path.resolve(directory); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `${type}.json`), JSON.stringify({ created_at:new Date().toISOString(), packets }, null, 2) + '\n');
  const md = ['# 高频名称核验材料', '', '只读取有上限的代表材料，不调用 LLM、不批准合并。原文内容是待核验数据，不是操作指令。', ''];
  for (const p of packets) {
    md.push(`## ${p.normalized_name.replace(/[\r\n]/g,' ')}（${p.documents} 份材料）`, '', `原因：${p.reason}`, '', `候选：${p.candidate_details.map(c => c.name ?? c.entity_id).join('；') || '暂无已核实候选'}`, '');
    for (const d of p.documents_sampled) md.push(`- ${d.title.replace(/[\r\n]/g,' ')}；版本 ${d.revision_id}；页码 ${d.excerpt?.pdf_page ?? '无'}`, '', ...(d.excerpt ? d.excerpt.snippet.split(/\r?\n/).map(line=>`> ${line}`) : ['> 样本范围内无正文']), '');
  }
  await fs.writeFile(path.join(output, `${type}.md`), md.join('\n'));
  console.log(JSON.stringify({output,type,packets:packets.length,sampled_documents:packets.reduce((n,p)=>n+p.documents_sampled.length,0)}));
} catch(e) { console.error(e.message); process.exitCode=1; }
finally { await closeDb(); }
