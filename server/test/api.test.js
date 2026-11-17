// Integration tests: node --test. In-memory SQLite by default; Postgres when DATABASE_URL is set
// (npm run test:pg runs them against PGlite with the real supabase/migrations applied).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, uniq } from './helpers.js';

process.env.RATE_LIMIT = 'off';
const { scenarios } = await import('../src/data/scenarios.js');
const { flagPartKeys } = await import('../src/lib/game.js');
const { quizPools } = await import('../src/data/quiz.js');

let h, j, admin;
before(async () => {
  h = await boot(); j = h.j;
  admin = (await j('POST', '/admin/login', { username: 'root', password: 'test-pass-1234' })).body.token;
});
after(() => h.close());

const truth = (kind, id) => quizPools[kind].find((q) => q.id === id).isPhishing;
const answerAll = (kind, items, correct = true, confidence = 3) => items.map((i) => ({ itemId: i.id, choice: (truth(kind, i.id) === correct) ? 'phishing' : 'legit', confidence }));
const register = async (prefix, group) => {
  const r = await j('POST', '/players/register', { nickname: uniq(prefix), pin: '1234', consent: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (group) await j('PUT', `/admin/players/${r.body.player.id}/group`, { group }, admin);
  return r.body;
};

test('health reports the active driver', async () => {
  const r = await j('GET', '/health');
  assert.equal(r.body.ok, true);
  assert.equal(r.body.db, process.env.DATABASE_URL ? 'postgres' : 'sqlite');
  console.log(`# using ${r.body.db} driver`);
});

test('scenario bank is valid', () => {
  assert.ok(scenarios.length >= 40);
  for (const s of scenarios) assert.ok(!flagPartKeys(s).includes(null), `flag mapping broken in ${s.id}`);
});

test('registration requires consent, valid ID and PIN; login checks PIN', async () => {
  const nick = uniq('reg');
  assert.equal((await j('POST', '/players/register', { nickname: nick, pin: '1234' })).status, 400, 'consent required');
  assert.equal((await j('POST', '/players/register', { nickname: 'Juan Dela Cruz!', pin: '1234', consent: true })).status, 400);
  assert.equal((await j('POST', '/players/register', { nickname: nick, pin: '12', consent: true })).status, 400);
  const ok = await j('POST', '/players/register', { nickname: nick, pin: '123456', consent: true });
  assert.equal(ok.status, 201);
  assert.ok(['control', 'experimental'].includes(ok.body.player.group));
  assert.equal((await j('POST', '/players/register', { nickname: nick.toUpperCase(), pin: '123456', consent: true })).status, 409, 'nickname unique (case-insensitive)');
  assert.equal((await j('POST', '/players/login', { nickname: nick, pin: '000000' })).status, 401);
  const login = await j('POST', '/players/login', { nickname: nick, pin: '123456' });
  assert.equal(login.status, 200);
  const prog = await j('GET', '/players/me/progress', null, login.body.token);
  assert.equal(prog.body.player.nickname, nick);
  assert.ok(prog.body.player.consentAt, 'consent timestamp stored');
  assert.equal((await j('GET', '/players/me/progress')).status, 401, 'token required');
  assert.equal((await j('GET', '/players/me/progress', null, 'forged.token')).status, 401);
});

test('experimental flow: pre → round → post (confidence) → retention → surveys → stats', async () => {
  const { token, player } = await register('exp', 'experimental');
  const pre = await j('GET', '/quiz/pre');
  assert.equal(pre.body.items.length, 10);
  assert.equal(pre.body.items[0].isPhishing, undefined, 'answers must not leak');
  assert.equal((await j('POST', '/quiz/pre/submit', { answers: answerAll('pre', pre.body.items) })).status, 401);
  const noConf = answerAll('pre', pre.body.items).map(({ confidence, ...a }) => a);
  assert.equal((await j('POST', '/quiz/pre/submit', { answers: noConf }, token)).status, 400, 'confidence required');
  // half right, all at confidence 5 → 5 confidently wrong
  const half = pre.body.items.map((i, n) => ({ itemId: i.id, choice: (truth('pre', i.id) === (n < 5)) ? 'phishing' : 'legit', confidence: 5 }));
  const preSub = await j('POST', '/quiz/pre/submit', { answers: half }, token);
  assert.equal(preSub.status, 200);
  assert.equal(preSub.body.percent, 50);
  assert.equal(preSub.body.confidentlyWrong, 5);
  assert.equal(preSub.body.review, undefined);
  assert.equal((await j('POST', '/quiz/pre/submit', { answers: half }, token)).status, 409);
  assert.equal((await j('POST', '/quiz/post/submit', { answers: [] }, token)).status, 403);

  assert.equal((await j('POST', '/sessions', { level: 3 }, token)).status, 403);
  const sess = await j('POST', '/sessions', { level: 1 }, token);
  assert.equal(sess.status, 201);
  assert.equal(sess.body.scenarios.length, 8);
  const other = await register('intruder', 'experimental');
  assert.equal((await j('POST', `/sessions/${sess.body.sessionId}/answers`, { scenarioId: sess.body.scenarios[0].id, choice: 'legit', timeMs: 1 }, other.token)).status, 404, 'cannot answer someone else\'s session');
  for (const sc of sess.body.scenarios) {
    assert.equal(sc.isPhishing, undefined);
    const t = scenarios.find((s) => s.id === sc.id);
    const keys = flagPartKeys(t);
    const r = await j('POST', `/sessions/${sess.body.sessionId}/answers`, { scenarioId: sc.id, choice: t.isPhishing ? 'phishing' : 'legit', timeMs: 5000, clickedParts: keys }, token);
    assert.equal(r.status, 200);
    assert.equal(r.body.isCorrect, true);
  }
  const fin = await j('POST', `/sessions/${sess.body.sessionId}/finish`, null, token);
  assert.equal(fin.body.accuracy, 100);
  assert.equal(fin.body.newlyUnlocked, 2);

  const post = await j('GET', '/quiz/post');
  const postSub = await j('POST', '/quiz/post/submit', { answers: answerAll('post', post.body.items, true, 4) }, token);
  assert.equal(postSub.body.percent, 100);
  assert.equal(postSub.body.review.length, 10);
  assert.equal(postSub.body.improvementPoints, 50);

  // retention locked until N days; set to 0 days via settings (superadmin)
  let prog = (await j('GET', '/players/me/progress', null, token)).body;
  assert.equal(prog.retentionQuiz.unlocked, false);
  assert.ok(prog.retentionQuiz.unlocksAt);
  assert.equal((await j('POST', '/quiz/retention/submit', { answers: [] }, token)).status, 403);
  assert.equal((await j('PUT', '/admin/settings', { retentionDays: 0 }, admin)).status, 200);
  prog = (await j('GET', '/players/me/progress', null, token)).body;
  assert.equal(prog.retentionQuiz.unlocked, true);
  const ret = await j('GET', '/quiz/retention');
  assert.equal(ret.body.items.length, 10);
  const retSub = await j('POST', '/quiz/retention/submit', { answers: answerAll('retention', ret.body.items, true, 4) }, token);
  assert.equal(retSub.status, 200);
  assert.equal(retSub.body.percent, 100);
  assert.equal((await j('POST', '/quiz/retention/submit', { answers: answerAll('retention', ret.body.items) }, token)).status, 409);

  // surveys
  const items = (await j('GET', '/surveys/items')).body;
  assert.equal(items.sus.length, 10);
  assert.ok(items.iso25010.length >= 8);
  assert.equal((await j('POST', '/surveys/sus', { answers: [5, 1, 5] }, token)).status, 400);
  const sus = await j('POST', '/surveys/sus', { answers: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1] }, token);
  assert.equal(sus.status, 201);
  assert.equal(sus.body.score, 100);
  assert.equal((await j('POST', '/surveys/sus', { answers: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1] }, token)).status, 409);
  const iso = await j('POST', '/surveys/iso25010', { answers: Object.fromEntries(items.iso25010.map((i) => [i.id, 4])) }, token);
  assert.equal(iso.status, 201);
  assert.equal(iso.body.score, 4);

  const stats = (await j('GET', '/admin/stats', null, admin)).body;
  assert.ok(stats.groups.experimental.pairedCount >= 1);
  assert.ok(stats.confidence.byKind.pre.confidentlyWrong >= 5);
  assert.equal(stats.surveys.sus.n, 1);
  assert.equal(stats.surveys.sus.mean, 100);
  assert.ok(stats.surveys.iso25010.characteristics.length === 8);
  const csv = await j('GET', '/admin/export/surveys', null, admin);
  assert.match(csv.body, /sus_q1/);
  const qi = await j('GET', '/admin/export/quiz-items', null, admin);
  assert.match(qi.body, /confidently_wrong/);
  await j('PUT', '/admin/settings', { retentionDays: 14 }, admin);
  void player;
});

test('control group: no gameplay, reading task unlocks post-quiz, play after retention', async () => {
  const { token } = await register('ctl', 'control');
  const pre = await j('GET', '/quiz/pre');
  await j('POST', '/quiz/pre/submit', { answers: answerAll('pre', pre.body.items) }, token);
  let prog = (await j('GET', '/players/me/progress', null, token)).body;
  assert.equal(prog.player.group, 'control');
  assert.equal(prog.canPlay, false);
  assert.equal(prog.reading.required, true);
  assert.equal((await j('POST', '/sessions', { level: 1 }, token)).status, 403);
  assert.equal((await j('POST', '/quiz/post/submit', { answers: [] }, token)).status, 403);
  await j('POST', '/players/me/reading-done', null, token);
  const post = await j('GET', '/quiz/post');
  assert.equal((await j('POST', '/quiz/post/submit', { answers: answerAll('post', post.body.items) }, token)).status, 200);
  prog = (await j('GET', '/players/me/progress', null, token)).body;
  assert.equal(prog.surveys.unlocked, false, 'surveys are for players who used the game');
  const stats = (await j('GET', '/admin/stats', null, admin)).body;
  assert.ok(stats.groups.control.pairedCount >= 1);
});

test('admin accounts: roles, password rules, settings, group override', async () => {
  assert.equal((await j('GET', '/admin/stats')).status, 401);
  assert.equal((await j('POST', '/admin/login', { username: 'root', password: 'nope' })).status, 401);
  assert.equal((await j('POST', '/admin/admins', { username: 'teach1', password: 'short', role: 'educator' }, admin)).status, 400);
  const created = await j('POST', '/admin/admins', { username: 'teach1', password: 'Educator-pass-99', role: 'educator', displayName: 'Ma\'am Reyes' }, admin);
  assert.equal(created.status, 201);
  assert.equal(created.body.password_hash, undefined);
  const edu = (await j('POST', '/admin/login', { username: 'TEACH1', password: 'Educator-pass-99' })).body;
  assert.equal(edu.admin.role, 'educator');
  assert.equal((await j('GET', '/admin/stats', null, edu.token)).status, 200);
  assert.equal((await j('GET', '/admin/admins', null, edu.token)).status, 403);
  assert.equal((await j('PUT', '/admin/settings', { controlRatio: 0 }, edu.token)).status, 403);
  assert.equal((await j('PUT', '/admin/settings', { controlRatio: 2 }, admin)).status, 400);
  // ratio 1 → everyone control; ratio 0 → everyone experimental
  await j('PUT', '/admin/settings', { controlRatio: 1 }, admin);
  assert.equal((await register('allctl')).player.group, 'control');
  await j('PUT', '/admin/settings', { controlRatio: 0 }, admin);
  const p = await register('allexp');
  assert.equal(p.player.group, 'experimental');
  await j('PUT', '/admin/settings', { controlRatio: 0.5 }, admin);
  assert.equal((await j('PUT', `/admin/players/${p.player.id}/group`, { group: 'control' }, edu.token)).status, 404, 'educators only manage students in their own sections');
  const ov = await j('PUT', `/admin/players/${p.player.id}/group`, { group: 'control' }, admin);
  assert.equal(ov.body.group, 'control');
  assert.equal(ov.body.groupSource, 'admin');
  const me = (await j('GET', '/admin/me', null, admin)).body;
  assert.equal((await j('DELETE', `/admin/admins/${me.id}`, null, admin)).status, 400, 'cannot delete self');
  assert.equal((await j('DELETE', `/admin/admins/${created.body.id}`, null, admin)).status, 204);
  assert.equal((await j('GET', '/admin/stats', null, edu.token)).status, 401, 'deleted account token is dead');
});

test('admin scenario CRUD with validation', async () => {
  const bad = await j('POST', '/admin/scenarios', { id: 'x' }, admin);
  assert.equal(bad.status, 400);
  const s = { id: 'test-sms', channel: 'sms', difficulty: 1, isPhishing: true, senderName: '+639000000000', senderAddress: '+639000000000', body: 'Claim your prize now at {{link:0}}', links: [{ text: 'prize.example', href: 'http://prize.example' }], redFlags: [{ target: 'link', index: 0, label: 'Fake link' }], explanation: 'Test' };
  assert.equal((await j('POST', '/admin/scenarios', s, admin)).status, 201);
  const upd = await j('PUT', '/admin/scenarios/test-sms', { ...s, difficulty: 2 }, admin);
  assert.equal(upd.body.difficulty, 2);
  assert.equal((await j('PUT', '/admin/scenarios/test-sms', { ...s, redFlags: [{ target: 'body', match: 'not in body', label: 'x' }] }, admin)).status, 400);
  assert.equal((await j('DELETE', '/admin/scenarios/test-sms', null, admin)).status, 204);
});
