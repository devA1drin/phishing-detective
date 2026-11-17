// Repository factory.
//  - DATABASE_URL / POSTGRES_URL set (or DB_DRIVER=postgres) → Postgres / Supabase (production, Vercel)
//  - otherwise → local SQLite file (zero-setup development)
// Both implement the same async methods, so routes don't care which one is used.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios as seedScenarios } from '../data/scenarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let repoPromise;

export function pickDriver(env = process.env) {
  if (env.DB_DRIVER) return env.DB_DRIVER;
  return env.DATABASE_URL || env.POSTGRES_URL ? 'postgres' : 'sqlite';
}

async function init() {
  const driver = pickDriver();
  let repo;
  if (driver === 'postgres') {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DB_DRIVER=postgres requires DATABASE_URL');
    const { createPostgresRepo } = await import('./postgres.js');
    repo = createPostgresRepo(url);
  } else if (driver === 'sqlite') {
    const { createSqliteRepo } = await import('./sqlite.js'); // lazy: native module only loaded when used
    const file = process.env.DB_FILE
      ? (process.env.DB_FILE === ':memory:' ? ':memory:' : path.resolve(process.cwd(), process.env.DB_FILE))
      : path.resolve(__dirname, '../../data/phishing-detective.db');
    repo = createSqliteRepo(file);
  } else {
    throw new Error(`Unsupported DB_DRIVER "${driver}" (use sqlite or postgres)`);
  }
  if ((await repo.countScenarios()) === 0) {
    for (const s of seedScenarios) await repo.createScenario(s);
    console.log(`[db] Seeded ${seedScenarios.length} scenarios (${driver})`);
  }
  return repo;
}

export function getRepo() {
  if (!repoPromise) repoPromise = init().catch((e) => { repoPromise = null; throw e; });
  return repoPromise;
}
