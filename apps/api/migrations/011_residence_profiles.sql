create table if not exists residence_profiles (
  id uuid primary key,
  principal_id uuid not null references principals(id) on delete restrict,
  owner_user_id uuid,
  revision integer not null check (revision > 0),
  current_version_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists residence_versions (
  id uuid primary key,
  profile_id uuid not null references residence_profiles(id) on delete restrict,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  restored_from_version_id uuid references residence_versions(id) on delete restrict,
  created_at timestamptz not null,
  unique (profile_id, version),
  constraint residence_versions_snapshot_schema_check
    check (snapshot->>'schemaVersion' = 'residence-snapshot-v1')
);

alter table residence_profiles
  add constraint residence_profiles_current_version_id_fkey
  foreign key (current_version_id) references residence_versions(id) on delete restrict
  deferrable initially immediate;

create index if not exists residence_profiles_principal_updated_idx
  on residence_profiles (principal_id, updated_at desc)
  where deleted_at is null;

create index if not exists residence_versions_profile_version_idx
  on residence_versions (profile_id, version desc);

alter table reports
  add column if not exists residence_version_id uuid references residence_versions(id) on delete set null;

create index if not exists reports_residence_version_id_idx
  on reports (residence_version_id)
  where residence_version_id is not null;
