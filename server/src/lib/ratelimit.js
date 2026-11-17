// Rate limiting (express-rate-limit, in-memory store). On Vercel each warm function
// instance keeps its own counters, so limits are per-instance: they still stop rapid
// brute-force bursts without needing an external store, and never crash cold starts.
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const make = (windowMs, limit, message) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || '0.0.0.0'),
  message: { error: message },
  skip: () => process.env.RATE_LIMIT === 'off',
});

export const authLimiter = make(15 * 60_000, 20, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
export const answerLimiter = make(60_000, 90, 'Too many answers too quickly. Slow down, Detective.');
export const generalLimiter = make(60_000, 300, 'Too many requests. Please slow down.');
