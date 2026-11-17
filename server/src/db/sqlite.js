// SQLite implementation of the data repository (better-sqlite3).
// Every method is async so a Postgres/Supabase implementation with the same
// method names can be dropped in via db/index.js without touching routes.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const toScenario = (r) => r && ({
  id: r.id, channel: r.channel, platform: r.platform || undefined, difficulty: r.difficulty,
  isPhishing: !!r.is_phishing, senderName: r.sender_name, senderAddress: r.sender_address,
  subject: r.subject || undefined, body: r.body, links: JSON.parse(r.links),
  attachments: JSON.parse(r.attachments), redFlags: JSON.parse(r.red_flags),
  safeSigns: JSON.parse(r.safe_signs), explanation: r.explanation, active: !!r.active,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const toSession = (r) => r && ({
  id: r.id, playerId: r.player_id, level: r.level, scenarioIds: JSON.parse(r.scenario_ids),
  score: r.score, correct: r.correct, answered: r.answered, currentStreak: r.current_streak,
  maxStreak: r.max_streak, startedAt: r.started_at, finishedAt: r.finished_at,
  nickname: r.nickname,
});

export function createSqliteRepo(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  const scenarioParams = (s) => ({
    id: s.id, channel: s.channel, platform: s.platform || null, difficulty: Number(s.difficulty),
    is_phishing: s.isPhishing ? 1 : 0, sender_name: s.senderName, sender_address: s.senderAddress,
    subject: s.subject || null, body: s.body, links: JSON.stringify(s.links || []),
    attachments: JSON.stringify(s.attachments || []), red_flags: JSON.stringify(s.redFlags || []),
    safe_signs: JSON.stringify(s.safeSigns || []), explanation: s.explanation || '',
    active: s.active === false ? 0 : 1,
  });

  const repo = {
    driver: 'sqlite',
    raw: db,

    // ── players ──
    async findOrCreatePlayer(nickname) {
      const existing = db.prepare('SELECT * FROM players WHERE nickname = ?').get(nickname);
      if (existing) return { ...existing, isNew: false };
      const info = db.prepare('INSERT INTO players (nickname) VALUES (?)').run(nickname);
      return { ...db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid), isNew: true };
    },
    async getPlayer(id) { return db.prepare('SELECT * FROM players WHERE id = ?').get(id); },
    async listPlayersWithStats() {
      return db.prepare(`
        SELECT p.id, p.nickname, p.created_at,
          (SELECT COUNT(*) FROM game_sessions s WHERE s.player_id = p.id AND s.finished_at IS NOT NULL) AS sessions,
          (SELECT COALESCE(SUM(score),0) FROM game_sessions s WHERE s.player_id = p.id) AS total_score,
          (SELECT COALESCE(MAX(level),0) FROM game_sessions s WHERE s.player_id = p.id) AS max_level,
          (SELECT ROUND(100.0*SUM(is_correct)/COUNT(*),1) FROM answers a JOIN game_sessions s ON s.id=a.session_id WHERE s.player_id=p.id) AS accuracy,
          (SELECT ROUND(100.0*score/total,1) FROM quiz_attempts q WHERE q.player_id=p.id AND kind='pre' ORDER BY q.id LIMIT 1) AS pre_score,
          (SELECT ROUND(100.0*score/total,1) FROM quiz_attempts q WHERE q.player_id=p.id AND kind='post' ORDER BY q.id LIMIT 1) AS post_score
        FROM players p ORDER BY p.id DESC`).all();
    },
    async leaderboard(limit = 10) {
      return db.prepare(`
        SELECT p.nickname, SUM(s.score) AS total_score, MAX(s.level) AS max_level, COUNT(s.id) AS sessions
        FROM game_sessions s JOIN players p ON p.id = s.player_id
        WHERE s.finished_at IS NOT NULL GROUP BY p.id ORDER BY total_score DESC LIMIT ?`).all(limit);
    },

    // ── scenarios ──
    async listScenarios({ activeOnly = false } = {}) {
      const rows = db.prepare(`SELECT * FROM scenarios ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY difficulty, id`).all();
      return rows.map(toScenario);
    },
    async getScenario(id) { return toScenario(db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id)); },
    async createScenario(s) {
      db.prepare(`INSERT INTO scenarios (id, channel, platform, difficulty, is_phishing, sender_name, sender_address, subject, body, links, attachments, red_flags, safe_signs, explanation, active)
        VALUES (@id, @channel, @platform, @difficulty, @is_phishing, @sender_name, @sender_address, @subject, @body, @links, @attachments, @red_flags, @safe_signs, @explanation, @active)`).run(scenarioParams(s));
      return repo.getScenario(s.id);
    },
    async updateScenario(id, s) {
      const info = db.prepare(`UPDATE scenarios SET channel=@channel, platform=@platform, difficulty=@difficulty, is_phishing=@is_phishing,
        sender_name=@sender_name, sender_address=@sender_address, subject=@subject, body=@body, links=@links, attachments=@attachments,
        red_flags=@red_flags, safe_signs=@safe_signs, explanation=@explanation, active=@active, updated_at=datetime('now') WHERE id=@id`).run({ ...scenarioParams(s), id });
      return info.changes ? repo.getScenario(id) : null;
    },
    async deleteScenario(id) { return db.prepare('DELETE FROM scenarios WHERE id = ?').run(id).changes > 0; },
    async countScenarios() { return db.prepare('SELECT COUNT(*) c FROM scenarios').get().c; },

    // ── sessions & answers ──
    async createSession({ playerId, level, scenarioIds }) {
      const info = db.prepare('INSERT INTO game_sessions (player_id, level, scenario_ids) VALUES (?, ?, ?)').run(playerId, level, JSON.stringify(scenarioIds));
      return repo.getSession(info.lastInsertRowid);
    },
    async getSession(id) { return toSession(db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id)); },
    async listSessions() {
      return db.prepare(`SELECT s.*, p.nickname FROM game_sessions s JOIN players p ON p.id = s.player_id ORDER BY s.id DESC`).all().map(toSession);
    },
    async listPlayerSessions(playerId) {
      return db.prepare('SELECT * FROM game_sessions WHERE player_id = ? ORDER BY id').all(playerId).map(toSession);
    },
    async getAnswer(sessionId, scenarioId) {
      return db.prepare('SELECT * FROM answers WHERE session_id = ? AND scenario_id = ?').get(sessionId, scenarioId);
    },
    async recordAnswer(a, sessionUpdate) {
      const tx = db.transaction(() => {
        db.prepare(`INSERT INTO answers (session_id, scenario_id, choice, is_correct, time_ms, flags_found, false_clicks, points)
          VALUES (@sessionId, @scenarioId, @choice, @isCorrect, @timeMs, @flagsFound, @falseClicks, @points)`).run({ ...a, isCorrect: a.isCorrect ? 1 : 0 });
        db.prepare(`UPDATE game_sessions SET score=@score, correct=@correct, answered=@answered, current_streak=@currentStreak, max_streak=@maxStreak WHERE id=@id`).run(sessionUpdate);
      });
      tx();
    },
    async listSessionAnswers(sessionId) {
      return db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY id').all(sessionId);
    },
    async finishSession(id) {
      db.prepare("UPDATE game_sessions SET finished_at = COALESCE(finished_at, datetime('now')) WHERE id = ?").run(id);
      return repo.getSession(id);
    },
    async listAnswersExport() {
      return db.prepare(`SELECT a.id, a.session_id, p.nickname, a.scenario_id, sc.difficulty, sc.is_phishing, a.choice, a.is_correct, a.time_ms, a.flags_found, a.false_clicks, a.points, a.created_at
        FROM answers a JOIN game_sessions s ON s.id=a.session_id JOIN players p ON p.id=s.player_id LEFT JOIN scenarios sc ON sc.id=a.scenario_id ORDER BY a.id`).all();
    },

    // ── quiz ──
    async addQuizAttempt({ playerId, kind, score, total, answers }) {
      const info = db.prepare('INSERT INTO quiz_attempts (player_id, kind, score, total, answers) VALUES (?, ?, ?, ?, ?)').run(playerId, kind, score, total, JSON.stringify(answers));
      return db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(info.lastInsertRowid);
    },
    async listPlayerQuizAttempts(playerId) {
      return db.prepare('SELECT id, kind, score, total, created_at FROM quiz_attempts WHERE player_id = ? ORDER BY id').all(playerId);
    },
    async listQuizAttempts() {
      return db.prepare(`SELECT q.id, p.nickname, q.player_id, q.kind, q.score, q.total, q.answers, q.created_at FROM quiz_attempts q JOIN players p ON p.id=q.player_id ORDER BY q.id`).all();
    },

    // ── analytics ──
    async overview() {
      const one = (sql) => db.prepare(sql).get();
      const players = one('SELECT COUNT(*) c FROM players').c;
      const sessions = one('SELECT COUNT(*) c FROM game_sessions WHERE finished_at IS NOT NULL').c;
      const startedSessions = one('SELECT COUNT(*) c FROM game_sessions').c;
      const ans = one('SELECT COUNT(*) n, COALESCE(SUM(is_correct),0) k, AVG(time_ms) t FROM answers');
      // First pre and first post attempt per player (fair measurement: no retake inflation)
      const firsts = db.prepare(`
        SELECT player_id,
          (SELECT 100.0*score/total FROM quiz_attempts q WHERE q.player_id=x.player_id AND kind='pre'  ORDER BY id LIMIT 1) AS pre,
          (SELECT 100.0*score/total FROM quiz_attempts q WHERE q.player_id=x.player_id AND kind='post' ORDER BY id LIMIT 1) AS post
        FROM (SELECT DISTINCT player_id FROM quiz_attempts) x`).all();
      const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      const pre = firsts.filter((r) => r.pre != null).map((r) => r.pre);
      const post = firsts.filter((r) => r.post != null).map((r) => r.post);
      const paired = firsts.filter((r) => r.pre != null && r.post != null);
      const pairedPre = avg(paired.map((r) => r.pre));
      const pairedPost = avg(paired.map((r) => r.post));
      const byLevel = db.prepare(`SELECT s.level, COUNT(a.id) n, ROUND(100.0*SUM(a.is_correct)/COUNT(a.id),1) accuracy
        FROM answers a JOIN game_sessions s ON s.id=a.session_id GROUP BY s.level ORDER BY s.level`).all();
      const byChannel = db.prepare(`SELECT sc.channel, COUNT(a.id) n, ROUND(100.0*SUM(a.is_correct)/COUNT(a.id),1) accuracy
        FROM answers a JOIN scenarios sc ON sc.id=a.scenario_id GROUP BY sc.channel`).all();
      return {
        players, sessions, startedSessions, answers: ans.n,
        accuracy: ans.n ? (100 * ans.k) / ans.n : null, avgTimeMs: ans.t,
        preCount: pre.length, postCount: post.length, avgPre: avg(pre), avgPost: avg(post),
        pairedCount: paired.length, pairedAvgPre: pairedPre, pairedAvgPost: pairedPost,
        improvedBy20: paired.filter((r) => r.pre > 0 ? (r.post - r.pre) / r.pre >= 0.2 : r.post > 0).length,
        byLevel, byChannel,
      };
    },
    async scenarioStats() {
      return db.prepare(`
        SELECT sc.id, sc.channel, sc.difficulty, sc.is_phishing, sc.sender_name, sc.subject, sc.active,
          COUNT(a.id) AS attempts,
          COALESCE(SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END),0) AS misses,
          ROUND(100.0*SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END)/NULLIF(COUNT(a.id),0),1) AS miss_rate,
          ROUND(AVG(a.time_ms)) AS avg_time_ms
        FROM scenarios sc LEFT JOIN answers a ON a.scenario_id = sc.id
        GROUP BY sc.id ORDER BY miss_rate DESC NULLS LAST, attempts DESC`).all();
    },
  };
  return repo;
}
