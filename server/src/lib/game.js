// Core game rules: scenario selection, body segmentation, scoring, progression.

export const ROUND_SIZE = 8;
export const TIME_LIMITS = { 1: 40, 2: 35, 3: 30 }; // seconds per message, by difficulty
export const UNLOCK_ACCURACY = 70; // % accuracy needed in a finished round to unlock the next level
export const MAX_LEVEL = 3;
export const FLAG_BONUS = 20;
export const FALSE_CLICK_PENALTY = 10;

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Pick a randomized round for a level, weighted towards that level's difficulty. */
export function pickScenarios(all, level, size = ROUND_SIZE) {
  const plan = { 1: { 1: size }, 2: { 2: 5, 1: 3 }, 3: { 3: 5, 2: 3 } }[level];
  const chosen = [];
  for (const [diff, n] of Object.entries(plan)) {
    chosen.push(...shuffle(all.filter((s) => s.difficulty === Number(diff))).slice(0, n));
  }
  chosen.splice(size);
  if (chosen.length < size) {
    const rest = shuffle(all.filter((s) => !chosen.includes(s)));
    chosen.push(...rest.slice(0, size - chosen.length));
  }
  // Guarantee a mix: at least 2 legit and 2 phishing messages if available.
  const ensure = (wantPhish) => {
    if (chosen.filter((s) => s.isPhishing === wantPhish).length >= 2) return;
    const extra = shuffle(all.filter((s) => s.isPhishing === wantPhish && !chosen.includes(s) && Math.abs(s.difficulty - level) <= 1));
    while (chosen.filter((s) => s.isPhishing === wantPhish).length < 2 && extra.length) {
      const idx = chosen.findIndex((s) => s.isPhishing !== wantPhish);
      chosen[idx] = extra.pop();
    }
  };
  if (size >= 4) { ensure(true); ensure(false); }
  return shuffle(chosen);
}

/**
 * Split a body into clickable segments. Red-flag snippets become their own
 * segments, remaining text is split into sentences, and {{link:N}} placeholders
 * become link segments. Returns segments plus a map of flag -> part key.
 */
export function segmentBody(scenario) {
  const segments = [];
  const flagSnippets = (scenario.redFlags || []).filter((f) => f.target === 'body' && f.match).map((f) => f.match);
  const pushText = (text) => {
    if (!text) return;
    // sentence split, keeping newlines as non-clickable segments
    const parts = text.split(/(\n+)/);
    for (const p of parts) {
      if (!p) continue;
      if (/^\n+$/.test(p)) { segments.push({ type: 'break', text: p }); continue; }
      const sentences = (p.match(/[\s\S]*?(?:[.!?]+(?:\s+|$)|$)/g) || [p]).filter(Boolean);
      for (const s of sentences) {
        if (!s.trim()) segments.push({ type: 'space', text: s });
        else segments.push({ type: 'text', text: s });
      }
    }
  };
  const chunks = scenario.body.split(/(\{\{link:\d+\}\})/);
  for (const chunk of chunks) {
    const lm = chunk.match(/^\{\{link:(\d+)\}\}$/);
    if (lm) { segments.push({ type: 'link', index: Number(lm[1]) }); continue; }
    let rest = chunk;
    while (rest) {
      let best = null;
      for (const snip of flagSnippets) {
        const i = rest.indexOf(snip);
        if (i >= 0 && (best === null || i < best.i)) best = { i, snip };
      }
      if (!best) { pushText(rest); break; }
      pushText(rest.slice(0, best.i));
      segments.push({ type: 'text', text: best.snip });
      rest = rest.slice(best.i + best.snip.length);
    }
  }
  let n = 0;
  for (const s of segments) if (s.type === 'text') s.id = `seg:${n++}`;
  return segments;
}

/** Map each red flag to the clickable "part key" the client sends back. */
export function flagPartKeys(scenario, segments = segmentBody(scenario)) {
  return (scenario.redFlags || []).map((f) => {
    if (f.target === 'sender') return 'sender';
    if (f.target === 'subject') return 'subject';
    if (f.target === 'link') return `link:${f.index}`;
    if (f.target === 'attachment') return `att:${f.index}`;
    if (f.target === 'body') {
      const seg = segments.find((s) => s.type === 'text' && s.text === f.match);
      return seg ? seg.id : null;
    }
    return null;
  });
}

/** Scenario as sent to players: no answers, red flags, or explanation. */
export function publicScenario(s) {
  return {
    id: s.id, channel: s.channel, platform: s.platform, difficulty: s.difficulty,
    senderName: s.senderName, senderAddress: s.senderAddress, subject: s.subject,
    segments: segmentBody(s), links: s.links || [], attachments: s.attachments || [],
    timeLimit: TIME_LIMITS[s.difficulty] || 30,
  };
}

/** Score one answer. Returns everything needed for instant feedback. */
export function scoreAnswer(scenario, { choice, timeMs, clickedParts = [] }, currentStreak) {
  const limitMs = (TIME_LIMITS[scenario.difficulty] || 30) * 1000;
  const t = Math.max(0, Math.min(Number(timeMs) || limitMs, limitMs));
  const timedOut = choice !== 'phishing' && choice !== 'legit';
  const isCorrect = !timedOut && (choice === 'phishing') === scenario.isPhishing;
  const keys = flagPartKeys(scenario);
  const clicked = [...new Set(clickedParts.map(String))].slice(0, 30);
  const foundKeys = clicked.filter((k) => keys.includes(k));
  const falseClicks = clicked.length - foundKeys.length;

  const base = isCorrect ? 100 * scenario.difficulty : 0;
  const timeBonus = isCorrect ? Math.round(((limitMs - t) / limitMs) * 50) : 0;
  const streak = isCorrect ? currentStreak + 1 : 0;
  const multiplier = isCorrect ? 1 + Math.min(streak - 1, 5) * 0.1 : 1;
  const flagBonus = foundKeys.length * FLAG_BONUS - falseClicks * FALSE_CLICK_PENALTY;
  const points = Math.max(0, Math.round((base + timeBonus) * multiplier) + flagBonus);

  return {
    isCorrect, timedOut, isPhishing: scenario.isPhishing, timeMs: t,
    points, breakdown: { base, timeBonus, multiplier: Number(multiplier.toFixed(1)), flagBonus, streak },
    flagsFound: foundKeys.length, falseClicks, totalFlags: keys.length,
    redFlags: scenario.redFlags.map((f, i) => ({ ...f, partKey: keys[i], found: foundKeys.includes(keys[i]) })),
    safeSigns: scenario.safeSigns || [], explanation: scenario.explanation,
    falseClickParts: clicked.filter((k) => !keys.includes(k)),
  };
}

/** Levels unlocked based on finished rounds' accuracy. */
export function unlockedLevels(sessions) {
  let unlocked = 1;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    const passed = sessions.some((s) => s.finishedAt && s.level === lvl && s.answered > 0 && (100 * s.correct) / s.answered >= UNLOCK_ACCURACY);
    if (passed && unlocked === lvl) unlocked = lvl + 1;
  }
  return unlocked;
}

export function rankFor(totalScore) {
  if (totalScore >= 6000) return 'Chief Detective';
  if (totalScore >= 3000) return 'Senior Inspector';
  if (totalScore >= 1000) return 'Detective';
  return 'Rookie';
}
