alter table principals drop constraint if exists principals_kind_check;
alter table principals add constraint principals_kind_check check (kind in ('anonymous'));

create table if not exists user_accounts (
  id uuid primary key,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  status text not null check (status in ('active', 'disabled')),
  principal_id uuid unique references principals(id),
  last_login_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table user_accounts add column if not exists last_login_at timestamptz;

create table if not exists user_sessions (
  id uuid primary key,
  user_id uuid not null references user_accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null
);
create index if not exists user_sessions_user_id_idx on user_sessions(user_id);
create index if not exists user_sessions_expires_at_idx on user_sessions(expires_at);
