// Repository factory.
//  - DATABASE_URL / POSTGRES_URL set (or DB_DRIVER=postgres) → Postgres / Supabase (production, Vercel)
//  - otherwise → local SQLite file (zero-setup development)
// Postgres schema changes live in supabase/migrations (applied to Supabase as migrations);
// SQLite applies the mirrored migrations in migrate-sqlite.js on startup.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios as seedScenarios } from '../data/scenarios.js';
import { createRepo } from './repo.js';
import { ensureSuperadmin } from '../lib/admins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let repoPromise;

export function pickDriver(env = process.env) {
  if (env.DB_DRIVER) return env.DB_DRIVER;
  return env.DATABASE_URL || env.POSTGRES_URL ? 'postgres' : 'sqlite';
}

async function init() {
  const kind = pickDriver();
  let driver;
  if (kind === 'postgres') {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DB_DRIVER=postgres requires DATABASE_URL');
    const { createPostgresDriver } = await import('./drivers/postgres.js');
    driver = createPostgresDriver(url);
  } else if (kind === 'sqlite') {
    const { createSqliteDriver } = await import('./drivers/sqlite.js'); // native module loaded only when used
    const { migrateSqlite } = await import('./migrate-sqlite.js');
    const file = process.env.DB_FILE
      ? (process.env.DB_FILE === ':memory:' ? ':memory:' : path.resolve(process.cwd(), process.env.DB_FILE))
      : path.resolve(__dirname, '../../data/phishing-detective.db');
    driver = createSqliteDriver(file);
    migrateSqlite(driver.raw);
  } else {
    throw new Error(`Unsupported DB_DRIVER "${kind}" (use sqlite or postgres)`);
  }
  const repo = createRepo(driver);
  if ((await repo.countScenarios()) === 0) {
    for (const s of seedScenarios) await repo.createScenario(s);
    console.log(`[db] Seeded ${seedScenarios.length} scenarios (${kind})`);
  }
  await ensureSuperadmin(repo);
  return repo;
}

export function getRepo() {
  if (!repoPromise) repoPromise = init().catch((e) => { repoPromise = null; throw e; });
  return repoPromise;
}
