import { Router } from 'express';
import { quizPools } from '../data/quiz.js';
import { shuffle } from '../lib/game.js';

const publicItem = ({ isPhishing, explanation, ...rest }) => rest;

export default function quizRouter(repo) {
  const r = Router();

  r.get('/quiz/:kind', (req, res) => {
    const pool = quizPools[req.params.kind];
    if (!pool) return res.status(404).json({ error: 'Quiz must be "pre" or "post"' });
    res.json({ kind: req.params.kind, items: shuffle(pool).map(publicItem) });
  });

  r.post('/quiz/:kind/submit', async (req, res) => {
    const { kind } = req.params;
    const pool = quizPools[kind];
    if (!pool) return res.status(404).json({ error: 'Quiz must be "pre" or "post"' });
    const playerId = Number(req.body?.playerId);
    const player = await repo.getPlayer(playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const attempts = await repo.listPlayerQuizAttempts(playerId);
    const sessions = (await repo.listPlayerSessions(playerId)).filter((s) => s.finishedAt);
    if (kind === 'pre' && attempts.some((a) => a.kind === 'pre')) return res.status(409).json({ error: 'Pre-game quiz already taken' });
    if (kind === 'post' && !attempts.some((a) => a.kind === 'pre')) return res.status(403).json({ error: 'Take the pre-game quiz first' });
    if (kind === 'post' && sessions.length < 1) return res.status(403).json({ error: 'Finish at least one game round first' });

    const given = new Map((req.body?.answers || []).map((a) => [a.itemId, a.choice]));
    const graded = pool.map((item) => {
      const choice = given.get(item.id) ?? null;
      return { itemId: item.id, choice, correct: choice !== null && (choice === 'phishing') === item.isPhishing };
    });
    const score = graded.filter((g) => g.correct).length;
    const attempt = await repo.addQuizAttempt({ playerId, kind, score, total: pool.length, answers: graded });
    const pre = attempts.find((a) => a.kind === 'pre');
    const out = { attemptId: attempt.id, kind, score, total: pool.length, percent: Math.round((100 * score) / pool.length) };
    if (kind === 'post') {
      // Reveal answers only after the post-quiz (keeps the pre-test from teaching the answers).
      out.review = pool.map((item) => ({ ...item, ...graded.find((g) => g.itemId === item.id) }));
      if (pre) {
        const prePct = (100 * pre.score) / pre.total;
        out.prePercent = Math.round(prePct);
        out.improvementPoints = Math.round(out.percent - prePct);
        out.improvementPercent = prePct > 0 ? Math.round(((out.percent - prePct) / prePct) * 100) : null;
      }
    }
    res.json(out);
  });

  return r;
}
