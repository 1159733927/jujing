alter table knowledge_assets
  add column if not exists current_published_version_id text;

update knowledge_assets
set current_published_version_id = null
where state = 'archived'
  and current_published_version_id is not null;

update knowledge_assets a
set current_published_version_id = (
  select v.version_id
  from knowledge_versions v
  where v.asset_id = a.id
  order by v.version desc, v.published_at desc, v.version_id asc
  limit 1
)
where a.state <> 'archived'
  and a.current_published_version_id is null
  and exists (select 1 from knowledge_versions v where v.asset_id = a.id);

create unique index if not exists knowledge_versions_asset_version_id_idx
  on knowledge_versions (asset_id, version_id);

alter table knowledge_assets
  add constraint knowledge_assets_current_published_version_owner_fk
  foreign key (id, current_published_version_id)
  references knowledge_versions (asset_id, version_id)
  on delete restrict
  not valid;

alter table knowledge_assets
  validate constraint knowledge_assets_current_published_version_owner_fk;

create index if not exists knowledge_assets_current_published_version_idx
  on knowledge_assets (current_published_version_id)
  where current_published_version_id is not null;
