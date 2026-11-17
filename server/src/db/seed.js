// Re-seed scenarios. `npm run seed` wipes ALL data and reloads the scenario bank.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--reset')) {
  const file = process.env.DB_FILE ? path.resolve(process.cwd(), process.env.DB_FILE) : path.resolve(__dirname, '../../data/phishing-detective.db');
  for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  console.log('[seed] Removed', file);
}
const { getRepo } = await import('./index.js');
const repo = await getRepo();
console.log('[seed] Scenarios in bank:', await repo.countScenarios());
