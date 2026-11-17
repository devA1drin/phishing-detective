import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';

const LEVELS = [
  { n: 1, name: 'Rookie Cases', desc: 'Obvious scams: random numbers, fake prizes, loud urgency.' },
  { n: 2, name: 'Field Investigations', desc: 'Look-alike domains, spoofed sender IDs, disguised links.' },
  { n: 3, name: 'Master Detective', desc: 'Homographs, fake reply threads, QR codes and BEC.' },
];

export default function Hub() {
  const { progress, refresh } = usePlayer();
  const [board, setBoard] = useState([]);
  useEffect(() => { refresh(); api.leaderboard().then(setBoard).catch(() => {}); }, []); // eslint-disable-line

  if (!progress) return <div className="loading">Loading case board…</div>;
  if (!progress.preQuiz) return <Navigate to="/quiz/pre" replace />;
  const p = progress;

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
                <Link to={`/play/${l.n}`} className="btn btn-gold block">Start Level {l.n} →</Link>
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
            <p className="muted">🔒 Finish at least one round to unlock. (Tip: play a few rounds first for the best results.)</p>
          )}
        </div>
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
