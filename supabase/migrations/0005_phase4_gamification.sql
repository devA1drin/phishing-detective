-- Phase 4: gamification (additive; no data is dropped)
-- class sections (join codes) for class-vs-class leaderboards; educator scoping arrives in phase 5
create table if not exists sections (
  id bigint generated always as identity primary key,
  name text not null,
  join_code text not null unique,
  owner_admin_id bigint references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table players add column if not exists section_id bigint references sections(id) on delete set null;
create index if not exists idx_players_section on players(section_id);

-- daily challenge: one attempt per player per Manila calendar day
alter table game_sessions add column if not exists challenge_date text;
create unique index if not exists uq_daily_attempt on game_sessions(player_id, challenge_date) where challenge_date is not null;

create table if not exists player_badges (
  player_id bigint not null references players(id) on delete cascade,
  badge_id text not null,
  earned_at timestamptz not null default now(),
  primary key (player_id, badge_id)
);

create table if not exists certificates (
  code text primary key,
  player_id bigint not null unique references players(id) on delete cascade,
  nickname text not null,
  pre_percent numeric,
  post_percent numeric,
  retention_percent numeric,
  rounds int not null default 0,
  accuracy numeric,
  badges int not null default 0,
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sections enable row level security;
alter table player_badges enable row level security;
alter table certificates enable row level security;
revoke all on sections, player_badges, certificates from anon, authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'pd_app') then
    foreach t in array array['sections','player_badges','certificates'] loop
      execute format('grant select, insert, update, delete on %I to pd_app', t);
      execute format('drop policy if exists pd_app_all on %I', t);
      execute format('create policy pd_app_all on %I for all to pd_app using (true) with check (true)', t);
    end loop;
    grant usage, select on all sequences in schema public to pd_app;
  end if;
end $$;
