create table if not exists wenzhen_fixtures (
  sample_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint wenzhen_fixtures_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint wenzhen_fixtures_sample_id_matches_payload check (payload ->> 'sampleId' = sample_id),
  constraint wenzhen_fixtures_reportable_status check (payload ->> 'status' in ('verified', 'accepted-difference'))
);

create or replace function reject_wenzhen_fixture_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wenzhen_fixtures is append-only';
end;
$$;

drop trigger if exists wenzhen_fixtures_append_only on wenzhen_fixtures;
create trigger wenzhen_fixtures_append_only
before update or delete on wenzhen_fixtures
for each row execute function reject_wenzhen_fixture_mutation();
