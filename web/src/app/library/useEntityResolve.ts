import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export interface EntityCandidate { entity_id: string; name: string; entity_type: string; status: 'curated' | 'observed'; document_count: number; aliases: string[] }
export interface EntityResolveResult { results: EntityCandidate[]; ambiguous: boolean; next_cursor: string | null }

export const ENTITY_TYPE_LABELS: Record<string, string> = { company: '公司', security: '证券', industry: '行业', subfield: '领域', topic: '主题' };

export function entityStatusLabel(entity: EntityCandidate) {
  return entity.status === 'curated' ? '已配置别名映射' : '原始名称，身份待核验';
}

/** Resolve a free-text name to entity candidates. Callers must let the user pick; never auto-select. */
export function useEntityResolve(query: string, { limit = 20, enabled = true }: { limit?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['entity-resolve', query, limit], enabled: enabled && Boolean(query), staleTime: 30_000,
    queryFn: ({ signal }) => api<EntityResolveResult>('/api/research/resolve', {
      method: 'POST', signal, body: { kind: 'entity', q: query, limit },
    }),
  });
}
