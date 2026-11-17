// Small, dependency-free statistics helpers for the research report.
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

// ── distributions ──
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
/** Regularized incomplete beta I_x(a, b) */
export function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Two-tailed p-value for Student's t with df degrees of freedom */
export const tTwoTailed = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);
/** Standard normal CDF */
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

// ── tests ──
/** Paired-samples t-test (after − before). */
export function pairedTTest(before, after) {
  const d = after.map((y, i) => y - before[i]);
  const n = d.length;
  if (n < 2) return { n, insufficient: true };
  const md = mean(d), sdd = sd(d);
  if (!sdd) return { n, meanDiff: md, sdDiff: 0, t: null, df: n - 1, p: md === 0 ? 1 : 0, cohensD: null, note: 'All differences are identical' };
  const t = md / (sdd / Math.sqrt(n));
  return { n, meanDiff: md, sdDiff: sdd, t, df: n - 1, p: tTwoTailed(t, n - 1), cohensD: md / sdd };
}

/** Welch's independent-samples t-test (b − a). */
export function welchTTest(a, b) {
  if (a.length < 2 || b.length < 2) return { nA: a.length, nB: b.length, insufficient: true };
  const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
  const diff = mean(b) - mean(a);
  if (va + vb === 0) return { nA: a.length, nB: b.length, meanDiff: diff, t: null, df: null, p: diff === 0 ? 1 : 0 };
  const t = diff / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const pooled = Math.sqrt(((a.length - 1) * sd(a) ** 2 + (b.length - 1) * sd(b) ** 2) / (a.length + b.length - 2));
  return { nA: a.length, nB: b.length, meanDiff: diff, t, df, p: tTwoTailed(t, df), cohensD: pooled ? diff / pooled : null };
}

const rankAbs = (vals) => {
  const idx = vals.map((v, i) => [Math.abs(v), i]).sort((x, y) => x[0] - y[0]);
  const ranks = new Array(vals.length); const ties = [];
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, ties };
};

/** Wilcoxon signed-rank test (normal approximation with tie and continuity correction). */
export function wilcoxonSignedRank(before, after) {
  const d = after.map((y, i) => y - before[i]).filter((x) => x !== 0);
  const n = d.length;
  if (n < 1) return { n: 0, insufficient: true, note: 'No non-zero differences' };
  const { ranks, ties } = rankAbs(d);
  const wPlus = d.reduce((s, x, i) => s + (x > 0 ? ranks[i] : 0), 0);
  const wMinus = (n * (n + 1)) / 2 - wPlus;
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - ties.reduce((s, t) => s + (t ** 3 - t), 0) / 48);
  if (!sigma) return { n, wPlus, wMinus, z: null, p: 1 };
  const W = Math.min(wPlus, wMinus);
  const z = (W - mu + 0.5) / sigma; // continuity-corrected, ≤ 0
  const p = Math.min(1, 2 * normCdf(z));
  return { n, wPlus, wMinus, W, z: wPlus >= wMinus ? -z : z, p, r: Math.abs(z) / Math.sqrt(n), approximate: n < 20 };
}

/** Mann-Whitney U (normal approximation). */
export function mannWhitney(a, b) {
  if (!a.length || !b.length) return { insufficient: true };
  const all = [...a.map((v) => [v, 0]), ...b.map((v) => [v, 1])].sort((x, y) => x[0] - y[0]);
  const ranks = new Array(all.length); let tieSum = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[k] = (i + j + 2) / 2;
    const t = j - i + 1; if (t > 1) tieSum += t ** 3 - t;
    i = j + 1;
  }
  const rA = all.reduce((s, x, i) => s + (x[1] === 0 ? ranks[i] : 0), 0);
  const n1 = a.length, n2 = b.length, N = n1 + n2;
  const U1 = rA - (n1 * (n1 + 1)) / 2, U = Math.min(U1, n1 * n2 - U1);
  const sigma = Math.sqrt(((n1 * n2) / 12) * (N + 1 - tieSum / (N * (N - 1))));
  if (!sigma) return { U, z: null, p: 1 };
  const z = (U - (n1 * n2) / 2 + 0.5) / sigma;
  return { U, z, p: Math.min(1, 2 * normCdf(z)), r: Math.abs(z) / Math.sqrt(N) };
}

export const describe = (a) => ({ n: a.length, mean: mean(a), sd: sd(a), median: median(a), min: a.length ? Math.min(...a) : null, max: a.length ? Math.max(...a) : null });
