-- SQLite schema (also valid, with minor type changes, for Postgres/Supabase; see docs/schema.postgres.sql)
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenarios (
  id              TEXT PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('email','sms','social')),
  platform        TEXT,
  difficulty      INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  is_phishing     INTEGER NOT NULL,
  sender_name     TEXT NOT NULL,
  sender_address  TEXT NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  links           TEXT NOT NULL DEFAULT '[]',   -- JSON [{text, href}]
  attachments     TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, size}]
  red_flags       TEXT NOT NULL DEFAULT '[]',   -- JSON [{target, match?, index?, label, detail}]
  safe_signs      TEXT NOT NULL DEFAULT '[]',   -- JSON [string]
  explanation     TEXT NOT NULL DEFAULT '',
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  level           INTEGER NOT NULL,
  scenario_ids    TEXT NOT NULL,                -- JSON array of scenario ids served
  score           INTEGER NOT NULL DEFAULT 0,
  correct         INTEGER NOT NULL DEFAULT 0,
  answered        INTEGER NOT NULL DEFAULT 0,
  current_streak  INTEGER NOT NULL DEFAULT 0,
  max_streak      INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);

CREATE TABLE IF NOT EXISTS answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  scenario_id     TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  choice          TEXT,                         -- 'phishing' | 'legit' | NULL (timed out)
  is_correct      INTEGER NOT NULL,
  time_ms         INTEGER NOT NULL,
  flags_found     INTEGER NOT NULL DEFAULT 0,
  false_clicks    INTEGER NOT NULL DEFAULT 0,
  points          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('pre','post')),
  score           INTEGER NOT NULL,
  total           INTEGER NOT NULL,
  answers         TEXT NOT NULL,                -- JSON [{itemId, choice, correct}]
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_player ON game_sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_scenario ON answers(scenario_id);
CREATE INDEX IF NOT EXISTS idx_quiz_player ON quiz_attempts(player_id, kind);
