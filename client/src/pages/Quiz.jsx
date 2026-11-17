import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';

const channelLabel = { email: '📧 Email', sms: '💬 SMS', social: '📱 Social DM', call: '📞 Call' };
const CONFIDENCE = [[1, 'Pure guess'], [2, 'Unsure'], [3, 'Somewhat sure'], [4, 'Sure'], [5, 'Very sure']];
const TITLES = { pre: 'Pre-game Assessment', post: 'Post-game Assessment', retention: 'Retention Check' };

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
  const { progress, refresh } = usePlayer();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const [pending, setPending] = useState(null); // choice waiting for a confidence rating

  useEffect(() => {
    setResult(null); setIdx(0); setAnswers({}); setStarted(false); setPending(null);
    api.quiz(kind).then((q) => setItems(q.items)).catch((e) => setError(e.message));
  }, [kind]);

  useEffect(() => {
    if (kind === 'pre' && progress?.preQuiz && !result) nav('/hub', { replace: true });
  }, [kind, progress, result, nav]);

  const rate = async (confidence) => {
    const item = items[idx];
    const next = { ...answers, [item.id]: { choice: pending, confidence } };
    setAnswers(next); setPending(null);
    if (idx < items.length - 1) { setIdx(idx + 1); return; }
    try {
      const r = await api.submitQuiz(kind, Object.entries(next).map(([itemId, a]) => ({ itemId, ...a })));
      setResult(r);
      refresh();
    } catch (e) { setError(e.message); }
  };

  if (error) return <div className="card narrow"><p className="error">{error}</p><Link to="/hub" className="btn btn-ghost">Back to case board</Link></div>;
  if (!items.length) return <div className="loading">Loading quiz…</div>;

  const title = TITLES[kind] || 'Assessment';

  if (!started && !result) {
    return (
      <div className="card narrow quiz-intro">
        <span className="eyebrow">{{ pre: 'Before you start', post: 'After training', retention: 'A few weeks later' }[kind]}</span>
        <h1>{title}</h1>
        <p>You'll see <b>{items.length} messages</b>. For each one, decide whether it is <b>Phishing</b> or <b>Legit</b>. There is no timer and no hints. After each answer, rate <b>how confident</b> you are (1 = pure guess, 5 = very sure). Just answer honestly so we can measure {{ pre: 'your starting skill level', post: 'how much you improved', retention: 'how well your skills stuck' }[kind]}.</p>
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
        {result.confidentlyWrong > 0 && kind !== 'pre' && <p className="muted small">⚠️ {result.confidentlyWrong} answer{result.confidentlyWrong > 1 ? 's were' : ' was'} wrong even though you felt sure. Those are the scams most likely to fool you in real life.</p>}
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
                {result.postPercent != null && <><div><span>Post-game</span><b>{result.postPercent}%</b></div><div className="arrow">→</div></>}
                <div><span>{kind === 'retention' ? 'Retention' : 'Post-game'}</span><b>{result.percent}%</b></div>
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
      {!pending ? (
        <div className="choice-row">
          <button className="btn btn-red big" onClick={() => setPending('phishing')}>🚩 Phishing</button>
          <button className="btn btn-green big" onClick={() => setPending('legit')}>✅ Legit</button>
        </div>
      ) : (
        <div className="confidence card">
          <p>You chose <b>{pending === 'phishing' ? '🚩 Phishing' : '✅ Legit'}</b>. How confident are you? <button className="link-btn" onClick={() => setPending(null)}>change answer</button></p>
          <div className="confidence-row">
            {CONFIDENCE.map(([v, label]) => (
              <button key={v} className="btn conf-btn" onClick={() => rate(v)}><b>{v}</b><small>{label}</small></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
