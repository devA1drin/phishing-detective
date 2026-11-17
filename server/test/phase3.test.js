// Phase 3: AI generator (offline fake model), educator review, coach fallback, adaptive selection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, uniq } from './helpers.js';

process.env.RATE_LIMIT = 'off';
process.env.AI_FAKE = '1';
delete process.env.VERCEL;
const { scenarios } = await import('../src/data/scenarios.js');
const { quizPools } = await import('../src/data/quiz.js');
const { categorizeFlag, scenarioCategories, weakCategories } = await import('../src/lib/categories.js');
const { adaptiveWeight } = await import('../src/lib/adaptive.js');
const { pickScenarios } = await import('../src/lib/game.js');
const ai = await import('../src/lib/ai.js');

let h, j, admin, token;
before(async () => {
  h = await boot(); j = h.j;
  admin = (await j('POST', '/admin/login', { username: 'root', password: 'test-pass-1234' })).body.token;
  const reg = await j('POST', '/players/register', { nickname: uniq('p3'), pin: '1234', consent: true });
  token = reg.body.token;
  await j('PUT', `/admin/players/${reg.body.player.id}/group`, { group: 'experimental' }, admin);
  const pre = await j('GET', '/quiz/pre');
  await j('POST', '/quiz/pre/submit', { answers: pre.body.items.map((i) => ({ itemId: i.id, choice: quizPools.pre.find((q) => q.id === i.id).isPhishing ? 'phishing' : 'legit', confidence: 3 })) }, token);
});
after(() => h.close());

test('every seed red flag maps to a category', () => {
  for (const s of scenarios) for (const f of s.redFlags) assert.ok(categorizeFlag(f), `${s.id}: ${f.label}`);
  assert.deepEqual(scenarioCategories({ isPhishing: false }), ['legit']);
});

test('AI generator creates pending drafts that players never see until approved', async () => {
  const st = await j('GET', '/admin/ai/status', null, admin);
  assert.equal(st.body.enabled, true);
  const gen = await j('POST', '/admin/ai/generate', { channel: 'sms', difficulty: 1, isPhishing: true, language: 'taglish', count: 2 }, admin);
  assert.equal(gen.status, 201, JSON.stringify(gen.body));
  assert.equal(gen.body.drafts.length, 2);
  const d = gen.body.drafts[0];
  assert.equal(d.status, 'pending');
  assert.equal(d.source, 'ai');
  assert.equal(d.active, false);
  assert.deepEqual(d.validationErrors, []);
  const pending = await j('GET', '/admin/scenarios?status=pending', null, admin);
  assert.ok(pending.body.some((s) => s.id === d.id));
  // not served while pending
  for (let i = 0; i < 6; i++) {
    const s = await j('POST', '/sessions', { level: 1 }, token);
    assert.ok(!s.body.scenarios.some((x) => x.id.startsWith('ai-')), 'pending draft leaked into a round');
  }
  const ok = await j('POST', `/admin/scenarios/${d.id}/review`, { status: 'approved' }, admin);
  assert.equal(ok.body.status, 'approved');
  assert.equal(ok.body.active, true);
  assert.ok(ok.body.reviewedBy);
  const rej = await j('POST', `/admin/scenarios/${gen.body.drafts[1].id}/review`, { status: 'rejected' }, admin);
  assert.equal(rej.body.status, 'rejected');
  assert.equal(rej.body.active, false);
  const call = await j('POST', '/admin/ai/generate', { channel: 'call', difficulty: 2, isPhishing: true }, admin);
  assert.deepEqual(call.body.drafts[0].validationErrors, []);
  assert.equal(call.body.drafts[0].links.length, 0);
});

test('AI disabled → generator returns 503 with the reason; coach falls back to a static tip', async () => {
  process.env.AI_ENABLED = 'false';
  try {
    const gen = await j('POST', '/admin/ai/generate', { channel: 'sms' }, admin);
    assert.equal(gen.status, 503);
    assert.match(gen.body.error, /AI_ENABLED/);
    const s = await j('POST', '/sessions', { level: 1 }, token);
    const sc = s.body.scenarios[0];
    assert.equal((await j('POST', `/sessions/${s.body.sessionId}/coach`, { scenarioId: sc.id }, token)).status, 409, 'no coach before answering');
    const t = scenarios.find((x) => x.id === sc.id);
    await j('POST', `/sessions/${s.body.sessionId}/answers`, { scenarioId: sc.id, choice: t.isPhishing ? 'legit' : 'phishing', timeMs: 3000 }, token);
    const coach = await j('POST', `/sessions/${s.body.sessionId}/coach`, { scenarioId: sc.id }, token);
    assert.equal(coach.status, 200);
    assert.equal(coach.body.source, 'static');
    assert.ok(coach.body.text.length > 40);
  } finally { delete process.env.AI_ENABLED; }
});

test('without credentials AI reports exactly what is missing', () => {
  const none = ai.aiStatus({}, false);
  assert.equal(none.enabled, false);
  assert.match(none.reason, /AI_GATEWAY_API_KEY/);
  assert.equal(ai.aiStatus({ AI_GATEWAY_API_KEY: 'x' }, false).auth, 'api-key');
  assert.equal(ai.aiStatus({ VERCEL: '1' }, false).auth, 'vercel-oidc');
  assert.equal(ai.aiStatus({ AI_ENABLED: 'false', AI_GATEWAY_API_KEY: 'x' }, false).enabled, false);
});

test('coach uses AI when available and mentions weak spots', async () => {
  const s = await j('POST', '/sessions', { level: 1 }, token);
  const sc = s.body.scenarios[0];
  await j('POST', `/sessions/${s.body.sessionId}/answers`, { scenarioId: sc.id, choice: 'legit', timeMs: 3000 }, token);
  const coach = await j('POST', `/sessions/${s.body.sessionId}/coach`, { scenarioId: sc.id }, token);
  assert.equal(coach.body.source, 'ai');
  const prog = await j('GET', '/players/me/progress', null, token);
  assert.ok(Array.isArray(prog.body.weakSpots));
});

test('adaptive selection leans towards weak categories', () => {
  const rows = [
    { category: 'link', seen: 10, missed: 9 }, { category: 'sender', seen: 10, missed: 0 },
    { category: 'urgency', seen: 10, missed: 1 }, { category: 'legit', seen: 10, missed: 0 },
  ];
  const { weight, focus } = adaptiveWeight(rows);
  assert.equal(focus[0].category, 'link');
  assert.deepEqual(weakCategories(rows, { top: 1 }).map((w) => w.category), ['link']);
  const pool = scenarios.filter((s) => s.difficulty === 1);
  const hasLink = (s) => scenarioCategories(s).includes('link');
  let adaptiveHits = 0; let randomHits = 0;
  for (let i = 0; i < 300; i++) {
    adaptiveHits += pickScenarios(pool, 1, 8, weight).filter(hasLink).length;
    randomHits += pickScenarios(pool, 1, 8).filter(hasLink).length;
  }
  assert.ok(adaptiveHits > randomHits * 1.1, `adaptive ${adaptiveHits} vs random ${randomHits}`);
  assert.equal(adaptiveWeight([{ category: 'link', seen: 1, missed: 1 }]).weight, null, 'no adapting without evidence');
});
