// Adaptive selection: rounds lean towards the red-flag categories a player misses most.
import { scenarioCategories, weaknessScore, weakCategories } from './categories.js';

const MIN_EVIDENCE = 4; // answers needed before adapting (until then: plain random)

/** Returns { weight(scenario) | null, focus: [{category,label,...}] } */
export function adaptiveWeight(rows) {
  const evidence = rows.reduce((a, r) => a + Number(r.seen || 0), 0);
  if (evidence < MIN_EVIDENCE) return { weight: null, focus: [] };
  const byCat = Object.fromEntries(rows.map((r) => [r.category, weaknessScore(r)]));
  const weight = (s) => {
    const cats = scenarioCategories(s);
    const w = cats.reduce((a, c) => a + (byCat[c] ?? 0.5), 0) / cats.length;
    return 0.5 + 3 * w; // 0.5 (mastered) … 3.5 (always missed)
  };
  return { weight, focus: weakCategories(rows, { min: 2, top: 2 }) };
}
