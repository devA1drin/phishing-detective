// Auth middleware for players (nickname + PIN) and admin accounts (roles).
import { bearer, issue, verify } from './tokens.js';

export const issuePlayerToken = (playerId) => issue({ t: 'p', pid: playerId }, 24 * 30);
export const issueAdminToken = (admin) => issue({ t: 'a', aid: admin.id, role: admin.role }, 8);

/** Requires a valid player token; sets req.playerId. */
export function requirePlayer(req, res, next) {
  const data = verify(bearer(req));
  if (!data || data.t !== 'p') return res.status(401).json({ error: 'Please sign in again (nickname + PIN).' });
  req.playerId = data.pid;
  next();
}

/** Requires an admin token whose account still exists; optional role allow-list. */
export function requireAdmin(repo, roles) {
  return async (req, res, next) => {
    try {
      const data = verify(bearer(req) || req.query.token);
      if (!data || data.t !== 'a') return res.status(401).json({ error: 'Admin login required' });
      const admin = await repo.getAdmin(data.aid);
      if (!admin) return res.status(401).json({ error: 'Admin account no longer exists' });
      if (roles && !roles.includes(admin.role)) return res.status(403).json({ error: 'Not allowed for your role' });
      req.admin = { id: admin.id, username: admin.username, role: admin.role, displayName: admin.display_name };
      next();
    } catch (e) { next(e); }
  };
}
