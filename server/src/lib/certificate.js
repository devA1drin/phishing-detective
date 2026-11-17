// Completion certificate: issued after the post-quiz, verifiable by code at /verify.
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function newCertificateCode() {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `PD-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
export const CODE_RE = /^PD-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

const firstPct = (rows, kind) => { const x = rows.find((q) => q.kind === kind); return x ? Math.round((1000 * x.score) / x.total) / 10 : null; };

export async function certificateFacts(repo, player) {
  const quiz = await repo.listPlayerQuizAttempts(player.id);
  const sessions = (await repo.listPlayerSessions(player.id)).filter((s) => s.finishedAt);
  const answered = sessions.reduce((a, s) => a + s.answered, 0);
  const correct = sessions.reduce((a, s) => a + s.correct, 0);
  const badges = (await repo.getBadges(player.id)).length;
  const post = firstPct(quiz, 'post');
  return {
    eligible: post != null,
    reason: post == null ? 'Finish the post-game quiz to earn your certificate.' : null,
    facts: {
      nickname: player.nickname, prePercent: firstPct(quiz, 'pre'), postPercent: post, retentionPercent: firstPct(quiz, 'retention'),
      rounds: sessions.length, accuracy: answered ? Math.round((1000 * correct) / answered) / 10 : null, badges,
    },
  };
}

export const publicCertificate = (c) => c && ({
  code: c.code, nickname: c.nickname, issuedAt: c.issued_at, updatedAt: c.updated_at,
  prePercent: c.pre_percent, postPercent: c.post_percent, retentionPercent: c.retention_percent,
  rounds: c.rounds, accuracy: c.accuracy, badges: c.badges,
});

const manilaDay = (iso) => new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });

/** Streams a one-page landscape A4 certificate PDF. */
export async function renderCertificatePdf(cert, verifyUrl, out) {
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 240, color: { dark: '#0b1220', light: '#ffffff' } });
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Phishing Detective certificate ${cert.code}`, Author: 'Phishing Detective' } });
  doc.pipe(out);
  const W = doc.page.width; const H = doc.page.height;
  doc.rect(0, 0, W, H).fill('#fffdf7'); // light background: prints well
  doc.rect(24, 24, W - 48, H - 48).lineWidth(3).stroke('#c99a1e');
  doc.rect(34, 34, W - 68, H - 68).lineWidth(0.8).stroke('#d5dbe8');
  doc.fillColor('#a87a0c').font('Helvetica-Bold').fontSize(13).text('PHISHING DETECTIVE', 0, 70, { align: 'center', characterSpacing: 4 });
  doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(36).text('Certificate of Completion', 0, 100, { align: 'center' });
  doc.fillColor('#56627e').font('Helvetica').fontSize(14).text('This certifies that detective', 0, 162, { align: 'center' });
  doc.fillColor('#a87a0c').font('Helvetica-Bold').fontSize(34).text(cert.nickname, 0, 186, { align: 'center' });
  doc.fillColor('#33405c').font('Helvetica').fontSize(14).text(
    'completed the Phishing Detective gamified phishing-awareness training, including the pre-game and post-game knowledge assessments.',
    120, 240, { align: 'center', width: W - 240 });
  const stats = [
    ['Pre-quiz', cert.pre_percent != null ? `${cert.pre_percent}%` : '-'],
    ['Post-quiz', cert.post_percent != null ? `${cert.post_percent}%` : '-'],
    ['Retention', cert.retention_percent != null ? `${cert.retention_percent}%` : 'pending'],
    ['Rounds', String(cert.rounds)],
    ['Accuracy', cert.accuracy != null ? `${cert.accuracy}%` : '-'],
    ['Badges', String(cert.badges)],
  ];
  const boxW = 104; const gap = 12; const startX = (W - (stats.length * boxW + (stats.length - 1) * gap)) / 2; const y = 300;
  stats.forEach(([k, v], i) => {
    const x = startX + i * (boxW + gap);
    doc.roundedRect(x, y, boxW, 58, 8).fill('#f0f3fa');
    doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(18).text(v, x, y + 10, { width: boxW, align: 'center' });
    doc.fillColor('#6b7896').font('Helvetica').fontSize(10).text(k.toUpperCase(), x, y + 36, { width: boxW, align: 'center', characterSpacing: 1 });
  });
  doc.fillColor('#56627e').font('Helvetica').fontSize(12).text(`Issued ${manilaDay(cert.issued_at)}`, 70, 420);
  doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(16).text(`Verification code: ${cert.code}`, 70, 442);
  doc.fillColor('#56627e').font('Helvetica').fontSize(11).text(`Verify at ${verifyUrl}`, 70, 466, { width: W - 300, link: verifyUrl, underline: false });
  doc.fillColor('#8590a8').fontSize(9).text('Scores reflect the first attempt at each quiz. This certificate records participation in a research study; it is not an academic credit.', 70, 500, { width: W - 300 });
  doc.image(qr, W - 200, 396, { width: 120 });
  doc.fillColor('#6b7896').fontSize(9).text('Scan to verify', W - 200, 520, { width: 120, align: 'center' });
  doc.end();
}
