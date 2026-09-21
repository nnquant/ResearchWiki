import {queryProfile} from './profile.mjs';
import {fail} from './contract.mjs';

// Optional deployment extension. Quant retrieval has no entity registry dependency.
const adapter = queryProfile.graphAdapter ? await import(new URL(queryProfile.graphAdapter, import.meta.url)) : null;
export const graphEnabled = Boolean(adapter);
if (adapter) for (const name of ['refreshGraphIndex','graphCoverage','resolveEntities','graphQuery','indexedRelated']) {
  if (typeof adapter[name] !== 'function') throw new Error('Invalid graph adapter: '+name);
}
const required = name => (...args) => adapter ? adapter[name](...args) : fail('UNSUPPORTED_CAPABILITY','当前研究配置未启用实体图谱',400);
export const graphCoverage = required('graphCoverage');
export const resolveEntities = required('resolveEntities');
export const graphQuery = required('graphQuery');
export const refreshGraphIndex = (...args) => adapter ? adapter.refreshGraphIndex(...args) : null;
export const indexedRelated = async (...args) => adapter ? adapter.indexedRelated(...args) : (await import('./basic-relations.mjs')).related(...args);
