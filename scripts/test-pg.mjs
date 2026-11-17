// Runs the server test-suite against real Postgres semantics using PGlite (WASM Postgres),
// after applying every file in supabase/migrations in order, exactly as Supabase does.
//   npm run test:pg
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await PGlite.create();
// Roles that exist on Supabase (migrations grant to / revoke from them)
await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE pd_app LOGIN PASSWORD 'x';`);
const dir = path.join(root, 'supabase/migrations');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  console.log(`[pg] applied ${f}`);
}
const port = 55432;
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
await server.start();
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'test/*.test.js'], {
  cwd: path.join(root, 'server'), stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`, DB_DRIVER: '' },
});
const code = await new Promise((r) => child.on('exit', r));
await server.stop();
await db.close();
process.exit(code ?? 1);
