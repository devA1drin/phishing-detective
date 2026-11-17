// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json)
// and handled by the same Express app used locally. The app (and its DB pool)
// is created once per warm function instance.
import { createApp } from '../server/src/index.js';

let appPromise;

export default async function handler(req, res) {
  try {
    appPromise ??= createApp();
    const app = await appPromise;
    return app(req, res);
  } catch (err) {
    appPromise = undefined;
    console.error('[api] startup failed:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Service unavailable: database connection failed' }));
  }
}
