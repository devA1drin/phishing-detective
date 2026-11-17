import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const fmt = (iso) => new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });

export default function Verify() {
  const { code: param } = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState(param || '');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!param) { setRes(null); return; }
    setLoading(true);
    api.verify(param).then(setRes).catch((e) => setRes({ valid: false, error: e.message })).finally(() => setLoading(false));
  }, [param]);
  const c = res?.certificate;
  return (
    <div className="verify">
      <div className="card">
        <span className="eyebrow">Certificate verification</span>
        <h1>Verify a Phishing Detective certificate</h1>
        <form className="join-form" onSubmit={(e) => { e.preventDefault(); nav(`/verify/${code.trim().toUpperCase()}`); }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PD-XXXX-XXXX-XXXX" aria-label="Verification code" />
          <button className="btn btn-gold" disabled={code.trim().length < 8}>Verify</button>
        </form>
        {loading && <p className="muted">Checking…</p>}
        {res && !loading && (res.valid ? (
          <div className="verify-ok">
            <h2 className="good">✔ Valid certificate</h2>
            <p>Detective <b className="gold">{c.nickname}</b> completed the training. Issued {fmt(c.issuedAt)}.</p>
            <div className="stat-row">
              <div className="stat"><b>{c.prePercent ?? '-'}%</b><span>Pre-quiz</span></div>
              <div className="stat"><b>{c.postPercent ?? '-'}%</b><span>Post-quiz</span></div>
              <div className="stat"><b>{c.retentionPercent != null ? `${c.retentionPercent}%` : 'pending'}</b><span>Retention</span></div>
              <div className="stat"><b>{c.rounds}</b><span>Rounds</span></div>
              <div className="stat"><b>{c.badges}</b><span>Badges</span></div>
            </div>
            <p><a className="btn btn-ghost" href={api.certificatePdfUrl(c.code)} target="_blank" rel="noreferrer">View PDF</a></p>
          </div>
        ) : <p className="bad">✕ {res.error || 'Not a valid certificate.'}</p>)}
      </div>
    </div>
  );
}
