// Phase 2: inbox mode, language filter, link trap, vishing/QR scenarios, seed sync.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, uniq } from './helpers.js';

process.env.RATE_LIMIT = 'off';
const { scenarios } = await import('../src/data/scenarios.js');
const { flagPartKeys, segmentBody, linkTrap } = await import('../src/lib/game.js');
const { quizPools } = await import('../src/data/quiz.js');

let h, j, token;
before(async () => {
  h = await boot(); j = h.j;
  const admin = (await j('POST', '/admin/login', { username: 'root', password: 'test-pass-1234' })).body.token;
  const reg = await j('POST', '/players/register', { nickname: uniq('p2'), pin: '1234', consent: true });
  token = reg.body.token;
  await j('PUT', `/admin/players/${reg.body.player.id}/group`, { group: 'experimental' }, admin);
  const pre = await j('GET', '/quiz/pre');
  await j('POST', '/quiz/pre/submit', { answers: pre.body.items.map((i) => ({ itemId: i.id, choice: quizPools.pre.find((q) => q.id === i.id).isPhishing ? 'phishing' : 'legit', confidence: 3 })) }, token);
});
after(() => h.close());

test('scenario pack: ≥15 Filipino/Taglish, vishing calls and QR links, all flags map', () => {
  const fil = scenarios.filter((s) => ['tl', 'taglish'].includes(s.language) && s.addedIn === 2);
  assert.ok(fil.length >= 15, `only ${fil.length}`);
  const calls = scenarios.filter((s) => s.channel === 'call');
  assert.ok(calls.length >= 3 && calls.some((s) => !s.isPhishing));
  for (const c of calls) assert.ok(c.body.split('\n').every((l) => /^(Caller|You):/.test(l)), c.id);
  const qr = scenarios.filter((s) => (s.links || []).some((l) => l.qr));
  assert.ok(qr.length >= 3 && qr.some((s) => !s.isPhishing));
  for (const s of scenarios) assert.ok(!flagPartKeys(s, segmentBody(s)).includes(null), s.id);
});

test('language filter returns Filipino/Taglish cases', async () => {
  const s = await j('POST', '/sessions', { level: 1, language: 'fil' }, token);
  assert.equal(s.status, 201);
  assert.equal(s.body.language, 'fil');
  for (const sc of s.body.scenarios) assert.ok(['tl', 'taglish'].includes(sc.language), sc.id);
  assert.equal((await j('POST', '/sessions', { level: 1, language: 'xx' }, token)).status, 400);
});

test('inbox mode serves 6 messages at level 1 with a shared clock', async () => {
  const s = await j('POST', '/sessions', { level: 1, mode: 'inbox' }, token);
  assert.equal(s.status, 201);
  assert.equal(s.body.mode, 'inbox');
  assert.equal(s.body.scenarios.length, 6);
  assert.ok(s.body.inboxTimeLimit > 60);
  for (const sc of s.body.scenarios) {
    const t = scenarios.find((x) => x.id === sc.id);
    const r = await j('POST', `/sessions/${s.body.sessionId}/answers`, { scenarioId: sc.id, choice: t.isPhishing ? 'phishing' : 'legit', timeMs: 5000 }, token);
    assert.equal(r.body.isCorrect, true);
  }
  const fin = await j('POST', `/sessions/${s.body.sessionId}/finish`, null, token);
  assert.equal(fin.body.mode, 'inbox');
  assert.equal(fin.body.accuracy, 100);
  assert.equal((await j('POST', '/sessions', { level: 1, mode: 'speedrun' }, token)).status, 400);
});

test('link trap: opening a phishing link loses the case; a legit link only shows a safe note', async () => {
  let phishCase, legitCase, sess;
  for (let tries = 0; tries < 40 && !(phishCase && legitCase); tries++) {
    sess = await j('POST', '/sessions', { level: 1 }, token);
    phishCase = sess.body.scenarios.find((sc) => sc.links.length && scenarios.find((x) => x.id === sc.id).isPhishing);
    legitCase = sess.body.scenarios.find((sc) => sc.links.length && !scenarios.find((x) => x.id === sc.id).isPhishing);
  }
  assert.ok(phishCase && legitCase, 'need a session with both link types');
  const sid = sess.body.sessionId;
  const safe = await j('POST', `/sessions/${sid}/link-click`, { scenarioId: legitCase.id, index: 0 }, token);
  assert.equal(safe.status, 200);
  assert.equal(safe.body.trap.phished, false);
  assert.equal(safe.body.result, undefined, 'legit link does not end the case');
  const ans = await j('POST', `/sessions/${sid}/answers`, { scenarioId: legitCase.id, choice: 'legit', timeMs: 4000, linkClicked: true }, token);
  assert.equal(ans.body.isCorrect, true);

  const trap = await j('POST', `/sessions/${sid}/link-click`, { scenarioId: phishCase.id, index: 0, timeMs: 3000 }, token);
  assert.equal(trap.body.trap.phished, true);
  assert.match(trap.body.trap.title, /phished|QR/);
  assert.ok(trap.body.trap.whatToDo.length >= 3);
  assert.equal(trap.body.result.isCorrect, false);
  assert.equal(trap.body.result.points, 0);
  assert.equal(trap.body.result.phished, true);
  assert.ok(trap.body.result.redFlags.length > 0, 'feedback included');
  assert.equal((await j('POST', `/sessions/${sid}/answers`, { scenarioId: phishCase.id, choice: 'phishing', timeMs: 1 }, token)).status, 409);
  assert.equal((await j('POST', `/sessions/${sid}/link-click`, { scenarioId: phishCase.id, index: 9 }, token)).status, 409);
  const fin = await j('POST', `/sessions/${sid}/finish`, null, token);
  assert.equal(fin.body.phishedCount, 1);
});

test('linkTrap never fetches and explains QR codes', () => {
  const qr = scenarios.find((s) => s.id === 'qr-marketplace-receive');
  const t = linkTrap(qr, 0);
  assert.equal(t.phished, true);
  assert.equal(t.qr, true);
  assert.equal(t.host, 'gcash-seller-receive.top');
  assert.equal(linkTrap(qr, 5), null);
});
