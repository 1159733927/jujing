alter table knowledge_assets
  add column if not exists created_at timestamptz,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists submitted_for_review_at timestamptz,
  add column if not exists submitted_for_review_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;

update knowledge_assets
set created_at = coalesce(created_at, updated_at),
    created_by = coalesce(created_by, 'legacy-system-editor'),
    updated_by = coalesce(updated_by, 'legacy-system-editor'),
    submitted_for_review_at = case when state = 'published' then coalesce(submitted_for_review_at, updated_at) else submitted_for_review_at end,
    submitted_for_review_by = case when state = 'published' then coalesce(submitted_for_review_by, 'legacy-system-importer') else submitted_for_review_by end,
    reviewed_at = case when state = 'published' then coalesce(reviewed_at, updated_at) else reviewed_at end,
    reviewed_by = case when state = 'published' then coalesce(reviewed_by, 'legacy-system-publisher') else reviewed_by end;

alter table knowledge_assets
  alter column created_at set not null,
  alter column created_by set not null,
  alter column updated_by set not null;

alter table knowledge_assets
  add constraint knowledge_assets_submission_audit_paired
    check ((submitted_for_review_at is null) = (submitted_for_review_by is null)) not valid,
  add constraint knowledge_assets_review_audit_paired
    check ((reviewed_at is null) = (reviewed_by is null)) not valid,
  add constraint knowledge_assets_archive_audit_paired
    check ((archived_at is null) = (archived_by is null)) not valid;

alter table knowledge_assets validate constraint knowledge_assets_submission_audit_paired;
alter table knowledge_assets validate constraint knowledge_assets_review_audit_paired;
alter table knowledge_assets validate constraint knowledge_assets_archive_audit_paired;

alter table knowledge_versions
  add column if not exists submitted_for_review_at timestamptz,
  add column if not exists submitted_for_review_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists published_by text;

update knowledge_versions
set submitted_for_review_at = coalesce(submitted_for_review_at, published_at),
    submitted_for_review_by = coalesce(submitted_for_review_by, 'legacy-system-importer'),
    reviewed_at = coalesce(reviewed_at, published_at),
    reviewed_by = coalesce(reviewed_by, 'legacy-system-publisher'),
    published_by = coalesce(published_by, 'legacy-system-publisher');

alter table knowledge_versions
  alter column submitted_for_review_at set not null,
  alter column submitted_for_review_by set not null,
  alter column reviewed_at set not null,
  alter column reviewed_by set not null,
  alter column published_by set not null;

alter table knowledge_versions
  add constraint knowledge_versions_distinct_reviewer
    check (submitted_for_review_by <> reviewed_by) not valid,
  add constraint knowledge_versions_reviewer_is_publisher
    check (reviewed_by = published_by) not valid;

alter table knowledge_versions validate constraint knowledge_versions_distinct_reviewer;
alter table knowledge_versions validate constraint knowledge_versions_reviewer_is_publisher;
