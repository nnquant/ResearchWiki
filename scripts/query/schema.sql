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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='research_query.documents'::regclass AND attname='catalog_fields_ready' AND NOT attisdropped) THEN
    ALTER TABLE research_query.documents ADD COLUMN catalog_status text,
      ADD COLUMN catalog_published_at text, ADD COLUMN catalog_fields_ready boolean NOT NULL DEFAULT false;
  END IF;
END $$;
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
-- Compact current-revision recall index. Historical blocks remain immutable evidence.
CREATE TABLE IF NOT EXISTS research_query.search_documents (
  document_id text PRIMARY KEY REFERENCES research_query.documents(document_id),
  revision_id text NOT NULL,
  search_vector tsvector NOT NULL
);
CREATE INDEX IF NOT EXISTS rq_search_documents_fts ON research_query.search_documents USING gin(search_vector);
-- Small immutable catalog references: cursor sessions never hold whole result sets.
CREATE TABLE IF NOT EXISTS research_query.catalog_generations (
  snapshot_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);
CREATE TABLE IF NOT EXISTS research_query.catalog_entries (
  snapshot_id text NOT NULL REFERENCES research_query.catalog_generations ON DELETE CASCADE,
  document_id text NOT NULL,
  revision_id text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  family_id text NOT NULL,
  text_chars integer NOT NULL,
  indexed_at timestamptz NOT NULL,
  entity_ids jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY(snapshot_id, document_id),
  FOREIGN KEY(document_id,revision_id) REFERENCES research_query.revisions(document_id,revision_id)
);
ALTER TABLE research_query.catalog_entries ADD COLUMN IF NOT EXISTS sort_published_at text,
  ADD COLUMN IF NOT EXISTS sort_data_as_of text, ADD COLUMN IF NOT EXISTS sort_ingested_at text,
  ADD COLUMN IF NOT EXISTS sort_updated_at text;
