// Postgres driver (node-postgres) for Supabase. Pool is small for serverless.
import pg from 'pg';
import { normaliseRow, normaliseParam } from './common.js';

pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8 / count(*)
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric

export function createPostgresDriver(connectionString) {
  const url = new URL(connectionString);
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const ssl = !local && url.searchParams.get('sslmode') !== 'disable';
  url.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX) || 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const run = async (client, sql, params = []) => {
    const r = await client.query(sql, params.map((p) => normaliseParam(p, 'pg')));
    return { rows: r.rows.map(normaliseRow), rowCount: r.rowCount };
  };
  return {
    kind: 'postgres',
    pool,
    query: (sql, params) => run(pool, sql, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ kind: 'postgres', query: (s, p) => run(client, s, p) });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}
