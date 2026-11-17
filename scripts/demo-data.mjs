// Simulates demo players through the real API so the admin dashboard has data to show.
// Players are named demo_studentNN (PIN 1234) and randomly assigned to groups like real players.
// Usage: node scripts/demo-data.mjs [baseUrl] [players]   (DEMO_SECTION_CODES=AAA111,BBB222 spreads them over class sections)
const BASE = (process.argv[2] || 'http://localhost:3000') + '/api';
const N = Number(process.argv[3] || 12);
const { scenarios } = await import('../server/src/data/scenarios.js');
const { quizPools } = await import('../server/src/data/quiz.js');
const { flagPartKeys } = await import('../server/src/lib/game.js');
const { ISO_ITEMS } = await import('../server/src/data/surveys.js');
let token = null;
const req = (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json().catch(() => ({})));
const rnd = (a, b) => a + Math.random() * (b - a);
const CODES = (process.env.DEMO_SECTION_CODES || '').split(',').filter(Boolean);
const L = () => Math.max(1, Math.min(5, Math.round(rnd(3, 5.4))));

for (let i = 1; i <= N; i++) {
  const nickname = `demo_student${String(i).padStart(2, '0')}`;
  token = null;
  let auth = await req('POST', '/players/register', { nickname, pin: '1234', consent: true });
  if (auth.error) auth = await req('POST', '/players/login', { nickname, pin: '1234' });
  if (!auth.token) { console.log(nickname, 'skipped:', auth.error); continue; }
  token = auth.token;
  if (CODES.length) await req('POST', '/players/me/section', { code: CODES[i % CODES.length] });
  let skill = rnd(0.45, 0.7);
  const quiz = async (kind) => {
    const { items } = await req('GET', `/quiz/${kind}`);
    const answers = items.map((it) => {
      const truth = quizPools[kind].find((q) => q.id === it.id).isPhishing;
      const right = Math.random() < skill;
      return { itemId: it.id, choice: (right ? truth : !truth) ? 'phishing' : 'legit', confidence: right ? Math.round(rnd(2.5, 5.4)) : Math.round(rnd(1, 4.6)) };
    });
    return req('POST', `/quiz/${kind}/submit`, { answers });
  };
  const pre = await quiz('pre');
  if (pre.error) { console.log(nickname, 'skipped:', pre.error); continue; }
  const group = auth.player.group;
  let rounds = 0;
  if (group === 'control') {
    await req('POST', '/players/me/reading-done');
    skill = Math.min(0.95, skill + rnd(0, 0.05)); // little change without training
  } else {
    rounds = Math.floor(rnd(2, 5));
    for (let r = 0; r < rounds; r++) {
      const prog = await req('GET', '/players/me/progress');
      const s = await req('POST', '/sessions', { level: prog.unlockedLevel });
      for (const sc of s.scenarios) {
        const truth = scenarios.find((x) => x.id === sc.id);
        const right = Math.random() < skill + 0.1 - (sc.difficulty - 1) * 0.08;
        const keys = flagPartKeys(truth).filter(() => Math.random() < skill);
        await req('POST', `/sessions/${s.sessionId}/answers`, { scenarioId: sc.id, choice: (right ? truth.isPhishing : !truth.isPhishing) ? 'phishing' : 'legit', timeMs: Math.round(rnd(6, sc.timeLimit - 2) * 1000), clickedParts: right ? keys : [] });
      }
      await req('POST', `/sessions/${s.sessionId}/finish`);
      skill = Math.min(0.97, skill + rnd(0.05, 0.12));
    }
  }
  const p = await quiz('post');
  if (group === 'experimental') {
    await req('POST', '/surveys/sus', { answers: Array.from({ length: 10 }, (_, k) => (k % 2 === 0 ? L() : 6 - L())) });
    await req('POST', '/surveys/iso25010', { answers: Object.fromEntries(ISO_ITEMS.map((it) => [it.id, L()])) });
  }
  console.log(`${nickname} [${group}]: pre ${pre.percent}% -> post ${p.percent}% after ${rounds} rounds`);
}
