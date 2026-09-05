alter table reports
  add column if not exists archived_at timestamptz,
  add column if not exists source_report_id uuid references reports(id) on delete restrict;

update reports
set
  archived_at = nullif(payload->>'archivedAt', '')::timestamptz,
  source_report_id = nullif(payload->>'sourceReportId', '')::uuid
where archived_at is null
  and source_report_id is null
  and (payload ? 'archivedAt' or payload ? 'sourceReportId');

alter table reports
  drop constraint if exists reports_source_report_not_self_check;

alter table reports
  add constraint reports_source_report_not_self_check
  check (source_report_id is null or source_report_id <> id);

create index if not exists reports_principal_active_created_at_idx
  on reports ((payload->>'principalId'), created_at desc)
  where archived_at is null;

create index if not exists reports_principal_archived_created_at_idx
  on reports ((payload->>'principalId'), created_at desc)
  where archived_at is not null;

create index if not exists reports_source_report_id_idx
  on reports (source_report_id)
  where source_report_id is not null;
