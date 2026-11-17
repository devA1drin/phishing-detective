import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairedTTest, wilcoxonSignedRank, welchTTest, mannWhitney } from '../src/lib/stats.js';
import { susScore, susGrade } from '../src/data/surveys.js';

test('paired t-test matches reference values', () => {
  const pre = [50, 60, 40, 70, 50, 60, 30, 50, 60, 40];
  const post = [70, 80, 60, 70, 80, 70, 60, 60, 90, 50];
  const t = pairedTTest(pre, post);
  assert.equal(t.df, 9);
  assert.ok(Math.abs(t.t - 5.511) < 0.001, `t=${t.t}`); // hand-computed: mean d=18, sd=10.328, t=18/(10.328/√10)=5.511
  assert.ok(t.p < 0.001);
  const w = wilcoxonSignedRank(pre, post);
  assert.ok(w.p < 0.05);
  assert.ok(welchTTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]).p < 0.01);
  assert.ok(mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]).p < 0.05);
});

test('SUS scoring', () => {
  assert.equal(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  assert.equal(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50);
  assert.equal(susScore([1, 2]), null);
  assert.equal(susGrade(90).adjective, 'Excellent');
  assert.equal(susGrade(85).acceptability, 'Acceptable');
});
