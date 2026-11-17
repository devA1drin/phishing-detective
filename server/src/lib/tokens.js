// Stateless HMAC-signed tokens (base64url payload + signature) for players and admins.
import crypto from 'node:crypto';

let devSecret;
function secret() {
  const s = process.env.APP_SECRET || process.env.ADMIN_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new Error('ADMIN_SECRET (or APP_SECRET) must be set in production');
  devSecret ??= crypto.randomBytes(32).toString('hex'); // dev only: tokens reset on restart
  return devSecret;
}
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export function issue(payload, hours) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600_000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};
