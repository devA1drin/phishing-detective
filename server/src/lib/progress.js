// Study-flow rules shared by routes: who can play, which quizzes are unlocked.
import { parseTs } from '../db/drivers/common.js';
import { unlockedLevels, rankFor, MAX_LEVEL, UNLOCK_ACCURACY } from './game.js';
import { weakCategories } from './categories.js';

const DAY = 86_400_000;
const percent = (a) => Math.round((100 * a.score) / a.total);

export async function buildProgress(repo, player) {
  const settings = await repo.getSettings();
  const sessions = await repo.listPlayerSessions(player.id);
  const quizzes = await repo.listPlayerQuizAttempts(player.id);
  const surveys = await repo.listPlayerSurveys(player.id);
  const categoryStats = await repo.getCategoryStats(player.id);
  const finished = sessions.filter((s) => s.finishedAt);
  const group = player.group_name || 'experimental';
  const pre = quizzes.find((x) => x.kind === 'pre');
  const posts = quizzes.filter((x) => x.kind === 'post');
  const retention = quizzes.find((x) => x.kind === 'retention');
  const totalScore = finished.reduce((a, s) => a + s.score, 0);
  const answered = finished.reduce((a, s) => a + s.answered, 0);
  const correct = finished.reduce((a, s) => a + s.correct, 0);

  const readingDone = !!player.reading_done_at;
  const postQuizUnlocked = !!pre && (group === 'control' ? readingDone : finished.length >= settings.minRoundsForPost);
  const retentionUnlocksAt = posts[0] ? parseTs(posts[0].created_at) + settings.retentionDays * DAY : null;
  const retentionUnlocked = !!posts[0] && Date.now() >= retentionUnlocksAt;
  // Control group = wait-list control: gameplay opens only after their retention quiz.
  const canPlay = !!pre && (group === 'experimental' || !!retention);

  const section = player.section_id ? await repo.getSection(player.section_id) : null;
  return {
    section: section ? { id: section.id, name: section.name } : null,
    player: { id: player.id, nickname: player.nickname, group, consentAt: player.consent_at },
    canPlay, settings: { retentionDays: settings.retentionDays, minRoundsForPost: settings.minRoundsForPost },
    unlockedLevel: unlockedLevels(sessions), maxLevel: MAX_LEVEL, unlockAccuracy: UNLOCK_ACCURACY,
    totalScore, rank: rankFor(totalScore), roundsPlayed: finished.length,
    accuracy: answered ? Math.round((100 * correct) / answered) : null,
    bestStreak: finished.reduce((a, s) => Math.max(a, s.maxStreak), 0),
    levelBest: [1, 2, 3].map((lvl) => {
      const ls = finished.filter((s) => s.level === lvl && s.answered);
      return { level: lvl, bestAccuracy: ls.length ? Math.max(...ls.map((s) => Math.round((100 * s.correct) / s.answered))) : null, bestScore: ls.length ? Math.max(...ls.map((s) => s.score)) : null };
    }),
    weakSpots: weakCategories(categoryStats, { min: 2, top: 3 }),
    reading: { required: group === 'control', done: readingDone },
    preQuiz: pre ? { score: pre.score, total: pre.total, percent: percent(pre) } : null,
    postQuiz: posts.length ? { score: posts[0].score, total: posts[0].total, percent: percent(posts[0]), attempts: posts.length } : null,
    postQuizUnlocked,
    retentionQuiz: {
      taken: retention ? { score: retention.score, total: retention.total, percent: percent(retention) } : null,
      unlocked: retentionUnlocked && !retention,
      unlocksAt: retentionUnlocksAt ? new Date(retentionUnlocksAt).toISOString() : null,
    },
    surveys: {
      unlocked: !!posts.length && finished.length >= 1,
      sus: surveys.some((s) => s.kind === 'sus'),
      iso25010: surveys.some((s) => s.kind === 'iso25010'),
    },
  };
}
