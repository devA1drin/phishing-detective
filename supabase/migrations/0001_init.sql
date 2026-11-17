-- Postgres / Supabase schema used in production (DB_DRIVER=postgres / DATABASE_URL set)
create table if not exists players (
  id bigint generated always as identity primary key,
  nickname text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists players_nickname_lower_key on players (lower(nickname));

create table if not exists scenarios (
  id text primary key,
  channel text not null check (channel in ('email','sms','social')),
  platform text,
  difficulty smallint not null check (difficulty between 1 and 3),
  is_phishing boolean not null,
  sender_name text not null,
  sender_address text not null,
  subject text,
  body text not null,
  links jsonb not null default '[]',
  attachments jsonb not null default '[]',
  red_flags jsonb not null default '[]',
  safe_signs jsonb not null default '[]',
  explanation text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists game_sessions (
  id bigint generated always as identity primary key,
  player_id bigint not null references players(id) on delete cascade,
  level smallint not null,
  scenario_ids jsonb not null,
  score int not null default 0,
  correct int not null default 0,
  answered int not null default 0,
  current_streak int not null default 0,
  max_streak int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists answers (
  id bigint generated always as identity primary key,
  session_id bigint not null references game_sessions(id) on delete cascade,
  scenario_id text not null references scenarios(id) on delete cascade,
  choice text check (choice in ('phishing','legit')),
  is_correct boolean not null,
  time_ms int not null,
  flags_found int not null default 0,
  false_clicks int not null default 0,
  points int not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, scenario_id)
);

create table if not exists quiz_attempts (
  id bigint generated always as identity primary key,
  player_id bigint not null references players(id) on delete cascade,
  kind text not null check (kind in ('pre','post')),
  score int not null,
  total int not null,
  answers jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_player on game_sessions(player_id);
create index if not exists idx_answers_session on answers(session_id);
create index if not exists idx_answers_scenario on answers(scenario_id);
create index if not exists idx_quiz_player on quiz_attempts(player_id, kind);

-- Lock the tables away from Supabase's public REST API (anon/authenticated roles).
-- Only the Express server (connecting with its own Postgres role) reads and writes.
alter table players enable row level security;
alter table scenarios enable row level security;
alter table game_sessions enable row level security;
alter table answers enable row level security;
alter table quiz_attempts enable row level security;
revoke all on players, scenarios, game_sessions, answers, quiz_attempts from anon, authenticated;
