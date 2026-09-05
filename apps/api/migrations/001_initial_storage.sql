create table if not exists reports (
  id uuid primary key,
  status text not null check (status in ('queued', 'completed', 'failed')),
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists reports_status_created_at_idx on reports (status, created_at);

create table if not exists knowledge_assets (
  id uuid primary key,
  version integer not null check (version > 0),
  state text not null check (state in ('draft', 'in-review', 'published', 'archived')),
  kind text not null check (kind in ('article', 'rule', 'skill')),
  title text not null,
  tags jsonb not null default '[]'::jsonb,
  body text not null,
  source_label text not null,
  updated_at timestamptz not null,
  rule jsonb
);

create index if not exists knowledge_assets_state_version_idx on knowledge_assets (state, version);

create table if not exists knowledge_versions (
  version_id text primary key,
  asset_id uuid not null references knowledge_assets(id) on delete restrict,
  version integer not null check (version > 0),
  content_hash text not null,
  kind text not null check (kind in ('article', 'rule', 'skill')),
  title text not null,
  tags jsonb not null default '[]'::jsonb,
  body text not null,
  source_label text not null,
  exact_excerpt text not null,
  published_at timestamptz not null,
  rule jsonb,
  unique (asset_id, version)
);

create index if not exists knowledge_versions_kind_idx on knowledge_versions (kind);
