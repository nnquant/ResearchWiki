import { normalizeEntityName as norm, resolveMention } from './entities.mjs';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Explicit definitions only. Co-occurrence and topical proximity are not identity evidence.
export function resolveDocumentMention(mention, registry, context = {}) {
  const ordinary = resolveMention(mention, registry);
  if (ordinary.status === 'curated') return ordinary;
  const rules = registry.contextRules?.get(`${mention.type}:${mention.normalized}`) ?? [];
  if (!rules.length) return ordinary;
  const possible = new Set(), evidence = [];
  for (const block of context.blocks ?? []) for (const rule of rules) for (const definition of rule.definitions) {
    const body = norm(block.text), full = norm(definition), alias = mention.normalized;
    if (!body.includes(full)) continue;
    possible.add(rule.entity_id);
    const pattern = new RegExp(`(?:${escape(full)}\\s*\\(\\s*${escape(alias)}s?\\s*\\)|(?<![a-z0-9])${escape(alias)}\\s*\\(\\s*${escape(full)}\\s*\\))`, 'u');
    const match = body.match(pattern);
    if (match) evidence.push({ entity_id:rule.entity_id,source:rule.source,block_id:block.block_id ?? null,pdf_page:block.pdf_page ?? null,normalized_definition:match[0],method:'explicit_definition' });
  }
  const candidates = [...new Set([...ordinary.candidates,...rules.map(r=>r.entity_id)])].sort();
  const matched = [...new Set(evidence.map(e=>e.entity_id))];
  if (context.complete && matched.length===1 && possible.size===1) return { ...mention,status:'curated',candidates:matched,
    entity:registry.entities.get(matched[0]),matching:'document_definition',evidence:evidence.filter(e=>e.entity_id===matched[0]).slice(0,3) };
  return { ...ordinary,candidates,context_status:!context.complete?'context_budget_exceeded':possible.size>1?'multiple_meanings':'definition_not_found' };
}

export async function readEntityContext(tx, document) {
  const [size]=await tx`SELECT count(*)::int AS blocks,coalesce(sum(length(text)),0)::int AS chars FROM research_query.blocks
    WHERE document_id=${document.document_id} AND revision_id=${document.revision_id}`;
  if(size.blocks>128||size.chars>262144) return {blocks:[],complete:false};
  const blocks=await tx`SELECT block_id,pdf_page,text FROM research_query.blocks
    WHERE document_id=${document.document_id} AND revision_id=${document.revision_id} ORDER BY ordinal`;
  return {blocks,complete:true};
}
