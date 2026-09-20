import { FILTER_SCHEMA, FIELDS } from '../query/contract.mjs';
const str = { type: 'string' }, strings = { type: 'array', items: str, maxItems: 100 };
const common = { filters: { $ref: '#/$defs/filter' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: str,
  max_response_tokens: { type: 'integer', minimum: 512, maximum: 32000 }, timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 } };
const outputSchema = { type: 'object', properties: { schema_version: str, request_id: str, results: { type: 'array', items: { type: 'object' } }, next_cursor: { type: ['string', 'null'] }, truncated: { type: 'boolean' } }, required: ['schema_version', 'request_id', 'results', 'next_cursor', 'truncated'], additionalProperties: true };
const definitions = [
  ['describe', 'Discover capabilities, index coverage, fields, or actual tags. Use section=tags and q before constructing tag filters.', { section: { enum: ['capabilities', 'tags'] }, q: str }],
  ['resolve', 'Resolve documents, exact tags or entity names/aliases. kind=entity returns stable entity_id, observed/curated status and ambiguity; never guess identity. Filter query/search using entity_ids.', { q: str, kind: { enum: ['document', 'tag', 'entity'] }, entity_type: { enum: ['company', 'security', 'industry', 'subfield', 'topic'] } }],
  ['query', 'List, count or group registered materials matching filters. Tags support contains_all/contains_any/contains_none. Follow next_cursor. Publication dates do not represent historical knowledge.', { q: str, sort: { enum: ['title', ...Object.keys(FIELDS).filter(k => FIELDS[k] === 'date')] }, direction: { enum: ['asc', 'desc'] }, fields: strings, group_by: { enum: Object.keys(FIELDS) } }],
  ['search', 'Find relevant documents/passages inside filters. Optional entity_name/entity_type runs confirmed entity scope plus original-name metadata/fulltext fallback; identity_status marks unverified leads. All user filters remain active. lexical requires no model; hybrid adds existing vectors; deep increases candidates only. Not exhaustive. Read evidence before quoting.', { query: str, entity_name: str, entity_type: { enum: ['company', 'security', 'industry', 'subfield', 'topic'] }, mode: { enum: ['lexical', 'hybrid', 'deep'] }, group_by: { enum: ['document', 'document_family', 'passage'] }, explain: { type: 'boolean' }, expected_id: str }],
  ['read', 'Read an indexed immutable revision by document_id or slug. Start with outline, then blocks by block_id/page/find. Preserves tables and formulas. PDF physical pages are 1-based; follow next_cursor.', { id: str, revision_id: str, view: { enum: ['metadata', 'outline', 'blocks'] }, page: { type: 'integer', minimum: 1 }, block_id: str, start_block: { type: 'integer', minimum: 0 }, find: str, neighbors: { type: 'integer', minimum: 0, maximum: 3 } }],
  ['related', 'Follow explicit typed frontmatter relations with provenance. Maximum two hops. A relation is not automatically a verified conclusion.', { id: str, direction: { enum: ['incoming', 'outgoing', 'both'] }, link_types: strings, depth: { type: 'integer', minimum: 1, maximum: 2 } }],
  ['graph', 'Query the indexed local graph: overview counts, neighbors expands up to two hops, intersection finds shared materials for 2-5 entity/tag seeds. Use IDs from resolve/query. Results paginate; traversal_truncated is a separate expansion cap. Shared tags/entities never imply causality. Read original evidence before conclusions.', {
    operation: { enum: ['overview', 'neighbors', 'intersection'] },
    seed: { type: 'object', properties: { kind: { enum: ['document', 'entity', 'tag'] }, id: str }, required: ['kind', 'id'], additionalProperties: false },
    seeds: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'object', properties: { kind: { enum: ['entity', 'tag'] }, id: str }, required: ['kind', 'id'], additionalProperties: false } },
    direction: { enum: ['incoming', 'outgoing', 'both'] }, relation_types: strings, relation_as_of: {type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},
    depth: { type: 'integer', minimum: 1, maximum: 2 }, max_nodes: { type: 'integer', minimum: 2, maximum: 400 }, max_edges: { type: 'integer', minimum: 1, maximum: 1000 },
    group_by: { enum: ['entity', 'tag', 'category'] },
  }],
];
export const agentTools = definitions.map(([name, description, properties]) => ({ name: `research_${name}`, description,
  inputSchema: { type: 'object', properties: { ...Object.fromEntries(Object.entries(common).filter(([k]) => name !== 'read' || k !== 'filters')), ...properties }, additionalProperties: false, $defs: { filter: FILTER_SCHEMA },
    ...(['resolve', 'search', 'read', 'related'].includes(name) ? { anyOf: [{ required: [name === 'resolve' ? 'q' : name === 'search' ? 'query' : 'id'] }, { required: ['cursor'] }] } : {}) }, outputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
