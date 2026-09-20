CREATE TABLE IF NOT EXISTS research_query.entities (
  entity_id text PRIMARY KEY, entity_type text NOT NULL, name text NOT NULL,
  normalized_name text NOT NULL, status text NOT NULL, details jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS rq_entity_name ON research_query.entities(normalized_name);
CREATE TABLE IF NOT EXISTS research_query.entity_aliases (
  entity_id text NOT NULL REFERENCES research_query.entities(entity_id),
  normalized_alias text NOT NULL, PRIMARY KEY(entity_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS rq_entity_alias ON research_query.entity_aliases(normalized_alias);
CREATE TABLE IF NOT EXISTS research_query.entity_context_rules (
  entity_type text NOT NULL,normalized_alias text NOT NULL,entity_id text NOT NULL REFERENCES research_query.entities(entity_id),details jsonb NOT NULL,
  PRIMARY KEY(entity_type,normalized_alias,entity_id)
);
CREATE INDEX IF NOT EXISTS rq_context_alias ON research_query.entity_context_rules(normalized_alias);
CREATE TABLE IF NOT EXISTS research_query.entity_mentions (
  document_id text NOT NULL REFERENCES research_query.documents(document_id), revision_id text NOT NULL,
  mention_key text NOT NULL, entity_type text NOT NULL, raw_value text NOT NULL, field text NOT NULL,
  normalized_name text NOT NULL, status text NOT NULL, candidates jsonb NOT NULL,
  PRIMARY KEY(document_id, mention_key)
);
CREATE TABLE IF NOT EXISTS research_query.document_entities (
  document_id text NOT NULL REFERENCES research_query.documents(document_id), revision_id text NOT NULL,
  entity_id text NOT NULL REFERENCES research_query.entities(entity_id), raw_values jsonb NOT NULL,
  PRIMARY KEY(document_id, entity_id)
);
CREATE INDEX IF NOT EXISTS rq_entity_documents ON research_query.document_entities(entity_id, document_id);
CREATE TABLE IF NOT EXISTS research_query.graph_tags (tag_id text PRIMARY KEY, tag text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS research_query.document_tags (
  document_id text NOT NULL REFERENCES research_query.documents(document_id), revision_id text NOT NULL,
  tag_id text NOT NULL REFERENCES research_query.graph_tags(tag_id), PRIMARY KEY(document_id, tag_id)
);
CREATE INDEX IF NOT EXISTS rq_tag_documents ON research_query.document_tags(tag_id, document_id);
CREATE TABLE IF NOT EXISTS research_query.document_relations (
  document_id text NOT NULL REFERENCES research_query.documents(document_id), revision_id text NOT NULL,
  target_slug text NOT NULL, link_type text NOT NULL,
  PRIMARY KEY(document_id, target_slug, link_type)
);
CREATE INDEX IF NOT EXISTS rq_relation_target ON research_query.document_relations(target_slug, link_type);
CREATE INDEX IF NOT EXISTS rq_mention_name ON research_query.entity_mentions(entity_type, normalized_name, document_id);
ALTER TABLE research_query.entity_mentions ADD COLUMN IF NOT EXISTS resolution jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS rq_pending_mentions ON research_query.entity_mentions(entity_type,normalized_name,document_id) WHERE status<>'curated';
CREATE TABLE IF NOT EXISTS research_query.entity_reviews (
  review_id bigserial PRIMARY KEY, document_id text NOT NULL, revision_id text NOT NULL,
  entity_type text NOT NULL, normalized_name text NOT NULL, action text NOT NULL,
  entity_ids text[] NOT NULL DEFAULT '{}', evidence jsonb NOT NULL DEFAULT '[]',
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rq_review_latest ON research_query.entity_reviews(document_id,revision_id,entity_type,normalized_name,review_id DESC);
CREATE TABLE IF NOT EXISTS research_query.entity_rejections (
  document_id text NOT NULL,revision_id text NOT NULL,entity_type text NOT NULL,normalized_name text NOT NULL,entity_id text NOT NULL,review_id bigint NOT NULL,
  PRIMARY KEY(document_id,revision_id,entity_type,normalized_name,entity_id)
);
CREATE TABLE IF NOT EXISTS research_query.entity_relations (
  relation_id text PRIMARY KEY, source_id text NOT NULL REFERENCES research_query.entities(entity_id),
  target_id text NOT NULL REFERENCES research_query.entities(entity_id),relation_type text NOT NULL,
  source text NOT NULL,observed_at date NOT NULL,valid_from date,valid_to date,evidence jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS rq_business_source ON research_query.entity_relations(source_id,relation_type);
CREATE INDEX IF NOT EXISTS rq_business_target ON research_query.entity_relations(target_id,relation_type);
CREATE TABLE IF NOT EXISTS research_query.graph_registry_keys (
  entity_type text NOT NULL, normalized_name text NOT NULL, entity_ids text[] NOT NULL,
  PRIMARY KEY(entity_type, normalized_name)
);
CREATE TABLE IF NOT EXISTS research_query.graph_documents (
  document_id text PRIMARY KEY REFERENCES research_query.documents(document_id), revision_id text NOT NULL, registry_version text NOT NULL
);
