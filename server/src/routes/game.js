import { Router } from 'express';
import { pickScenarios, pickWithLanguage, publicScenario, scoreAnswer, unlockedLevels, linkTrap, UNLOCK_ACCURACY, MAX_LEVEL, ROUND_SIZE, INBOX_SIZES, MODES, LANGUAGE_FILTERS } from '../lib/game.js';
import { requirePlayer } from '../lib/auth.js';
import { answerLimiter } from '../lib/ratelimit.js';
import { buildProgress } from '../lib/progress.js';
import { adaptiveWeight } from '../lib/adaptive.js';
import { categoryOutcomes, weakCategories } from '../lib/categories.js';
import { coachText } from '../lib/ai.js';
import { coachLimiter } from '../lib/ratelimit.js';
import { DAILY_SIZE, dailyPick, dayStreak, manilaDate } from '../lib/daily.js';
import { evaluateBadges } from '../lib/badges.js';

export default function gameRouter(repo) {
  const r = Router();

  // Public preview: random scenarios without answers (useful for demos/tests).
  r.get('/scenarios/random', async (req, res) => {
    const level = Math.min(Math.max(Number(req.query.level) || 1, 1), MAX_LEVEL);
    const all = await repo.listScenarios({ activeOnly: true });
    const count = Math.min(Number(req.query.count) || 8, 20);
    res.json(pickScenarios(all, level, count).map(publicScenario));
  });

  // Start a round
  r.post('/sessions', requirePlayer, async (req, res) => {
    const playerId = req.playerId;
    const level = Number(req.body?.level) || 1;
    const mode = req.body?.mode || 'classic';
    const language = req.body?.language || 'all';
    if (mode === 'daily') return startDaily(req, res);
    if (!MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of ${MODES.join(', ')}` });
    if (!LANGUAGE_FILTERS.includes(language)) return res.status(400).json({ error: `language must be one of ${LANGUAGE_FILTERS.join(', ')}` });
    const player = await repo.getPlayer(playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const prog = await buildProgress(repo, player);
    if (!prog.canPlay) return res.status(403).json({ error: prog.preQuiz ? 'Your study group plays after the retention quiz. Thanks for your patience!' : 'Take the pre-game quiz first' });
    const unlocked = unlockedLevels(await repo.listPlayerSessions(playerId));
    if (level < 1 || level > unlocked) return res.status(403).json({ error: `Level ${level} is locked. Reach ${UNLOCK_ACCURACY}% accuracy on level ${unlocked} to unlock it.`, unlockedLevel: unlocked });
    const all = await repo.listScenarios({ activeOnly: true });
    if (all.length < 4) return res.status(500).json({ error: 'Not enough active scenarios' });
    const size = mode === 'inbox' ? INBOX_SIZES[level] : ROUND_SIZE;
    const adaptive = adaptiveWeight(await repo.getCategoryStats(playerId));
    const picked = pickWithLanguage(all, level, size, language, adaptive.weight);
    const session = await repo.createSession({ playerId, level, scenarioIds: picked.map((s) => s.id), mode, language });
    const scenarios = picked.map(publicScenario);
    const out = { sessionId: session.id, level, mode, language, scenarios, adaptive: { on: !!adaptive.weight, focus: adaptive.focus.map((f) => f.label) } };
    // Inbox: one shared clock for the whole inbox (80% of the per-message limits combined)
    if (mode === 'inbox') out.inboxTimeLimit = Math.round(scenarios.reduce((a, x) => a + x.timeLimit, 0) * 0.8);
    res.status(201).json(out);
  });

  // Daily challenge: same cases for everyone today, one attempt each (counts for the daily board)
  async function startDaily(req, res) {
    const player = await repo.getPlayer(req.playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const prog = await buildProgress(repo, player);
    if (!prog.canPlay) return res.status(403).json({ error: prog.preQuiz ? 'Your study group plays after the retention quiz. Thanks for your patience!' : 'Take the pre-game quiz first' });
    const date = manilaDate();
    if (await repo.getDailySession(player.id, date)) return res.status(409).json({ error: "You already played today's challenge. Come back tomorrow!" });
    const all = await repo.listScenarios({ activeOnly: true });
    const picked = dailyPick(all, date);
    let session;
    try {
      session = await repo.createSession({ playerId: player.id, level: 2, scenarioIds: picked.map((s) => s.id), mode: 'daily', language: 'all', challengeDate: date });
    } catch { return res.status(409).json({ error: "You already played today's challenge. Come back tomorrow!" }); }
    res.status(201).json({ sessionId: session.id, level: 2, mode: 'daily', date, language: 'all', scenarios: picked.map(publicScenario), adaptive: { on: false, focus: [] } });
  }

  r.get('/daily', requirePlayer, async (req, res) => {
    const date = manilaDate();
    const mine = await repo.getDailySession(req.playerId, date);
    res.json({
      date, size: DAILY_SIZE,
      played: mine ? { finished: !!mine.finishedAt, score: mine.score, correct: mine.correct, answered: mine.answered } : null,
      streak: dayStreak(await repo.listPlayerDailyDates(req.playerId), date),
      leaderboard: await repo.dailyLeaderboard(date, 10),
    });
  });

  // Submit an answer for one scenario in the round
  r.post('/sessions/:id/answers', requirePlayer, answerLimiter, async (req, res) => {
    const session = await repo.getSession(Number(req.params.id));
    if (!session || session.playerId !== req.playerId) return res.status(404).json({ error: 'Session not found' });
    if (session.finishedAt) return res.status(409).json({ error: 'Session already finished' });
    const { scenarioId, choice, timeMs, clickedParts, linkClicked } = req.body || {};
    if (!session.scenarioIds.includes(scenarioId)) return res.status(400).json({ error: 'Scenario not part of this session' });
    if (await repo.getAnswer(session.id, scenarioId)) return res.status(409).json({ error: 'Already answered' });
    const scenario = await repo.getScenario(scenarioId);
    if (!scenario) return res.status(404).json({ error: 'Scenario no longer exists' });

    res.json(await record(session, scenario, { choice, timeMs, clickedParts: Array.isArray(clickedParts) ? clickedParts : [], linkClicked: !!linkClicked }));
  });

  // Link trap: the player chose to OPEN a link (or scan a QR). Nothing real is opened.
  // Phishing link → the case is lost ("you got phished") and recorded as a wrong answer.
  // Legit link → a simulated safe-destination note; the player still has to decide.
  r.post('/sessions/:id/link-click', requirePlayer, answerLimiter, async (req, res) => {
    const session = await repo.getSession(Number(req.params.id));
    if (!session || session.playerId !== req.playerId) return res.status(404).json({ error: 'Session not found' });
    if (session.finishedAt) return res.status(409).json({ error: 'Session already finished' });
    const { scenarioId, index, timeMs, clickedParts } = req.body || {};
    if (!session.scenarioIds.includes(scenarioId)) return res.status(400).json({ error: 'Scenario not part of this session' });
    if (await repo.getAnswer(session.id, scenarioId)) return res.status(409).json({ error: 'Already answered' });
    const scenario = await repo.getScenario(scenarioId);
    const trap = scenario && linkTrap(scenario, Number(index));
    if (!trap) return res.status(400).json({ error: 'Unknown link' });
    if (!trap.phished) return res.json({ trap });
    const result = await record(session, scenario, { choice: 'legit', timeMs, clickedParts: Array.isArray(clickedParts) ? clickedParts : [], linkClicked: true });
    res.json({ trap, result });
  });

  async function record(session, scenario, { choice, timeMs, clickedParts, linkClicked }) {
    const scenarioId = scenario.id;
    const result = scoreAnswer(scenario, { choice, timeMs, clickedParts }, session.currentStreak);
    if (linkClicked && scenario.isPhishing) {
      // Opening a phishing link loses the case even if you later called it phishing
      Object.assign(result, { isCorrect: false, points: 0, phished: true });
      result.breakdown = { ...result.breakdown, base: 0, timeBonus: 0, multiplier: 1, streak: 0 };
    }
    const update = {
      id: session.id,
      score: session.score + result.points,
      correct: session.correct + (result.isCorrect ? 1 : 0),
      answered: session.answered + 1,
      currentStreak: result.breakdown.streak,
      maxStreak: Math.max(session.maxStreak, result.breakdown.streak),
    };
    await repo.recordAnswer({
      sessionId: session.id, scenarioId, choice: result.timedOut ? null : choice, isCorrect: result.isCorrect,
      timeMs: result.timeMs, flagsFound: result.flagsFound, falseClicks: result.falseClicks, points: result.points, linkClicked,
    }, update);
    Object.assign(session, update); // keep the in-memory copy current for callers
    await repo.bumpCategoryStats(session.playerId, categoryOutcomes(scenario, result));
    return { ...result, linkClicked, sessionScore: update.score, streak: update.currentStreak, answered: update.answered, total: session.scenarioIds.length };
  }

  // AI coach: personalised explanation for an answered case (static tip if AI is unavailable)
  r.post('/sessions/:id/coach', requirePlayer, coachLimiter, async (req, res) => {
    const session = await repo.getSession(Number(req.params.id));
    if (!session || session.playerId !== req.playerId) return res.status(404).json({ error: 'Session not found' });
    const { scenarioId, missed = [] } = req.body || {};
    const answer = await repo.getAnswer(session.id, scenarioId);
    if (!answer) return res.status(409).json({ error: 'Answer the case first' });
    const scenario = await repo.getScenario(scenarioId);
    if (!scenario) return res.status(404).json({ error: 'Scenario no longer exists' });
    const missedSet = new Set((Array.isArray(missed) ? missed : []).map(Number));
    const result = {
      isCorrect: !!answer.is_correct, timedOut: answer.choice == null, phished: !!answer.link_clicked && !answer.is_correct,
      redFlags: (scenario.redFlags || []).map((f, i) => ({ ...f, found: answer.is_correct ? !missedSet.has(i) : false })),
    };
    const weak = weakCategories(await repo.getCategoryStats(session.playerId));
    const coach = await coachText({ scenario, result, weak });
    res.json({ ...coach, weakCategories: weak.map((w) => w.label) });
  });

  // Finish a round and get the summary
  r.post('/sessions/:id/finish', requirePlayer, async (req, res) => {
    const before = await repo.getSession(Number(req.params.id));
    if (!before || before.playerId !== req.playerId) return res.status(404).json({ error: 'Session not found' });
    const prevUnlocked = unlockedLevels((await repo.listPlayerSessions(before.playerId)).filter((s) => s.id !== before.id));
    const session = await repo.finishSession(before.id);
    const unlocked = unlockedLevels(await repo.listPlayerSessions(session.playerId));
    const answers = await repo.listSessionAnswers(session.id);
    const details = [];
    for (const a of answers) {
      const s = await repo.getScenario(a.scenario_id);
      details.push({ linkClicked: !!a.link_clicked, scenarioId: a.scenario_id, label: s ? (s.subject || `${s.channel.toUpperCase()} from ${s.senderName}`) : a.scenario_id, channel: s?.channel, isPhishing: s?.isPhishing, choice: a.choice, isCorrect: !!a.is_correct, points: a.points, timeMs: a.time_ms, flagsFound: a.flags_found });
    }
    const accuracy = session.answered ? Math.round((100 * session.correct) / session.answered) : 0;
    const { newly } = await evaluateBadges(repo, session.playerId);
    res.json({
      newBadges: newly, challengeDate: session.challengeDate,
      sessionId: session.id, level: session.level, mode: session.mode, phishedCount: answers.filter((a) => a.link_clicked && !a.is_correct).length, score: session.score, correct: session.correct,
      answered: session.answered, total: session.scenarioIds.length, accuracy, maxStreak: session.maxStreak,
      avgTimeMs: answers.length ? Math.round(answers.reduce((a, x) => a + x.time_ms, 0) / answers.length) : 0,
      flagsFound: answers.reduce((a, x) => a + x.flags_found, 0),
      unlockedLevel: unlocked, newlyUnlocked: unlocked > prevUnlocked ? unlocked : null,
      unlockAccuracy: UNLOCK_ACCURACY, details,
    });
  });

  return r;
}
