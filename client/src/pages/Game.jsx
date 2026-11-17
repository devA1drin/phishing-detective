import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';
import MessageView from '../components/MessageView.jsx';
import Timer from '../components/Timer.jsx';
import { TrapOverlay, SafeLinkNote } from '../components/TrapOverlay.jsx';
import { getPrefs } from '../lib/prefs.js';

export const channelLabel = { email: '📧 Email', sms: '💬 SMS', social: '📱 Social DM', call: '📞 Call' };

export default function Game() {
  const { level } = useParams();
  const { player, refresh } = usePlayer();
  const nav = useNavigate();
  const [session, setSession] = useState(null);
  const [idx, setIdx] = useState(0);
  const [marked, setMarked] = useState(new Set());
  const [feedback, setFeedback] = useState(null);
  const [summary, setSummary] = useState(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const [trap, setTrap] = useState(null); // link-trap overlay or safe note
  const [linkClicked, setLinkClicked] = useState(false);
  const startRef = useRef(0);
  const submittingRef = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.startSession(Number(level), { mode: 'classic', language: getPrefs().language }).then(setSession).catch((e) => setError(e.message));
  }, [player.id, level]);

  const scenario = session?.scenarios[idx];

  // reset timer per scenario
  useEffect(() => {
    if (!scenario || feedback) return;
    startRef.current = performance.now();
    setRemaining(scenario.timeLimit);
    const t = setInterval(() => {
      const left = scenario.timeLimit - (performance.now() - startRef.current) / 1000;
      setRemaining(Math.max(0, left));
    }, 100);
    return () => clearInterval(t);
  }, [scenario, feedback]);

  const submit = useCallback(async (choice) => {
    if (!scenario || feedback || submittingRef.current) return;
    submittingRef.current = true;
    const timeMs = Math.round(performance.now() - startRef.current);
    try {
      const r = await api.answer(session.sessionId, { scenarioId: scenario.id, choice, timeMs, clickedParts: [...marked], linkClicked });
      setFeedback(r);
      setScore(r.sessionScore);
      setStreak(r.streak);
    } catch (e) { setError(e.message); } finally { submittingRef.current = false; }
  }, [scenario, feedback, session, marked, linkClicked]);

  // Link trap: "open" a link or scanned QR (simulated; nothing real is opened)
  const openLink = async (index) => {
    if (!scenario || feedback || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const r = await api.linkClick(session.sessionId, { scenarioId: scenario.id, index, timeMs: Math.round(performance.now() - startRef.current), clickedParts: [...marked] });
      setTrap(r.trap);
      if (r.result) { setFeedback(r.result); setScore(r.result.sessionScore); setStreak(r.result.streak); } else setLinkClicked(true);
    } catch (e) { setError(e.message); } finally { submittingRef.current = false; }
  };

  // time out
  useEffect(() => {
    if (scenario && !feedback && !trap && remaining <= 0 && performance.now() - startRef.current > 500) submit(null);
  }, [remaining, scenario, feedback, submit]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || trap) return;
      if (!feedback && (e.key === 'p' || e.key === 'P')) submit('phishing');
      if (!feedback && (e.key === 'l' || e.key === 'L')) submit('legit');
      if (feedback && e.key === 'Enter') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggle = (k) => setMarked((m) => { const n = new Set(m); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const next = async () => {
    if (idx < session.scenarios.length - 1) {
      setIdx(idx + 1); setMarked(new Set()); setFeedback(null); setTrap(null); setLinkClicked(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const s = await api.finish(session.sessionId);
      setSummary(s);
      refresh();
      window.scrollTo({ top: 0 });
    }
  };

  if (error) return <div className="card narrow"><p className="error">{error}</p><Link className="btn btn-ghost" to="/hub">Back to case board</Link></div>;
  if (!session) return <div className="loading">Shuffling case files…</div>;

  if (summary) return <Summary s={summary} onAgain={() => nav(0)} />;

  const reveal = feedback && {
    flags: feedback.redFlags.map((f, i) => ({ ...f, n: i + 1 })),
    falseClicks: feedback.falseClickParts,
  };

  return (
    <div className="game">
      {trap?.phished && <TrapOverlay trap={trap} onClose={() => setTrap(null)} />}
      <div className="game-hud card">
        <div className="hud-item"><span>Level</span><b>{session.level}</b></div>
        <div className="hud-item"><span>Case</span><b>{idx + 1}/{session.scenarios.length}</b></div>
        <div className="hud-item"><span>Score</span><b className="gold">{score}</b></div>
        <div className="hud-item"><span>Streak</span><b>{streak > 0 ? `🔥 ${streak}` : '-'}</b></div>
        {session.adaptive?.on && <div className="hud-item hide-sm" title="This round leans towards the red flags you miss most"><span>Training focus</span><b className="small">🎯 {session.adaptive.focus.join(', ') || 'mixed'}</b></div>}
        <div className="hud-timer">{!feedback ? <Timer remaining={remaining} limit={scenario.timeLimit} /> : <span className="muted small">Debrief</span>}</div>
      </div>

      <div className="game-grid">
        <div className="game-main">
          <div className="case-tag">
            <span className="pill">{channelLabel[scenario.channel]}</span>
            <span className="pill">Difficulty {'★'.repeat(scenario.difficulty)}</span>
            {scenario.language !== 'en' && <span className="pill">🇵🇭 {scenario.language === 'tl' ? 'Filipino' : 'Taglish'}</span>}
            {!feedback && <span className="muted small hide-sm">🔍 Click anything suspicious for bonus points</span>}
          </div>
          <MessageView scenario={scenario} marked={marked} onToggle={feedback ? null : toggle} onOpenLink={feedback ? null : openLink} reveal={reveal} />
          {trap && !trap.phished && !feedback && <SafeLinkNote trap={trap} onClose={() => setTrap(null)} />}
          {!feedback && (
            <div className="choice-row sticky">
              <button className="btn btn-red big" onClick={() => submit('phishing')}>🚩 Phishing <kbd>P</kbd></button>
              <button className="btn btn-green big" onClick={() => submit('legit')}>✅ Legit <kbd>L</kbd></button>
            </div>
          )}
        </div>

        <aside className="game-side">
          {!feedback ? (
            <div className="card clues">
              <h3>🔍 Your clues <span className="pill">{marked.size}</span></h3>
              {marked.size === 0 ? <p className="muted small">Click the sender, subject, sentences, links or attachments that look suspicious. Each correct clue = <b>+20</b>, each wrong one = −10.</p> : (
                <p className="small">You flagged {marked.size} part{marked.size > 1 ? 's' : ''}. Click again to un-flag.</p>
              )}
              <ul className="mini-tips small muted">
                <li>Tap a link or QR code to inspect it. Opening a scam link loses the case!</li>
                <li>Check the sender's exact domain/number</li>
                <li>Watch for urgency, fees, OTP or password requests</li>
              </ul>
            </div>
          ) : (
            <Feedback f={feedback} onNext={next} last={idx === session.scenarios.length - 1} sessionId={session.sessionId} scenarioId={scenario.id} />
          )}
        </aside>
      </div>
    </div>
  );
}

function Coach({ sessionId, scenarioId, f }) {
  const [c, setC] = useState(null);
  useEffect(() => {
    let alive = true;
    const missed = f.redFlags.map((r, i) => (r.found ? null : i)).filter((x) => x != null);
    api.coach(sessionId, { scenarioId, missed }).then((r) => alive && setC(r)).catch(() => alive && setC({ source: 'error' }));
    return () => { alive = false; };
  }, [sessionId, scenarioId]); // eslint-disable-line
  if (c?.source === 'error') return null;
  return (
    <div className={`coach ${c?.source || ''}`}>
      <b>{c?.source === 'ai' ? '🤖 AI coach' : '💡 Coach tip'}</b>
      {!c ? <p className="small muted">Thinking about your answer…</p> : <p className="small">{c.text}</p>}
      {c?.weakCategories?.length > 0 && <p className="small muted">Your weak spots: {c.weakCategories.join(', ')}</p>}
    </div>
  );
}

export function Feedback({ f, onNext, last, sessionId, scenarioId }) {
  return (
    <div className={`card feedback ${f.isCorrect ? 'correct' : 'wrong'}`}>
      <div className="fb-head">
        <div className="fb-icon">{f.isCorrect ? '✅' : f.phished ? '🎣' : f.timedOut ? '⏰' : '❌'}</div>
        <div>
          <h3>{f.isCorrect ? 'Case solved!' : f.phished ? 'You opened the scam link' : f.timedOut ? "Time's up!" : 'Not quite, Detective'}</h3>
          <p>This message is <b className={f.isPhishing ? 'bad' : 'good'}>{f.isPhishing ? 'PHISHING' : 'LEGIT'}</b></p>
        </div>
        <div className="fb-points">+{f.points}<span>pts</span></div>
      </div>
      <div className="breakdown small">
        <span>Base {f.breakdown.base}</span>
        <span>Time +{f.breakdown.timeBonus}</span>
        <span>Streak ×{f.breakdown.multiplier}</span>
        <span>Clues {f.breakdown.flagBonus >= 0 ? '+' : ''}{f.breakdown.flagBonus}</span>
      </div>
      {f.redFlags.length > 0 ? (
        <>
          <h4>🚩 Red flags ({f.flagsFound}/{f.totalFlags} found)</h4>
          <ol className="flag-list">
            {f.redFlags.map((r, i) => (
              <li key={i} className={r.found ? 'found' : ''}>
                <span className="flag-n">{i + 1}</span>
                <div><b>{r.label}</b> {r.found && <span className="pill pill-green">You caught this</span>}<p className="small muted">{r.detail}</p></div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <h4>✅ Why it's safe</h4>
          <ul className="safe-list small">{f.safeSigns.map((s) => <li key={s}>{s}</li>)}</ul>
          {f.falseClicks > 0 && <p className="small muted">You flagged {f.falseClicks} part(s) of a legit message (−{f.falseClicks * 10}).</p>}
        </>
      )}
      <p className="explain">💡 {f.explanation}</p>
      {sessionId && scenarioId && <Coach sessionId={sessionId} scenarioId={scenarioId} f={f} />}
      {onNext && <button className="btn btn-gold block" onClick={onNext}>{last ? 'See round summary →' : 'Next case →'} <kbd>Enter</kbd></button>}
    </div>
  );
}

export function Summary({ s, onAgain }) {
  const passed = s.accuracy >= s.unlockAccuracy;
  return (
    <div className="summary">
      <div className="card summary-head">
        <span className="eyebrow">Level {s.level} · {s.mode === 'inbox' ? 'Inbox' : 'Round'} report</span>
        <h1>{s.accuracy >= 90 ? 'Outstanding work, Detective! 🏅' : passed ? 'Case closed! 🕵️' : 'Keep training, Detective 🔍'}</h1>
        {s.newlyUnlocked && <div className="unlock-banner">🔓 Level {s.newlyUnlocked} unlocked!</div>}
        <div className="stat-row">
          <div className="stat"><b className="gold">{s.score}</b><span>Points</span></div>
          <div className="stat"><b>{s.correct}/{s.total}</b><span>Correct</span></div>
          <div className="stat"><b>{s.accuracy}%</b><span>Accuracy</span></div>
          <div className="stat"><b>🔥 {s.maxStreak}</b><span>Best streak</span></div>
          <div className="stat"><b>{(s.avgTimeMs / 1000).toFixed(1)}s</b><span>Avg time</span></div>
          <div className="stat"><b>{s.flagsFound}</b><span>Clues found</span></div>
        </div>
        {s.phishedCount > 0 && <p className="bad">🎣 You opened {s.phishedCount} scam link{s.phishedCount > 1 ? 's' : ''}. In real life, inspect first and never open links from unexpected messages.</p>}
        {!passed && s.level === s.unlockedLevel && s.level < 3 && <p className="muted">Reach {s.unlockAccuracy}% accuracy to unlock Level {s.level + 1}.</p>}
      </div>
      <div className="card">
        <h3>Case log</h3>
        <table className="table">
          <thead><tr><th>Message</th><th>Answer</th><th>Truth</th><th className="num">Time</th><th className="num">Pts</th></tr></thead>
          <tbody>
            {s.details.map((d) => (
              <tr key={d.scenarioId} className={d.isCorrect ? '' : 'row-miss'}>
                <td>{d.isCorrect ? '✅' : '❌'} {d.label}</td>
                <td>{d.linkClicked && !d.isCorrect ? '🎣 opened link' : d.choice ? (d.choice === 'phishing' ? 'Phishing' : 'Legit') : '⏰ timeout'}</td>
                <td><span className={`pill ${d.isPhishing ? 'pill-red' : 'pill-green'}`}>{d.isPhishing ? 'Phishing' : 'Legit'}</span></td>
                <td className="num">{(d.timeMs / 1000).toFixed(1)}s</td>
                <td className="num">{d.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="choice-row">
        <button className="btn btn-gold" onClick={onAgain}>Play again</button>
        <Link className="btn btn-ghost" to="/hub">Back to case board</Link>
      </div>
    </div>
  );
}
