import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

const medal = (i) => ['🥇', '🥈', '🥉'][i] || i + 1;

export function DailyCard({ me }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.daily().then(setD).catch(() => {}); }, []);
  if (!d) return <div className="card"><h3>📅 Daily challenge</h3><p className="muted small">Loading…</p></div>;
  return (
    <div className="card daily">
      <h3>📅 Daily challenge <span className="muted small">· {d.date}</span></h3>
      {d.played?.finished ? (
        <p>Today: <b className="gold">{d.played.score} pts</b> · {d.played.correct}/{d.played.answered} correct. New cases tomorrow!</p>
      ) : d.played ? (
        <p className="muted">You started today's challenge. One attempt per day; come back tomorrow.</p>
      ) : (
        <><p className="muted small">{d.size} mixed cases, the same for everyone today. One attempt, so make it count.</p><Link className="btn btn-gold" to="/daily">Play today's challenge →</Link></>
      )}
      <p className="small">🔥 Daily streak: <b>{d.streak}</b> day{d.streak === 1 ? '' : 's'}</p>
      {d.leaderboard.length > 0 && (
        <ol className="leaderboard compact">
          {d.leaderboard.slice(0, 5).map((r, i) => (
            <li key={r.nickname} className={r.nickname === me ? 'me' : ''}><span className="lb-rank">{medal(i)}</span><span className="lb-name">{r.nickname}<small>{r.section || ''}</small></span><b>{r.score}</b></li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function BadgesCard() {
  const [b, setB] = useState(null);
  useEffect(() => { api.badges().then(setB).catch(() => {}); }, []);
  if (!b) return null;
  return (
    <div className="card badges-card">
      <h3>🏅 Badges <span className="muted small">{b.earned}/{b.badges.length}</span></h3>
      <div className="badge-grid">
        {b.badges.map((x) => (
          <div key={x.id} className={`badge ${x.earned ? 'earned' : ''}`} title={x.desc}>
            <span className="badge-icon">{x.icon}</span>
            <b>{x.name}</b>
            <small>{x.earned ? 'Earned' : `${x.progress}/${x.goal}`}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClassCard({ section, onChange }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [board, setBoard] = useState([]);
  useEffect(() => { api.classLeaderboard().then(setBoard).catch(() => {}); }, [section?.id]);
  const join = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.joinSection(code); setCode(''); onChange(); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="card">
      <h3>🏫 Class vs class</h3>
      {section ? <p className="small">Your class: <b>{section.name}</b></p> : (
        <form className="join-form" onSubmit={join}>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Class join code" maxLength={12} aria-label="Class join code" />
          <button className="btn btn-sm btn-gold" disabled={code.length < 4}>Join</button>
        </form>
      )}
      {err && <p className="error small">{err}</p>}
      {board.length === 0 ? <p className="muted small">No classes on the board yet. Ask your teacher for a join code.</p> : (
        <ol className="leaderboard compact">
          {board.slice(0, 8).map((c, i) => (
            <li key={c.id} className={c.id === section?.id ? 'me' : ''}>
              <span className="lb-rank">{medal(i)}</span>
              <span className="lb-name">{c.name}<small>{c.activePlayers}/{c.members} playing · {c.accuracy ?? '-'}{c.accuracy != null && '%'} accuracy</small></span>
              <b title="Average points per active player">{c.avgScore}</b>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">Ranked by average points per active player, so small classes can win too.</p>
    </div>
  );
}

export function CertificateCard() {
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.certificate().then(setC).catch(() => {}); }, []);
  if (!c) return null;
  const issue = async () => {
    setBusy(true); setErr('');
    try { const r = await api.issueCertificate(); setC({ ...c, certificate: r.certificate }); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const cert = c.certificate;
  return (
    <div className="card cert-card">
      <h3>📜 Certificate</h3>
      {cert ? (
        <>
          <p className="small">Code <code className="cert-code">{cert.code}</code></p>
          <div className="form-row">
            <a className="btn btn-gold" href={api.certificatePdfUrl(cert.code)} target="_blank" rel="noreferrer">Download PDF</a>
            <Link className="btn btn-ghost" to={`/verify/${cert.code}`}>Verify page</Link>
            <button className="btn btn-sm" disabled={busy} onClick={issue} title="Refresh scores and badges on your certificate">↻ Update</button>
          </div>
        </>
      ) : c.eligible ? (
        <><p className="muted small">You finished the training. Get a printable certificate with a verification code.</p><button className="btn btn-gold" disabled={busy} onClick={issue}>Get my certificate</button></>
      ) : <p className="muted small">🔒 {c.reason}</p>}
      {err && <p className="error small">{err}</p>}
    </div>
  );
}

export function NewBadges({ list }) {
  if (!list?.length) return null;
  return (
    <div className="new-badges">
      {list.map((b) => <div key={b.id} className="badge earned pop"><span className="badge-icon">{b.icon}</span><b>{b.name}</b><small>New badge!</small></div>)}
    </div>
  );
}
