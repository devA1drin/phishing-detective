// Repository factory.
//  - DATABASE_URL / POSTGRES_URL set (or DB_DRIVER=postgres) → Postgres / Supabase (production, Vercel)
//  - otherwise → local SQLite file (zero-setup development)
// Postgres schema changes live in supabase/migrations (applied to Supabase as migrations);
// SQLite applies the mirrored migrations in migrate-sqlite.js on startup.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios as seedScenarios, SEED_VERSION } from '../data/scenarios.js';
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
  await syncSeedScenarios(repo, kind);
  await ensureSuperadmin(repo);
  return repo;
}

/**
 * Seed the scenario bank. A fresh database gets every scenario. An existing database gets
 * only scenarios added in newer seed versions (never re-inserting ones an admin deleted
 * from an older version, never overwriting edits).
 */
async function syncSeedScenarios(repo, kind) {
  const settings = await repo.getSettings();
  const fresh = (await repo.countScenarios()) === 0;
  const have = fresh ? 0 : Number(settings.seedVersion || 1);
  if (have >= SEED_VERSION) return;
  let added = 0;
  for (const s of seedScenarios) if ((fresh || s.addedIn > have) && (await repo.insertScenarioIfMissing(s))) added++;
  await repo.setSetting('seedVersion', SEED_VERSION);
  if (added) console.log(`[db] Seeded ${added} scenarios (${kind}, seed v${SEED_VERSION})`);
}

export function getRepo() {
  if (!repoPromise) repoPromise = init().catch((e) => { repoPromise = null; throw e; });
  return repoPromise;
}
