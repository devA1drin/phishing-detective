import { Router } from 'express';
import { SUS_ITEMS, ISO_ITEMS, susScore, susGrade } from '../data/surveys.js';
import { requirePlayer } from '../lib/auth.js';
import { buildProgress } from '../lib/progress.js';

export default function surveysRouter(repo) {
  const r = Router();
  r.get('/surveys/items', (_req, res) => res.json({ sus: SUS_ITEMS, iso25010: ISO_ITEMS }));

  r.post('/surveys/:kind', requirePlayer, async (req, res) => {
    const { kind } = req.params;
    if (!['sus', 'iso25010'].includes(kind)) return res.status(404).json({ error: 'Unknown survey' });
    const player = await repo.getPlayer(req.playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const prog = await buildProgress(repo, player);
    if (!prog.surveys.unlocked) return res.status(403).json({ error: 'Surveys open after the post-game quiz' });
    if (prog.surveys[kind]) return res.status(409).json({ error: 'Already submitted, thank you!' });
    let answers, score;
    if (kind === 'sus') {
      answers = (req.body?.answers || []).map(Number);
      score = susScore(answers);
      if (score == null) return res.status(400).json({ error: 'Answer all 10 SUS items (1-5)' });
    } else {
      const raw = req.body?.answers || {};
      answers = {};
      for (const item of ISO_ITEMS) {
        const v = Number(raw[item.id]);
        if (![1, 2, 3, 4, 5].includes(v)) return res.status(400).json({ error: `Answer every item (missing ${item.id})` });
        answers[item.id] = v;
      }
      score = Object.values(answers).reduce((a, b) => a + b, 0) / ISO_ITEMS.length;
    }
    await repo.addSurvey({ playerId: player.id, kind, answers, score });
    res.status(201).json({ kind, score, ...(kind === 'sus' ? { grade: susGrade(score) } : {}) });
  });
  return r;
}
