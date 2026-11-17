import crypto from 'node:crypto';
import { Router } from 'express';
import { issueAdminToken, requireAdmin } from '../lib/auth.js';
import { hashPassword, checkHash, validatePassword } from '../lib/admins.js';
import { authLimiter, aiLimiter } from '../lib/ratelimit.js';
import { aiStatus, generateScenario } from '../lib/ai.js';
import { randomBytes } from 'node:crypto';
import { toCsv } from '../lib/csv.js';
import { segmentBody, flagPartKeys } from '../lib/game.js';
import { groupComparison, confidenceStats, surveyStats, firstScores } from '../lib/analytics.js';
import { DEFAULT_SETTINGS } from '../db/repo.js';
import { adminScope, ScopeError } from '../lib/scope.js';
import { scopedData, buildStats, scenarioStatsFrom, studentReport, sectionRows, renderChapter4Pdf } from '../lib/reports.js';

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const USER_RE = /^[A-Za-z0-9_.-]{3,32}$/;

export function validateScenario(s, { partial = false } = {}) {
  const errors = [];
  if (!partial && !/^[a-z0-9-]{3,60}$/.test(s.id || '')) errors.push('id: 3-60 chars, lowercase letters, numbers, dashes');
  if (!['email', 'sms', 'social', 'call'].includes(s.channel)) errors.push('channel must be email, sms, social or call');
  if (![1, 2, 3].includes(Number(s.difficulty))) errors.push('difficulty must be 1, 2 or 3');
  if (typeof s.isPhishing !== 'boolean') errors.push('isPhishing must be true/false');
  if (!s.senderName || !s.senderAddress) errors.push('senderName and senderAddress are required');
  if (!s.body) errors.push('body is required');
  if (s.language !== undefined && !['en', 'tl', 'taglish'].includes(s.language)) errors.push('language must be en, tl or taglish');
  if (s.channel === 'call' && s.body && !/^(Caller|You):/m.test(s.body)) errors.push('call transcripts need lines starting with "Caller:" or "You:"');
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
  const anyAdmin = requireAdmin(repo);
  const superOnly = requireAdmin(repo, ['superadmin']);

  r.post('/admin/login', authLimiter, async (req, res) => {
    const admin = await repo.getAdminByUsername(String(req.body?.username || '').trim());
    if (!admin || !(await checkHash(req.body?.password, admin.password_hash))) return res.status(401).json({ error: 'Wrong username or password' });
    await repo.touchAdminLogin(admin.id);
    res.json({ token: issueAdminToken(admin), admin: { id: admin.id, username: admin.username, role: admin.role, displayName: admin.display_name } });
  });

  r.use('/admin', anyAdmin);
  r.get('/admin/me', (req, res) => res.json(req.admin));

  // Change own password
  r.put('/admin/me/password', authLimiter, async (req, res) => {
    const me = await repo.getAdmin(req.admin.id);
    if (!(await checkHash(req.body?.currentPassword, me.password_hash))) return res.status(401).json({ error: 'Current password is wrong' });
    const err = validatePassword(req.body?.newPassword);
    if (err) return res.status(400).json({ error: err });
    await repo.updateAdmin(me.id, { passwordHash: await hashPassword(req.body.newPassword) });
    res.json({ ok: true });
  });

  // ── admin accounts (superadmin) ──
  r.get('/admin/admins', superOnly, async (_req, res) => res.json(await repo.listAdmins()));
  r.post('/admin/admins', superOnly, async (req, res) => {
    const { username, password, role = 'educator', displayName } = req.body || {};
    if (!USER_RE.test(username || '')) return res.status(400).json({ error: 'Username: 3-32 letters, numbers, dot, dash or underscore' });
    if (!['superadmin', 'educator'].includes(role)) return res.status(400).json({ error: 'Role must be superadmin or educator' });
    const err = validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    if (await repo.getAdminByUsername(username)) return res.status(409).json({ error: 'Username already exists' });
    res.status(201).json(await repo.createAdmin({ username, passwordHash: await hashPassword(password), role, displayName }));
  });
  r.put('/admin/admins/:id', superOnly, async (req, res) => {
    const target = await repo.getAdmin(req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });
    const { password, role, displayName } = req.body || {};
    if (role && !['superadmin', 'educator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'educator' && target.role === 'superadmin') {
      const supers = (await repo.listAdmins()).filter((a) => a.role === 'superadmin');
      if (supers.length <= 1) return res.status(400).json({ error: 'Cannot demote the last superadmin' });
    }
    let passwordHash;
    if (password) {
      const err = validatePassword(password);
      if (err) return res.status(400).json({ error: err });
      passwordHash = await hashPassword(password);
    }
    res.json(await repo.updateAdmin(target.id, { passwordHash, role, displayName }));
  });
  r.delete('/admin/admins/:id', superOnly, async (req, res) => {
    const target = await repo.getAdmin(req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.id === req.admin.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    await repo.deleteAdmin(target.id);
    res.status(204).end();
  });

  // ── study settings (superadmin) ──
  r.get('/admin/settings', async (_req, res) => res.json(await repo.getSettings()));
  r.put('/admin/settings', superOnly, async (req, res) => {
    const b = req.body || {};
    const errors = [];
    if (b.controlRatio !== undefined && !(Number(b.controlRatio) >= 0 && Number(b.controlRatio) <= 1)) errors.push('controlRatio must be between 0 and 1');
    if (b.retentionDays !== undefined && !(Number.isInteger(Number(b.retentionDays)) && Number(b.retentionDays) >= 0 && Number(b.retentionDays) <= 365)) errors.push('retentionDays must be 0-365');
    if (b.minRoundsForPost !== undefined && !(Number.isInteger(Number(b.minRoundsForPost)) && Number(b.minRoundsForPost) >= 1 && Number(b.minRoundsForPost) <= 20)) errors.push('minRoundsForPost must be 1-20');
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (b[k] !== undefined) await repo.setSetting(k, Number(b[k]));
    res.json(await repo.getSettings());
  });

  // ── players ──
  const scopeOf = (req) => adminScope(repo, req.admin, req.query.section);
  const canSee = async (req, playerId) => (await adminScope(repo, req.admin)).has(playerId);

  r.get('/admin/players', async (req, res) => {
    const scope = await scopeOf(req);
    res.json((await repo.listPlayersWithStats()).filter((p) => scope.has(p.id)));
  });
  r.get('/admin/players/:id/report', async (req, res) => {
    if (!(await canSee(req, req.params.id))) return res.status(404).json({ error: 'Student not found in your classes' });
    const rep = await studentReport(repo, Number(req.params.id));
    rep ? res.json(rep) : res.status(404).json({ error: 'Not found' });
  });
  r.put('/admin/players/:id/group', async (req, res) => {
    if (!(await canSee(req, req.params.id))) return res.status(404).json({ error: 'Student not found in your classes' });
    const group = req.body?.group;
    if (!['control', 'experimental'].includes(group)) return res.status(400).json({ error: 'group must be control or experimental' });
    const p = await repo.setPlayerGroup(Number(req.params.id), group, 'admin');
    p ? res.json({ id: p.id, nickname: p.nickname, group: p.group_name, groupSource: p.group_source }) : res.status(404).json({ error: 'Not found' });
  });

  // Delete a player and all their rows (data-subject erasure under RA 10173; test clean-up)
  r.delete('/admin/players/:id', superOnly, async (req, res) => {
    (await repo.deletePlayer(Number(req.params.id))) ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  });

  r.get('/admin/stats', async (req, res) => {
    const d = await scopedData(repo, await scopeOf(req));
    res.json(buildStats(d, { settings: await repo.getSettings(), pendingScenarios: await repo.countPendingScenarios() }));
  });

  r.get('/admin/sessions', async (req, res) => {
    const scope = await scopeOf(req);
    const rows = (await repo.listSessions()).filter((x) => scope.has(x.playerId));
    res.json(rows.map(({ scenarioIds, ...s }) => ({ ...s, total: scenarioIds.length, accuracy: s.answered ? Math.round((100 * s.correct) / s.answered) : null })));
  });
  r.get('/admin/scenario-stats', async (req, res) => {
    const scope = await scopeOf(req);
    if (scope.all) return res.json(await repo.scenarioStats());
    res.json(scenarioStatsFrom(await repo.scenarioStats(), (await scopedData(repo, scope)).answers));
  });

  // ── Chapter 4 results (JSON + PDF), computed server-side for the admin's scope ──
  r.get('/admin/reports/chapter4', async (req, res) => res.json(buildStats(await scopedData(repo, await scopeOf(req)))));
  r.get('/admin/reports/chapter4.pdf', async (req, res) => {
    const stats = buildStats(await scopedData(repo, await scopeOf(req)));
    const generatedAt = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="phishing-detective-chapter4${req.query.section ? `-section-${Number(req.query.section)}` : ''}.pdf"`);
    renderChapter4Pdf(stats, { generatedAt, generatedBy: req.admin.username }, res);
  });

  // CSV export
  r.get('/admin/export/:kind', async (req, res) => {
    const kind = req.params.kind.replace(/\.csv$/, '');
    const scope = await scopeOf(req);
    const d = await scopedData(repo, scope);
    let rows;
    if (kind === 'players') rows = d.players;
    else if (kind === 'sessions') rows = d.sessions.map(({ scenarioIds, ...s }) => ({ ...s, scenarioIds: scenarioIds.join(' ') }));
    else if (kind === 'answers') rows = d.answers;
    else if (kind === 'quiz') rows = d.attempts.map(({ answers, ...a }) => ({ ...a, percent: round1((100 * a.score) / a.total), confidently_wrong: (answers || []).filter((x) => !x.correct && x.confidence >= 4).length, answers }));
    else if (kind === 'quiz-items') rows = d.attempts.flatMap((a) => (a.answers || []).map((x) => ({ attempt_id: a.id, nickname: a.nickname, group_name: a.group_name, kind: a.kind, item_id: x.itemId, choice: x.choice, confidence: x.confidence, correct: x.correct, confidently_wrong: !x.correct && x.confidence >= 4, created_at: a.created_at })));
    else if (kind === 'surveys') rows = d.surveys.map(({ answers, ...s }) => ({ ...s, ...(Array.isArray(answers) ? Object.fromEntries(answers.map((v, i) => [`sus_q${i + 1}`, v])) : answers) }));
    else if (kind === 'scenarios') rows = scope.all ? await repo.scenarioStats() : scenarioStatsFrom(await repo.scenarioStats(), d.answers);
    else if (kind === 'students') rows = sectionRows(d);
    else if (kind === 'categories') rows = d.categories.map((c) => ({ ...c, miss_rate: c.seen ? round1((100 * c.missed) / c.seen) : null }));
    else return res.status(404).json({ error: 'Unknown export' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="phishing-detective-${kind}.csv"`);
    res.send(toCsv(rows));
  });

  // ── AI scenario generator (drafts need educator approval) ──
  r.get('/admin/ai/status', async (_req, res) => res.json({ ...aiStatus(), pending: await repo.countPendingScenarios() }));
  r.post('/admin/ai/generate', aiLimiter, async (req, res) => {
    const b = req.body || {};
    const opts = {
      channel: ['email', 'sms', 'social', 'call'].includes(b.channel) ? b.channel : 'sms',
      difficulty: [1, 2, 3].includes(Number(b.difficulty)) ? Number(b.difficulty) : 2,
      isPhishing: b.isPhishing !== false,
      language: ['en', 'tl', 'taglish'].includes(b.language) ? b.language : 'en',
      topic: String(b.topic || '').slice(0, 200),
    };
    const count = Math.min(Math.max(Number(b.count) || 1, 1), 3);
    const st = aiStatus();
    if (!st.enabled) return res.status(503).json({ error: st.reason, ai: st });
    const drafts = [];
    try {
      for (let i = 0; i < count; i++) {
        const { scenario, model } = await generateScenario(opts);
        const id = `ai-${opts.channel}-${randomBytes(3).toString('hex')}`;
        const draft = { ...scenario, id, active: false, status: 'pending', source: 'ai', aiModel: model, createdBy: req.admin.id };
        const saved = await repo.createScenario(draft);
        drafts.push({ ...saved, validationErrors: validateScenario(saved, { partial: true }) });
      }
    } catch (e) {
      if (!drafts.length) return res.status(e.status || 502).json({ error: e.message, ai: aiStatus() });
    }
    res.status(201).json({ drafts });
  });
  r.post('/admin/scenarios/:id/review', async (req, res) => {
    const status = req.body?.status;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
    const s = await repo.getScenario(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (status === 'approved') {
      const errors = validateScenario(s, { partial: true });
      if (errors.length) return res.status(400).json({ error: 'Fix these before approving', details: errors });
    }
    res.json(await repo.reviewScenario(s.id, status, req.admin.id));
  });

  // Scenario CRUD
  r.get('/admin/scenarios', async (req, res) => res.json(await repo.listScenarios({ status: ['approved', 'pending', 'rejected'].includes(req.query.status) ? req.query.status : undefined })));
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
  // ── class sections (join codes) ──
  const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const joinCode = () => [...crypto.randomBytes(6)].map((b) => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join('');
  r.get('/admin/sections', async (req, res) => res.json((await adminScope(repo, req.admin)).sections));
  r.get('/admin/sections/:id/report', async (req, res) => {
    const scope = await adminScope(repo, req.admin, req.params.id);
    const d = await scopedData(repo, scope);
    const stats = buildStats(d);
    res.json({ section: scope.chosen[0], students: sectionRows(d), categories: stats.categories, quiz: stats.quiz, groups: stats.groups, accuracy: stats.accuracy, rounds: stats.sessions });
  });
  r.post('/admin/sections', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Section name must be 2-60 characters.' });
    if ((await repo.listSections()).some((x) => x.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'A section with that name already exists.' });
    for (let i = 0; i < 5; i++) {
      try { return res.status(201).json(await repo.createSection({ name, joinCode: joinCode(), ownerAdminId: req.admin.id })); } catch (e) { if (!/unique|duplicate/i.test(e.message)) throw e; }
    }
    res.status(500).json({ error: 'Could not create a unique join code, try again.' });
  });

  r.delete('/admin/sections/:id', async (req, res) => {
    const sec = await repo.getSection(req.params.id);
    if (!sec) return res.status(404).json({ error: 'Not found' });
    if (req.admin.role !== 'superadmin' && sec.owner_admin_id !== req.admin.id) return res.status(403).json({ error: 'Only the section owner or a super admin can delete it' });
    await repo.deleteSection(sec.id); // students stay; they just leave the section
    res.status(204).end();
  });

  r.delete('/admin/scenarios/:id', superOnly, async (req, res) => {
    (await repo.deleteScenario(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  });

  return r;
}
