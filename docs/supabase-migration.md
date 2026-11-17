# Supabase / Postgres (production storage)

The API never touches SQL directly. Every route calls the async repository from `getRepo()` in `server/src/db/index.js`:

| Condition | Driver | File |
|---|---|---|
| `DATABASE_URL` or `POSTGRES_URL` set (or `DB_DRIVER=postgres`) | Postgres / Supabase | `server/src/db/postgres.js` (node-postgres) |
| otherwise | SQLite (zero-setup local dev) | `server/src/db/sqlite.js` (better-sqlite3, optional dependency) |

## Setting up a new Supabase project
1. Create a project (free tier is fine) and run `docs/schema.postgres.sql` in the SQL editor (or as a migration). It creates the tables, enables RLS and revokes access for the public `anon`/`authenticated` API roles, so only the server can read and write.
2. Create a least-privilege login role for the app (choose your own strong password):
   ```sql
   create role pd_app login password '<strong-password>';
   grant usage on schema public to pd_app;
   grant select, insert, update, delete on players, scenarios, game_sessions, answers, quiz_attempts to pd_app;
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
4. Scenarios are seeded automatically on the first request if the table is empty.

## Testing the Postgres adapter locally
Any Postgres works, e.g. a local server or PGlite with `@electric-sql/pglite-socket`:
```bash
DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable' npm test
```
