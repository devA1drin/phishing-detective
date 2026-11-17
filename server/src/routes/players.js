import { Router } from 'express';
import { rankFor } from '../lib/game.js';
import { hashPin, checkHash } from '../lib/admins.js';
import { issuePlayerToken, requirePlayer } from '../lib/auth.js';
import { authLimiter } from '../lib/ratelimit.js';
import { buildProgress } from '../lib/progress.js';
import { evaluateBadges } from '../lib/badges.js';

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

  r.get('/players/me/badges', requirePlayer, async (req, res) => {
    const { badges, newly } = await evaluateBadges(repo, req.playerId);
    res.json({ badges, newly, earned: badges.filter((b) => b.earned).length });
  });

  // Join a class section with the code from your teacher (switching later is allowed)
  r.post('/players/me/section', requirePlayer, authLimiter, async (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!code) { await repo.setPlayerSection(req.playerId, null); return res.json({ section: null }); }
    const sec = await repo.getSectionByCode(code);
    if (!sec) return res.status(404).json({ error: 'No class has that join code. Check with your teacher.' });
    await repo.setPlayerSection(req.playerId, sec.id);
    res.json({ section: { id: sec.id, name: sec.name } });
  });

  // Class vs class: average points per active player (fair to class size), then accuracy
  r.get('/leaderboard/classes', async (_req, res) => {
    const rows = (await repo.classLeaderboard()).map((c) => ({
      id: c.id, name: c.name, members: c.members, activePlayers: c.active_players, totalScore: c.total_score,
      avgScore: c.active_players ? Math.round(c.total_score / c.active_players) : 0,
      accuracy: c.answered ? Math.round((1000 * c.correct) / c.answered) / 10 : null,
    })).sort((a, b) => b.avgScore - a.avgScore || (b.accuracy ?? 0) - (a.accuracy ?? 0));
    res.json(rows.map((c, i) => ({ ...c, place: i + 1 })));
  });

  r.get('/leaderboard', async (_req, res) => {
    const rows = await repo.leaderboard(10);
    res.json(rows.map((x) => ({ ...x, rank: rankFor(x.total_score) })));
  });

  return r;
}
