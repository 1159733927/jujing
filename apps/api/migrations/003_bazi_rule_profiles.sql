create table if not exists bazi_rule_profiles (
  id uuid primary key,
  profile_key text not null unique,
  name text not null,
  description text,
  state text not null check (state in ('draft', 'in-review', 'published', 'archived')),
  revision integer not null check (revision > 0),
  working_definition jsonb not null,
  current_published_version_id text,
  created_at timestamptz not null,
  created_by text not null,
  updated_at timestamptz not null,
  updated_by text not null,
  submitted_for_review_at timestamptz,
  submitted_for_review_by text,
  reviewed_at timestamptz,
  reviewed_by text,
  archived_at timestamptz,
  archived_by text,
  check ((submitted_for_review_at is null) = (submitted_for_review_by is null)),
  check ((reviewed_at is null) = (reviewed_by is null)),
  check ((archived_at is null) = (archived_by is null))
);

create table if not exists bazi_rule_profile_versions (
  version_id text primary key,
  profile_id uuid not null references bazi_rule_profiles(id) on delete restrict,
  version integer not null check (version > 0),
  profile_key text not null,
  name text not null,
  description text,
  definition jsonb not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  submitted_for_review_at timestamptz not null,
  submitted_for_review_by text not null,
  reviewed_at timestamptz not null,
  reviewed_by text not null,
  published_at timestamptz not null,
  published_by text not null,
  unique (profile_id, version)
);

alter table bazi_rule_profiles
  add constraint bazi_rule_profiles_current_version_id_fkey
  foreign key (current_published_version_id) references bazi_rule_profile_versions(version_id) on delete restrict
  deferrable initially immediate;

create index if not exists bazi_rule_profiles_state_updated_idx on bazi_rule_profiles (state, updated_at desc);
create index if not exists bazi_rule_profile_versions_profile_version_idx on bazi_rule_profile_versions (profile_id, version desc);
