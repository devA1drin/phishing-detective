// Phase 4: badges, daily challenge, class leaderboard, certificates + verification.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, uniq } from './helpers.js';

process.env.RATE_LIMIT = 'off';
const { scenarios } = await import('../src/data/scenarios.js');
const { quizPools } = await import('../src/data/quiz.js');
const { dailyPick, dayStreak, manilaDate } = await import('../src/lib/daily.js');
const { BADGES } = await import('../src/lib/badges.js');

let h, j, admin;
// approved AI drafts from other test files may be served (shared PG database); the fake generator only makes phishing cases
const truth = (id) => scenarios.find((x) => x.id === id) || { isPhishing: true };
const right = (kind, items) => items.map((i) => ({ itemId: i.id, choice: quizPools[kind].find((q) => q.id === i.id).isPhishing ? 'phishing' : 'legit', confidence: 4 }));

async function newPlayer(prefix = 'p4') {
  const reg = await j('POST', '/players/register', { nickname: uniq(prefix), pin: '1234', consent: true });
  await j('PUT', `/admin/players/${reg.body.player.id}/group`, { group: 'experimental' }, admin);
  const pre = await j('GET', '/quiz/pre');
  await j('POST', '/quiz/pre/submit', { answers: pre.body.items.map((i) => ({ itemId: i.id, choice: 'phishing', confidence: 3 })) }, reg.body.token);
  return { token: reg.body.token, id: reg.body.player.id, nickname: reg.body.player.nickname };
}
async function playRound(token, body = { level: 1 }, allRight = true) {
  const s = await j('POST', '/sessions', body, token);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  for (const sc of s.body.scenarios) {
    const t = truth(sc.id);
    const choice = allRight ? (t.isPhishing ? 'phishing' : 'legit') : (t.isPhishing ? 'legit' : 'phishing');
    await j('POST', `/sessions/${s.body.sessionId}/answers`, { scenarioId: sc.id, choice, timeMs: 4000, clickedParts: [] }, token);
  }
  return (await j('POST', `/sessions/${s.body.sessionId}/finish`, null, token)).body;
}

before(async () => {
  h = await boot(); j = h.j;
  admin = (await j('POST', '/admin/login', { username: 'root', password: 'test-pass-1234' })).body.token;
});
after(() => h.close());

test('at least 8 badges; first round awards Rookie, Flawless and Hot Streak', async () => {
  assert.ok(BADGES.length >= 8);
  const p = await newPlayer();
  const before = await j('GET', '/players/me/badges', null, p.token);
  assert.equal(before.body.earned, 0);
  const fin = await playRound(p.token);
  const ids = fin.newBadges.map((b) => b.id);
  for (const id of ['rookie', 'flawless', 'hot-streak']) assert.ok(ids.includes(id), `missing ${id}: ${ids}`);
  const again = await playRound(p.token);
  assert.ok(!again.newBadges.some((b) => b.id === 'rookie'), 'badges are awarded once');
  const list = await j('GET', '/players/me/badges', null, p.token);
  assert.ok(list.body.badges.find((b) => b.id === 'rookie').earnedAt);
  assert.equal(list.body.badges.find((b) => b.id === 'daily-habit').progress, 0);
});

test('daily challenge: same cases for everyone, one attempt per day, own leaderboard', async () => {
  const a = await newPlayer('dA'); const b = await newPlayer('dB');
  const sa = await j('POST', '/sessions', { mode: 'daily' }, a.token);
  const sb = await j('POST', '/sessions', { mode: 'daily' }, b.token);
  assert.equal(sa.status, 201);
  assert.deepEqual(sa.body.scenarios.map((s) => s.id), sb.body.scenarios.map((s) => s.id));
  assert.equal(sa.body.scenarios.length, 5);
  assert.equal(sa.body.date, manilaDate());
  assert.equal((await j('POST', '/sessions', { mode: 'daily' }, a.token)).status, 409);
  for (const sc of sa.body.scenarios) await j('POST', `/sessions/${sa.body.sessionId}/answers`, { scenarioId: sc.id, choice: truth(sc.id).isPhishing ? 'phishing' : 'legit', timeMs: 3000 }, a.token);
  const fin = await j('POST', `/sessions/${sa.body.sessionId}/finish`, null, a.token);
  assert.equal(fin.body.challengeDate, manilaDate());
  const d = await j('GET', '/daily', null, a.token);
  assert.equal(d.body.played.finished, true);
  assert.equal(d.body.streak, 1);
  assert.equal(d.body.leaderboard[0].nickname, a.nickname);
  // a daily round never unlocks levels
  const prog = await j('GET', '/players/me/progress', null, b.token);
  assert.ok(prog.status === 200);
});

test('daily helpers are deterministic and balanced; streaks count consecutive days', () => {
  const pool = scenarios.filter((s) => s.active !== false);
  const x = dailyPick(pool, '2026-11-17'); const y = dailyPick(pool, '2026-11-17'); const z = dailyPick(pool, '2026-11-18');
  assert.deepEqual(x.map((s) => s.id), y.map((s) => s.id));
  assert.notDeepEqual(x.map((s) => s.id), z.map((s) => s.id));
  for (let d = 1; d <= 28; d++) {
    const p = dailyPick(pool, `2026-02-${String(d).padStart(2, '0')}`);
    assert.ok(p.some((s) => !s.isPhishing) && p.filter((s) => s.isPhishing).length >= 2);
  }
  assert.equal(dayStreak(['2026-11-15', '2026-11-16', '2026-11-17'], '2026-11-17'), 3);
  assert.equal(dayStreak(['2026-11-15', '2026-11-16'], '2026-11-17'), 2, 'today not played yet keeps the streak');
  assert.equal(dayStreak(['2026-11-14'], '2026-11-17'), 0);
  assert.equal(manilaDate(new Date('2026-11-17T16:30:00Z')), '2026-11-18');
});

test('class sections: join by code, class-vs-class leaderboard by average points', async () => {
  const a = await j('POST', '/admin/sections', { name: 'BSIT 3A' }, admin);
  const b = await j('POST', '/admin/sections', { name: 'BSIT 3B' }, admin);
  assert.equal(a.status, 201);
  assert.match(a.body.join_code, /^[A-Z2-9]{6}$/);
  const p1 = await newPlayer('c1'); const p2 = await newPlayer('c2'); const p3 = await newPlayer('c3');
  assert.equal((await j('POST', '/players/me/section', { code: 'NOPE99' }, p1.token)).status, 404);
  assert.equal((await j('POST', '/players/me/section', { code: a.body.join_code.toLowerCase() }, p1.token)).body.section.name, 'BSIT 3A');
  await j('POST', '/players/me/section', { code: b.body.join_code }, p2.token);
  await j('POST', '/players/me/section', { code: b.body.join_code }, p3.token);
  await playRound(p1.token, { level: 1 }, true);
  await playRound(p2.token, { level: 1 }, false);
  const prog = await j('GET', '/players/me/progress', null, p1.token);
  assert.equal(prog.body.section.name, 'BSIT 3A');
  const lb = await j('GET', '/leaderboard/classes');
  const A = lb.body.find((c) => c.name === 'BSIT 3A'); const B = lb.body.find((c) => c.name === 'BSIT 3B');
  assert.equal(A.place, 1);
  assert.equal(B.members, 2);
  assert.equal(B.activePlayers, 1);
  assert.ok(A.avgScore > B.avgScore);
  assert.equal((await j('POST', '/admin/sections', { name: 'bsit 3a' }, admin)).status, 409, 'duplicate names rejected');
  assert.equal((await j('DELETE', `/admin/sections/${a.body.id}`, null, admin)).status, 204);
  assert.equal((await j('GET', '/players/me/progress', null, p1.token)).body.section, null, 'students stay, section cleared');
});

test('certificate: locked before the post-quiz, then issued with a verifiable code and a PDF', async () => {
  const p = await newPlayer('cert');
  const locked = await j('GET', '/certificates/me', null, p.token);
  assert.equal(locked.body.eligible, false);
  assert.equal((await j('POST', '/certificates/me', null, p.token)).status, 403);
  await playRound(p.token);
  const post = await j('GET', '/quiz/post', null, p.token);
  await j('POST', '/quiz/post/submit', { answers: right('post', post.body.items) }, p.token);
  const issued = await j('POST', '/certificates/me', null, p.token);
  assert.equal(issued.status, 201);
  const c = issued.body.certificate;
  assert.match(c.code, /^PD-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(c.postPercent, 100);
  assert.ok(c.badges >= 3);
  const again = await j('POST', '/certificates/me', null, p.token);
  assert.equal(again.status, 200);
  assert.equal(again.body.certificate.code, c.code, 'code is stable');
  const v = await j('GET', `/verify/${c.code.toLowerCase()}`);
  assert.equal(v.body.valid, true);
  assert.equal(v.body.certificate.nickname, p.nickname);
  assert.equal((await j('GET', '/verify/PD-AAAA-AAAA-AAAA')).status, 404);
  assert.equal((await j('GET', '/verify/garbage')).status, 400);
  const pdf = await fetch(`${h.base}/certificates/${c.code}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 3000);
});
