// Data repository shared by SQLite and Postgres. All SQL here is written in the
// common subset of both dialects ($n placeholders, CURRENT_TIMESTAMP, CASE, CAST).
const toScenario = (r) => r && ({
  id: r.id, channel: r.channel, platform: r.platform || undefined, difficulty: r.difficulty,
  isPhishing: !!r.is_phishing, senderName: r.sender_name, senderAddress: r.sender_address,
  subject: r.subject || undefined, body: r.body, links: r.links || [], attachments: r.attachments || [],
  redFlags: r.red_flags || [], safeSigns: r.safe_signs || [], explanation: r.explanation, active: !!r.active,
  language: r.language || 'en', status: r.status || 'approved', source: r.source || 'seed',
  aiModel: r.ai_model || undefined, createdBy: r.created_by ?? undefined, reviewedBy: r.reviewed_by ?? undefined, reviewedAt: r.reviewed_at || undefined,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const toSession = (r) => r && ({
  id: r.id, playerId: r.player_id, level: r.level, scenarioIds: r.scenario_ids || [],
  score: r.score, correct: r.correct, answered: r.answered, currentStreak: r.current_streak,
  maxStreak: r.max_streak, startedAt: r.started_at, finishedAt: r.finished_at, nickname: r.nickname,
  mode: r.mode || 'classic', language: r.language || null, challengeDate: r.challenge_date || null,
});

const scenarioValues = (s) => [
  s.id, s.channel, s.platform || null, Number(s.difficulty), !!s.isPhishing, s.senderName, s.senderAddress,
  s.subject || null, s.body, s.links || [], s.attachments || [], s.redFlags || [], s.safeSigns || [],
  s.explanation || '', s.active !== false, s.language || 'en',
];

export const DEFAULT_SETTINGS = {
  controlRatio: 0.5,       // share of new players randomly assigned to the control group
  retentionDays: 14,       // days after the post-quiz before the retention quiz unlocks
  minRoundsForPost: 1,     // experimental group: finished rounds needed before the post-quiz
};

export function createRepo(driver) {
  const q = async (sql, params) => (await driver.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  const validId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

  const repo = {
    driver: driver.kind,
    raw: driver,

    // ── players ──
    async findPlayerByNickname(nickname) {
      return one('SELECT * FROM players WHERE lower(nickname) = lower($1)', [nickname]);
    },
    async createPlayer({ nickname, pinHash, groupName, groupSource = 'random', consentVersion }) {
      return one(`INSERT INTO players (nickname, pin_hash, group_name, group_source, consent_at, consent_version)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5) RETURNING *`, [nickname, pinHash, groupName, groupSource, consentVersion]);
    },
    async setPlayerPin(id, pinHash) { await q('UPDATE players SET pin_hash = $2 WHERE id = $1', [id, pinHash]); },
    async getPlayer(id) { return validId(id) ? one('SELECT * FROM players WHERE id = $1', [Number(id)]) : undefined; },
    async setPlayerGroup(id, groupName, source = 'admin') {
      return one('UPDATE players SET group_name = $2, group_source = $3 WHERE id = $1 RETURNING *', [id, groupName, source]);
    },
    async markReadingDone(id) { await q('UPDATE players SET reading_done_at = COALESCE(reading_done_at, CURRENT_TIMESTAMP) WHERE id = $1', [id]); },
    async deletePlayer(id) { return (await driver.query('DELETE FROM players WHERE id = $1', [id])).rowCount > 0; },
    async listPlayersWithStats() {
      return q(`
        SELECT p.id, p.nickname, p.group_name, p.group_source, p.consent_at, p.created_at,
          (SELECT COUNT(*) FROM game_sessions s WHERE s.player_id = p.id AND s.finished_at IS NOT NULL) AS sessions,
          (SELECT COALESCE(SUM(score),0) FROM game_sessions s WHERE s.player_id = p.id) AS total_score,
          (SELECT COALESCE(MAX(level),0) FROM game_sessions s WHERE s.player_id = p.id) AS max_level,
          (SELECT ROUND(100.0*SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) FROM answers a JOIN game_sessions s ON s.id=a.session_id WHERE s.player_id=p.id) AS accuracy,
          (SELECT ROUND(100.0*score/total,1) FROM quiz_attempts x WHERE x.player_id=p.id AND kind='pre' ORDER BY x.id LIMIT 1) AS pre_score,
          (SELECT ROUND(100.0*score/total,1) FROM quiz_attempts x WHERE x.player_id=p.id AND kind='post' ORDER BY x.id LIMIT 1) AS post_score,
          (SELECT ROUND(100.0*score/total,1) FROM quiz_attempts x WHERE x.player_id=p.id AND kind='retention' ORDER BY x.id LIMIT 1) AS retention_score
        FROM players p ORDER BY p.id DESC`);
    },
    async leaderboard(limit = 10) {
      return q(`
        SELECT p.nickname, CAST(SUM(s.score) AS INTEGER) AS total_score, CAST(MAX(s.level) AS INTEGER) AS max_level, CAST(COUNT(s.id) AS INTEGER) AS sessions
        FROM game_sessions s JOIN players p ON p.id = s.player_id
        WHERE s.finished_at IS NOT NULL GROUP BY p.id, p.nickname ORDER BY total_score DESC LIMIT $1`, [limit]);
    },

    // ── settings ──
    async getSettings() {
      const rows = await q('SELECT key, value FROM settings');
      const out = { ...DEFAULT_SETTINGS };
      for (const r of rows) out[r.key] = r.value?.v ?? r.value;
      return out;
    },
    async setSetting(key, value) {
      await q(`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`, [key, { v: value }]);
    },

    // ── scenarios ──
    /** activeOnly = what players can be served: active AND approved (pending AI drafts never leak). */
    async listScenarios({ activeOnly = false, status } = {}) {
      const where = [];
      const params = [];
      if (activeOnly) where.push("active = true AND status = 'approved'");
      if (status) { params.push(status); where.push(`status = $${params.length}`); }
      return (await q(`SELECT * FROM scenarios ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY difficulty, id`, params)).map(toScenario);
    },
    async getScenario(id) { return toScenario(await one('SELECT * FROM scenarios WHERE id = $1', [id])); },
    async createScenario(s) {
      await q(`INSERT INTO scenarios (id, channel, platform, difficulty, is_phishing, sender_name, sender_address, subject, body, links, attachments, red_flags, safe_signs, explanation, active, language, status, source, ai_model, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [...scenarioValues(s), s.status || 'approved', s.source || 'admin', s.aiModel || null, s.createdBy || null]);
      return repo.getScenario(s.id);
    },
    /** Insert a seed scenario unless that id exists (safe under concurrent cold starts). */
    async insertScenarioIfMissing(s) {
      return (await driver.query(`INSERT INTO scenarios (id, channel, platform, difficulty, is_phishing, sender_name, sender_address, subject, body, links, attachments, red_flags, safe_signs, explanation, active, language)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`, scenarioValues(s))).rowCount > 0;
    },
    /** Educator review of a (usually AI-generated) draft. Approve makes it live. */
    async reviewScenario(id, status, adminId) {
      const rows = await q(`UPDATE scenarios SET status = $2, active = $3, reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING id`, [id, status, status === 'approved', adminId]);
      return rows.length ? repo.getScenario(id) : null;
    },
    async countPendingScenarios() { return (await one("SELECT COUNT(*) AS c FROM scenarios WHERE status = 'pending'")).c; },

    // ── adaptive learning: weakness per red-flag category ──
    async bumpCategoryStats(playerId, outcomes) {
      for (const o of outcomes) {
        await q(`INSERT INTO player_category_stats (player_id, category, seen, missed) VALUES ($1, $2, 1, $3)
          ON CONFLICT (player_id, category) DO UPDATE SET seen = player_category_stats.seen + 1,
            missed = player_category_stats.missed + excluded.missed, updated_at = CURRENT_TIMESTAMP`, [playerId, o.category, o.missed ? 1 : 0]);
      }
    },
    async getCategoryStats(playerId) { return q('SELECT category, seen, missed FROM player_category_stats WHERE player_id = $1', [playerId]); },
    async listCategoryStats() {
      return q('SELECT c.player_id, p.nickname, c.category, c.seen, c.missed FROM player_category_stats c JOIN players p ON p.id = c.player_id ORDER BY c.player_id, c.category');
    },
    async updateScenario(id, s) {
      const rows = await q(`UPDATE scenarios SET channel=$2, platform=$3, difficulty=$4, is_phishing=$5, sender_name=$6, sender_address=$7,
        subject=$8, body=$9, links=$10, attachments=$11, red_flags=$12, safe_signs=$13, explanation=$14, active=$15, language=$16, updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING id`, scenarioValues({ ...s, id }));
      return rows.length ? repo.getScenario(id) : null;
    },
    async deleteScenario(id) { return (await driver.query('DELETE FROM scenarios WHERE id = $1', [id])).rowCount > 0; },
    async countScenarios() { return (await one('SELECT COUNT(*) AS c FROM scenarios')).c; },

    // ── sessions & answers ──
    async createSession({ playerId, level, scenarioIds, mode = 'classic', language = null, challengeDate = null }) {
      return toSession(await one('INSERT INTO game_sessions (player_id, level, scenario_ids, mode, language, challenge_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [playerId, level, scenarioIds, mode, language, challengeDate]));
    },
    async getDailySession(playerId, date) {
      return toSession(await one('SELECT * FROM game_sessions WHERE player_id = $1 AND challenge_date = $2', [playerId, date]));
    },
    async dailyLeaderboard(date, limit = 10) {
      return q(`SELECT p.nickname, sec.name AS section, s.score, s.correct, s.answered
        FROM game_sessions s JOIN players p ON p.id = s.player_id LEFT JOIN sections sec ON sec.id = p.section_id
        WHERE s.challenge_date = $1 AND s.finished_at IS NOT NULL ORDER BY s.score DESC, s.correct DESC, s.id LIMIT $2`, [date, limit]);
    },
    async listPlayerDailyDates(playerId) {
      return (await q('SELECT challenge_date FROM game_sessions WHERE player_id = $1 AND challenge_date IS NOT NULL AND finished_at IS NOT NULL', [playerId])).map((r) => r.challenge_date);
    },
    async listPlayerAnswerFacts(playerId) {
      return q(`SELECT a.session_id, a.is_correct, a.flags_found, a.link_clicked, s.channel, s.language, s.is_phishing, s.red_flags, s.links
        FROM answers a JOIN game_sessions g ON g.id = a.session_id JOIN scenarios s ON s.id = a.scenario_id WHERE g.player_id = $1`, [playerId]);
    },

    // ── badges ──
    async getBadges(playerId) { return q('SELECT badge_id, earned_at FROM player_badges WHERE player_id = $1 ORDER BY earned_at', [playerId]); },
    async awardBadges(playerId, ids) {
      for (const id of ids) await q('INSERT INTO player_badges (player_id, badge_id) VALUES ($1, $2) ON CONFLICT (player_id, badge_id) DO NOTHING', [playerId, id]);
    },
    async badgeCounts() { return q('SELECT badge_id, COUNT(*) AS n FROM player_badges GROUP BY badge_id'); },

    // ── sections (classes) ──
    async createSection({ name, joinCode, ownerAdminId }) {
      return one('INSERT INTO sections (name, join_code, owner_admin_id) VALUES ($1, $2, $3) RETURNING *', [name, joinCode, ownerAdminId ?? null]);
    },
    async getSection(id) { return validId(id) ? one('SELECT * FROM sections WHERE id = $1', [Number(id)]) : undefined; },
    async getSectionByCode(code) { return one('SELECT * FROM sections WHERE upper(join_code) = upper($1)', [String(code || '').trim()]); },
    async listSections() {
      return q(`SELECT sec.*, a.username AS owner_username,
          (SELECT COUNT(*) FROM players p WHERE p.section_id = sec.id) AS players
        FROM sections sec LEFT JOIN admins a ON a.id = sec.owner_admin_id ORDER BY sec.id`);
    },
    async updateSection(id, { name, ownerAdminId }) {
      return one('UPDATE sections SET name = COALESCE($2, name), owner_admin_id = COALESCE($3, owner_admin_id) WHERE id = $1 RETURNING *', [id, name ?? null, ownerAdminId ?? null]);
    },
    async deleteSection(id) { return (await driver.query('DELETE FROM sections WHERE id = $1', [id])).rowCount > 0; },
    async setPlayerSection(playerId, sectionId) { await q('UPDATE players SET section_id = $2 WHERE id = $1', [playerId, sectionId]); },
    async classLeaderboard() {
      return q(`SELECT sec.id, sec.name, COUNT(DISTINCT p.id) AS members,
          COUNT(DISTINCT s.player_id) AS active_players,
          CAST(COALESCE(SUM(s.score), 0) AS INTEGER) AS total_score,
          CAST(COALESCE(SUM(s.correct), 0) AS INTEGER) AS correct,
          CAST(COALESCE(SUM(s.answered), 0) AS INTEGER) AS answered
        FROM sections sec JOIN players p ON p.section_id = sec.id
        LEFT JOIN game_sessions s ON s.player_id = p.id AND s.finished_at IS NOT NULL
        GROUP BY sec.id, sec.name`);
    },

    // ── certificates ──
    async getCertificateByPlayer(playerId) { return one('SELECT * FROM certificates WHERE player_id = $1', [playerId]); },
    async getCertificate(code) { return one('SELECT * FROM certificates WHERE code = $1', [String(code || '').trim().toUpperCase()]); },
    async upsertCertificate(c) {
      return one(`INSERT INTO certificates (code, player_id, nickname, pre_percent, post_percent, retention_percent, rounds, accuracy, badges)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (player_id) DO UPDATE SET nickname = excluded.nickname, pre_percent = excluded.pre_percent, post_percent = excluded.post_percent,
          retention_percent = excluded.retention_percent, rounds = excluded.rounds, accuracy = excluded.accuracy, badges = excluded.badges, updated_at = CURRENT_TIMESTAMP
        RETURNING *`, [c.code, c.playerId, c.nickname, c.prePercent, c.postPercent, c.retentionPercent, c.rounds, c.accuracy, c.badges]);
    },
    async getSession(id) { return validId(id) ? toSession(await one('SELECT * FROM game_sessions WHERE id = $1', [Number(id)])) : undefined; },
    async listSessions() {
      return (await q('SELECT s.*, p.nickname FROM game_sessions s JOIN players p ON p.id = s.player_id ORDER BY s.id DESC')).map(toSession);
    },
    async listPlayerSessions(playerId) {
      return (await q('SELECT * FROM game_sessions WHERE player_id = $1 ORDER BY id', [playerId])).map(toSession);
    },
    async getAnswer(sessionId, scenarioId) { return one('SELECT * FROM answers WHERE session_id = $1 AND scenario_id = $2', [sessionId, scenarioId]); },
    async recordAnswer(a, u) {
      await driver.tx(async (t) => {
        await t.query(`INSERT INTO answers (session_id, scenario_id, choice, is_correct, time_ms, flags_found, false_clicks, points, link_clicked)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [a.sessionId, a.scenarioId, a.choice, !!a.isCorrect, a.timeMs, a.flagsFound, a.falseClicks, a.points, !!a.linkClicked]);
        await t.query('UPDATE game_sessions SET score=$2, correct=$3, answered=$4, current_streak=$5, max_streak=$6 WHERE id=$1',
          [u.id, u.score, u.correct, u.answered, u.currentStreak, u.maxStreak]);
      });
    },
    async listSessionAnswers(sessionId) { return q('SELECT * FROM answers WHERE session_id = $1 ORDER BY id', [sessionId]); },
    async finishSession(id) {
      await q('UPDATE game_sessions SET finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP) WHERE id = $1', [id]);
      return repo.getSession(id);
    },
    async listAnswersExport() {
      return q(`SELECT a.id, a.session_id, p.nickname, p.group_name, a.scenario_id, sc.difficulty, sc.channel, sc.language, sc.is_phishing, s.mode, a.choice, a.is_correct, a.link_clicked, a.time_ms, a.flags_found, a.false_clicks, a.points, a.created_at
        FROM answers a JOIN game_sessions s ON s.id=a.session_id JOIN players p ON p.id=s.player_id LEFT JOIN scenarios sc ON sc.id=a.scenario_id ORDER BY a.id`);
    },

    // ── quiz ──
    async addQuizAttempt({ playerId, kind, score, total, answers }) {
      return one('INSERT INTO quiz_attempts (player_id, kind, score, total, answers) VALUES ($1,$2,$3,$4,$5) RETURNING *', [playerId, kind, score, total, answers]);
    },
    async listPlayerQuizAttempts(playerId) {
      return q('SELECT id, kind, score, total, answers, created_at FROM quiz_attempts WHERE player_id = $1 ORDER BY id', [playerId]);
    },
    async listQuizAttempts() {
      return q(`SELECT x.id, p.nickname, x.player_id, p.group_name, x.kind, x.score, x.total, x.answers, x.created_at
        FROM quiz_attempts x JOIN players p ON p.id=x.player_id ORDER BY x.id`);
    },

    // ── surveys (SUS, ISO 25010) ──
    async addSurvey({ playerId, kind, answers, score }) {
      return one('INSERT INTO surveys (player_id, kind, answers, score) VALUES ($1,$2,$3,$4) RETURNING *', [playerId, kind, answers, score]);
    },
    async listPlayerSurveys(playerId) { return q('SELECT kind, score, created_at FROM surveys WHERE player_id = $1', [playerId]); },
    async listSurveys() {
      return q('SELECT v.id, v.player_id, p.nickname, p.group_name, v.kind, v.score, v.answers, v.created_at FROM surveys v JOIN players p ON p.id=v.player_id ORDER BY v.id');
    },

    // ── admins ──
    async countAdmins() { return (await one('SELECT COUNT(*) AS c FROM admins')).c; },
    async getAdminByUsername(username) { return one('SELECT * FROM admins WHERE lower(username) = lower($1)', [username]); },
    async getAdmin(id) { return validId(id) ? one('SELECT * FROM admins WHERE id = $1', [Number(id)]) : undefined; },
    async listAdmins() { return q('SELECT id, username, role, display_name, created_at, last_login_at FROM admins ORDER BY id'); },
    async createAdmin({ username, passwordHash, role, displayName }) {
      return one('INSERT INTO admins (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4) RETURNING id, username, role, display_name, created_at', [username, passwordHash, role, displayName || null]);
    },
    async updateAdmin(id, { passwordHash, role, displayName }) {
      const cur = await repo.getAdmin(id);
      if (!cur) return null;
      return one('UPDATE admins SET password_hash=$2, role=$3, display_name=$4 WHERE id=$1 RETURNING id, username, role, display_name, created_at, last_login_at',
        [id, passwordHash ?? cur.password_hash, role ?? cur.role, displayName === undefined ? cur.display_name : displayName]);
    },
    async deleteAdmin(id) { return (await driver.query('DELETE FROM admins WHERE id = $1', [id])).rowCount > 0; },
    async touchAdminLogin(id) { await q('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [id]); },

    // ── analytics ──
    async answerTotals() {
      const ans = await one('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END),0) AS k, AVG(time_ms) AS t FROM answers');
      const counts = await one(`SELECT (SELECT COUNT(*) FROM players) AS players,
        (SELECT COUNT(*) FROM game_sessions WHERE finished_at IS NOT NULL) AS sessions,
        (SELECT COUNT(*) FROM game_sessions) AS started`);
      const byLevel = await q(`SELECT s.level, COUNT(a.id) AS n, ROUND(100.0*SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)/NULLIF(COUNT(a.id),0),1) AS accuracy
        FROM answers a JOIN game_sessions s ON s.id=a.session_id GROUP BY s.level ORDER BY s.level`);
      const byChannel = await q(`SELECT sc.channel, COUNT(a.id) AS n, ROUND(100.0*SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)/NULLIF(COUNT(a.id),0),1) AS accuracy
        FROM answers a JOIN scenarios sc ON sc.id=a.scenario_id GROUP BY sc.channel ORDER BY sc.channel`);
      return { ...counts, answers: ans.n, correct: ans.k, avgTimeMs: ans.t == null ? null : Number(ans.t), byLevel, byChannel };
    },
    async scenarioStats() {
      return q(`
        SELECT sc.id, sc.channel, sc.language, sc.difficulty, sc.is_phishing, sc.sender_name, sc.subject, sc.active,
          COUNT(a.id) AS attempts,
          COALESCE(SUM(CASE WHEN a.link_clicked = true THEN 1 ELSE 0 END),0) AS link_clicks,
          COALESCE(SUM(CASE WHEN a.is_correct = false THEN 1 ELSE 0 END),0) AS misses,
          ROUND(100.0*SUM(CASE WHEN a.is_correct = false THEN 1 ELSE 0 END)/NULLIF(COUNT(a.id),0),1) AS miss_rate,
          ROUND(AVG(a.time_ms)) AS avg_time_ms
        FROM scenarios sc LEFT JOIN answers a ON a.scenario_id = sc.id
        GROUP BY sc.id, sc.channel, sc.language, sc.difficulty, sc.is_phishing, sc.sender_name, sc.subject, sc.active
        ORDER BY miss_rate DESC NULLS LAST, attempts DESC`);
    },
  };
  return repo;
}
