// Rate limiting is on by default: the 21st sign-in attempt in 15 minutes is rejected.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

delete process.env.RATE_LIMIT;
const h = await boot();
after(() => h.close());

test('auth endpoints are rate limited', async () => {
  let last;
  for (let i = 0; i < 21; i++) last = await h.j('POST', '/players/login', { nickname: 'nobody_here', pin: '0000' });
  assert.equal(last.status, 429);
  assert.match(last.body.error, /Too many/);
  assert.ok(last.headers.get('ratelimit-policy'));
});
