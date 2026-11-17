import { Router } from 'express';
import { pickScenarios, publicScenario, scoreAnswer, unlockedLevels, UNLOCK_ACCURACY, MAX_LEVEL } from '../lib/game.js';

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
  r.post('/sessions', async (req, res) => {
    const playerId = Number(req.body?.playerId);
    const level = Number(req.body?.level) || 1;
    const player = await repo.getPlayer(playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const unlocked = unlockedLevels(await repo.listPlayerSessions(playerId));
    if (level < 1 || level > unlocked) return res.status(403).json({ error: `Level ${level} is locked. Reach ${UNLOCK_ACCURACY}% accuracy on level ${unlocked} to unlock it.`, unlockedLevel: unlocked });
    const all = await repo.listScenarios({ activeOnly: true });
    if (all.length < 4) return res.status(500).json({ error: 'Not enough active scenarios' });
    const picked = pickScenarios(all, level);
    const session = await repo.createSession({ playerId, level, scenarioIds: picked.map((s) => s.id) });
    res.status(201).json({ sessionId: session.id, level, scenarios: picked.map(publicScenario) });
  });

  // Submit an answer for one scenario in the round
  r.post('/sessions/:id/answers', async (req, res) => {
    const session = await repo.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.finishedAt) return res.status(409).json({ error: 'Session already finished' });
    const { scenarioId, choice, timeMs, clickedParts } = req.body || {};
    if (!session.scenarioIds.includes(scenarioId)) return res.status(400).json({ error: 'Scenario not part of this session' });
    if (await repo.getAnswer(session.id, scenarioId)) return res.status(409).json({ error: 'Already answered' });
    const scenario = await repo.getScenario(scenarioId);
    if (!scenario) return res.status(404).json({ error: 'Scenario no longer exists' });

    const result = scoreAnswer(scenario, { choice, timeMs, clickedParts: Array.isArray(clickedParts) ? clickedParts : [] }, session.currentStreak);
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
      timeMs: result.timeMs, flagsFound: result.flagsFound, falseClicks: result.falseClicks, points: result.points,
    }, update);
    res.json({ ...result, sessionScore: update.score, streak: update.currentStreak, answered: update.answered, total: session.scenarioIds.length });
  });

  // Finish a round and get the summary
  r.post('/sessions/:id/finish', async (req, res) => {
    const before = await repo.getSession(Number(req.params.id));
    if (!before) return res.status(404).json({ error: 'Session not found' });
    const prevUnlocked = unlockedLevels((await repo.listPlayerSessions(before.playerId)).filter((s) => s.id !== before.id));
    const session = await repo.finishSession(before.id);
    const unlocked = unlockedLevels(await repo.listPlayerSessions(session.playerId));
    const answers = await repo.listSessionAnswers(session.id);
    const details = [];
    for (const a of answers) {
      const s = await repo.getScenario(a.scenario_id);
      details.push({ scenarioId: a.scenario_id, label: s ? (s.subject || `${s.channel.toUpperCase()} from ${s.senderName}`) : a.scenario_id, channel: s?.channel, isPhishing: s?.isPhishing, choice: a.choice, isCorrect: !!a.is_correct, points: a.points, timeMs: a.time_ms, flagsFound: a.flags_found });
    }
    const accuracy = session.answered ? Math.round((100 * session.correct) / session.answered) : 0;
    res.json({
      sessionId: session.id, level: session.level, score: session.score, correct: session.correct,
      answered: session.answered, total: session.scenarioIds.length, accuracy, maxStreak: session.maxStreak,
      avgTimeMs: answers.length ? Math.round(answers.reduce((a, x) => a + x.time_ms, 0) / answers.length) : 0,
      flagsFound: answers.reduce((a, x) => a + x.flags_found, 0),
      unlockedLevel: unlocked, newlyUnlocked: unlocked > prevUnlocked ? unlocked : null,
      unlockAccuracy: UNLOCK_ACCURACY, details,
    });
  });

  return r;
}
