alter table chart_versions
  add column if not exists restored_from_version_id uuid
    references chart_versions(id) on delete restrict;

create index if not exists chart_versions_restored_from_version_idx
  on chart_versions (restored_from_version_id)
  where restored_from_version_id is not null;
