import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';

const channelLabel = { email: '📧 Email', sms: '💬 SMS', social: '📱 Social DM' };

function QuizCard({ item }) {
  return (
    <div className="quiz-msg">
      <div className="quiz-meta"><span className="pill">{channelLabel[item.channel]}</span></div>
      <div className="quiz-from"><span className="muted">From:</span> <b>{item.sender}</b></div>
      {item.subject && <div className="quiz-subject"><span className="muted">Subject:</span> {item.subject}</div>}
      <p className="quiz-body">{item.body}</p>
      {item.url && <div className="quiz-url">🔗 Link destination: <code>{item.url}</code></div>}
    </div>
  );
}

export default function Quiz() {
  const { kind } = useParams();
  const { player, progress, refresh } = usePlayer();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setResult(null); setIdx(0); setAnswers({}); setStarted(false);
    api.quiz(kind).then((q) => setItems(q.items)).catch((e) => setError(e.message));
  }, [kind]);

  useEffect(() => {
    if (kind === 'pre' && progress?.preQuiz && !result) nav('/hub', { replace: true });
  }, [kind, progress, result, nav]);

  const choose = async (choice) => {
    const item = items[idx];
    const next = { ...answers, [item.id]: choice };
    setAnswers(next);
    if (idx < items.length - 1) { setIdx(idx + 1); return; }
    try {
      const r = await api.submitQuiz(kind, player.id, Object.entries(next).map(([itemId, c]) => ({ itemId, choice: c })));
      setResult(r);
      refresh();
    } catch (e) { setError(e.message); }
  };

  if (error) return <div className="card narrow"><p className="error">{error}</p><Link to="/hub" className="btn btn-ghost">Back to case board</Link></div>;
  if (!items.length) return <div className="loading">Loading quiz…</div>;

  const title = kind === 'pre' ? 'Pre-game Assessment' : 'Post-game Assessment';

  if (!started && !result) {
    return (
      <div className="card narrow quiz-intro">
        <span className="eyebrow">{kind === 'pre' ? 'Before you play' : 'After playing'}</span>
        <h1>{title}</h1>
        <p>You'll see <b>{items.length} messages</b>. For each one, decide whether it is <b>Phishing</b> or <b>Legit</b>. There is no timer and no hints. Just answer honestly so we can measure {kind === 'pre' ? 'your starting skill level' : 'how much you improved'}.</p>
        <p className="muted small">Your answers are recorded anonymously under your detective ID for the research study.</p>
        <button className="btn btn-gold" onClick={() => setStarted(true)}>Begin assessment →</button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card narrow quiz-result">
        <span className="eyebrow">{title} complete</span>
        <div className="big-score">{result.score}<span>/{result.total}</span></div>
        <p className="lead">Detection rate: <b>{result.percent}%</b></p>
        {kind === 'pre' ? (
          <>
            <p>Nice work! Answers stay hidden for now so the post-game quiz can fairly measure your progress. Time to train your eye.</p>
            <button className="btn btn-gold" onClick={() => nav('/hub')}>Go to case board →</button>
          </>
        ) : (
          <>
            {result.prePercent != null && (
              <div className="compare">
                <div><span>Pre-game</span><b>{result.prePercent}%</b></div>
                <div className="arrow">→</div>
                <div><span>Post-game</span><b>{result.percent}%</b></div>
                <div className={result.improvementPoints >= 0 ? 'good' : 'bad'}>
                  <span>Change</span><b>{result.improvementPoints >= 0 ? '+' : ''}{result.improvementPoints} pts</b>
                  {result.improvementPercent != null && <small>({result.improvementPercent >= 0 ? '+' : ''}{result.improvementPercent}% relative)</small>}
                </div>
              </div>
            )}
            <h3>Answer review</h3>
            <div className="review-list">
              {result.review.map((r) => (
                <div key={r.itemId} className={`review ${r.correct ? 'ok' : 'no'}`}>
                  <div className="review-head">
                    <span>{r.correct ? '✅' : '❌'} <b>{r.sender}</b>{r.subject ? `: ${r.subject}` : ''}</span>
                    <span className={`pill ${r.isPhishing ? 'pill-red' : 'pill-green'}`}>{r.isPhishing ? 'Phishing' : 'Legit'}</span>
                  </div>
                  <p className="small muted">{r.explanation}</p>
                </div>
              ))}
            </div>
            <button className="btn btn-gold" onClick={() => nav('/hub')}>Back to case board</button>
          </>
        )}
      </div>
    );
  }

  const item = items[idx];
  return (
    <div className="quiz narrow">
      <div className="quiz-progress">
        <span>{title}</span>
        <span>{idx + 1} / {items.length}</span>
      </div>
      <div className="progress"><div style={{ width: `${(idx / items.length) * 100}%` }} /></div>
      <QuizCard item={item} />
      <div className="choice-row">
        <button className="btn btn-red big" onClick={() => choose('phishing')}>🚩 Phishing</button>
        <button className="btn btn-green big" onClick={() => choose('legit')}>✅ Legit</button>
      </div>
    </div>
  );
}
