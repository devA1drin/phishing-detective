-- Phase 3: AI scenario generator with educator review, adaptive selection (additive)
alter table scenarios add column if not exists status text not null default 'approved';
alter table scenarios drop constraint if exists scenarios_status_check;
alter table scenarios add constraint scenarios_status_check check (status in ('approved','pending','rejected'));
alter table scenarios add column if not exists source text not null default 'seed';
alter table scenarios add column if not exists ai_model text;
alter table scenarios add column if not exists created_by bigint references admins(id) on delete set null;
alter table scenarios add column if not exists reviewed_by bigint references admins(id) on delete set null;
alter table scenarios add column if not exists reviewed_at timestamptz;
create index if not exists idx_scenarios_status on scenarios(status);

-- per-player weakness by red-flag category (drives adaptive selection and the AI coach)
create table if not exists player_category_stats (
  player_id bigint not null references players(id) on delete cascade,
  category text not null,
  seen int not null default 0,
  missed int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, category)
);
alter table player_category_stats enable row level security;
revoke all on player_category_stats from anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'pd_app') then
    grant select, insert, update, delete on player_category_stats to pd_app;
    drop policy if exists pd_app_all on player_category_stats;
    create policy pd_app_all on player_category_stats for all to pd_app using (true) with check (true);
  end if;
end $$;
