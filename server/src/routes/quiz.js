import { Router } from 'express';
import { quizPools } from '../data/quiz.js';
import { shuffle } from '../lib/game.js';
import { requirePlayer } from '../lib/auth.js';
import { answerLimiter } from '../lib/ratelimit.js';
import { buildProgress } from '../lib/progress.js';

const publicItem = ({ isPhishing, explanation, ...rest }) => rest;

export default function quizRouter(repo) {
  const r = Router();

  r.get('/quiz/:kind', (req, res) => {
    const pool = quizPools[req.params.kind];
    if (!pool) return res.status(404).json({ error: 'Quiz must be pre, post or retention' });
    res.json({ kind: req.params.kind, items: shuffle(pool).map(publicItem) });
  });

  r.post('/quiz/:kind/submit', requirePlayer, answerLimiter, async (req, res) => {
    const { kind } = req.params;
    const pool = quizPools[kind];
    if (!pool) return res.status(404).json({ error: 'Quiz must be pre, post or retention' });
    const player = await repo.getPlayer(req.playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const prog = await buildProgress(repo, player);
    if (kind === 'pre' && prog.preQuiz) return res.status(409).json({ error: 'Pre-game quiz already taken' });
    if (kind === 'post' && !prog.preQuiz) return res.status(403).json({ error: 'Take the pre-game quiz first' });
    if (kind === 'post' && !prog.postQuizUnlocked) return res.status(403).json({ error: prog.reading.required ? 'Finish the reading task first' : 'Finish at least one game round first' });
    if (kind === 'retention' && prog.retentionQuiz.taken) return res.status(409).json({ error: 'Retention quiz already taken' });
    if (kind === 'retention' && !prog.retentionQuiz.unlocked) return res.status(403).json({ error: 'The retention quiz is not open yet', unlocksAt: prog.retentionQuiz.unlocksAt });

    const given = new Map((Array.isArray(req.body?.answers) ? req.body.answers : []).map((a) => [a.itemId, a]));
    for (const item of pool) {
      const a = given.get(item.id);
      if (!a || !['phishing', 'legit'].includes(a.choice)) return res.status(400).json({ error: `Answer every item (missing ${item.id})` });
      if (![1, 2, 3, 4, 5].includes(Number(a.confidence))) return res.status(400).json({ error: `Rate your confidence (1-5) for every item (missing ${item.id})` });
    }
    const graded = pool.map((item) => {
      const a = given.get(item.id);
      return { itemId: item.id, choice: a.choice, confidence: Number(a.confidence), correct: (a.choice === 'phishing') === item.isPhishing };
    });
    const score = graded.filter((g) => g.correct).length;
    const attempt = await repo.addQuizAttempt({ playerId: player.id, kind, score, total: pool.length, answers: graded });
    const out = { attemptId: attempt.id, kind, score, total: pool.length, percent: Math.round((100 * score) / pool.length) };
    out.confidentlyWrong = graded.filter((g) => !g.correct && g.confidence >= 4).length;
    if (kind !== 'pre') {
      // Answers are revealed only after post/retention so the pre-test doesn't teach.
      out.review = pool.map((item) => ({ ...item, ...graded.find((g) => g.itemId === item.id) }));
      if (prog.preQuiz) {
        const prePct = (100 * prog.preQuiz.score) / prog.preQuiz.total;
        out.prePercent = Math.round(prePct);
        out.improvementPoints = Math.round(out.percent - prePct);
        out.improvementPercent = prePct > 0 ? Math.round(((out.percent - prePct) / prePct) * 100) : null;
      }
      if (kind === 'retention' && prog.postQuiz) out.postPercent = prog.postQuiz.percent;
    }
    res.json(out);
  });

  return r;
}
