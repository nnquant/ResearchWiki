import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadRegistry, entityMentions, resolveMention, normalizeEntityName, tagId } from './entities.mjs';
import { hash } from './blocks.mjs';
import { RELATION_FIELDS } from '../server/slugs.mjs';
import { getSql, closeDb } from '../server/db.mjs';
import { readEntityContext, resolveDocumentMention } from './entity-context.mjs';
import { applyEntityReview } from './entity-review-resolution.mjs';

async function insertRows(tx, table, rows, columns, conflict = '') {
  if (!rows.length) return;
  // Table and column names are private constants, never request input.
  for (let offset = 0; offset < rows.length; offset += 1000) {
    await tx`INSERT INTO ${tx(`research_query.${table}`)} ${tx(rows.slice(offset, offset + 1000), ...columns)} ${tx.unsafe(conflict)}`;
  }
}

export async function refreshGraphIndex(sql, registry = null) {
  registry ??= await loadRegistry();
  await sql.unsafe(await fs.readFile(new URL('./graph-schema.sql', import.meta.url), 'utf8'));
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(78314027)`;
    const [prior] = await tx`SELECT value FROM research_query.state WHERE key='graph_index'`;
    const registryChanged = prior?.value?.registry_version !== registry.version;
    const projectionKeys = new Map([...registry.aliases].map(([key,ids])=>[key,new Set(ids)]));
    for(const [key,rules] of registry.contextRules ?? []) projectionKeys.set(key,new Set([...(projectionKeys.get(key) ?? []),`context:${hash(JSON.stringify(rules))}`]));
    const keys = [...projectionKeys].map(([key, ids]) => ({ entity_type: key.slice(0, key.indexOf(':')),
      normalized_name: key.slice(key.indexOf(':') + 1), entity_ids: [...ids].sort() }));
    const oldKeys = await tx`SELECT * FROM research_query.graph_registry_keys`;
    const old = new Map(oldKeys.map(k => [`${k.entity_type}:${k.normalized_name}`, JSON.stringify(k.entity_ids)]));
    const affected = [];
    for (const key of keys) {
      const name = `${key.entity_type}:${key.normalized_name}`;
      if (old.get(name) !== JSON.stringify(key.entity_ids)) affected.push({ entity_type: key.entity_type, normalized_name: key.normalized_name });
      old.delete(name);
    }
    for (const name of old.keys()) affected.push({ entity_type: name.slice(0, name.indexOf(':')), normalized_name: name.slice(name.indexOf(':') + 1) });
    const bootstrap = prior?.value?.projection_version !== 3;
    const changed = await tx`SELECT d.document_id,d.revision_id,d.metadata FROM research_query.documents d
      LEFT JOIN research_query.graph_documents g ON g.document_id=d.document_id
      WHERE NOT d.deleted AND (${bootstrap} OR g.revision_id IS DISTINCT FROM d.revision_id OR (${registryChanged} AND EXISTS(
        SELECT 1 FROM research_query.entity_mentions c WHERE c.document_id=d.document_id AND c.entity_type='company' AND strpos(c.normalized_name,'(')>0)) OR EXISTS(
        SELECT 1 FROM research_query.entity_mentions m JOIN jsonb_to_recordset(${tx.json(affected)}::jsonb)
        a(entity_type text,normalized_name text) ON m.entity_type=a.entity_type AND m.normalized_name=a.normalized_name
        WHERE m.document_id=d.document_id)) ORDER BY d.document_id`;
    if (registryChanged) {
      await tx`UPDATE research_query.entities SET status='retired' WHERE status='curated'`;
      await tx`DELETE FROM research_query.entity_aliases`;
      const records = [...registry.entities.values()].map(e => ({ entity_id: e.entity_id, entity_type: e.type, name: e.name,
        normalized_name: normalizeEntityName(e.name), status: e.status, details: tx.json(e) }));
      await insertRows(tx, 'entities', records, ['entity_id', 'entity_type', 'name', 'normalized_name', 'status', 'details'],
        'ON CONFLICT(entity_id) DO UPDATE SET entity_type=excluded.entity_type,name=excluded.name,normalized_name=excluded.normalized_name,status=excluded.status,details=excluded.details');
      const aliases = [...registry.aliases].flatMap(([key, ids]) => [...ids].map(entity_id => ({ entity_id, normalized_alias: key.slice(key.indexOf(':') + 1) })));
      await insertRows(tx, 'entity_aliases', aliases, ['entity_id', 'normalized_alias'], 'ON CONFLICT DO NOTHING');
      await tx`DELETE FROM research_query.entity_context_rules`;
      await insertRows(tx,'entity_context_rules',[...registry.contextRules.values()].flat().map(r=>({entity_type:r.type,normalized_alias:normalizeEntityName(r.alias),entity_id:r.entity_id,details:tx.json(r)})),
        ['entity_type','normalized_alias','entity_id','details'],'ON CONFLICT DO NOTHING');
      await tx`DELETE FROM research_query.entity_relations`;
      await insertRows(tx,'entity_relations',(registry.relations??[]).map(r=>({...r,evidence:tx.json(r.evidence)})),
        ['relation_id','source_id','target_id','relation_type','source','observed_at','valid_from','valid_to','evidence'],'ON CONFLICT DO NOTHING');
    }
    for (let offset = 0; offset < changed.length; offset += 200) {
      const docs = changed.slice(offset, offset + 200), ids = docs.map(d => d.document_id);
      const reviewRows=await tx`SELECT DISTINCT ON (r.document_id,r.revision_id,r.entity_type,r.normalized_name) r.*
        FROM research_query.entity_reviews r JOIN research_query.documents d ON d.document_id=r.document_id AND d.revision_id=r.revision_id
        WHERE r.document_id=ANY(${ids}::text[]) ORDER BY r.document_id,r.revision_id,r.entity_type,r.normalized_name,r.review_id DESC`;
      const reviews=new Map(reviewRows.map(r=>[JSON.stringify([r.document_id,r.entity_type,r.normalized_name]),r]));
      const rejections=await tx`SELECT r.* FROM research_query.entity_rejections r JOIN research_query.documents d ON d.document_id=r.document_id AND d.revision_id=r.revision_id WHERE r.document_id=ANY(${ids}::text[])`;
      for(const rejected of rejections) {
        const review=reviews.get(JSON.stringify([rejected.document_id,rejected.entity_type,rejected.normalized_name]));
        if(review)(review.rejected_ids??=[]).push(rejected.entity_id);
      }
      for (const table of ['document_tags', 'document_entities', 'entity_mentions', 'document_relations']) await tx`DELETE FROM ${tx(`research_query.${table}`)} WHERE document_id=ANY(${ids}::text[])`;
      const tags = new Map(), entities = new Map(), memberships = [], tagLinks = [], mentions = [], relations = [];
      for (const d of docs) {
        const common = { document_id: d.document_id, revision_id: d.revision_id };
        for (const tag of new Set(d.metadata.tags ?? [])) {
          const tag_id = tagId(tag); tags.set(tag_id, { tag_id, tag }); tagLinks.push({ ...common, tag_id });
        }
        const linked = new Map();
        const documentMentions=entityMentions(d.metadata);
        const needsContext=documentMentions.some(m=>registry.contextRules?.has(`${m.type}:${m.normalized}`)&&resolveMention(m,registry).status!=='curated');
        const context=needsContext?await readEntityContext(tx,d):{};
        for (const mention of documentMentions) {
          const resolutions=applyEntityReview(resolveDocumentMention(mention,registry,context),reviews.get(JSON.stringify([d.document_id,mention.type,mention.normalized])),registry);
          const resolved=resolutions[0];
          mentions.push({ ...common, mention_key: hash(JSON.stringify(mention)), entity_type: mention.type, raw_value: mention.raw,
            field: mention.field, normalized_name: mention.normalized, status: resolved.status, candidates: tx.json(resolved.candidates),
            resolution:tx.json({method:resolved.matching??resolved.status,context_status:resolved.context_status??null,evidence:resolved.evidence??[],review_id:resolved.review_id??null,review_action:resolved.review_action??null}) });
          for(const resolution of resolutions) {
          const entity=resolution.entity;
          if (!entity) continue;
          if (entity.status === 'observed') entities.set(entity.entity_id, { entity_id: entity.entity_id, entity_type: entity.type, name: entity.name,
            normalized_name: normalizeEntityName(entity.name), status: 'observed', details: tx.json(entity) });
          const raw = linked.get(entity.entity_id) ?? []; raw.push({ field: mention.field, value: mention.raw, matching: resolution.matching??resolution.status,evidence:resolution.evidence??[] }); linked.set(entity.entity_id, raw);
          }
        }
        for (const [entity_id, raw] of linked) memberships.push({ ...common, entity_id, raw_values: tx.json(raw) });
        for (const [link_type, values] of Object.entries(d.metadata.relations ?? {})) if (RELATION_FIELDS.includes(link_type)) {
          for (const target_slug of new Set(values)) relations.push({ ...common, target_slug, link_type });
        }
      }
      await insertRows(tx, 'graph_tags', [...tags.values()], ['tag_id', 'tag'], 'ON CONFLICT DO NOTHING');
      await insertRows(tx, 'entities', [...entities.values()], ['entity_id', 'entity_type', 'name', 'normalized_name', 'status', 'details'], 'ON CONFLICT DO NOTHING');
      await insertRows(tx, 'document_tags', tagLinks, ['document_id', 'revision_id', 'tag_id']);
      await insertRows(tx, 'document_entities', memberships, ['document_id', 'revision_id', 'entity_id', 'raw_values']);
      await insertRows(tx, 'entity_mentions', mentions, ['document_id', 'revision_id', 'mention_key', 'entity_type', 'raw_value', 'field', 'normalized_name', 'status', 'candidates','resolution']);
      await insertRows(tx, 'document_relations', relations, ['document_id', 'revision_id', 'target_slug', 'link_type']);
      await insertRows(tx, 'graph_documents', docs.map(d => ({ document_id: d.document_id, revision_id: d.revision_id, registry_version: registry.version })),
        ['document_id', 'revision_id', 'registry_version'], 'ON CONFLICT(document_id) DO UPDATE SET revision_id=excluded.revision_id,registry_version=excluded.registry_version');
    }
    for (const table of ['document_tags', 'document_entities', 'entity_mentions', 'document_relations', 'graph_documents']) {
      await tx`DELETE FROM ${tx(`research_query.${table}`)} g USING research_query.documents d WHERE g.document_id=d.document_id AND d.deleted`;
    }
    if (registryChanged || bootstrap) {
      await tx`DELETE FROM research_query.graph_registry_keys`;
      await insertRows(tx, 'graph_registry_keys', keys, ['entity_type', 'normalized_name', 'entity_ids']);
      // Unaffected memberships are unchanged, but have been checked against this catalog.
      await tx`UPDATE research_query.graph_documents SET registry_version=${registry.version} WHERE registry_version<>${registry.version}`;
    }
    const [counts] = await tx`SELECT (SELECT count(*)::int FROM research_query.graph_documents) AS documents,
      (SELECT count(*)::int FROM research_query.document_entities) AS entity_memberships,
      (SELECT count(*)::int FROM research_query.document_tags) AS tag_memberships,
      (SELECT count(*)::int FROM research_query.entity_mentions WHERE status='ambiguous') AS ambiguous_mentions`;
    const state = { ...counts, projection_version: 3, affected_aliases: affected.length, registry_version: registry.version, changed_documents: changed.length, updated_at: new Date().toISOString(), snapshot_id: hash(JSON.stringify([registry.version, Date.now(), counts])) };
    await tx`INSERT INTO research_query.state VALUES ('graph_index',${tx.json(state)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
    return state;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await refreshGraphIndex(await getSql()), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await closeDb(); }
}
