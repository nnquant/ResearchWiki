import { FILTER_SCHEMA, FIELDS } from '../query/contract.mjs';
const str = { type: 'string' }, strings = { type: 'array', items: str, maxItems: 100 };
const common = { filters: { $ref: '#/$defs/filter' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: str,
  max_response_tokens: { type: 'integer', minimum: 512, maximum: 32000 }, timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 } };
const outputSchema = { type: 'object', properties: { schema_version: str, request_id: str, results: { type: 'array', items: { type: 'object' } }, next_cursor: { type: ['string', 'null'] }, truncated: { type: 'boolean' } }, required: ['schema_version', 'request_id', 'results', 'next_cursor', 'truncated'], additionalProperties: true };
const definitions = [
  ['describe', 'Discover capabilities, index coverage, fields, or actual tags. Use section=tags and q before constructing tag filters.', { section: { enum: ['capabilities', 'tags'] }, q: str }],
  ['resolve', 'Resolve an existing title/slug/alias/code or tag. Returns candidates, never silently chooses an ambiguous company code.', { q: str, kind: { enum: ['document', 'tag'] } }],
  ['query', 'List, count or group registered materials matching filters. Tags support contains_all/contains_any/contains_none. Follow next_cursor. Publication dates do not represent historical knowledge.', { q: str, sort: { enum: ['title', ...Object.keys(FIELDS).filter(k => FIELDS[k] === 'date')] }, direction: { enum: ['asc', 'desc'] }, fields: strings, group_by: { enum: Object.keys(FIELDS) } }],
  ['search', 'Find relevant documents/passages inside filters. lexical requires no model; hybrid adds existing vectors; deep currently increases candidates only. Not exhaustive. Read evidence before quoting.', { query: str, mode: { enum: ['lexical', 'hybrid', 'deep'] }, group_by: { enum: ['document', 'document_family', 'passage'] }, explain: { type: 'boolean' }, expected_id: str }],
  ['read', 'Read an indexed immutable revision by document_id or slug. Start with outline, then blocks by block_id/page/find. Preserves tables and formulas. PDF physical pages are 1-based; follow next_cursor.', { id: str, revision_id: str, view: { enum: ['metadata', 'outline', 'blocks'] }, page: { type: 'integer', minimum: 1 }, block_id: str, start_block: { type: 'integer', minimum: 0 }, find: str, neighbors: { type: 'integer', minimum: 0, maximum: 3 } }],
  ['related', 'Follow explicit typed frontmatter relations with provenance. Maximum two hops. A relation is not automatically a verified conclusion.', { id: str, direction: { enum: ['incoming', 'outgoing', 'both'] }, link_types: strings, depth: { type: 'integer', minimum: 1, maximum: 2 } }],
];
export const agentTools = definitions.map(([name, description, properties]) => ({ name: `research_${name}`, description,
  inputSchema: { type: 'object', properties: { ...Object.fromEntries(Object.entries(common).filter(([k]) => name !== 'read' || k !== 'filters')), ...properties }, additionalProperties: false, $defs: { filter: FILTER_SCHEMA },
    ...(['resolve', 'search', 'read', 'related'].includes(name) ? { anyOf: [{ required: [name === 'resolve' ? 'q' : name === 'search' ? 'query' : 'id'] }, { required: ['cursor'] }] } : {}) }, outputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
