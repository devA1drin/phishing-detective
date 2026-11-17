// Postgres / Supabase implementation of the data repository (node-postgres).
// Same async method names as sqlite.js, so routes don't change.
// Used automatically when DATABASE_URL (or POSTGRES_URL) is set.
import pg from 'pg';

pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8 / count(*)
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric

// Render timestamps like the SQLite version ("YYYY-MM-DD HH:MM:SS", UTC)
const ts = (d) => (d instanceof Date ? d.toISOString().replace('T', ' ').slice(0, 19) : d);
const fix = (row) => {
  if (!row) return row;
  for (const k of Object.keys(row)) if (row[k] instanceof Date) row[k] = ts(row[k]);
  return row;
};

const toScenario = (r) => r && ({
  id: r.id, channel: r.channel, platform: r.platform || undefined, difficulty: r.difficulty,
  isPhishing: !!r.is_phishing, senderName: r.sender_name, senderAddress: r.sender_address,
  subject: r.subject || undefined, body: r.body, links: r.links || [], attachments: r.attachments || [],
  redFlags: r.red_flags || [], safeSigns: r.safe_signs || [], explanation: r.explanation, active: !!r.active,
  createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
});

const toSession = (r) => r && ({
  id: r.id, playerId: r.player_id, level: r.level, scenarioIds: r.scenario_ids,
  score: r.score, correct: r.correct, answered: r.answered, currentStreak: r.current_streak,
  maxStreak: r.max_streak, startedAt: ts(r.started_at), finishedAt: ts(r.finished_at), nickname: r.nickname,
});

const scenarioValues = (s) => [
  s.id, s.channel, s.platform || null, Number(s.difficulty), !!s.isPhishing, s.senderName, s.senderAddress,
  s.subject || null, s.body, JSON.stringify(s.links || []), JSON.stringify(s.attachments || []),
  JSON.stringify(s.redFlags || []), JSON.stringify(s.safeSigns || []), s.explanation || '', s.active !== false,
];

export function createPostgresRepo(connectionString) {
  // Strip sslmode from the URL and configure TLS explicitly (Supabase pooler uses its own CA chain).
  const url = new URL(connectionString);
  const wantsSsl = !/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && url.searchParams.get('sslmode') !== 'disable';
  url.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: wantsSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX) || 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];

  const repo = {
    driver: 'postgres',
    pool,

    // ── players ──
    async findOrCreatePlayer(nickname) {
      const existing = await one('SELECT * FROM players WHERE lower(nickname) = lower($1)', [nickname]);
      if (existing) return { ...fix(existing), isNew: false };
      const created = await one('INSERT INTO players (nickname) VALUES ($1) ON CONFLICT DO NOTHING RETURNING *', [nickname]);
      if (created) return { ...fix(created), isNew: true };
      return { ...fix(await one('SELECT * FROM players WHERE lower(nickname) = lower($1)', [nickname])), isNew: false };
    },
    async getPlayer(id) {
      if (!Number.isFinite(Number(id))) return undefined;
      return fix(await one('SELECT * FROM players WHERE id = $1', [id]));
    },
    async listPlayersWithStats() {
      const rows = await q(`
        SELECT p.id, p.nickname, p.created_at,
          (SELECT COUNT(*) FROM game_sessions s WHERE s.player_id = p.id AND s.finished_at IS NOT NULL) AS sessions,
          (SELECT COALESCE(SUM(score),0) FROM game_sessions s WHERE s.player_id = p.id) AS total_score,
          (SELECT COALESCE(MAX(level),0) FROM game_sessions s WHERE s.player_id = p.id) AS max_level,
          (SELECT ROUND(100.0*SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) FROM answers a JOIN game_sessions s ON s.id=a.session_id WHERE s.player_id=p.id) AS accuracy,
          (SELECT ROUND(100.0*score/total,1) FROM quiz_attempts q WHERE q.player_id=p.id AND kind='pre' ORDER BY q.id LIMIT 1) AS pre_score,
          (SELECT ROUND(100.0*score/total,1) FROM quiz_attempts q WHERE q.player_id=p.id AND kind='post' ORDER BY q.id LIMIT 1) AS post_score
        FROM players p ORDER BY p.id DESC`);
      return rows.map(fix);
    },
    async leaderboard(limit = 10) {
      return q(`
        SELECT p.nickname, SUM(s.score)::int AS total_score, MAX(s.level)::int AS max_level, COUNT(s.id)::int AS sessions
        FROM game_sessions s JOIN players p ON p.id = s.player_id
        WHERE s.finished_at IS NOT NULL GROUP BY p.id, p.nickname ORDER BY total_score DESC LIMIT $1`, [limit]);
    },

    // ── scenarios ──
    async listScenarios({ activeOnly = false } = {}) {
      return (await q(`SELECT * FROM scenarios ${activeOnly ? 'WHERE active' : ''} ORDER BY difficulty, id`)).map(toScenario);
    },
    async getScenario(id) { return toScenario(await one('SELECT * FROM scenarios WHERE id = $1', [id])); },
    async createScenario(s) {
      await q(`INSERT INTO scenarios (id, channel, platform, difficulty, is_phishing, sender_name, sender_address, subject, body, links, attachments, red_flags, safe_signs, explanation, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, scenarioValues(s));
      return repo.getScenario(s.id);
    },
    async updateScenario(id, s) {
      const rows = await q(`UPDATE scenarios SET channel=$2, platform=$3, difficulty=$4, is_phishing=$5, sender_name=$6, sender_address=$7,
        subject=$8, body=$9, links=$10, attachments=$11, red_flags=$12, safe_signs=$13, explanation=$14, active=$15, updated_at=now()
        WHERE id=$1 RETURNING id`, scenarioValues({ ...s, id }));
      return rows.length ? repo.getScenario(id) : null;
    },
    async deleteScenario(id) { return (await q('DELETE FROM scenarios WHERE id = $1 RETURNING id', [id])).length > 0; },
    async countScenarios() { return (await one('SELECT COUNT(*) AS c FROM scenarios')).c; },

    // ── sessions & answers ──
    async createSession({ playerId, level, scenarioIds }) {
      return toSession(await one('INSERT INTO game_sessions (player_id, level, scenario_ids) VALUES ($1, $2, $3) RETURNING *', [playerId, level, JSON.stringify(scenarioIds)]));
    },
    async getSession(id) {
      if (!Number.isFinite(Number(id))) return undefined;
      return toSession(await one('SELECT * FROM game_sessions WHERE id = $1', [id]));
    },
    async listSessions() {
      return (await q('SELECT s.*, p.nickname FROM game_sessions s JOIN players p ON p.id = s.player_id ORDER BY s.id DESC')).map(toSession);
    },
    async listPlayerSessions(playerId) {
      return (await q('SELECT * FROM game_sessions WHERE player_id = $1 ORDER BY id', [playerId])).map(toSession);
    },
    async getAnswer(sessionId, scenarioId) {
      return fix(await one('SELECT * FROM answers WHERE session_id = $1 AND scenario_id = $2', [sessionId, scenarioId]));
    },
    async recordAnswer(a, u) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO answers (session_id, scenario_id, choice, is_correct, time_ms, flags_found, false_clicks, points)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [a.sessionId, a.scenarioId, a.choice, !!a.isCorrect, a.timeMs, a.flagsFound, a.falseClicks, a.points]);
        await client.query('UPDATE game_sessions SET score=$2, correct=$3, answered=$4, current_streak=$5, max_streak=$6 WHERE id=$1',
          [u.id, u.score, u.correct, u.answered, u.currentStreak, u.maxStreak]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    async listSessionAnswers(sessionId) {
      return (await q('SELECT * FROM answers WHERE session_id = $1 ORDER BY id', [sessionId])).map(fix);
    },
    async finishSession(id) {
      await q('UPDATE game_sessions SET finished_at = COALESCE(finished_at, now()) WHERE id = $1', [id]);
      return repo.getSession(id);
    },
    async listAnswersExport() {
      return (await q(`SELECT a.id, a.session_id, p.nickname, a.scenario_id, sc.difficulty, sc.is_phishing, a.choice, a.is_correct, a.time_ms, a.flags_found, a.false_clicks, a.points, a.created_at
        FROM answers a JOIN game_sessions s ON s.id=a.session_id JOIN players p ON p.id=s.player_id LEFT JOIN scenarios sc ON sc.id=a.scenario_id ORDER BY a.id`)).map(fix);
    },

    // ── quiz ──
    async addQuizAttempt({ playerId, kind, score, total, answers }) {
      return fix(await one('INSERT INTO quiz_attempts (player_id, kind, score, total, answers) VALUES ($1,$2,$3,$4,$5) RETURNING *', [playerId, kind, score, total, JSON.stringify(answers)]));
    },
    async listPlayerQuizAttempts(playerId) {
      return (await q('SELECT id, kind, score, total, created_at FROM quiz_attempts WHERE player_id = $1 ORDER BY id', [playerId])).map(fix);
    },
    async listQuizAttempts() {
      return (await q('SELECT q.id, p.nickname, q.player_id, q.kind, q.score, q.total, q.answers, q.created_at FROM quiz_attempts q JOIN players p ON p.id=q.player_id ORDER BY q.id')).map(fix);
    },

    // ── analytics ──
    async overview() {
      const players = (await one('SELECT COUNT(*) AS c FROM players')).c;
      const sessions = (await one('SELECT COUNT(*) AS c FROM game_sessions WHERE finished_at IS NOT NULL')).c;
      const startedSessions = (await one('SELECT COUNT(*) AS c FROM game_sessions')).c;
      const ans = await one('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END),0)::int AS k, AVG(time_ms)::float AS t FROM answers');
      const firsts = await q(`
        SELECT x.player_id,
          (SELECT 100.0*score/total FROM quiz_attempts q WHERE q.player_id=x.player_id AND kind='pre'  ORDER BY id LIMIT 1)::float AS pre,
          (SELECT 100.0*score/total FROM quiz_attempts q WHERE q.player_id=x.player_id AND kind='post' ORDER BY id LIMIT 1)::float AS post
        FROM (SELECT DISTINCT player_id FROM quiz_attempts) x`);
      const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      const pre = firsts.filter((r) => r.pre != null).map((r) => r.pre);
      const post = firsts.filter((r) => r.post != null).map((r) => r.post);
      const paired = firsts.filter((r) => r.pre != null && r.post != null);
      const byLevel = await q(`SELECT s.level, COUNT(a.id) AS n, ROUND(100.0*SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)/COUNT(a.id),1) AS accuracy
        FROM answers a JOIN game_sessions s ON s.id=a.session_id GROUP BY s.level ORDER BY s.level`);
      const byChannel = await q(`SELECT sc.channel, COUNT(a.id) AS n, ROUND(100.0*SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)/COUNT(a.id),1) AS accuracy
        FROM answers a JOIN scenarios sc ON sc.id=a.scenario_id GROUP BY sc.channel`);
      return {
        players, sessions, startedSessions, answers: ans.n,
        accuracy: ans.n ? (100 * ans.k) / ans.n : null, avgTimeMs: ans.t,
        preCount: pre.length, postCount: post.length, avgPre: avg(pre), avgPost: avg(post),
        pairedCount: paired.length, pairedAvgPre: avg(paired.map((r) => r.pre)), pairedAvgPost: avg(paired.map((r) => r.post)),
        improvedBy20: paired.filter((r) => (r.pre > 0 ? (r.post - r.pre) / r.pre >= 0.2 : r.post > 0)).length,
        byLevel, byChannel,
      };
    },
    async scenarioStats() {
      return q(`
        SELECT sc.id, sc.channel, sc.difficulty, sc.is_phishing, sc.sender_name, sc.subject, sc.active,
          COUNT(a.id) AS attempts,
          COALESCE(SUM(CASE WHEN a.is_correct = false THEN 1 ELSE 0 END),0)::int AS misses,
          ROUND(100.0*SUM(CASE WHEN a.is_correct = false THEN 1 ELSE 0 END)/NULLIF(COUNT(a.id),0),1) AS miss_rate,
          ROUND(AVG(a.time_ms)) AS avg_time_ms
        FROM scenarios sc LEFT JOIN answers a ON a.scenario_id = sc.id
        GROUP BY sc.id ORDER BY miss_rate DESC NULLS LAST, attempts DESC`);
    },
  };
  return repo;
}
