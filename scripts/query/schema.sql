CREATE SCHEMA IF NOT EXISTS research_query;
CREATE TABLE IF NOT EXISTS research_query.documents (
  document_id text PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  slug text NOT NULL,
  title text NOT NULL,
  family_id text NOT NULL,
  revision_id text NOT NULL,
  metadata jsonb NOT NULL,
  provenance jsonb NOT NULL,
  signature text NOT NULL,
  text_chars integer NOT NULL,
  source_mtime double precision NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector
);
CREATE INDEX IF NOT EXISTS rq_documents_metadata ON research_query.documents USING gin(metadata);
CREATE INDEX IF NOT EXISTS rq_documents_tags ON research_query.documents USING gin((metadata->'tags'));
CREATE INDEX IF NOT EXISTS rq_documents_tickers ON research_query.documents USING gin((metadata->'tickers'));
CREATE INDEX IF NOT EXISTS rq_documents_published ON research_query.documents((metadata->>'published_at'));
CREATE INDEX IF NOT EXISTS rq_documents_fts ON research_query.documents USING gin(search_vector);
CREATE INDEX IF NOT EXISTS rq_documents_slug ON research_query.documents(slug);
CREATE TABLE IF NOT EXISTS research_query.revisions (
  document_id text NOT NULL REFERENCES research_query.documents(document_id),
  revision_id text NOT NULL,
  metadata jsonb NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, revision_id)
);
CREATE TABLE IF NOT EXISTS research_query.blocks (
  document_id text NOT NULL,
  revision_id text NOT NULL,
  block_id text NOT NULL,
  ordinal integer NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  pdf_page integer,
  section jsonb NOT NULL,
  text text NOT NULL,
  search_vector tsvector,
  PRIMARY KEY(document_id, revision_id, ordinal),
  FOREIGN KEY(document_id, revision_id) REFERENCES research_query.revisions(document_id, revision_id)
);
CREATE INDEX IF NOT EXISTS rq_blocks_fts ON research_query.blocks USING gin(search_vector);
CREATE TABLE IF NOT EXISTS research_query.state (key text PRIMARY KEY, value jsonb NOT NULL);
