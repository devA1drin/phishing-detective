// SQLite schema + ordered migrations (mirrors supabase/migrations for Postgres).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const hasColumn = (db, table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
const addColumn = (db, table, col, ddl) => { if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); };
const tableSql = (db, table) => db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';

/**
 * Rebuild a table with a new definition, copying every shared column (used to relax CHECK
 * constraints). Follows SQLite's documented 12-step procedure: create new, copy, drop old,
 * rename. Must run with foreign_keys OFF (see migrateSqlite) so nothing cascades.
 */
function rebuild(db, table, createSql) {
  const tmp = `${table}__new`;
  db.exec(createSql.replace(`CREATE TABLE ${table} (`, `CREATE TABLE ${tmp} (`));
  const oldCols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const newCols = db.prepare(`PRAGMA table_info(${tmp})`).all().map((c) => c.name);
  const cols = oldCols.filter((c) => newCols.includes(c)).join(', ');
  db.exec(`INSERT INTO ${tmp} (${cols}) SELECT ${cols} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
}

export const sqliteMigrations = [
  {
    id: '0002_phase1_research_security',
    up(db) {
      addColumn(db, 'players', 'pin_hash', 'TEXT');
      addColumn(db, 'players', 'group_name', "TEXT NOT NULL DEFAULT 'experimental'");
      addColumn(db, 'players', 'group_source', "TEXT NOT NULL DEFAULT 'random'");
      addColumn(db, 'players', 'consent_at', 'TEXT');
      addColumn(db, 'players', 'consent_version', 'TEXT');
      addColumn(db, 'players', 'reading_done_at', 'TEXT');
      db.exec("UPDATE players SET group_source = 'legacy' WHERE consent_at IS NULL AND pin_hash IS NULL");
      if (tableSql(db, 'quiz_attempts').includes("'post')")) {
        rebuild(db, 'quiz_attempts', `CREATE TABLE quiz_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('pre','post','retention')),
          score INTEGER NOT NULL, total INTEGER NOT NULL, answers TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
        db.exec('CREATE INDEX IF NOT EXISTS idx_quiz_player ON quiz_attempts(player_id, kind)');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS surveys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('sus','iso25010')),
          answers TEXT NOT NULL, score REAL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (player_id, kind));
        CREATE TABLE IF NOT EXISTS admins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('superadmin','educator')),
          display_name TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_login_at TEXT);`);
    },
  },
];

export function migrateSqlite(db) {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const pending = sqliteMigrations.filter((m) => !done.has(m.id));
  if (!pending.length) return;
  db.pragma('foreign_keys = OFF'); // so table rebuilds never cascade-delete child rows
  try {
    for (const m of pending) {
      db.transaction(() => { m.up(db); db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(m.id); })();
    }
    const problems = db.pragma('foreign_key_check');
    if (problems.length) console.warn('[db] foreign_key_check reported', problems.length, 'issues');
  } finally { db.pragma('foreign_keys = ON'); }
}
