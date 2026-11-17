// Simulates demo players through the real API so the admin dashboard has data
// to show. Players are named demo_student01..N. Remove them with `npm run seed` (full reset).
// Usage: node scripts/demo-data.mjs [baseUrl] [players]
const BASE = (process.argv[2] || 'http://localhost:3000') + '/api';
const N = Number(process.argv[3] || 12);
const { scenarios } = await import('../server/src/data/scenarios.js');
const { quizPools } = await import('../server/src/data/quiz.js');
const { flagPartKeys } = await import('../server/src/lib/game.js');
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const get = (p) => fetch(BASE + p).then((r) => r.json());
const rnd = (a, b) => a + Math.random() * (b - a);

for (let i = 1; i <= N; i++) {
  const nickname = `demo_student${String(i).padStart(2, '0')}`;
  const player = await post('/players', { nickname });
  let skill = rnd(0.45, 0.7); // probability of a correct call
  const quiz = async (kind) => {
    const { items } = await get(`/quiz/${kind}`);
    const answers = items.map((it) => {
      const truth = quizPools[kind].find((q) => q.id === it.id).isPhishing;
      const ok = Math.random() < skill;
      return { itemId: it.id, choice: (ok ? truth : !truth) ? 'phishing' : 'legit' };
    });
    return post(`/quiz/${kind}/submit`, { playerId: player.id, answers });
  };
  const pre = await quiz('pre');
  if (pre.error) { console.log(nickname, 'skipped:', pre.error); continue; }
  const rounds = Math.floor(rnd(2, 5));
  for (let r = 0; r < rounds; r++) {
    const prog = await get(`/players/${player.id}/progress`);
    const s = await post('/sessions', { playerId: player.id, level: prog.unlockedLevel });
    for (const sc of s.scenarios) {
      const truth = scenarios.find((x) => x.id === sc.id);
      const ok = Math.random() < skill + 0.1 - (sc.difficulty - 1) * 0.08;
      const keys = flagPartKeys(truth).filter(() => Math.random() < skill);
      await post(`/sessions/${s.sessionId}/answers`, {
        scenarioId: sc.id, choice: (ok ? truth.isPhishing : !truth.isPhishing) ? 'phishing' : 'legit',
        timeMs: Math.round(rnd(6, sc.timeLimit - 2) * 1000), clickedParts: ok ? keys : [],
      });
    }
    await post(`/sessions/${s.sessionId}/finish`);
    skill = Math.min(0.97, skill + rnd(0.05, 0.12)); // learning effect
  }
  const p = await quiz('post');
  console.log(`${nickname}: pre ${pre.percent}% -> post ${p.percent}% after ${rounds} rounds`);
}
