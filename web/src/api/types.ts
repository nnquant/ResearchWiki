import type { ResearchMetadata } from '../lib/research';

export interface IndexEntry {
  category?: string;
  research: ResearchMetadata;
  slug: string;
  title: string;
  type: string;
  tags: string[];
  aliases: string[];
  updated_at: string;
  indexed: boolean;
  stale: boolean;
  review_status?: string | null;
}

export interface TypeCount {
  type: string;
  label: string;
  dir: string | null;
  n: number;
}

export interface TagCount {
  tag: string;
  n: number;
  /** Display name from the report dictionaries, e.g. 高盛 for 机构:GoldmanSachs. */
  label?: string;
}

export interface TagOptions {
  tags: TagCount[];
  total: number;
  /** Tag-prefix counts over the whole library, independent of the query. */
  groups: { name: string; n: number }[];
}

export interface LinkRef {
  slug: string;
  title: string;
  type: string;
  link_type: string;
  link_source: string;
  context?: string | null;
}

export interface RelationRef {
  slug: string;
  title: string;
  type: string;
  link_source: string;
  exists: boolean;
}

export interface Provenance {
  llm_model?: string | null;
  llm_processed_at?: string | null;
  raw_url: string | null;
  parsed_url: string | null;
  translation_url: string | null;
  page_map_url: string | null;
  source_url: string | null;
  source_kind: string | null;
  sha256: string | null;
  parser: string | null;
  received_at: string | null;
  published_at: string | null;
  pages: number | null;
  characters: number | null;
  status: string | null;
  knowledge_base: string | null;
}

export interface Page {
  category?: string;
  research: ResearchMetadata;
  slug: string;
  title: string;
  type: string;
  type_label: string;
  frontmatter: Record<string, unknown>;
  frontmatter_error: string | null;
  markdown: string;
  hash: string;
  mtime: string;
  updated_at: string;
  created_at: string | null;
  indexed: boolean;
  stale: boolean;
  editable: boolean;
  edit_reason: string | null;
  tags: string[];
  aliases: string[];
  review_status: string | null;
  pdf_pages: number;
  provenance: Provenance | null;
  links_out: LinkRef[];
  backlinks: LinkRef[];
  relations: { out: Record<string, RelationRef[]>; in: Record<string, RelationRef[]> };
}

export interface PageSummary {
  slug: string;
  title: string;
  type: string;
  tags: string[];
  aliases: string[];
  review_status: string | null;
  updated_at: string;
  excerpt: string;
  pdf_pages: number;
}

export interface RawPage {
  slug: string;
  content: string;
  hash: string;
  editable: boolean;
  edit_reason: string | null;
}

export interface SearchHit {
  document_id?: string;
  revision_id?: string;
  evidence?: { block_id: string; pdf_page: number | null } | null;
  citation_status?: string;
  category?: string | null;
  slug: string;
  page_id: number | null;
  title: string;
  type: string | null;
  chunk_text: string;
  chunk_index: number;
  chunk_source: string | null;
  score: number | null;
  stale: boolean;
  keyword_hit: unknown;
  pdf_page: number | null;
}

export interface SearchResponse {
  query: string;
  mode: 'fast' | 'deep' | 'lexical' | 'hybrid';
  engine: 'mcp' | 'cli' | 'research-query';
  next_cursor?: string | null;
  query_plan?: Record<string, unknown>;
  coverage?: { documents: number; text_ready: number; complete: boolean; vector_ready: number | null };
  empty_reason?: string | null;
  latency_ms: number;
  degraded: { stage: string; reason?: string }[];
  results: SearchHit[];
}

export interface PageListItem {
  category?: string;
  research: ResearchMetadata;
  slug: string;
  title: string;
  type: string;
  created_at?: string | null;
  updated_at: string;
  review_status: string | null;
  source_kind?: string | null;
  tags: string[];
  backlinks: number | null;
  excerpt?: string;
}

export interface PageList {
  total: number;
  items: PageListItem[];
  degraded?: boolean;
}

export interface GraphNode {
  kind?: 'page' | 'tag' | 'category' | 'entity';
  entity_id?: string;
  identity_status?: string;
  category?: string;
  group?: string;
  tag?: string;
  tags?: string[];
  tag_count?: number;
  count?: number;
  updated_at?: string;
  id: string;
  title: string;
  type: string;
  degree: number;
  level: number;
}

export interface GraphEdge {
  weight?: number;
  context?: string | null;
  source: string;
  target: string;
  link_type: string;
  link_source: string;
}

export interface Graph {
  view?: 'overview' | 'materials' | 'neighborhood';
  explicit_unavailable?: boolean;
  discovery?: { related_pages: number; shown_pages: number; hubs: number; available_hubs: number; hub_limit: number; related_limit: number; node_limit: number };
  overview?: {
    covered_pages: number; categories: number; featured_tags: number; other_tags: number; singleton_tags: number;
    groups: { key: string; label: string; distinct: number; singletons: number; shown: number }[];
  };
  scope?: { pages: number; tags: number; untagged: number; shown_pages: number; shown_tags: number; page_limit: number; tag_limit: number; omitted_links: number };
  types?: { type: string; n: number }[];
  metadata_errors?: number;
  center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  unindexed?: boolean;
}

export interface Job {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted';
  queued_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  result?: unknown;
  key?: string | null;
}

export interface ServiceHealth {
  ok: boolean;
  provider?: 'shared' | 'local';
  endpoint?: string;
  error?: string | null;
  version?: string | null;
  model_present?: boolean;
}

export interface Status {
  name: string;
  version: string;
  dataRoot: string;
  csrf: string;
  model: string;
  active: Job | null;
  queue: number;
  services: { postgres: ServiceHealth; ollama: ServiceHealth };
  counts: { files: number; documents: number; indexed: number; failed: number; pdf_pages: number };
  last_index_at: string | null;
}

export interface Stats {
  files: number;
  database: {
    pages: number;
    chunks: { total: number | null; embedded: number | null; estimated: boolean };
    dims: number[];
    dims_sampled: boolean;
    checked_at: string;
    links: { link_type: string; n: number }[];
    tags: number;
    by_type: { type: string; n: number }[];
  } | null;
  database_error: string | null;
  documents_total: number;
  documents_offset: number;
  documents_limit: number;
  documents: {
    title: string; source_kind: string; status: string; pages?: number; characters?: number; parser?: string; error: string | null; wiki_slug?: string;
  }[];
  services: Status['services'];
  model: string;
  dims: number;
}

export interface Template {
  type: string;
  label: string;
  description: string;
  dir: string | null;
  fields: string[];
}

export interface HomeData {
  due: IndexEntry[];
  due_total: number;
  total: number;
  recent: IndexEntry[];
  unread: IndexEntry[];
  unindexed: number;
  types: TypeCount[];
}

export interface ValidationError {
  field: string;
  message: string;
}
