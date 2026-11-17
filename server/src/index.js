import 'dotenv/config';
import 'express-async-errors'; // Express 4: route async errors reach the error handler
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepo } from './db/index.js';
import playersRouter from './routes/players.js';
import gameRouter from './routes/game.js';
import quizRouter from './routes/quiz.js';
import adminRouter from './routes/admin.js';
import surveysRouter from './routes/surveys.js';
import certificatesRouter from './routes/certificates.js';
import { generalLimiter } from './lib/ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  const repo = await getRepo();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Vercel / reverse proxy: use the client IP for rate limiting
  app.use(cors());
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', async (_req, res) => res.json({ ok: true, db: repo.driver, scenarios: await repo.countScenarios() }));
  app.use('/api', generalLimiter);
  app.use('/api', playersRouter(repo));
  app.use('/api', surveysRouter(repo));
  app.use('/api', gameRouter(repo));
  app.use('/api', quizRouter(repo));
  app.use('/api', adminRouter(repo));
  app.use('/api', certificatesRouter(repo));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built React client (npm run build) from Express
  const dist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('API running. Build the client with "npm run build" or use "npm run dev" (Vite on :5173).'));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const app = await createApp();
  app.listen(port, () => console.log(`🕵️  Phishing Detective running on http://localhost:${port}`));
}
