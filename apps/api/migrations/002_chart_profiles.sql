create table if not exists principals (
  id uuid primary key,
  kind text not null check (kind in ('anonymous')),
  token_hash text not null unique,
  owner_user_id uuid,
  created_at timestamptz not null
);

create table if not exists chart_profiles (
  id uuid primary key,
  principal_id uuid not null references principals(id) on delete restrict,
  owner_user_id uuid,
  revision integer not null check (revision > 0),
  current_version_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists chart_versions (
  id uuid primary key,
  profile_id uuid not null references chart_profiles(id) on delete restrict,
  version integer not null check (version > 0),
  birth jsonb not null,
  bazi jsonb not null,
  created_at timestamptz not null,
  unique (profile_id, version)
);

alter table chart_profiles
  add constraint chart_profiles_current_version_id_fkey
  foreign key (current_version_id) references chart_versions(id) on delete restrict
  deferrable initially immediate;

create index if not exists chart_profiles_principal_updated_idx on chart_profiles (principal_id, updated_at desc) where deleted_at is null;
create unique index if not exists chart_profiles_one_active_per_principal_idx on chart_profiles (principal_id) where deleted_at is null;
create index if not exists chart_versions_profile_version_idx on chart_versions (profile_id, version desc);

alter table reports
  add column if not exists chart_version_id uuid references chart_versions(id) on delete set null;
