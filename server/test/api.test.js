// Integration tests: node --test (uses an in-memory SQLite DB)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'test-pass';
const { createApp } = await import('../src/index.js');
const { scenarios } = await import('../src/data/scenarios.js');
const { flagPartKeys } = await import('../src/lib/game.js');

let server, base;
before(async () => {
  const app = await createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const j = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
};

test('health reports the active driver', async () => {
  const h = await j('GET', '/health');
  assert.equal(h.body.ok, true);
  assert.equal(h.body.db, process.env.DATABASE_URL ? 'postgres' : 'sqlite');
  console.log(`# using ${h.body.db} driver`);
});

test('scenario bank is valid', () => {
  assert.ok(scenarios.length >= 40);
  for (const s of scenarios) assert.ok(!flagPartKeys(s).includes(null), `flag mapping broken in ${s.id}`);
});

test('full player flow: register → pre-quiz → round → post-quiz → admin stats', async () => {
  const reg = await j('POST', '/players', { nickname: 'tester_01' });
  assert.equal(reg.status, 201);
  const pid = reg.body.id;
  assert.equal((await j('POST', '/players', { nickname: 'Juan Dela Cruz!' })).status, 400);

  const pre = await j('GET', '/quiz/pre');
  assert.equal(pre.body.items.length, 10);
  assert.equal(pre.body.items[0].isPhishing, undefined, 'answers must not leak');
  const preSub = await j('POST', '/quiz/pre/submit', { playerId: pid, answers: pre.body.items.slice(0, 5).map((i) => ({ itemId: i.id, choice: 'phishing' })) });
  assert.equal(preSub.status, 200);
  assert.equal(preSub.body.review, undefined);
  assert.equal((await j('POST', '/quiz/post/submit', { playerId: pid, answers: [] })).status, 403);

  assert.equal((await j('POST', '/sessions', { playerId: pid, level: 3 })).status, 403);
  const sess = await j('POST', '/sessions', { playerId: pid, level: 1 });
  assert.equal(sess.status, 201);
  assert.equal(sess.body.scenarios.length, 8);
  for (const sc of sess.body.scenarios) {
    assert.equal(sc.isPhishing, undefined);
    const truth = scenarios.find((s) => s.id === sc.id);
    const keys = flagPartKeys(truth);
    const r = await j('POST', `/sessions/${sess.body.sessionId}/answers`, { scenarioId: sc.id, choice: truth.isPhishing ? 'phishing' : 'legit', timeMs: 5000, clickedParts: keys });
    assert.equal(r.status, 200);
    assert.equal(r.body.isCorrect, true);
    assert.equal(r.body.flagsFound, keys.length);
  }
  const fin = await j('POST', `/sessions/${sess.body.sessionId}/finish`);
  assert.equal(fin.body.accuracy, 100);
  assert.equal(fin.body.newlyUnlocked, 2);

  const post = await j('GET', '/quiz/post');
  const { quizPools } = await import('../src/data/quiz.js');
  const postSub = await j('POST', '/quiz/post/submit', { playerId: pid, answers: post.body.items.map((i) => ({ itemId: i.id, choice: quizPools.post.find((q) => q.id === i.id).isPhishing ? 'phishing' : 'legit' })) });
  assert.equal(postSub.body.percent, 100);
  assert.ok(postSub.body.review.length === 10);

  assert.equal((await j('GET', '/admin/stats')).status, 401);
  assert.equal((await j('POST', '/admin/login', { password: 'nope' })).status, 401);
  const { body: { token } } = await j('POST', '/admin/login', { password: 'test-pass' });
  const stats = await j('GET', '/admin/stats', null, token);
  assert.equal(stats.body.players, 1);
  assert.equal(stats.body.quiz.pairedCount, 1);
  assert.ok(stats.body.quiz.improvementPercent > 0);
});

test('admin scenario CRUD with validation', async () => {
  const { body: { token } } = await j('POST', '/admin/login', { password: 'test-pass' });
  const bad = await j('POST', '/admin/scenarios', { id: 'x' }, token);
  assert.equal(bad.status, 400);
  const s = { id: 'test-sms', channel: 'sms', difficulty: 1, isPhishing: true, senderName: '+639000000000', senderAddress: '+639000000000', body: 'Claim your prize now at {{link:0}}', links: [{ text: 'prize.example', href: 'http://prize.example' }], redFlags: [{ target: 'link', index: 0, label: 'Fake link' }], explanation: 'Test' };
  assert.equal((await j('POST', '/admin/scenarios', s, token)).status, 201);
  const upd = await j('PUT', '/admin/scenarios/test-sms', { ...s, difficulty: 2 }, token);
  assert.equal(upd.body.difficulty, 2);
  assert.equal((await j('PUT', '/admin/scenarios/test-sms', { ...s, redFlags: [{ target: 'body', match: 'not in body', label: 'x' }] }, token)).status, 400);
  assert.equal((await j('DELETE', '/admin/scenarios/test-sms', null, token)).status, 204);
});
