import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, loadStatus, refreshStatus, encodeSlug } from './client';
import type {
  Status, IndexEntry, TypeCount, TagCount, Page, PageSummary, RawPage, SearchResponse, PageList, Graph, Job, Stats, Template, HomeData,
} from './types';

export const keys = {
  status: ['status'] as const,
  index: ['index'] as const,
  types: ['types'] as const,
  tags: ['tags'] as const,
  home: ['home'] as const,
  page: (slug: string) => ['page', slug] as const,
  summary: (slug: string) => ['summary', slug] as const,
  raw: (slug: string) => ['raw', slug] as const,
  search: (q: string, mode: string, types: string, limit: number) => ['search', q, mode, types, limit] as const,
  pages: (params: string) => ['pages', params] as const,
  graph: (slug: string, depth: number, linkTypes: string) => ['graph', slug, depth, linkTypes] as const,
  jobs: ['jobs'] as const,
  stats: ['stats'] as const,
  templates: ['templates'] as const,
};

export function useStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: () => refreshStatus(),
    initialData: undefined,
    placeholderData: keepPreviousData,
    refetchInterval: query => {
      const data = query.state.data as Status | undefined;
      return data && (data.active || data.queue > 0) ? 3000 : 30000;
    },
    staleTime: 2000,
  });
}

export function useBootStatus() {
  return useQuery({ queryKey: keys.status, queryFn: () => loadStatus(), staleTime: 2000 });
}

export function useIndex(enabled = true) {
  return useQuery({ queryKey: keys.index, queryFn: () => api<IndexEntry[]>('/api/index'), staleTime: 300_000, enabled });
}

export function usePageLookup(q: string) {
  return useQuery({ queryKey: ['pages', 'lookup', q], queryFn: ({ signal }) => api<PageList>(`/api/pages?${new URLSearchParams({ q, limit: '20', lookup: 'true' })}`, { signal }), staleTime: 300_000 });
}
export function usePageTargets(slugs: string[]) {
  return useQuery({ queryKey: ['pages', 'targets', ...slugs], queryFn: ({ signal }) => api<{ items: IndexEntry[] }>('/api/page-targets', { method: 'POST', body: { slugs }, signal }), staleTime: 300_000, enabled: slugs.length > 0 });
}

export function useGraphNavigation(enabled: boolean) {
  return useQuery({ queryKey: ['graph', 'navigation'], queryFn: () => api<{ items: IndexEntry[]; counts: Record<string, number> }>('/api/graph-navigation'), staleTime: 30_000, enabled });
}

export function useTypes(enabled = true) {
  return useQuery({ queryKey: keys.types, queryFn: () => api<TypeCount[]>('/api/types'), staleTime: 300_000, enabled });
}

export function useTags(enabled = true) {
  return useQuery({ queryKey: keys.tags, queryFn: () => api<TagCount[]>('/api/tags'), staleTime: 300_000, enabled });
}

export function useHome() {
  return useQuery({ queryKey: keys.home, queryFn: () => api<HomeData>('/api/home'), staleTime: 30_000 });
}

export function usePage(slug: string | undefined) {
  return useQuery({
    queryKey: keys.page(slug ?? ''),
    queryFn: () => api<Page>(`/api/page/${encodeSlug(slug ?? '')}`),
    enabled: Boolean(slug),
    staleTime: 15_000,
    retry: (count, error) => (error as { status?: number }).status === 404 ? false : count < 2,
  });
}

export function useSummary(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.summary(slug ?? ''),
    queryFn: () => api<PageSummary>(`/api/page/${encodeSlug(slug ?? '')}/summary`),
    enabled: Boolean(slug) && enabled,
    staleTime: 120_000,
    retry: false,
  });
}

export function useRawPage(slug: string | undefined) {
  return useQuery({
    queryKey: keys.raw(slug ?? ''),
    queryFn: () => api<RawPage>(`/api/page/${encodeSlug(slug ?? '')}/raw`),
    enabled: Boolean(slug),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export interface SearchParams {
  q: string;
  mode: 'fast' | 'deep' | 'lexical' | 'hybrid';
  types?: string[];
  limit?: number;
  tags_all?: string[];
  tags_any?: string[];
  tags_none?: string[];
  entity_id?: string;
  cursor?: string;
}

export function useSearch({ q, mode, types = [], limit = 20, tags_all = [], tags_any = [], tags_none = [], entity_id, cursor }: SearchParams, enabled = true) {
  const typesKey = types.join(',');
  return useQuery({
    queryKey: [...keys.search(q, mode, typesKey, limit), JSON.stringify([tags_all, tags_any, tags_none]), entity_id ?? '', cursor ?? ''],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q, mode, limit: String(limit) });
      if (typesKey) params.set('types', typesKey);
      if (entity_id) params.set('entity_id', entity_id);
      for (const [key, values] of Object.entries({ tags_all, tags_any, tags_none })) values.forEach(t => params.append(key, t));
      if (cursor) params.set('cursor', cursor);
      return api<SearchResponse>(`/api/search?${params}`, { signal });
    },
    enabled: enabled && q.trim().length >= 1,
    staleTime: 60_000,
    retry: false,
  });
}

export function usePages(params: URLSearchParams) {
  const key = params.toString();
  return useQuery({
    queryKey: keys.pages(key),
    queryFn: () => api<PageList>(`/api/pages?${key}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useGraph(slug: string | undefined, depth: number, linkTypes: string[]) {
  const lt = linkTypes.join(',');
  return useQuery({
    queryKey: keys.graph(slug ?? '', depth, lt),
    queryFn: () => {
      const params = new URLSearchParams({ depth: String(depth) });
      if (lt) params.set('link_types', lt);
      return api<Graph>(`/api/graph/${encodeSlug(slug ?? '')}?${params}`);
    },
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
}

export function useTagGraph(params: URLSearchParams) {
  const key = params.toString();
  return useQuery({
    queryKey: ['graph', 'tags', key],
    queryFn: ({ signal }) => api<Graph>(`/api/graph?${key}`, { signal }),
    staleTime: 30_000,
  });
}

export function useGraphTags(q: string, enabled = true) {
  return useQuery({
    queryKey: ['graph', 'tag-options', q],
    queryFn: ({ signal }) => api<{ tags: TagCount[]; total: number }>(`/api/graph-tags?${new URLSearchParams({ q })}`, { signal }),
    staleTime: 30_000,
    enabled,
  });
}

export function useJobs(active: boolean) {
  return useQuery({
    queryKey: keys.jobs,
    queryFn: () => api<Job[]>('/api/jobs'),
    refetchInterval: active ? 3000 : 30_000,
    staleTime: 1000,
  });
}

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: () => api<Stats>('/api/stats'), staleTime: 10_000 });
}

export function useTemplates() {
  return useQuery({ queryKey: keys.templates, queryFn: () => api<Template[]>('/api/templates'), staleTime: Infinity });
}

/** Invalidate everything derived from wiki content after a write or a finished job. */
export function useInvalidateContent() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: keys.index });
    client.invalidateQueries({ queryKey: keys.types });
    client.invalidateQueries({ queryKey: keys.tags });
    client.invalidateQueries({ queryKey: keys.home });
    client.invalidateQueries({ queryKey: ['page'] });
    client.invalidateQueries({ queryKey: ['summary'] });
    client.invalidateQueries({ queryKey: ['pages'] });
    client.invalidateQueries({ queryKey: ['graph'] });
    client.invalidateQueries({ queryKey: ['search'] });
    client.invalidateQueries({ queryKey: keys.stats });
  };
}

export function useSavePage() {
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: ({ slug, content, baseHash, force }: { slug: string; content: string; baseHash: string | null; force?: boolean }) =>
      api<{ slug: string; hash: string; job_id: string }>(`/api/page/${encodeSlug(slug)}`, {
        method: 'PUT',
        body: { content, base_hash: baseHash, force: Boolean(force) },
      }),
    onSuccess: () => invalidate(),
  });
}

export function useCreatePage() {
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: (input: { type: string; title: string; slug?: string; tags?: string[]; relations?: Record<string, string[]>; research?: Record<string, string | string[] | null> }) =>
      api<{ slug: string; hash: string; job_id: string }>('/api/pages', { method: 'POST', body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useReindex() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<Job>('/api/index', { method: 'POST', body: {} }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.jobs });
      client.invalidateQueries({ queryKey: keys.status });
    },
  });
}
