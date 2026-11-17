import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';
import { getPrefs, setPrefs } from '../lib/prefs.js';
import { BadgesCard, CertificateCard, ClassCard, DailyCard } from '../components/Gamification.jsx';

const LEVELS = [
  { n: 1, name: 'Rookie Cases', desc: 'Obvious scams: random numbers, fake prizes, loud urgency.' },
  { n: 2, name: 'Field Investigations', desc: 'Look-alike domains, spoofed sender IDs, disguised links.' },
  { n: 3, name: 'Master Detective', desc: 'Homographs, fake reply threads, QR codes and BEC.' },
];

export default function Hub() {
  const { progress, refresh } = usePlayer();
  const [board, setBoard] = useState([]);
  const [prefs, setP] = useState(getPrefs);
  const pref = (patch) => setP(setPrefs(patch));
  useEffect(() => { refresh(); api.leaderboard().then(setBoard).catch(() => {}); }, []); // eslint-disable-line

  if (!progress) return <div className="loading">Loading case board…</div>;
  if (!progress.preQuiz) return <Navigate to="/quiz/pre" replace />;
  const p = progress;
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const retentionCard = (
    <div className="card">
      <h3>⏳ Retention check</h3>
      {p.retentionQuiz.taken ? (
        <p>Retention score: <b>{p.retentionQuiz.taken.percent}%</b> (post: {p.postQuiz?.percent}%, pre: {p.preQuiz.percent}%). Thank you!</p>
      ) : p.retentionQuiz.unlocked ? (
        <><p className="muted">It's been {p.settings.retentionDays} days. Let's see how much you remember: 10 new messages.</p><Link className="btn btn-gold" to="/quiz/retention">Take retention check</Link></>
      ) : p.retentionQuiz.unlocksAt ? (
        <p className="muted">🔒 Opens on <b>{fmtDate(p.retentionQuiz.unlocksAt)}</b> ({p.settings.retentionDays} days after your post-quiz). Come back then!</p>
      ) : (
        <p className="muted">🔒 Opens {p.settings.retentionDays} days after your post-game quiz.</p>
      )}
    </div>
  );
  const surveyCard = p.surveys.unlocked && (
    <div className="card">
      <h3>🗳️ Rate the game</h3>
      {p.surveys.sus && p.surveys.iso25010 ? <p className="good">✔ Both surveys submitted. Salamat!</p> : (
        <><p className="muted">Two short surveys (about 3 minutes) on how usable and well-built the game is. Your feedback is part of the study.</p><Link className="btn btn-gold" to="/surveys">Answer surveys</Link></>
      )}
    </div>
  );

  // Control (wait-list) group: reading task → post-quiz → retention → then the game opens
  if (!p.canPlay) {
    return (
      <div className="hub">
        <section className="hub-head card">
          <div>
            <span className="eyebrow">Study group: reading first</span>
            <h1>Welcome, Detective {p.player.nickname}</h1>
            <p className="muted">You were randomly placed in the group that reads a short guide first. The game unlocks for you after your retention check, so you still get to play!</p>
          </div>
          <div className="stat-row">
            <div className="stat"><b>{p.preQuiz.percent}%</b><span>Pre-quiz</span></div>
            <div className="stat"><b>{p.postQuiz ? `${p.postQuiz.percent}%` : '-'}</b><span>Post-quiz</span></div>
          </div>
        </section>
        <section className="hub-grid">
          <div className="card">
            <h3>📖 Step 1: Reading task</h3>
            {p.reading.done ? <p className="good">✔ Done. Thank you!</p> : <><p className="muted">Read a short guide about online safety (about 5 minutes).</p><Link className="btn btn-gold" to="/reading">Start reading</Link></>}
          </div>
          <div className="card">
            <h3>📋 Step 2: Post-quiz</h3>
            {p.postQuiz ? <p>Your score: <b>{p.postQuiz.percent}%</b></p> : p.postQuizUnlocked ? <Link className="btn btn-gold" to="/quiz/post">Take post-quiz</Link> : <p className="muted">🔒 Finish the reading task first.</p>}
          </div>
          {retentionCard}
          <CertificateCard />
          <ClassCard section={p.section} onChange={refresh} />
        </section>
      </div>
    );
  }

  return (
    <div className="hub">
      <section className="hub-head card">
        <div>
          <span className="eyebrow">Case board</span>
          <h1>{p.roundsPlayed ? "Welcome back" : "Welcome"}, Detective {p.player.nickname}</h1>
          <p className="muted">Rank: <b className="gold">{p.rank}</b> · {p.roundsPlayed} rounds solved</p>
        </div>
        <div className="stat-row">
          <div className="stat"><b>{p.totalScore}</b><span>Total points</span></div>
          <div className="stat"><b>{p.accuracy ?? '-'}{p.accuracy != null && '%'}</b><span>Accuracy</span></div>
          <div className="stat"><b>🔥 {p.bestStreak}</b><span>Best streak</span></div>
          <div className="stat"><b>{p.preQuiz.percent}%</b><span>Pre-quiz</span></div>
        </div>
      </section>

      <div className="mode-bar card">
        <div>
          <span className="small muted">Game mode</span>
          <div className="tabs">
            <button className={`tab ${prefs.mode === 'classic' ? 'active' : ''}`} onClick={() => pref({ mode: 'classic' })}>🕵️ Classic: one case at a time</button>
            <button className={`tab ${prefs.mode === 'inbox' ? 'active' : ''}`} onClick={() => pref({ mode: 'inbox' })}>📥 Inbox: sort 6-10 messages</button>
          </div>
        </div>
        <label className="small muted">Message language
          <select value={prefs.language} onChange={(e) => pref({ language: e.target.value })}>
            <option value="all">All languages</option>
            <option value="en">English</option>
            <option value="fil">Filipino / Taglish</option>
          </select>
        </label>
      </div>
      <section className="hub-grid">
        <DailyCard me={p.player.nickname} />
        <BadgesCard />
        <ClassCard section={p.section} onChange={refresh} />
      </section>
      <h2 className="section-title">Choose your case level</h2>
      <section className="levels">
        {LEVELS.map((l) => {
          const locked = l.n > p.unlockedLevel;
          const best = p.levelBest.find((b) => b.level === l.n);
          return (
            <div key={l.n} className={`level card ${locked ? 'locked' : ''}`}>
              <div className="level-top">
                <span className="level-num">Level {l.n}</span>
                <span className="stars">{'★'.repeat(l.n)}{'☆'.repeat(3 - l.n)}</span>
              </div>
              <h3>{l.name}</h3>
              <p className="muted">{l.desc}</p>
              {best?.bestAccuracy != null && <p className="small">Best: <b>{best.bestAccuracy}%</b> accuracy · {best.bestScore} pts</p>}
              {locked ? (
                <div className="lock-note">🔒 Reach {p.unlockAccuracy}% accuracy in Level {l.n - 1} to unlock</div>
              ) : (
                <Link to={`/${prefs.mode === 'inbox' ? 'inbox' : 'play'}/${l.n}`} className="btn btn-gold block">{prefs.mode === 'inbox' ? `Open Level ${l.n} inbox →` : `Start Level ${l.n} →`}</Link>
              )}
            </div>
          );
        })}
      </section>

      <section className="hub-grid">
        <div className="card">
          <h3>📋 Post-game quiz</h3>
          {p.postQuiz ? (
            <>
              <p>Your first post-game score: <b>{p.postQuiz.percent}%</b> (pre: {p.preQuiz.percent}%)</p>
              <p className={p.postQuiz.percent >= p.preQuiz.percent ? 'good' : 'muted'}>
                {p.postQuiz.percent - p.preQuiz.percent >= 0 ? '▲' : '▼'} {Math.abs(p.postQuiz.percent - p.preQuiz.percent)} percentage points
              </p>
              <Link className="btn btn-ghost" to="/quiz/post">Retake for practice</Link>
            </>
          ) : p.postQuizUnlocked ? (
            <>
              <p className="muted">Ready to measure how much you've improved? 10 new messages, no timer.</p>
              <Link className="btn btn-gold" to="/quiz/post">Take post-game quiz</Link>
            </>
          ) : (
            <p className="muted">🔒 Finish {p.settings.minRoundsForPost > 1 ? `${p.settings.minRoundsForPost} rounds` : 'at least one round'} to unlock. (Tip: play a few rounds first for the best results.)</p>
          )}
        </div>
        {p.postQuiz && retentionCard}
        <CertificateCard />
        <div className="card">
          <h3>🎯 Your weak spots</h3>
          {p.weakSpots.length === 0 ? <p className="muted small">Play a few rounds and we'll show which red flags you miss most. Rounds then adapt to train them.</p> : (
            <>
              {p.weakSpots.map((w) => (
                <div className="bar-row" key={w.category}>
                  <span>{w.label}<small>{w.missed}/{w.seen} missed</small></span>
                  <div className="bar"><div className="bar-fill miss" style={{ width: `${Math.round(w.weakness * 100)}%` }} /></div>
                </div>
              ))}
              <p className="muted small">New rounds lean towards these so you practice where it counts.</p>
            </>
          )}
        </div>
        {surveyCard}
        <div className="card">
          <h3>🏆 Top detectives</h3>
          {board.length === 0 ? <p className="muted">No finished rounds yet. Be the first!</p> : (
            <ol className="leaderboard">
              {board.map((r, i) => (
                <li key={r.nickname} className={r.nickname === p.player.nickname ? 'me' : ''}>
                  <span className="lb-rank">{['🥇', '🥈', '🥉'][i] || i + 1}</span>
                  <span className="lb-name">{r.nickname}<small>{r.rank}</small></span>
                  <b>{r.total_score}</b>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card tips">
          <h3>🔎 Detective's checklist</h3>
          <ul>
            <li><b>Sender:</b> is the domain exact? (urs.edu.ph ≠ urs-edu.ph)</li>
            <li><b>Links:</b> hover to see the real URL. The text can lie.</li>
            <li><b>Urgency:</b> "24 hours", "suspended", "final notice"</li>
            <li><b>Requests:</b> OTP, password, fees, IDs = 🚩</li>
            <li><b>Attachments:</b> .exe, .html, .xlsm, "pdf.exe"</li>
            <li><b>Verify</b> through the official app or by calling the official hotline.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
