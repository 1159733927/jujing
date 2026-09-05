create index if not exists reports_payload_principal_created_at_idx
  on reports ((payload->>'principalId'), created_at desc);
