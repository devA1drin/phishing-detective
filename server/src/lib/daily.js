// Daily challenge: the same 5 cases for everyone on a given Manila calendar day.
export const DAILY_SIZE = 5;
export const DAILY_TZ_OFFSET_H = 8; // Asia/Manila (no DST)

export const manilaDate = (d = new Date()) => new Date(d.getTime() + DAILY_TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

function seededRandom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Deterministic pick for a date: at least 1 legit and 2 phishing, mixed difficulty. */
export function dailyPick(all, date, size = DAILY_SIZE) {
  const rand = seededRandom(`pd-daily-${date}`);
  const pool = [...all].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = pool.slice(0, size);
  const rest = pool.slice(size);
  const ensure = (pred, min) => {
    while (out.filter(pred).length < min) {
      const k = rest.findIndex(pred); if (k < 0) return;
      const drop = out.findIndex((x) => !pred(x)); if (drop < 0) return;
      out[drop] = rest.splice(k, 1)[0];
    }
  };
  ensure((s) => !s.isPhishing, 1);
  ensure((s) => s.isPhishing, 2);
  return out;
}

/** Consecutive days played, ending today (or yesterday if today isn't played yet). */
export function dayStreak(dates, today = manilaDate()) {
  const set = new Set(dates);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
