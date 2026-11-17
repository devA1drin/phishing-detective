// Scoped research data, educator reports and the Chapter 4 results PDF.
import PDFDocument from 'pdfkit';
import { groupComparison, confidenceStats, surveyStats, firstScores } from './analytics.js';
import { CATEGORIES, CATEGORY_KEYS, weaknessScore, weakCategories } from './categories.js';
import { BADGES } from './badges.js';

const r1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const accuracyOf = (rows) => (rows.length ? r1((100 * rows.filter((a) => a.is_correct).length) / rows.length) : null);

/** All study rows the admin may see. */
export async function scopedData(repo, scope) {
  const keep = (pid) => scope.has(pid);
  const players = (await repo.listPlayersWithStats()).filter((p) => keep(p.id));
  return {
    scope,
    players,
    attempts: (await repo.listQuizAttempts()).filter((a) => keep(a.player_id)),
    surveys: (await repo.listSurveys()).filter((s) => keep(s.player_id)),
    sessions: (await repo.listSessions()).filter((s) => keep(s.playerId)),
    answers: (await repo.listAnswersExport()).filter((a) => keep(a.player_id)),
    categories: (await repo.listCategoryStats()).filter((c) => keep(c.player_id)),
  };
}

export function totals(d) {
  const group = (key) => Object.values(d.answers.reduce((m, a) => { (m[a[key]] ??= { [key]: a[key], rows: [] }).rows.push(a); return m; }, {}))
    .map((g) => ({ [key]: g[key], n: g.rows.length, accuracy: accuracyOf(g.rows) })).sort((x, y) => (x[key] > y[key] ? 1 : -1));
  return {
    players: d.players.length, sessions: d.sessions.filter((s) => s.finishedAt).length, started: d.sessions.length,
    answers: d.answers.length, correct: d.answers.filter((a) => a.is_correct).length,
    avgTimeMs: avg(d.answers.map((a) => Number(a.time_ms))), byLevel: group('level'), byChannel: group('channel'),
  };
}

export function scenarioStatsFrom(globalRows, answers) {
  const by = answers.reduce((m, a) => { (m[a.scenario_id] ??= []).push(a); return m; }, {});
  return globalRows.map((s) => {
    const rows = by[s.id] || [];
    const misses = rows.filter((a) => !a.is_correct).length;
    return { ...s, attempts: rows.length, link_clicks: rows.filter((a) => a.link_clicked).length, misses, miss_rate: rows.length ? r1((100 * misses) / rows.length) : null, avg_time_ms: rows.length ? Math.round(avg(rows.map((a) => Number(a.time_ms)))) : null };
  }).sort((a, b) => (b.miss_rate ?? -1) - (a.miss_rate ?? -1) || b.attempts - a.attempts);
}

export function categorySummary(rows) {
  const sum = {};
  for (const r of rows) { const c = (sum[r.category] ??= { category: r.category, seen: 0, missed: 0 }); c.seen += Number(r.seen); c.missed += Number(r.missed); }
  return CATEGORY_KEYS.filter((k) => sum[k]).map((k) => ({ ...sum[k], label: CATEGORIES[k].label, missRate: sum[k].seen ? r1((100 * sum[k].missed) / sum[k].seen) : null, weakness: Math.round(weaknessScore(sum[k]) * 100) / 100 }))
    .sort((a, b) => b.weakness - a.weakness);
}

export function buildStats(d, extra = {}) {
  const t = totals(d);
  const { groups, between } = groupComparison(d.players, d.attempts);
  const scores = Object.values(firstScores(d.attempts));
  const paired = scores.filter((s) => s.pre != null && s.post != null);
  const exp = groups.experimental;
  const only = (k) => scores.filter((s) => s[k] != null).map((s) => s[k]);
  return {
    scope: { label: d.scope.label, all: d.scope.all, sections: d.scope.chosen.map((s) => ({ id: s.id, name: s.name })) },
    players: t.players, sessions: t.sessions, startedSessions: t.started, answers: t.answers,
    accuracy: t.answers ? r1((100 * t.correct) / t.answers) : null, avgTimeSec: t.avgTimeMs ? r1(t.avgTimeMs / 1000) : null,
    quiz: {
      preCount: only('pre').length, postCount: only('post').length, retentionCount: only('retention').length,
      avgPre: r1(avg(only('pre'))), avgPost: r1(avg(only('post'))), avgRetention: r1(avg(only('retention'))),
      pairedCount: paired.length, pairedAvgPre: r1(avg(paired.map((s) => s.pre))), pairedAvgPost: r1(avg(paired.map((s) => s.post))),
      improvementPoints: exp.improvementPoints, improvementPercent: exp.improvementPercent,
      targetMet: exp.improvementPercent != null ? exp.improvementPercent >= 20 : null,
      playersImprovedBy20: exp.improvedBy20, experimentalPairedCount: exp.pairedCount,
    },
    groups, between,
    confidence: confidenceStats(d.attempts),
    surveys: surveyStats(d.surveys),
    categories: categorySummary(d.categories),
    byLevel: t.byLevel, byChannel: t.byChannel,
    ...extra,
  };
}

/** One student's weakness report. */
export async function studentReport(repo, playerId) {
  const p = await repo.getPlayer(playerId);
  if (!p) return null;
  const section = p.section_id ? await repo.getSection(p.section_id) : null;
  const attempts = await repo.listPlayerQuizAttempts(p.id);
  const first = firstScores(attempts.map((a) => ({ ...a, player_id: p.id })))[p.id] || {};
  const sessions = (await repo.listPlayerSessions(p.id)).filter((s) => s.finishedAt);
  const cats = await repo.getCategoryStats(p.id);
  const answers = (await repo.listAnswersExport()).filter((a) => Number(a.player_id) === p.id);
  const scen = new Map((await repo.listScenarios()).map((s) => [s.id, s]));
  const missed = answers.filter((a) => !a.is_correct).slice(-12).reverse().map((a) => {
    const s = scen.get(a.scenario_id);
    return { scenarioId: a.scenario_id, label: s ? s.subject || `${s.channel.toUpperCase()} from ${s.senderName}` : a.scenario_id, channel: a.channel, isPhishing: !!a.is_phishing, choice: a.choice, linkClicked: !!a.link_clicked, at: a.created_at };
  });
  const quizAnswers = attempts.flatMap((a) => a.answers || []);
  const badges = await repo.getBadges(p.id);
  const categories = CATEGORY_KEYS.map((k) => {
    const r = cats.find((c) => c.category === k) || { seen: 0, missed: 0 };
    return { category: k, label: CATEGORIES[k].label, seen: Number(r.seen), missed: Number(r.missed), missRate: r.seen ? r1((100 * r.missed) / r.seen) : null, weakness: Math.round(weaknessScore(r) * 100) / 100 };
  });
  const weak = weakCategories(cats, { min: 2, top: 3 }).map((w) => ({ ...w, tip: CATEGORIES[w.category].tip }));
  return {
    player: { id: p.id, nickname: p.nickname, group: p.group_name, section: section ? { id: section.id, name: section.name } : null, joinedAt: p.created_at },
    quiz: { pre: r1(first.pre), post: r1(first.post), retention: r1(first.retention), gain: first.pre != null && first.post != null ? r1(first.post - first.pre) : null, attempts: attempts.length,
      confidentlyWrong: quizAnswers.filter((x) => !x.correct && x.confidence >= 4).length },
    game: { rounds: sessions.length, answers: answers.length, accuracy: accuracyOf(answers), totalScore: sessions.reduce((s, x) => s + x.score, 0), linkClicks: answers.filter((a) => a.link_clicked && !a.is_correct).length,
      byChannel: Object.entries(answers.reduce((m, a) => { (m[a.channel] ??= []).push(a); return m; }, {})).map(([channel, rows]) => ({ channel, n: rows.length, accuracy: accuracyOf(rows) })) },
    categories, weak, missed,
    badges: badges.map((b) => ({ id: b.badge_id, name: BADGES.find((x) => x.id === b.badge_id)?.name || b.badge_id, earnedAt: b.earned_at })),
  };
}

/** Class roll-up: one row per student plus the class's weakest categories. */
export function sectionRows(d) {
  const first = firstScores(d.attempts);
  const catsBy = d.categories.reduce((m, c) => { (m[c.player_id] ??= []).push(c); return m; }, {});
  return d.players.map((p) => {
    const f = first[p.id] || {};
    const w = weakCategories(catsBy[p.id] || [], { min: 2, top: 1 })[0];
    return { id: p.id, nickname: p.nickname, group: p.group_name, section: p.section_name, pre: r1(f.pre), post: r1(f.post), retention: r1(f.retention), gain: f.pre != null && f.post != null ? r1(f.post - f.pre) : null, rounds: p.sessions, accuracy: p.accuracy, weakest: w ? `${w.label} (${Math.round(w.weakness * 100)}%)` : null };
  });
}

// ── Chapter 4 PDF ──
const fmtP = (p) => (p == null ? '-' : p < 0.001 ? '< .001' : p.toFixed(3).replace(/^0/, ''));
const f2 = (v) => (v == null ? '-' : Number(v).toFixed(2));
const f1 = (v) => (v == null ? '-' : Number(v).toFixed(1));
const sig = (t) => (!t || t.insufficient || t.p == null ? 'insufficient data' : t.p < 0.05 ? 'significant (p < .05)' : 'not significant (p >= .05)');

export function renderChapter4Pdf(stats, meta, out) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 64, right: 64 }, info: { Title: 'Phishing Detective - Chapter 4 Results', Author: meta.generatedBy } });
  doc.pipe(out);
  const W = doc.page.width - 128;
  let tableNo = 0;
  const h1 = (t) => { doc.moveDown(0.6).font('Times-Bold').fontSize(14).fillColor('#000').text(t); doc.moveDown(0.3); };
  const para = (t) => { doc.font('Times-Roman').fontSize(11).fillColor('#000').text(t, { align: 'justify', width: W }); doc.moveDown(0.4); };
  const table = (title, head, rows, widths) => {
    tableNo++;
    const total = widths.reduce((a, b) => a + b, 0); const ws = widths.map((w) => (w / total) * W);
    const need = 34 + 18 * (rows.length + 1);
    if (doc.y + need > doc.page.height - 70) doc.addPage();
    doc.font('Times-Bold').fontSize(11).text(`Table 4.${tableNo}`, { width: W });
    doc.font('Times-Italic').fontSize(11).text(title, { width: W }); doc.moveDown(0.2);
    const x0 = doc.page.margins.left;
    const line = (y, w = 1) => doc.moveTo(x0, y).lineTo(x0 + W, y).lineWidth(w).stroke('#000');
    const row = (cells, bold) => {
      const y = doc.y; let x = x0;
      const hgt = Math.max(...cells.map((c, i) => doc.font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(10).heightOfString(String(c ?? '-'), { width: ws[i] - 6 }))) + 6;
      if (y + hgt > doc.page.height - 60) { doc.addPage(); return row(cells, bold); }
      cells.forEach((c, i) => { doc.font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(10).text(String(c ?? '-'), x + 3, y + 3, { width: ws[i] - 6, align: i === 0 ? 'left' : 'center' }); x += ws[i]; });
      doc.y = y + hgt; doc.x = x0;
    };
    line(doc.y, 1); row(head, true); line(doc.y, 0.6);
    rows.forEach((r) => row(r));
    line(doc.y, 1); doc.moveDown(0.6); doc.x = x0;
  };

  doc.font('Times-Bold').fontSize(16).text('CHAPTER 4', { align: 'center' });
  doc.fontSize(14).text('PRESENTATION, ANALYSIS AND INTERPRETATION OF DATA', { align: 'center' });
  doc.moveDown(0.4).font('Times-Italic').fontSize(10).fillColor('#333')
    .text(`Phishing Detective: a gamified phishing-awareness tool · Data scope: ${stats.scope.label} · Generated ${meta.generatedAt} (Asia/Manila) by ${meta.generatedBy}`, { align: 'center' });
  doc.fillColor('#000');

  const g = stats.groups; const e = g.experimental; const c = g.control;
  h1('4.1 Profile of the Participants');
  para(`A total of ${stats.players} participants registered under the study's data privacy consent (RA 10173). ${g.experimental.players} were randomly assigned to the experimental group (gameplay) and ${g.control.players} to the wait-list control group (reading task). ${stats.quiz.preCount} completed the pre-test, ${stats.quiz.postCount} the post-test, and ${stats.quiz.retentionCount} the retention test. Participants played ${stats.sessions} rounds and judged ${stats.answers} messages with ${f1(stats.accuracy)}% overall accuracy.`);
  table('Number of participants per group and assessment', ['Group', 'Registered', 'Pre-test', 'Post-test', 'Retention', 'Paired pre/post'],
    [['Experimental', e.players, e.pre.n, e.post.n, e.retention.n, e.pairedCount], ['Control', c.players, c.pre.n, c.post.n, c.retention.n, c.pairedCount]], [2, 1.2, 1, 1, 1, 1.4]);

  h1('4.2 Phishing-Awareness Scores Before and After the Intervention');
  const desc = (name, x) => [name, x.n, f1(x.mean), f1(x.sd), f1(x.median), x.min == null ? '-' : f1(x.min), x.max == null ? '-' : f1(x.max)];
  table('Descriptive statistics of awareness scores (percent correct, first attempt)', ['Group / Test', 'n', 'Mean', 'SD', 'Median', 'Min', 'Max'], [
    desc('Experimental - Pre-test', e.pre), desc('Experimental - Post-test', e.post), desc('Experimental - Retention', e.retention),
    desc('Control - Pre-test', c.pre), desc('Control - Post-test', c.post), desc('Control - Retention', c.retention),
  ], [3, 0.7, 1, 1, 1, 0.9, 0.9]);
  const tRow = (name, t) => (t?.insufficient ? [name, t.n ?? '-', '-', '-', '-', '-', '-', 'insufficient data'] : [name, t?.n, f2(t?.meanDiff), f2(t?.t), t?.df ?? '-', fmtP(t?.p), f2(t?.cohensD), sig(t)]);
  table('Paired-samples t-test: post-test vs pre-test', ['Group', 'n', 'Mean diff.', 't', 'df', 'p', "Cohen's d", 'Interpretation'],
    [tRow('Experimental', e.tTest), tRow('Control', c.tTest)], [1.6, 0.6, 1, 0.8, 0.6, 0.8, 0.9, 2]);
  const wRow = (name, w) => (w?.insufficient ? [name, w.n ?? 0, '-', '-', '-', '-', 'insufficient data'] : [name, w?.n, f1(w?.W), f2(w?.z), fmtP(w?.p), f2(w?.r), sig(w)]);
  table('Wilcoxon signed-rank test: post-test vs pre-test (non-parametric check)', ['Group', 'n (non-zero)', 'W', 'z', 'p', 'r', 'Interpretation'],
    [wRow('Experimental', e.wilcoxon), wRow('Control', c.wilcoxon)], [1.6, 1, 0.8, 0.8, 0.8, 0.7, 2]);
  para(`The experimental group's mean score changed from ${f1(e.pairedAvgPre)}% to ${f1(e.pairedAvgPost)}% (${e.improvementPoints == null ? '-' : `${e.improvementPoints >= 0 ? '+' : ''}${f1(e.improvementPoints)} percentage points`}, a ${f1(e.improvementPercent)}% relative improvement), which is ${sig(e.tTest)} by the paired t-test and ${sig(e.wilcoxon)} by the Wilcoxon signed-rank test. ${stats.quiz.targetMet == null ? 'The 20% improvement target cannot be evaluated yet.' : stats.quiz.targetMet ? 'This meets the study objective of at least a 20% improvement.' : 'This does not yet meet the study objective of a 20% improvement.'} ${e.improvedBy20} of ${e.pairedCount} paired participants individually improved by at least 20%.`);

  h1('4.3 Retention of Learning');
  table('Paired-samples t-test and Wilcoxon test: retention vs post-test', ['Group', 'Test', 'n', 'Mean diff. / W', 't / z', 'p', 'Interpretation'], [
    ['Experimental', 'Paired t', e.retentionTTest?.n ?? 0, f2(e.retentionTTest?.meanDiff), f2(e.retentionTTest?.t), fmtP(e.retentionTTest?.p), sig(e.retentionTTest)],
    ['Experimental', 'Wilcoxon', e.retentionWilcoxon?.n ?? 0, f1(e.retentionWilcoxon?.W), f2(e.retentionWilcoxon?.z), fmtP(e.retentionWilcoxon?.p), sig(e.retentionWilcoxon)],
    ['Control', 'Paired t', c.retentionTTest?.n ?? 0, f2(c.retentionTTest?.meanDiff), f2(c.retentionTTest?.t), fmtP(c.retentionTTest?.p), sig(c.retentionTTest)],
  ], [1.4, 1, 0.6, 1.2, 0.8, 0.8, 2]);
  para('A non-significant difference between the post-test and the retention test indicates that the knowledge gained was retained over the retention interval.');

  h1('4.4 Comparison Between Groups');
  const b = stats.between;
  table('Score gain (post - pre): experimental vs control', ['Test', 'Statistic', 'df', 'p', 'Effect size', 'Interpretation'], [
    ['Welch t-test', f2(b.gainWelch?.t), f1(b.gainWelch?.df), fmtP(b.gainWelch?.p), `d = ${f2(b.gainWelch?.cohensD)}`, sig(b.gainWelch)],
    ['Mann-Whitney U', `U = ${f1(b.gainMannWhitney?.U)}`, '-', fmtP(b.gainMannWhitney?.p), `r = ${f2(b.gainMannWhitney?.r)}`, sig(b.gainMannWhitney)],
  ], [1.5, 1.2, 0.6, 0.8, 1.1, 2]);
  para(`Mean gain was ${f1(b.meanGainExperimental)} points for the experimental group and ${f1(b.meanGainControl)} points for the control group.`);

  h1('4.5 In-Game Performance');
  table('Detection accuracy by level and by channel', ['Breakdown', 'Answers', 'Accuracy (%)'], [
    ...stats.byLevel.map((l) => [`Level ${l.level}`, l.n, f1(l.accuracy)]),
    ...stats.byChannel.map((ch) => [`Channel: ${ch.channel}`, ch.n, f1(ch.accuracy)]),
  ], [2, 1, 1]);
  if (stats.categories.length) {
    table('Red-flag categories ranked by weakness (missed / seen)', ['Category', 'Seen', 'Missed', 'Miss rate (%)'],
      stats.categories.map((x) => [x.label, x.seen, x.missed, f1(x.missRate)]), [2.6, 0.8, 0.8, 1]);
  }
  const conf = stats.confidence.overall;
  para(`Confidence calibration: ${conf.answers} quiz answers carried a 1-5 confidence rating; ${conf.confidentlyWrong} (${f1(conf.confidentlyWrongRate)}%) were wrong with confidence of 4 or 5. Average confidence was ${f1(conf.avgConfidenceCorrect)} on correct and ${f1(conf.avgConfidenceWrong)} on wrong answers.`);

  h1('4.6 Usability and Software Quality');
  const sus = stats.surveys.sus; const iso = stats.surveys.iso25010;
  table('System Usability Scale (SUS)', ['n', 'Mean', 'SD', 'Grade / adjective'], [[sus.n, f1(sus.mean), f1(sus.sd), sus.grade ? `${sus.grade.adjective} (${sus.grade.acceptability})` : '-']], [1, 1, 1, 2]);
  table('ISO/IEC 25010 software quality evaluation', ['Characteristic', 'n', 'Mean', 'SD', 'Interpretation'],
    [...iso.characteristics.map((x) => [x.characteristic, x.n, f2(x.mean), f1(x.sd), x.interpretation || '-']), ['Overall', iso.n, f2(iso.overallMean), '-', iso.overallInterpretation || '-']], [2.2, 0.6, 0.8, 0.7, 1.6]);

  doc.moveDown(0.5).font('Times-Italic').fontSize(9).fillColor('#444').text('Notes. Scores are the percent correct on each participant\'s first attempt. Two-tailed tests at alpha = .05. Wilcoxon and Mann-Whitney use the normal approximation with tie and continuity corrections (approximate for n < 20). Cohen\'s d for paired tests = mean difference / SD of differences. All statistics are computed server-side by Phishing Detective from the raw study records; exports are available as CSV for verification in SPSS, JASP or R.', { width: W });
  doc.end();
}
