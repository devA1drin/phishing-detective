import { Router } from 'express';
import { rankFor } from '../lib/game.js';
import { hashPin, checkHash } from '../lib/admins.js';
import { issuePlayerToken, requirePlayer } from '../lib/auth.js';
import { authLimiter } from '../lib/ratelimit.js';
import { buildProgress } from '../lib/progress.js';

const NICK_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const PIN_RE = /^\d{4,6}$/;
export const CONSENT_VERSION = 'RA10173-v1';

export default function playersRouter(repo) {
  const r = Router();
  const pub = (p) => ({ id: p.id, nickname: p.nickname, group: p.group_name });

  // Register: nickname/student ID + 4-6 digit PIN + Data Privacy Act consent. No personal data collected.
  r.post('/players/register', authLimiter, async (req, res) => {
    const nickname = String(req.body?.nickname || '').trim();
    const pin = String(req.body?.pin || '');
    if (req.body?.consent !== true) return res.status(400).json({ error: 'You must agree to the data privacy consent to join the study.' });
    if (!NICK_RE.test(nickname)) return res.status(400).json({ error: 'Use 3-24 letters, numbers, dot, dash or underscore (a nickname or student ID, not your real name).' });
    if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    if (await repo.findPlayerByNickname(nickname)) return res.status(409).json({ error: 'That detective ID is taken. Sign in with your PIN or pick another ID.' });
    const settings = await repo.getSettings();
    const groupName = Math.random() < Number(settings.controlRatio) ? 'control' : 'experimental';
    try {
      const p = await repo.createPlayer({ nickname, pinHash: await hashPin(pin), groupName, groupSource: 'random', consentVersion: CONSENT_VERSION });
      res.status(201).json({ token: issuePlayerToken(p.id), player: pub(p) });
    } catch (e) {
      if (/unique|duplicate/i.test(e.message)) return res.status(409).json({ error: 'That detective ID is taken.' });
      throw e;
    }
  });

  // Sign in with nickname + PIN. Legacy players without a PIN set one on first sign-in.
  r.post('/players/login', authLimiter, async (req, res) => {
    const nickname = String(req.body?.nickname || '').trim();
    const pin = String(req.body?.pin || '');
    const p = nickname ? await repo.findPlayerByNickname(nickname) : null;
    if (!p) return res.status(401).json({ error: 'Wrong detective ID or PIN.' });
    if (!p.pin_hash) {
      if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'This ID has no PIN yet. Choose a 4-6 digit PIN to secure it.' });
      await repo.setPlayerPin(p.id, await hashPin(pin));
    } else if (!(await checkHash(pin, p.pin_hash))) {
      return res.status(401).json({ error: 'Wrong detective ID or PIN.' });
    }
    res.json({ token: issuePlayerToken(p.id), player: pub(p) });
  });

  r.get('/players/me/progress', requirePlayer, async (req, res) => {
    const player = await repo.getPlayer(req.playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json(await buildProgress(repo, player));
  });

  // Control group's neutral reading task
  r.post('/players/me/reading-done', requirePlayer, async (req, res) => {
    await repo.markReadingDone(req.playerId);
    res.json({ ok: true });
  });

  r.get('/leaderboard', async (_req, res) => {
    const rows = await repo.leaderboard(10);
    res.json(rows.map((x) => ({ ...x, rank: rankFor(x.total_score) })));
  });

  return r;
}
