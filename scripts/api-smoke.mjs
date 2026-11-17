// End-to-end API smoke test against a running server (local or live). Creates one throwaway
// player, walks the study flow, checks admin endpoints, then DELETES the player it created.
// Usage: ADMIN_USER=superadmin ADMIN_PASS_FILE=/path/to/password node scripts/api-smoke.mjs [baseUrl]
import fs from 'node:fs';
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '') + '/api';
const ADMIN_USER = process.env.ADMIN_USER || 'superadmin';
const ADMIN_PASS = process.env.ADMIN_PASS || (process.env.ADMIN_PASS_FILE ? fs.readFileSync(process.env.ADMIN_PASS_FILE, 'utf8').trim() : '');
const { quizPools } = await import('../server/src/data/quiz.js');
const { scenarios } = await import('../server/src/data/scenarios.js');

const call = async (method, path, body, token, expect) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (expect != null ? res.status !== expect : !res.ok) throw new Error(`${method} ${path} → ${res.status} ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data)}`);
  return data;
};
const ok = (label, extra = '') => console.log(`✔ ${label}${extra ? `: ${extra}` : ''}`);
const answers = (kind, items) => items.map((i, n) => ({ itemId: i.id, choice: (n % 4 === 0) !== quizPools[kind].find((q) => q.id === i.id).isPhishing ? 'phishing' : 'legit', confidence: 1 + (n % 5) }));

const aiDrafts = [];
let admin, playerId;
try {
  const h = await call('GET', '/health'); ok('health', JSON.stringify(h));
  await call('GET', '/admin/stats', null, null, 401); ok('admin requires login');
  await call('POST', '/admin/login', { username: ADMIN_USER, password: 'wrong-password-123' }, null, 401); ok('wrong admin password rejected');
  if (!ADMIN_PASS) throw new Error('Set ADMIN_PASS or ADMIN_PASS_FILE');
  admin = (await call('POST', '/admin/login', { username: ADMIN_USER, password: ADMIN_PASS })).token; ok('admin login');

  const nickname = `smoke_${Date.now().toString(36)}`;
  await call('POST', '/players/register', { nickname, pin: '4321' }, null, 400); ok('consent required');
  const reg = await call('POST', '/players/register', { nickname, pin: '4321', consent: true }, null, 201);
  playerId = reg.player.id; ok('register', `${nickname} (#${playerId}, randomly assigned ${reg.player.group})`);
  await call('POST', '/players/login', { nickname, pin: '0000' }, null, 401); ok('wrong PIN rejected');
  const { token } = await call('POST', '/players/login', { nickname, pin: '4321' }); ok('PIN login');
  await call('GET', '/players/me/progress', null, null, 401); ok('progress requires token');
  // force experimental to exercise gameplay
  await call('PUT', `/admin/players/${playerId}/group`, { group: 'experimental' }, admin); ok('admin group override');

  const pre = await call('GET', '/quiz/pre');
  const preRes = await call('POST', '/quiz/pre/submit', { answers: answers('pre', pre.items) }, token); ok('pre-quiz', `${preRes.percent}%, confidently wrong ${preRes.confidentlyWrong}`);
  const s = await call('POST', '/sessions', { level: 1 }, token, 201);
  for (const sc of s.scenarios) {
    const t = scenarios.find((x) => x.id === sc.id);
    await call('POST', `/sessions/${s.sessionId}/answers`, { scenarioId: sc.id, choice: t ? (t.isPhishing ? 'phishing' : 'legit') : 'phishing', timeMs: 6000, clickedParts: [] }, token);
  }
  const coach = await call('POST', `/sessions/${s.sessionId}/coach`, { scenarioId: s.scenarios[0].id, missed: [] }, token);
  ok('coach', `${coach.source} (${coach.text.length} chars)`);
  const fin = await call('POST', `/sessions/${s.sessionId}/finish`, null, token); ok('round', `score ${fin.score}, accuracy ${fin.accuracy}%, adaptive ${s.adaptive?.on}`);
  // Phase 2: inbox mode + language filter + link trap
  const inbox = await call('POST', '/sessions', { level: 1, mode: 'inbox', language: 'fil' }, token, 201);
  ok('inbox (Filipino/Taglish)', `${inbox.scenarios.length} messages, ${inbox.inboxTimeLimit}s, languages ${[...new Set(inbox.scenarios.map((x) => x.language))].join('/')}`);
  const withLink = inbox.scenarios.find((x) => x.links.length);
  if (withLink) {
    const lc = await call('POST', `/sessions/${inbox.sessionId}/link-click`, { scenarioId: withLink.id, index: 0, timeMs: 3000 }, token);
    ok('link trap', lc.trap.phished ? `phished → ${lc.trap.title} (${lc.trap.host})` : `safe link (${lc.trap.host})`);
  }
  const post = await call('GET', '/quiz/post');
  const postRes = await call('POST', '/quiz/post/submit', { answers: answers('post', post.items) }, token); ok('post-quiz', `${postRes.percent}% (pre ${postRes.prePercent}%)`);
  const prog = await call('GET', '/players/me/progress', null, token); ok('progress', `retention opens ${prog.retentionQuiz.unlocksAt}, surveys unlocked ${prog.surveys.unlocked}`);
  await call('POST', '/quiz/retention/submit', { answers: [] }, token, 403); ok('retention locked until delay passes');
  const sus = await call('POST', '/surveys/sus', { answers: [4, 2, 4, 2, 4, 2, 4, 2, 4, 2] }, token, 201); ok('SUS survey', `score ${sus.score}`);
  const st = await call('GET', '/admin/stats', null, admin); ok('admin stats', `players ${st.players}, SUS n=${st.surveys.sus.n}, groups exp=${st.groups.experimental.players}/ctl=${st.groups.control.players}`);
  for (const k of ['players', 'quiz-items', 'surveys']) {
    const csv = await call('GET', `/admin/export/${k}.csv`, null, admin);
    ok(`CSV ${k}`, `${csv.split('\n').length - 1} rows`);
  }
  await call('GET', '/admin/admins', null, admin); ok('admin accounts list');
  const ai = await call('GET', '/admin/ai/status', null, admin);
  ok('AI status', ai.enabled ? `enabled, ${ai.model} via ${ai.auth}` : `disabled: ${ai.reason}`);
  if (ai.enabled && process.env.SMOKE_AI_GENERATE === '1') {
    const res = await fetch(`${BASE}/admin/ai/generate`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` }, body: JSON.stringify({ channel: 'sms', difficulty: 2, isPhishing: true, language: 'taglish', topic: 'smoke test', count: 1 }) });
    const g = await res.json();
    if (res.status === 201) {
      aiDrafts.push(...g.drafts.map((d) => d.id));
      const d = g.drafts[0];
      ok('AI generate', `${d.id} status=${d.status} active=${d.active} validation=${d.validationErrors.length ? d.validationErrors.join('; ') : 'ok'}`);
    } else console.log(`✖ AI generate: HTTP ${res.status} ${g.error}`);
  }
} finally {
  for (const id of aiDrafts) { await call('DELETE', `/admin/scenarios/${id}`, null, admin, 204).catch((e) => console.log('draft cleanup failed', e.message)); ok('cleanup', `deleted smoke AI draft ${id}`); }
  if (admin && playerId) { await call('DELETE', `/admin/players/${playerId}`, null, admin, 204); ok('cleanup', `deleted smoke player #${playerId}`); }
}
console.log('ALL OK');
