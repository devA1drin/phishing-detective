import { Router } from 'express';
import { checkPassword, issueToken, requireAdmin } from '../lib/auth.js';
import { toCsv } from '../lib/csv.js';
import { segmentBody, flagPartKeys } from '../lib/game.js';

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

function validateScenario(s, { partial = false } = {}) {
  const errors = [];
  if (!partial && !/^[a-z0-9-]{3,60}$/.test(s.id || '')) errors.push('id: 3-60 chars, lowercase letters, numbers, dashes');
  if (!['email', 'sms', 'social'].includes(s.channel)) errors.push('channel must be email, sms or social');
  if (![1, 2, 3].includes(Number(s.difficulty))) errors.push('difficulty must be 1, 2 or 3');
  if (typeof s.isPhishing !== 'boolean') errors.push('isPhishing must be true/false');
  if (!s.senderName || !s.senderAddress) errors.push('senderName and senderAddress are required');
  if (!s.body) errors.push('body is required');
  for (const k of ['links', 'attachments', 'redFlags', 'safeSigns']) if (s[k] !== undefined && !Array.isArray(s[k])) errors.push(`${k} must be an array`);
  if (!errors.length) {
    const keys = flagPartKeys(s, segmentBody(s));
    (s.redFlags || []).forEach((f, i) => {
      if (!['sender', 'subject', 'body', 'link', 'attachment'].includes(f.target)) errors.push(`redFlags[${i}].target invalid`);
      else if (!keys[i]) errors.push(`redFlags[${i}] does not match any part of the message (check "match" text or index)`);
      if (!f.label) errors.push(`redFlags[${i}].label is required`);
    });
  }
  return errors;
}

export default function adminRouter(repo) {
  const r = Router();

  r.post('/admin/login', (req, res) => {
    if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password' });
    res.json({ token: issueToken() });
  });

  r.use('/admin', requireAdmin);

  r.get('/admin/stats', async (_req, res) => {
    const o = await repo.overview();
    const improvementPercent = o.pairedAvgPre ? ((o.pairedAvgPost - o.pairedAvgPre) / o.pairedAvgPre) * 100 : null;
    res.json({
      players: o.players, sessions: o.sessions, startedSessions: o.startedSessions, answers: o.answers,
      accuracy: round1(o.accuracy), avgTimeSec: o.avgTimeMs ? round1(o.avgTimeMs / 1000) : null,
      quiz: {
        preCount: o.preCount, postCount: o.postCount, avgPre: round1(o.avgPre), avgPost: round1(o.avgPost),
        pairedCount: o.pairedCount, pairedAvgPre: round1(o.pairedAvgPre), pairedAvgPost: round1(o.pairedAvgPost),
        improvementPoints: o.pairedCount ? round1(o.pairedAvgPost - o.pairedAvgPre) : null,
        improvementPercent: round1(improvementPercent),
        targetMet: improvementPercent != null ? improvementPercent >= 20 : null,
        playersImprovedBy20: o.improvedBy20,
      },
      byLevel: o.byLevel, byChannel: o.byChannel,
    });
  });

  r.get('/admin/players', async (_req, res) => res.json(await repo.listPlayersWithStats()));
  r.get('/admin/sessions', async (_req, res) => {
    const rows = await repo.listSessions();
    res.json(rows.map(({ scenarioIds, ...s }) => ({ ...s, total: scenarioIds.length, accuracy: s.answered ? Math.round((100 * s.correct) / s.answered) : null })));
  });
  r.get('/admin/scenario-stats', async (_req, res) => res.json(await repo.scenarioStats()));

  // CSV export: players | sessions | answers | quiz | scenarios
  r.get('/admin/export/:kind', async (req, res) => {
    const kind = req.params.kind.replace(/\.csv$/, '');
    let rows;
    if (kind === 'players') rows = await repo.listPlayersWithStats();
    else if (kind === 'sessions') rows = (await repo.listSessions()).map(({ scenarioIds, ...s }) => ({ ...s, scenarioIds: scenarioIds.join(' ') }));
    else if (kind === 'answers') rows = await repo.listAnswersExport();
    else if (kind === 'quiz') rows = await repo.listQuizAttempts();
    else if (kind === 'scenarios') rows = await repo.scenarioStats();
    else return res.status(404).json({ error: 'Unknown export' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="phishing-detective-${kind}.csv"`);
    res.send(toCsv(rows));
  });

  // Scenario CRUD
  r.get('/admin/scenarios', async (_req, res) => res.json(await repo.listScenarios()));
  r.get('/admin/scenarios/:id', async (req, res) => {
    const s = await repo.getScenario(req.params.id);
    s ? res.json(s) : res.status(404).json({ error: 'Not found' });
  });
  r.post('/admin/scenarios', async (req, res) => {
    const s = req.body || {};
    const errors = validateScenario(s);
    if (errors.length) return res.status(400).json({ error: 'Invalid scenario', details: errors });
    if (await repo.getScenario(s.id)) return res.status(409).json({ error: 'A scenario with this id already exists' });
    res.status(201).json(await repo.createScenario(s));
  });
  r.put('/admin/scenarios/:id', async (req, res) => {
    const s = { ...req.body, id: req.params.id };
    const errors = validateScenario(s, { partial: true });
    if (errors.length) return res.status(400).json({ error: 'Invalid scenario', details: errors });
    const updated = await repo.updateScenario(req.params.id, s);
    updated ? res.json(updated) : res.status(404).json({ error: 'Not found' });
  });
  r.delete('/admin/scenarios/:id', async (req, res) => {
    (await repo.deleteScenario(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  });

  return r;
}
