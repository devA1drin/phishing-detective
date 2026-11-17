// Achievement badges, computed from the player's own records (no client trust).
const pct = (x) => (x ? (100 * x.score) / x.total : null);
const correctWhere = (ctx, pred) => ctx.answers.filter((a) => a.is_correct && pred(a)).length;

export const BADGES = [
  { id: 'rookie', icon: '🔰', name: 'Rookie Detective', desc: 'Finish your first round.', goal: 1, value: (c) => c.finished.length },
  { id: 'flawless', icon: '💎', name: 'Flawless', desc: 'Get every case right in a round of 5 or more.', goal: 1, value: (c) => c.finished.filter((s) => s.answered >= 5 && s.correct === s.answered).length },
  { id: 'hot-streak', icon: '🔥', name: 'Hot Streak', desc: 'Solve 5 cases in a row.', goal: 5, value: (c) => Math.max(0, ...c.sessions.map((s) => s.maxStreak || 0)) },
  { id: 'eagle-eye', icon: '🦅', name: 'Eagle Eye', desc: 'Find every red flag in 10 phishing cases.', goal: 10, value: (c) => correctWhere(c, (a) => a.is_phishing && (a.red_flags || []).length > 0 && a.flags_found >= a.red_flags.length) },
  { id: 'call-screener', icon: '📞', name: 'Call Screener', desc: 'Judge 3 phone calls correctly.', goal: 3, value: (c) => correctWhere(c, (a) => a.channel === 'call') },
  { id: 'qr-wise', icon: '🔳', name: 'QR Wise', desc: 'Judge 2 QR-code messages correctly.', goal: 2, value: (c) => correctWhere(c, (a) => (a.links || []).some((l) => l.qr)) },
  { id: 'lokal', icon: '🇵🇭', name: 'Lokal Detective', desc: 'Solve 5 Filipino or Taglish cases.', goal: 5, value: (c) => correctWhere(c, (a) => a.language === 'tl' || a.language === 'taglish') },
  { id: 'hands-off', icon: '🧤', name: 'Hands Off', desc: 'Clear an inbox round without opening a scam link.', goal: 1, value: (c) => c.finished.filter((s) => s.mode === 'inbox' && s.answered >= 6 && !c.answers.some((a) => a.session_id === s.id && a.link_clicked && !a.is_correct)).length },
  { id: 'master', icon: '🎖️', name: 'Master Detective', desc: 'Score 80%+ on a Level 3 round.', goal: 1, value: (c) => c.finished.filter((s) => s.mode !== 'daily' && s.level === 3 && s.answered && (100 * s.correct) / s.answered >= 80).length },
  { id: 'daily-habit', icon: '📅', name: 'Daily Habit', desc: 'Complete 3 daily challenges.', goal: 3, value: (c) => c.finished.filter((s) => s.mode === 'daily').length },
  { id: 'level-up', icon: '📈', name: 'Level Up', desc: 'Improve your quiz score by 20 points (or ace the post-quiz).', goal: 1, value: (c) => { const pre = pct(c.quiz.find((q) => q.kind === 'pre')); const post = pct(c.quiz.find((q) => q.kind === 'post')); return pre != null && post != null && (post - pre >= 20 || post === 100) ? 1 : 0; } },
  { id: 'research-partner', icon: '🧪', name: 'Research Partner', desc: 'Answer both feedback surveys.', goal: 2, value: (c) => new Set(c.surveys.map((s) => s.kind)).size },
];

export async function loadBadgeContext(repo, playerId) {
  const sessions = await repo.listPlayerSessions(playerId);
  return {
    sessions,
    finished: sessions.filter((s) => s.finishedAt),
    answers: await repo.listPlayerAnswerFacts(playerId),
    quiz: await repo.listPlayerQuizAttempts(playerId),
    surveys: await repo.listPlayerSurveys(playerId),
  };
}

/** Awards any newly earned badges and returns { badges: [...all with progress], newly: [...] }. */
export async function evaluateBadges(repo, playerId) {
  const ctx = await loadBadgeContext(repo, playerId);
  const have = new Map((await repo.getBadges(playerId)).map((b) => [b.badge_id, b.earned_at]));
  const newly = [];
  const rows = BADGES.map((b) => {
    const value = Math.min(b.goal, b.value(ctx));
    const earned = have.has(b.id) || value >= b.goal;
    if (earned && !have.has(b.id)) newly.push(b.id);
    return { id: b.id, icon: b.icon, name: b.name, desc: b.desc, goal: b.goal, progress: value, earned };
  });
  if (newly.length) await repo.awardBadges(playerId, newly);
  const after = new Map((await repo.getBadges(playerId)).map((b) => [b.badge_id, b.earned_at]));
  for (const r of rows) r.earnedAt = after.get(r.id) || null;
  return { badges: rows, newly: rows.filter((r) => newly.includes(r.id)) };
}
