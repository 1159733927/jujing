alter table chart_versions
  add column if not exists rule_profile_version_id text
    references bazi_rule_profile_versions(version_id) on delete restrict;

alter table chart_versions
  add column if not exists rule_profile_version jsonb;

alter table chart_versions
  drop constraint if exists chart_versions_rule_profile_pair_check;

alter table chart_versions
  add constraint chart_versions_rule_profile_pair_check check (
    (rule_profile_version_id is null and rule_profile_version is null)
    or
    (
      rule_profile_version_id is not null
      and rule_profile_version is not null
      and rule_profile_version ->> 'versionId' = rule_profile_version_id
    )
  );

create index if not exists chart_versions_rule_profile_version_idx
  on chart_versions (rule_profile_version_id)
  where rule_profile_version_id is not null;
