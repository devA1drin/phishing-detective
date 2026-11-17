import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import MessageView from '../components/MessageView.jsx';

const TOKEN_KEY = 'pd.adminToken';
const fmt = (v, suffix = '') => (v == null ? '-' : `${v}${suffix}`);

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  const logout = () => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); };
  if (!token) return <AdminLogin onLogin={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }} />;
  return <Dashboard token={token} onLogout={logout} />;
}

function AdminLogin({ onLogin }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onLogin((await api.admin.login(pw)).token); } catch (e2) { setErr(e2.message); }
  };
  return (
    <form className="card narrow admin-login" onSubmit={submit}>
      <span className="eyebrow">Educator access</span>
      <h1>Admin dashboard</h1>
      <p className="muted">View player progress, pre/post quiz results and manage the scenario bank.</p>
      <label htmlFor="pw">Password</label>
      <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Admin password" required />
      {err && <p className="error">{err}</p>}
      <button className="btn btn-gold block">Sign in</button>
      <p className="muted small">The default password is set in <code>server/.env</code> (<code>ADMIN_PASSWORD</code>). See the README.</p>
    </form>
  );
}

function Dashboard({ token, onLogout }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState({});
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [stats, players, sessions, scenarioStats, scenarios] = await Promise.all([
        api.admin.stats(token), api.admin.players(token), api.admin.sessions(token), api.admin.scenarioStats(token), api.admin.scenarios(token),
      ]);
      setData({ stats, players, sessions, scenarioStats, scenarios });
    } catch (e) {
      if (e.status === 401) onLogout(); else setError(e.message);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const tabs = [['overview', '📊 Overview'], ['scenarios-stats', '🎯 Miss rates'], ['players', '🕵️ Players'], ['sessions', '🎮 Sessions'], ['manage', '🗂 Scenario bank']];
  return (
    <div className="admin">
      <div className="admin-head">
        <div><span className="eyebrow">Educator dashboard</span><h1>Phishing Detective analytics</h1></div>
        <div className="admin-actions">
          <ExportMenu token={token} />
          <button className="btn btn-ghost" onClick={load}>↻ Refresh</button>
          <button className="btn btn-ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {error && <p className="error">{error}</p>}
      {!data.stats ? <div className="loading">Loading analytics…</div> : (
        <>
          {tab === 'overview' && <Overview s={data.stats} />}
          {tab === 'scenarios-stats' && <MissRates rows={data.scenarioStats} />}
          {tab === 'players' && <Players rows={data.players} />}
          {tab === 'sessions' && <Sessions rows={data.sessions} />}
          {tab === 'manage' && <ScenarioManager token={token} scenarios={data.scenarios} reload={load} />}
        </>
      )}
    </div>
  );
}

function ExportMenu({ token }) {
  const [msg, setMsg] = useState('');
  const dl = async (k) => { try { await api.admin.download(token, k); setMsg(''); } catch (e) { setMsg(e.message); } };
  return (
    <div className="export">
      <span className="small muted">Export CSV:</span>
      {['players', 'sessions', 'answers', 'quiz', 'scenarios'].map((k) => <button key={k} className="btn btn-sm" onClick={() => dl(k)}>{k}</button>)}
      {msg && <span className="error small">{msg}</span>}
    </div>
  );
}

function Overview({ s }) {
  const q = s.quiz;
  const max = 100;
  return (
    <div className="overview">
      <div className="kpis">
        <div className="kpi card"><span>Players</span><b>{s.players}</b></div>
        <div className="kpi card"><span>Finished sessions</span><b>{s.sessions}</b><small>{s.startedSessions} started</small></div>
        <div className="kpi card"><span>Answers logged</span><b>{s.answers}</b></div>
        <div className="kpi card"><span>In-game accuracy</span><b>{fmt(s.accuracy, '%')}</b><small>avg {fmt(s.avgTimeSec, 's')} / message</small></div>
      </div>

      <div className="card impact">
        <div className="impact-head">
          <div>
            <h3>Expected impact: ≥ 20% improvement in detection rate</h3>
            <p className="muted small">Paired comparison of each player's first pre-game vs first post-game quiz ({q.pairedCount} player{q.pairedCount === 1 ? '' : 's'} with both).</p>
          </div>
          {q.targetMet != null && <span className={`pill big-pill ${q.targetMet ? 'pill-green' : 'pill-red'}`}>{q.targetMet ? '✅ Target met' : '⏳ Below target'}</span>}
        </div>
        <div className="impact-grid">
          <div className="bars">
            {[['Pre-game avg', q.pairedAvgPre ?? q.avgPre, 'pre'], ['Post-game avg', q.pairedAvgPost ?? q.avgPost, 'post']].map(([l, v, c]) => (
              <div className="bar-row" key={l}>
                <span>{l}</span>
                <div className="bar"><div className={`bar-fill ${c}`} style={{ width: `${((v || 0) / max) * 100}%` }} /></div>
                <b>{fmt(v, '%')}</b>
              </div>
            ))}
          </div>
          <div className="impact-num">
            <b className={q.improvementPercent >= 20 ? 'good' : ''}>{q.improvementPercent == null ? '-' : `${q.improvementPercent > 0 ? '+' : ''}${q.improvementPercent}%`}</b>
            <span>relative improvement</span>
            <small>{q.improvementPoints == null ? '' : `${q.improvementPoints > 0 ? '+' : ''}${q.improvementPoints} percentage points · ${q.playersImprovedBy20}/${q.pairedCount} players improved ≥20%`}</small>
          </div>
        </div>
        <p className="muted small">All attempts: {q.preCount} pre-quizzes (avg {fmt(q.avgPre, '%')}), {q.postCount} post-quizzes (avg {fmt(q.avgPost, '%')}).</p>
      </div>

      <div className="two-col">
        <div className="card"><h3>Accuracy by level</h3><MiniBars rows={s.byLevel.map((r) => [`Level ${r.level}`, r.accuracy, `${r.n} answers`])} /></div>
        <div className="card"><h3>Accuracy by channel</h3><MiniBars rows={s.byChannel.map((r) => [r.channel.toUpperCase(), r.accuracy, `${r.n} answers`])} /></div>
      </div>
    </div>
  );
}

function MiniBars({ rows }) {
  if (!rows.length) return <p className="muted small">No data yet.</p>;
  return rows.map(([l, v, sub]) => (
    <div className="bar-row" key={l}>
      <span>{l}<small>{sub}</small></span>
      <div className="bar"><div className="bar-fill post" style={{ width: `${v || 0}%` }} /></div>
      <b>{fmt(v, '%')}</b>
    </div>
  ));
}

function MissRates({ rows }) {
  return (
    <div className="card">
      <h3>Per-scenario miss rates</h3>
      <p className="muted small">Scenarios students get wrong most often. Use these to focus your classroom discussion.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Scenario</th><th>Type</th><th>Diff.</th><th>Truth</th><th className="num">Attempts</th><th className="num">Misses</th><th>Miss rate</th><th className="num">Avg time</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.subject || r.sender_name}</b><div className="muted small">{r.id}{!r.active && ' · inactive'}</div></td>
                <td>{r.channel}</td><td>{'★'.repeat(r.difficulty)}</td>
                <td><span className={`pill ${r.is_phishing ? 'pill-red' : 'pill-green'}`}>{r.is_phishing ? 'Phishing' : 'Legit'}</span></td>
                <td className="num">{r.attempts}</td><td className="num">{r.misses}</td>
                <td className="miss-cell">{r.miss_rate == null ? <span className="muted">-</span> : <><div className="bar small-bar"><div className="bar-fill miss" style={{ width: `${r.miss_rate}%` }} /></div><b>{r.miss_rate}%</b></>}</td>
                <td className="num">{r.avg_time_ms ? `${(r.avg_time_ms / 1000).toFixed(1)}s` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Players({ rows }) {
  return (
    <div className="card">
      <h3>Players ({rows.length})</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nickname / ID</th><th>Joined</th><th className="num">Rounds</th><th className="num">Score</th><th className="num">Max lvl</th><th className="num">Accuracy</th><th className="num">Pre</th><th className="num">Post</th><th className="num">Δ</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nickname}</b></td><td className="small muted">{p.created_at}</td>
                <td className="num">{p.sessions}</td><td className="num">{p.total_score}</td><td className="num">{p.max_level || '-'}</td>
                <td className="num">{fmt(p.accuracy, '%')}</td><td className="num">{fmt(p.pre_score, '%')}</td><td className="num">{fmt(p.post_score, '%')}</td>
                <td className={`num ${p.post_score - p.pre_score > 0 ? 'good' : ''}`}>{p.pre_score != null && p.post_score != null ? `${p.post_score - p.pre_score > 0 ? '+' : ''}${Math.round(p.post_score - p.pre_score)}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Sessions({ rows }) {
  return (
    <div className="card">
      <h3>Game sessions ({rows.length})</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>Player</th><th className="num">Level</th><th className="num">Score</th><th className="num">Correct</th><th className="num">Accuracy</th><th className="num">Best streak</th><th>Started</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td><td><b>{s.nickname}</b></td><td className="num">{s.level}</td><td className="num">{s.score}</td>
                <td className="num">{s.correct}/{s.total}</td><td className="num">{fmt(s.accuracy, '%')}</td><td className="num">{s.maxStreak}</td>
                <td className="small muted">{s.startedAt}</td>
                <td>{s.finishedAt ? <span className="pill pill-green">Finished</span> : <span className="pill">In progress</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EMPTY = {
  id: '', channel: 'email', platform: '', difficulty: 1, isPhishing: true, senderName: '', senderAddress: '', subject: '',
  body: '', links: [], attachments: [], redFlags: [], safeSigns: [], explanation: '', active: true,
};

function ScenarioManager({ token, scenarios, reload }) {
  const [editing, setEditing] = useState(null); // scenario object or null
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState('');
  const shown = scenarios.filter((s) => `${s.id} ${s.senderName} ${s.subject || ''} ${s.channel}`.toLowerCase().includes(filter.toLowerCase()));

  const remove = async (id) => {
    if (!confirm(`Delete scenario "${id}"? Its answer history will also be removed.`)) return;
    await api.admin.deleteScenario(token, id);
    reload();
  };

  if (editing) return <ScenarioForm token={token} initial={editing} isNew={isNew} onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />;

  return (
    <div className="card">
      <div className="manage-head">
        <h3>Scenario bank ({scenarios.length})</h3>
        <div className="manage-tools">
          <input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn btn-gold" onClick={() => { setIsNew(true); setEditing(EMPTY); }}>+ New scenario</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>ID</th><th>Type</th><th>Diff.</th><th>Truth</th><th>Sender / subject</th><th>Flags</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td className="small"><code>{s.id}</code></td><td>{s.channel}</td><td>{'★'.repeat(s.difficulty)}</td>
                <td><span className={`pill ${s.isPhishing ? 'pill-red' : 'pill-green'}`}>{s.isPhishing ? 'Phishing' : 'Legit'}</span></td>
                <td><b>{s.senderName}</b><div className="small muted">{s.subject || s.body.slice(0, 60) + '…'}</div></td>
                <td className="num">{s.redFlags.length}</td>
                <td>{s.active ? 'Active' : <span className="muted">Inactive</span>}</td>
                <td className="row-actions"><button className="btn btn-sm" onClick={() => { setIsNew(false); setEditing(s); }}>Edit</button><button className="btn btn-sm btn-danger" onClick={() => remove(s.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScenarioForm({ token, initial, isNew, onDone, onCancel }) {
  const [f, setF] = useState({ ...EMPTY, ...initial, platform: initial.platform || '', subject: initial.subject || '' });
  const [json, setJson] = useState({
    links: JSON.stringify(initial.links || [], null, 2),
    attachments: JSON.stringify(initial.attachments || [], null, 2),
    redFlags: JSON.stringify(initial.redFlags || [], null, 2),
    safeSigns: JSON.stringify(initial.safeSigns || [], null, 2),
  });
  const [errors, setErrors] = useState([]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const parsed = useMemo(() => {
    const out = {}; const errs = [];
    for (const k of Object.keys(json)) { try { out[k] = JSON.parse(json[k] || '[]'); } catch { errs.push(`${k}: invalid JSON`); } }
    return { out, errs };
  }, [json]);

  const preview = useMemo(() => {
    const segs = [];
    f.body.split(/(\{\{link:\d+\}\})/).forEach((chunk, i) => {
      const m = chunk.match(/^\{\{link:(\d+)\}\}$/);
      if (m) segs.push({ type: 'link', index: Number(m[1]) });
      else if (chunk) segs.push({ type: 'text', text: chunk, id: `p${i}` });
    });
    return { ...f, segments: segs, links: parsed.out.links || [], attachments: parsed.out.attachments || [] };
  }, [f, parsed]);

  const save = async (e) => {
    e.preventDefault();
    if (parsed.errs.length) return setErrors(parsed.errs);
    const payload = { ...f, difficulty: Number(f.difficulty), isPhishing: f.isPhishing === true || f.isPhishing === 'true', platform: f.platform || undefined, subject: f.subject || undefined, ...parsed.out };
    try {
      if (isNew) await api.admin.createScenario(token, payload);
      else await api.admin.updateScenario(token, f.id, payload);
      onDone();
    } catch (err) { setErrors(err.details || [err.message]); }
  };

  return (
    <form className="scenario-form" onSubmit={save}>
      <div className="card">
        <h3>{isNew ? 'New scenario' : `Edit: ${f.id}`}</h3>
        <div className="form-grid">
          <label>ID<input value={f.id} onChange={set('id')} disabled={!isNew} placeholder="e.g. gcash-sms-promo" required /></label>
          <label>Channel<select value={f.channel} onChange={set('channel')}><option value="email">Email</option><option value="sms">SMS</option><option value="social">Social DM</option></select></label>
          <label>Difficulty<select value={f.difficulty} onChange={set('difficulty')}><option value={1}>1 - Easy</option><option value={2}>2 - Medium</option><option value={3}>3 - Hard</option></select></label>
          <label>Verdict<select value={String(f.isPhishing)} onChange={(e) => setF({ ...f, isPhishing: e.target.value === 'true' })}><option value="true">Phishing</option><option value="false">Legit</option></select></label>
          <label>Sender name<input value={f.senderName} onChange={set('senderName')} required /></label>
          <label>Sender address / number<input value={f.senderAddress} onChange={set('senderAddress')} required /></label>
          {f.channel === 'email' && <label className="span2">Subject<input value={f.subject} onChange={set('subject')} /></label>}
          {f.channel === 'social' && <label>Platform<input value={f.platform} onChange={set('platform')} placeholder="Messenger, Instagram, Telegram…" /></label>}
          <label className="checkbox"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active (served to players)</label>
          <label className="span2">Body <small className="muted">Use {'{{link:0}}'} to place links[0]</small><textarea rows={7} value={f.body} onChange={set('body')} required /></label>
          <label className="span2">Explanation<textarea rows={2} value={f.explanation} onChange={set('explanation')} /></label>
          <label>Links (JSON) <small className="muted">[{'{"text","href"}'}]</small><textarea className="mono" rows={4} value={json.links} onChange={(e) => setJson({ ...json, links: e.target.value })} /></label>
          <label>Attachments (JSON) <small className="muted">[{'{"name","size"}'}]</small><textarea className="mono" rows={4} value={json.attachments} onChange={(e) => setJson({ ...json, attachments: e.target.value })} /></label>
          <label className="span2">Red flags (JSON) <small className="muted">[{'{"target":"sender|subject|body|link|attachment","match":"exact body text","index":0,"label","detail"}'}]</small><textarea className="mono" rows={7} value={json.redFlags} onChange={(e) => setJson({ ...json, redFlags: e.target.value })} /></label>
          <label className="span2">Safe signs (JSON array of strings, for legit messages)<textarea className="mono" rows={3} value={json.safeSigns} onChange={(e) => setJson({ ...json, safeSigns: e.target.value })} /></label>
        </div>
        {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="choice-row">
          <button className="btn btn-gold">{isNew ? 'Create scenario' : 'Save changes'}</button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
      <div className="card">
        <h3>Live preview</h3>
        {f.senderName && f.body ? <MessageView scenario={preview} /> : <p className="muted small">Fill in sender and body to preview.</p>}
      </div>
    </form>
  );
}
