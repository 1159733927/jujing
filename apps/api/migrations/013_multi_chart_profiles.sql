alter table chart_profiles
  add column if not exists label text,
  add column if not exists relationship text;
update chart_profiles
set
  label = coalesce(label, '我的命盘'),
  relationship = coalesce(relationship, 'self')
where label is null or relationship is null;

alter table chart_profiles
  alter column label set default '我的命盘',
  alter column label set not null,
  alter column relationship set default 'self',
  alter column relationship set not null;

alter table chart_profiles
  drop constraint if exists chart_profiles_relationship_check;

alter table chart_profiles
  add constraint chart_profiles_relationship_check
  check (relationship in ('self', 'partner', 'parent', 'child', 'other'));

drop index if exists chart_profiles_one_active_per_principal_idx;
