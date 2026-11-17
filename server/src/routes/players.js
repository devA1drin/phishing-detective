import { Router } from 'express';
import { unlockedLevels, rankFor, MAX_LEVEL, UNLOCK_ACCURACY } from '../lib/game.js';

const NICK_RE = /^[A-Za-z0-9_.-]{3,24}$/;

export default function playersRouter(repo) {
  const r = Router();

  // Register or resume with a nickname / student ID. No personal data is collected.
  r.post('/players', async (req, res) => {
    const nickname = String(req.body?.nickname || '').trim();
    if (!NICK_RE.test(nickname)) {
      return res.status(400).json({ error: 'Use 3-24 letters, numbers, dot, dash or underscore (a nickname or student ID, not your real name).' });
    }
    const p = await repo.findOrCreatePlayer(nickname);
    res.status(p.isNew ? 201 : 200).json({ id: p.id, nickname: p.nickname, isNew: p.isNew, createdAt: p.created_at });
  });

  r.get('/players/:id/progress', async (req, res) => {
    const player = await repo.getPlayer(Number(req.params.id));
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const sessions = await repo.listPlayerSessions(player.id);
    const quizzes = await repo.listPlayerQuizAttempts(player.id);
    const finished = sessions.filter((s) => s.finishedAt);
    const totalScore = finished.reduce((a, s) => a + s.score, 0);
    const answered = finished.reduce((a, s) => a + s.answered, 0);
    const correct = finished.reduce((a, s) => a + s.correct, 0);
    const pre = quizzes.find((q) => q.kind === 'pre');
    const post = quizzes.filter((q) => q.kind === 'post');
    res.json({
      player: { id: player.id, nickname: player.nickname },
      unlockedLevel: unlockedLevels(sessions), maxLevel: MAX_LEVEL, unlockAccuracy: UNLOCK_ACCURACY,
      totalScore, rank: rankFor(totalScore), roundsPlayed: finished.length,
      accuracy: answered ? Math.round((100 * correct) / answered) : null,
      bestStreak: finished.reduce((a, s) => Math.max(a, s.maxStreak), 0),
      levelBest: [1, 2, 3].map((lvl) => {
        const ls = finished.filter((s) => s.level === lvl && s.answered);
        return { level: lvl, bestAccuracy: ls.length ? Math.max(...ls.map((s) => Math.round((100 * s.correct) / s.answered))) : null, bestScore: ls.length ? Math.max(...ls.map((s) => s.score)) : null };
      }),
      preQuiz: pre ? { score: pre.score, total: pre.total, percent: Math.round((100 * pre.score) / pre.total) } : null,
      postQuiz: post.length ? { score: post[0].score, total: post[0].total, percent: Math.round((100 * post[0].score) / post[0].total), attempts: post.length } : null,
      postQuizUnlocked: !!pre && finished.length >= 1,
    });
  });

  r.get('/leaderboard', async (_req, res) => {
    const rows = await repo.leaderboard(10);
    res.json(rows.map((r) => ({ ...r, rank: rankFor(r.total_score) })));
  });

  return r;
}
