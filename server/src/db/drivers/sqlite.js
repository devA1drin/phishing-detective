// SQLite driver (better-sqlite3). Accepts Postgres-style $1 placeholders.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { normaliseRow, normaliseParam } from './common.js';

export function createSqliteDriver(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const cache = new Map();
  const prep = (sql) => {
    let entry = cache.get(sql);
    if (!entry) {
      const order = [];
      const converted = sql.replace(/\$(\d+)/g, (_, n) => { order.push(Number(n) - 1); return '?'; });
      entry = { stmt: db.prepare(converted), order };
      cache.set(sql, entry);
    }
    return entry;
  };
  return {
    kind: 'sqlite',
    raw: db,
    async query(sql, params = []) {
      const { stmt, order } = prep(sql);
      const args = order.map((i) => normaliseParam(params[i], 'sqlite'));
      if (stmt.reader) {
        const rows = stmt.all(...args).map(normaliseRow);
        return { rows, rowCount: rows.length };
      }
      const info = stmt.run(...args);
      return { rows: [], rowCount: info.changes };
    },
    exec(sql) { db.exec(sql); },
    // better-sqlite3 is synchronous; queries inside fn run back-to-back on one connection.
    async tx(fn) { return fn(this); },
    async close() { db.close(); },
  };
}
