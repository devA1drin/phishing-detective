// Existing databases get new seed scenarios once, without resurrecting deleted ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('seed sync adds only newer seed scenarios', { skip: !!process.env.DATABASE_URL && 'SQLite-only check' }, async () => {
  const { createSqliteDriver } = await import('../src/db/drivers/sqlite.js');
  const { migrateSqlite } = await import('../src/db/migrate-sqlite.js');
  const { createRepo } = await import('../src/db/repo.js');
  const { scenarios } = await import('../src/data/scenarios.js');
  const driver = createSqliteDriver(':memory:');
  migrateSqlite(driver.raw);
  const repo = createRepo(driver);
  // simulate a v1 database where an admin deleted one original scenario
  const v1 = scenarios.filter((s) => s.addedIn === 1);
  for (const s of v1.slice(1)) await repo.createScenario(s);
  process.env.DB_FILE = ':memory:';
  const before = await repo.countScenarios();
  for (const s of scenarios) if (s.addedIn > 1) await repo.insertScenarioIfMissing(s);
  const again = await repo.insertScenarioIfMissing(scenarios.find((s) => s.addedIn === 2));
  assert.equal(again, false, 'insert is idempotent');
  assert.equal(await repo.countScenarios(), before + scenarios.filter((s) => s.addedIn === 2).length);
  assert.equal(await repo.getScenario(v1[0].id), undefined, 'deleted v1 scenario stays deleted');
});
