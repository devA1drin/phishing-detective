// Post-study usability (SUS, 10 items) and software-quality (ISO/IEC 25010) questionnaires.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';

const SCALE = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

function Likert({ text, value, onChange, n }) {
  return (
    <div className="likert">
      <p><b>{n}.</b> {text}</p>
      <div className="likert-row" role="radiogroup" aria-label={text}>
        {SCALE.map((label, i) => (
          <button type="button" key={label} role="radio" aria-checked={value === i + 1} className={value === i + 1 ? 'on' : ''} onClick={() => onChange(i + 1)}>{i + 1}<br />{label}</button>
        ))}
      </div>
    </div>
  );
}

export default function Surveys() {
  const { progress, refresh } = usePlayer();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [sus, setSus] = useState({});
  const [iso, setIso] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.surveyItems().then(setItems).catch((e) => setError(e.message)); }, []);
  if (!items || !progress) return <div className="loading">Loading surveys…</div>;
  if (!progress.surveys.unlocked) return <div className="card narrow"><p>Surveys open after you play and take the post-game quiz.</p><Link className="btn btn-ghost" to="/hub">Back</Link></div>;
  const kind = !progress.surveys.sus ? 'sus' : !progress.surveys.iso25010 ? 'iso25010' : null;
  if (!kind) return <div className="card narrow"><h2>Thank you! 🙏</h2><p>Both surveys are in. Your feedback helps evaluate the game.</p><Link className="btn btn-gold" to="/hub">Back to case board</Link></div>;

  const list = kind === 'sus' ? items.sus.map((text, i) => ({ id: i, text })) : items.iso25010;
  const vals = kind === 'sus' ? sus : iso;
  const set = kind === 'sus' ? setSus : setIso;
  const complete = list.every((it) => vals[it.id]);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await api.submitSurvey(kind, kind === 'sus' ? list.map((it) => vals[it.id]) : vals);
      await refresh();
      window.scrollTo(0, 0);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card narrow">
      <span className="eyebrow">Survey {kind === 'sus' ? '1 of 2' : '2 of 2'}</span>
      <h1>{kind === 'sus' ? 'System Usability Scale' : 'Software quality (ISO/IEC 25010)'}</h1>
      <p className="muted">{kind === 'sus' ? 'Rate how much you agree with each statement about Phishing Detective.' : 'Rate the game on each quality statement.'} There are no right or wrong answers.</p>
      {list.map((it, i) => <Likert key={it.id} n={i + 1} text={it.text} value={vals[it.id]} onChange={(v) => set({ ...vals, [it.id]: v })} />)}
      {error && <p className="error">{error}</p>}
      <div className="form-row">
        <button className="btn btn-gold" disabled={!complete || busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button>
        <button className="btn btn-ghost" onClick={() => nav('/hub')}>Later</button>
        {!complete && <span className="muted small">{list.filter((it) => vals[it.id]).length}/{list.length} answered</span>}
      </div>
    </div>
  );
}
