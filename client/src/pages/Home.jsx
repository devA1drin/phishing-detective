import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';

function ConsentText() {
  return (
    <div className="consent-box" tabIndex={0} aria-label="Data privacy consent">
      <p><b>Research consent and privacy notice</b> (Data Privacy Act of 2012, RA 10173)</p>
      <h4>Who we are</h4>
      <p>Phishing Detective is a capstone research project by BS Information Systems students of the University of Rizal System. It measures whether an educational game improves phishing awareness.</p>
      <h4>What we collect</h4>
      <ul>
        <li>Your chosen detective ID (a nickname or student ID, <b>not</b> your real name) and a hashed PIN.</li>
        <li>Your quiz answers, confidence ratings, game answers, scores and response times.</li>
        <li>Your usability survey answers (SUS and ISO 25010), if you choose to give them.</li>
        <li>The date and time you gave this consent.</li>
      </ul>
      <p>We do <b>not</b> collect names, emails, phone numbers, passwords or location.</p>
      <h4>Why and how</h4>
      <p>The data is used only to evaluate the game for the study (for example, comparing pre-, post- and retention quiz scores). Results are reported in aggregate only. You may be randomly placed in a group that plays now or a group that reads a short guide first and plays later.</p>
      <h4>Storage and retention</h4>
      <p>Data is stored in a secured database that only the researchers and authorized educators can access. It is kept until the study is completed and evaluated, then deleted or anonymized.</p>
      <h4>Your rights</h4>
      <p>Participation is voluntary. You may stop at any time without penalty. You may ask the researchers or your educator to access, correct or delete your data, as provided by RA 10173.</p>
    </div>
  );
}

export default function Home() {
  const { player, login } = usePlayer();
  const nav = useNavigate();
  const [mode, setMode] = useState('new');
  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (player) return <Navigate to="/hub" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{4,6}$/.test(pin)) return setError('PIN must be 4 to 6 digits.');
    if (mode === 'new') {
      if (pin !== pin2) return setError('The two PINs do not match.');
      if (!consent) return setError('Please read and agree to the privacy consent first.');
    }
    setBusy(true);
    try {
      const r = mode === 'new' ? await api.register(nickname.trim(), pin, true) : await api.login(nickname.trim(), pin);
      login(r);
      const prog = await api.progress();
      nav(prog.preQuiz ? '/hub' : '/quiz/pre');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const pinProps = { inputMode: 'numeric', pattern: '\\d{4,6}', maxLength: 6, className: 'pin-input', autoComplete: 'off', required: true };

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Cybersecurity awareness game</span>
          <h1>Can you spot the <span className="hl">scam</span> before the clock runs out?</h1>
          <p className="lead">Inspect real-world style emails, texts and DMs, the kind that target Filipino students: GCash, BDO, scholarships, the student portal, Shopee, LBC and fake job offers. Flag the clues, make the call and level up your detective skills.</p>
          <form className="join-card" onSubmit={submit}>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'new'} className={`tab ${mode === 'new' ? 'active' : ''}`} onClick={() => { setMode('new'); setError(''); }}>New detective</button>
              <button type="button" role="tab" aria-selected={mode === 'login'} className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>I already have an ID</button>
            </div>
            <label htmlFor="nick">Detective ID</label>
            <input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname or student ID (e.g. sherlock_2026)" maxLength={24} autoComplete="off" required />
            <div className="join-row">
              <label className="grow">PIN (4-6 digits)<input type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" {...pinProps} /></label>
              {mode === 'new' && <label className="grow">Confirm PIN<input type="password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} placeholder="••••" {...pinProps} /></label>}
            </div>
            {mode === 'new' && (
              <>
                <ConsentText />
                <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>I have read the privacy notice. I voluntarily agree to take part and allow the processing of my data for this study, as described above (RA 10173).</span></label>
              </>
            )}
            <button className="btn btn-gold block" disabled={busy}>{busy ? 'Opening case…' : mode === 'new' ? 'Agree and start investigating →' : 'Sign in →'}</button>
            <p className="muted small">🔒 No real names, emails or passwords. Remember your PIN: it protects your progress on any device.</p>
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
