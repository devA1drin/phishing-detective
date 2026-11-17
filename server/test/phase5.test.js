// Phase 5: educator scoping by class section, student weakness reports, Chapter 4 statistics + PDF.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot, uniq } from './helpers.js';

process.env.RATE_LIMIT = 'off';
const { scenarios } = await import('../src/data/scenarios.js');
const { quizPools } = await import('../src/data/quiz.js');
const { pairedTTest, wilcoxonSignedRank } = await import('../src/lib/stats.js');

let h, j, root, eduA, eduB, secA, secB;
const truth = (id) => scenarios.find((x) => x.id === id) || { isPhishing: true };
// answer the first k quiz items correctly and the rest wrongly → score k/10
const quiz = (kind, items, k) => items.map((i, n) => {
  const isP = quizPools[kind].find((q) => q.id === i.id).isPhishing;
  return { itemId: i.id, choice: (n < k) === isP ? 'phishing' : 'legit', confidence: n < k ? 3 : 5 };
});

async function student(code, pre, post, missLinks = false) {
  const reg = await j('POST', '/players/register', { nickname: uniq('s5'), pin: '1234', consent: true });
  const t = reg.body.token;
  await j('PUT', `/admin/players/${reg.body.player.id}/group`, { group: 'experimental' }, root);
  await j('POST', '/players/me/section', { code }, t);
  const pq = await j('GET', '/quiz/pre');
  await j('POST', '/quiz/pre/submit', { answers: quiz('pre', pq.body.items, pre) }, t);
  const s = await j('POST', '/sessions', { level: 1 }, t);
  for (const sc of s.body.scenarios) {
    const isP = truth(sc.id).isPhishing;
    await j('POST', `/sessions/${s.body.sessionId}/answers`, { scenarioId: sc.id, choice: missLinks ? (isP ? 'legit' : 'phishing') : (isP ? 'phishing' : 'legit'), timeMs: 4000 }, t);
  }
  await j('POST', `/sessions/${s.body.sessionId}/finish`, null, t);
  const po = await j('GET', '/quiz/post', null, t);
  await j('POST', '/quiz/post/submit', { answers: quiz('post', po.body.items, post) }, t);
  return { id: reg.body.player.id, token: t, nickname: reg.body.player.nickname, pre: pre * 10, post: post * 10 };
}

const pairs = [[3, 7], [4, 8], [5, 6], [2, 9]];
let A = [], B = [];
before(async () => {
  h = await boot(); j = h.j;
  root = (await j('POST', '/admin/login', { username: 'root', password: 'test-pass-1234' })).body.token;
  for (const u of ['edu_a', 'edu_b']) await j('POST', '/admin/admins', { username: u, password: 'Educator-pass-99', role: 'educator' }, root);
  eduA = (await j('POST', '/admin/login', { username: 'edu_a', password: 'Educator-pass-99' })).body.token;
  eduB = (await j('POST', '/admin/login', { username: 'edu_b', password: 'Educator-pass-99' })).body.token;
  secA = (await j('POST', '/admin/sections', { name: 'BSIS 4A' }, eduA)).body;
  secB = (await j('POST', '/admin/sections', { name: 'BSIS 4B' }, eduB)).body;
  for (const [pre, post] of pairs) A.push(await student(secA.join_code, pre, post, pre === 2));
  B.push(await student(secB.join_code, 6, 6));
});
after(() => h.close());

test('educators only see students in their own sections; superadmins see all', async () => {
  const pa = (await j('GET', '/admin/players', null, eduA)).body;
  assert.deepEqual(pa.map((p) => p.id).sort(), A.map((s) => s.id).sort());
  assert.ok(pa.every((p) => p.section_name === 'BSIS 4A'));
  assert.equal((await j('GET', '/admin/stats', null, eduA)).body.players, 4);
  assert.equal((await j('GET', '/admin/stats', null, eduB)).body.players, 1);
  assert.ok((await j('GET', '/admin/stats', null, root)).body.players >= 5);
  assert.equal((await j('GET', `/admin/stats?section=${secB.id}`, null, root)).body.players, 1, 'superadmin can filter by section');
  assert.equal((await j('GET', `/admin/stats?section=${secB.id}`, null, eduA)).status, 403);
  assert.ok((await j('GET', '/admin/sessions', null, eduA)).body.every((s) => A.some((x) => x.id === s.playerId)));
  const csv = (await j('GET', '/admin/export/players', null, eduB)).body;
  assert.ok(csv.includes(B[0].nickname) && !csv.includes(A[0].nickname));
  assert.deepEqual((await j('GET', '/admin/sections', null, eduA)).body.map((s) => s.name), ['BSIS 4A']);
  assert.equal((await j('GET', `/admin/sections/${secA.id}/report`, null, eduB)).status, 403);
  assert.equal((await j('GET', `/admin/players/${A[0].id}/report`, null, eduB)).status, 404);
  assert.equal((await j('PUT', `/admin/players/${A[0].id}/group`, { group: 'control' }, eduB)).status, 404);
  assert.equal((await j('DELETE', `/admin/sections/${secA.id}`, null, eduB)).status, 403);
});

test('per-student weakness report and class roll-up', async () => {
  const weakStudent = A.find((s) => s.pre === 20);
  const r = (await j('GET', `/admin/players/${weakStudent.id}/report`, null, eduA)).body;
  assert.equal(r.player.section.name, 'BSIS 4A');
  assert.equal(r.quiz.pre, 20); assert.equal(r.quiz.post, 90); assert.equal(r.quiz.gain, 70);
  assert.equal(r.categories.length, 8);
  assert.ok(r.weak.length > 0 && r.weak[0].tip.length > 20);
  assert.ok(r.missed.length > 0);
  assert.ok(r.quiz.confidentlyWrong > 0);
  const sec = (await j('GET', `/admin/sections/${secA.id}/report`, null, eduA)).body;
  assert.equal(sec.students.length, 4);
  assert.ok(sec.categories.length > 0);
  assert.ok(sec.students.find((s) => s.id === weakStudent.id).weakest);
  const csv = (await j('GET', '/admin/export/students', null, eduA)).body;
  assert.match(csv.split('\n')[0], /nickname.*pre.*post.*weakest/);
});

test('Chapter 4 statistics are computed server-side and match the reference implementation', async () => {
  const c4 = (await j('GET', '/admin/reports/chapter4', null, eduA)).body;
  const pre = A.map((s) => s.pre); const post = A.map((s) => s.post);
  const ref = pairedTTest(pre, post); const w = wilcoxonSignedRank(pre, post);
  const e = c4.groups.experimental;
  assert.equal(e.pairedCount, 4);
  assert.equal(e.tTest.n, 4);
  assert.ok(Math.abs(e.tTest.t - ref.t) < 0.001, `t ${e.tTest.t} vs ${ref.t}`);
  assert.ok(Math.abs(e.tTest.p - ref.p) < 0.001);
  assert.equal(e.tTest.df, 3);
  assert.ok(Math.abs(e.wilcoxon.p - w.p) < 0.001);
  assert.equal(e.pre.mean, 35); assert.equal(e.post.mean, 75);
  assert.equal(c4.scope.label, 'BSIS 4A');
});

test('Chapter 4 PDF export', async () => {
  const res = await fetch(`${h.base}/admin/reports/chapter4.pdf`, { headers: { Authorization: `Bearer ${eduA}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const file = path.join(os.tmpdir(), `c4-${Date.now()}.pdf`);
  fs.writeFileSync(file, buf);
  let text = '';
  try { text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }); } catch { /* poppler not installed */ }
  fs.unlinkSync(file);
  if (text) {
    for (const s of ['CHAPTER 4', 'Paired-samples t-test', 'Wilcoxon signed-rank', 'Table 4.3', 'BSIS 4A', 'Retention']) assert.ok(text.includes(s), `PDF missing "${s}"`);
  }
  assert.equal((await fetch(`${h.base}/admin/reports/chapter4.pdf`)).status, 401);
});
