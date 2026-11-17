import { Router } from 'express';
import { requirePlayer } from '../lib/auth.js';
import { evaluateBadges } from '../lib/badges.js';
import { CODE_RE, certificateFacts, newCertificateCode, publicCertificate, renderCertificatePdf } from '../lib/certificate.js';

const origin = (req) => process.env.PUBLIC_URL?.replace(/\/$/, '') || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;

export default function certificatesRouter(repo) {
  const r = Router();

  r.get('/certificates/me', requirePlayer, async (req, res) => {
    const player = await repo.getPlayer(req.playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const { eligible, reason } = await certificateFacts(repo, player);
    res.json({ eligible, reason, certificate: publicCertificate(await repo.getCertificateByPlayer(player.id)) });
  });

  // Issue (or refresh the numbers on) the player's certificate; the code never changes once issued
  r.post('/certificates/me', requirePlayer, async (req, res) => {
    const player = await repo.getPlayer(req.playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    await evaluateBadges(repo, player.id);
    const { eligible, reason, facts } = await certificateFacts(repo, player);
    if (!eligible) return res.status(403).json({ error: reason });
    const existing = await repo.getCertificateByPlayer(player.id);
    const cert = await repo.upsertCertificate({ code: existing?.code || newCertificateCode(), playerId: player.id, ...facts });
    res.status(existing ? 200 : 201).json({ certificate: publicCertificate(cert) });
  });

  // Public verification (the code is the secret; nothing beyond the certificate itself is revealed)
  r.get('/verify/:code', async (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).json({ valid: false, error: 'Codes look like PD-XXXX-XXXX-XXXX.' });
    const cert = await repo.getCertificate(code);
    if (!cert) return res.status(404).json({ valid: false, error: 'No certificate has this code.' });
    res.json({ valid: true, certificate: publicCertificate(cert) });
  });

  r.get('/certificates/:code/pdf', async (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const cert = CODE_RE.test(code) && (await repo.getCertificate(code));
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="phishing-detective-${code}.pdf"`);
    await renderCertificatePdf(cert, `${origin(req)}/verify/${code}`, res);
  });

  return r;
}
