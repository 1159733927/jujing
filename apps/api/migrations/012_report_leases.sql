alter table reports drop constraint if exists reports_status_check;

alter table reports
  add constraint reports_status_check
  check (status in ('queued', 'running', 'completed', 'failed'));

create index if not exists reports_running_lease_idx
  on reports ((payload#>>'{runLease,expiresAt}'))
  where status = 'running';
