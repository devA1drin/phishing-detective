-- Phase 1: research rigor & security (additive; no data is dropped)
alter table players add column if not exists pin_hash text;
alter table players add column if not exists group_name text not null default 'experimental';
alter table players add column if not exists group_source text not null default 'random';
alter table players add column if not exists consent_at timestamptz;
alter table players add column if not exists consent_version text;
alter table players add column if not exists reading_done_at timestamptz;
-- players created before this phase played the game without random assignment
update players set group_source = 'legacy' where consent_at is null and pin_hash is null;

-- allow the delayed retention quiz (constraint widened, rows untouched)
alter table quiz_attempts drop constraint if exists quiz_attempts_kind_check;
alter table quiz_attempts add constraint quiz_attempts_kind_check check (kind in ('pre','post','retention'));

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists surveys (
  id bigint generated always as identity primary key,
  player_id bigint not null references players(id) on delete cascade,
  kind text not null check (kind in ('sus','iso25010')),
  answers jsonb not null,
  score numeric,
  created_at timestamptz not null default now(),
  unique (player_id, kind)
);

create table if not exists admins (
  id bigint generated always as identity primary key,
  username text not null,
  password_hash text not null,
  role text not null check (role in ('superadmin','educator')),
  display_name text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists admins_username_lower_key on admins (lower(username));

alter table settings enable row level security;
alter table surveys enable row level security;
alter table admins enable row level security;
revoke all on settings, surveys, admins from anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'pd_app') then
    grant select, insert, update, delete on settings, surveys, admins to pd_app;
    grant usage, select on all sequences in schema public to pd_app;
    drop policy if exists pd_app_all on settings; create policy pd_app_all on settings for all to pd_app using (true) with check (true);
    drop policy if exists pd_app_all on surveys;  create policy pd_app_all on surveys  for all to pd_app using (true) with check (true);
    drop policy if exists pd_app_all on admins;   create policy pd_app_all on admins   for all to pd_app using (true) with check (true);
  end if;
end $$;
