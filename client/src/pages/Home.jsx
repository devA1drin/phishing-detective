import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';

export default function Home() {
  const { player, login } = usePlayer();
  const nav = useNavigate();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (player) return <Navigate to="/hub" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const p = await api.register(nickname.trim());
      login({ id: p.id, nickname: p.nickname });
      const prog = await api.progress(p.id);
      nav(prog.preQuiz ? '/hub' : '/quiz/pre');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Cybersecurity awareness game</span>
          <h1>Can you spot the <span className="hl">scam</span> before the clock runs out?</h1>
          <p className="lead">Inspect real-world style emails, texts and DMs, the kind that target Filipino students: GCash, BDO, scholarships, the student portal, Shopee, LBC and fake job offers. Flag the clues, make the call and level up your detective skills.</p>
          <form className="join-card" onSubmit={submit}>
            <label htmlFor="nick">Detective ID</label>
            <div className="join-row">
              <input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname or student ID (e.g. sherlock_2026)" maxLength={24} autoComplete="off" required />
              <button className="btn btn-gold" disabled={busy}>{busy ? 'Opening case…' : 'Start investigating →'}</button>
            </div>
            <p className="muted small">🔒 No real names, emails or passwords. Use a nickname or student ID only. Already played? Enter the same ID to continue.</p>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="case-file">
            <div className="stamp">PHISHING</div>
            <div className="cf-line w80" /><div className="cf-line w60" /><div className="cf-line w90" />
            <div className="cf-clue"><span>🚩</span> security@bdo-<b>online-ph</b>.com</div>
            <div className="cf-clue"><span>⏰</span> "Verify within <b>24 hours</b>"</div>
            <div className="cf-clue"><span>🔗</span> Link → <b>gcash-kyc-verify.com</b></div>
            <div className="glass" />
          </div>
        </div>
      </section>

      <section className="steps">
        {[
          ['📝', 'Pre-game quiz', 'A quick 10-item check of your current detection skills.'],
          ['🕵️', 'Timed cases', 'Read each message, click suspicious parts for bonus points, then decide: Phishing or Legit.'],
          ['💡', 'Instant debrief', 'See every red flag you caught or missed, with a clear explanation.'],
          ['📈', 'Level up & re-test', 'Unlock harder cases as your accuracy improves, then take the post-game quiz.'],
        ].map(([icon, t, d], i) => (
          <div className="step card" key={t}>
            <div className="step-num">{i + 1}</div>
            <div className="step-icon">{icon}</div>
            <h3>{t}</h3>
            <p className="muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
