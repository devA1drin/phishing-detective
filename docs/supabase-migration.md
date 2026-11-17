# Supabase / Postgres (production storage)

The API never touches SQL directly. Every route calls the async repository from `getRepo()` in `server/src/db/index.js`:

| Condition | Driver | File |
|---|---|---|
| `DATABASE_URL` or `POSTGRES_URL` set (or `DB_DRIVER=postgres`) | Postgres / Supabase | `server/src/db/drivers/postgres.js` (node-postgres) |
| otherwise | SQLite (zero-setup local dev) | `server/src/db/drivers/sqlite.js` (better-sqlite3, optional dependency) |

## Setting up a new Supabase project
1. Create a project (free tier is fine) and apply `supabase/migrations/0001_init.sql` … `0006_phase5_educator_tools.sql` **in order** (SQL editor, `supabase db push`, or the Supabase MCP `apply_migration`). They create every table, enable RLS and revoke access for the public `anon`/`authenticated` API roles, so only the server can read and write. Every migration is additive (no drops of data) and safe to re-run.
2. Create a least-privilege login role for the app (choose your own strong password):
   ```sql
   create role pd_app login password '<strong-password>';
   grant usage on schema public to pd_app;
   grant select, insert, update, delete on players, scenarios, game_sessions, answers, quiz_attempts to pd_app;
   -- migrations 0002+ grant their own new tables to pd_app automatically when the role exists,
   -- so create the role before applying them (or re-run them afterwards).
   grant usage, select on all sequences in schema public to pd_app;
   -- RLS policies so the app role can use the tables
   create policy pd_app_all on players       for all to pd_app using (true) with check (true);
   create policy pd_app_all on scenarios     for all to pd_app using (true) with check (true);
   create policy pd_app_all on game_sessions for all to pd_app using (true) with check (true);
   create policy pd_app_all on answers       for all to pd_app using (true) with check (true);
   create policy pd_app_all on quiz_attempts for all to pd_app using (true) with check (true);
   ```
3. Use the **pooler** (Supavisor, transaction mode, port 6543). It works from serverless/IPv4 hosts like Vercel:
   `DATABASE_URL=postgresql://pd_app.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres?sslmode=require`
4. Scenarios are seeded automatically on boot: missing seed scenarios are inserted (`ON CONFLICT DO NOTHING`) whenever `SEED_VERSION` in `server/src/data/scenarios.js` is newer than the `seedVersion` setting, so admin edits are never overwritten.

## Testing the Postgres adapter locally
Any Postgres works, e.g. a local server or PGlite with `@electric-sql/pglite-socket`:
```bash
npm run test:pg   # starts PGlite, creates anon/authenticated/pd_app, applies every migration, runs the suite
```
