// Research analytics computed in JS from raw rows (dialect-free and easy to audit).
import { describe, mean, pairedTTest, wilcoxonSignedRank, welchTTest, mannWhitney, sd } from './stats.js';
import { SUS_ITEMS, ISO_ITEMS, susGrade, likertLabel } from '../data/surveys.js';

const r1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 1000) / 1000);
const pct = (a) => (100 * a.score) / a.total;

/** First attempt of each quiz kind per player → { [playerId]: { pre, post, retention } } (percent). */
export function firstScores(attempts) {
  const out = {};
  for (const a of attempts) {
    out[a.player_id] ??= {};
    if (out[a.player_id][a.kind] == null) out[a.player_id][a.kind] = pct(a);
  }
  return out;
}

const roundTest = (t) => t && Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v]));

export function groupComparison(players, attempts) {
  const scores = firstScores(attempts);
  const groups = {};
  for (const g of ['experimental', 'control']) {
    const members = players.filter((p) => (p.group_name || 'experimental') === g).map((p) => ({ id: p.id, ...scores[p.id] }));
    const pre = members.filter((m) => m.pre != null).map((m) => m.pre);
    const post = members.filter((m) => m.post != null).map((m) => m.post);
    const ret = members.filter((m) => m.retention != null).map((m) => m.retention);
    const paired = members.filter((m) => m.pre != null && m.post != null);
    const pairedRet = members.filter((m) => m.post != null && m.retention != null);
    const pPre = mean(paired.map((m) => m.pre)), pPost = mean(paired.map((m) => m.post));
    groups[g] = {
      players: members.length,
      pre: describe(pre), post: describe(post), retention: describe(ret),
      pairedCount: paired.length,
      pairedAvgPre: r1(pPre), pairedAvgPost: r1(pPost),
      improvementPoints: paired.length ? r1(pPost - pPre) : null,
      improvementPercent: pPre ? r1(((pPost - pPre) / pPre) * 100) : null,
      improvedBy20: paired.filter((m) => (m.pre > 0 ? (m.post - m.pre) / m.pre >= 0.2 : m.post > 0)).length,
      gains: paired.map((m) => m.post - m.pre),
      tTest: roundTest(pairedTTest(paired.map((m) => m.pre), paired.map((m) => m.post))),
      wilcoxon: roundTest(wilcoxonSignedRank(paired.map((m) => m.pre), paired.map((m) => m.post))),
      retentionTTest: roundTest(pairedTTest(pairedRet.map((m) => m.post), pairedRet.map((m) => m.retention))),
      retentionWilcoxon: roundTest(wilcoxonSignedRank(pairedRet.map((m) => m.post), pairedRet.map((m) => m.retention))),
    };
    for (const k of ['pre', 'post', 'retention']) for (const f of ['mean', 'sd', 'median']) groups[g][k][f] = r1(groups[g][k][f]);
  }
  const between = {
    gainWelch: roundTest(welchTTest(groups.control.gains, groups.experimental.gains)),
    gainMannWhitney: roundTest(mannWhitney(groups.control.gains, groups.experimental.gains)),
    meanGainExperimental: r1(mean(groups.experimental.gains)), meanGainControl: r1(mean(groups.control.gains)),
  };
  for (const g of Object.values(groups)) delete g.gains;
  return { groups, between };
}

/** Confidence calibration from quiz answers that carry a 1-5 confidence rating. */
export function confidenceStats(attempts) {
  const byKind = {};
  const all = { answers: 0, wrong: 0, confidentlyWrong: 0, confCorrect: [], confWrong: [] };
  for (const a of attempts) {
    const k = (byKind[a.kind] ??= { answers: 0, wrong: 0, confidentlyWrong: 0, confCorrect: [], confWrong: [] });
    for (const x of a.answers || []) {
      if (typeof x.confidence !== 'number') continue;
      for (const bucket of [k, all]) {
        bucket.answers++;
        if (x.correct) bucket.confCorrect.push(x.confidence);
        else { bucket.wrong++; bucket.confWrong.push(x.confidence); if (x.confidence >= 4) bucket.confidentlyWrong++; }
      }
    }
  }
  const fmt = (b) => ({
    answers: b.answers, wrong: b.wrong, confidentlyWrong: b.confidentlyWrong,
    confidentlyWrongRate: b.answers ? r1((100 * b.confidentlyWrong) / b.answers) : null, // % of all answers
    confidentlyWrongShareOfErrors: b.wrong ? r1((100 * b.confidentlyWrong) / b.wrong) : null, // % of wrong answers
    avgConfidenceCorrect: r1(mean(b.confCorrect)), avgConfidenceWrong: r1(mean(b.confWrong)),
  });
  return { overall: fmt(all), byKind: Object.fromEntries(Object.entries(byKind).map(([k, b]) => [k, fmt(b)])) };
}

export function surveyStats(surveys) {
  const sus = surveys.filter((s) => s.kind === 'sus');
  const susScores = sus.map((s) => Number(s.score));
  const susMean = mean(susScores);
  const susItems = SUS_ITEMS.map((text, i) => ({ item: i + 1, text, mean: r1(mean(sus.map((s) => s.answers[i]))) }));
  const iso = surveys.filter((s) => s.kind === 'iso25010');
  const chars = [...new Set(ISO_ITEMS.map((i) => i.characteristic))];
  const characteristics = chars.map((c) => {
    const ids = ISO_ITEMS.filter((i) => i.characteristic === c).map((i) => i.id);
    const vals = iso.flatMap((s) => ids.map((id) => s.answers[id]).filter((v) => typeof v === 'number'));
    const m = mean(vals);
    return { characteristic: c, n: iso.length, mean: m == null ? null : Math.round(m * 100) / 100, sd: r1(sd(vals)), interpretation: likertLabel(m) };
  });
  const overall = mean(characteristics.map((c) => c.mean).filter((v) => v != null));
  return {
    sus: { n: sus.length, mean: r1(susMean), sd: r1(sd(susScores)), grade: susGrade(susMean), items: susItems },
    iso25010: { n: iso.length, characteristics, overallMean: overall == null ? null : Math.round(overall * 100) / 100, overallInterpretation: likertLabel(overall) },
  };
}
