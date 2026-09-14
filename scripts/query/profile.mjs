import profile from '../../config/query-profile.json' with { type: 'json' };

// This is deployment source configuration, never a request-supplied import path.
if (!profile.name || !['page_type', 'research_category'].includes(profile.webTypeField)) throw new Error('无效的查询 profile');
export const queryProfile = Object.freeze(profile);
const adapter = profile.metadataAdapter ? await import(new URL(profile.metadataAdapter, import.meta.url)) : null;
if (adapter && typeof adapter.decorateMetadata !== 'function') throw new Error('查询 metadataAdapter 必须导出 decorateMetadata');
export const decorateMetadata = adapter?.decorateMetadata ?? (metadata => metadata);
