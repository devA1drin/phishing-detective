// Minimal stateless admin auth: HMAC-signed, expiring bearer token.
import crypto from 'node:crypto';

const secret = () => process.env.ADMIN_SECRET || `pd-${process.env.ADMIN_PASSWORD || 'detective2026'}`;
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function checkPassword(pw) {
  const expected = Buffer.from(String(process.env.ADMIN_PASSWORD || 'detective2026'));
  const got = Buffer.from(String(pw || ''));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export function issueToken(hours = 8) {
  const payload = `admin.${Date.now() + hours * 3600_000}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const [p, sig] = String(token).split('.');
  if (!p || !sig) return false;
  const payload = Buffer.from(p, 'base64url').toString();
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(payload.split('.')[1]) > Date.now();
}

export function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (!verifyToken(token)) return res.status(401).json({ error: 'Admin login required' });
  next();
}
