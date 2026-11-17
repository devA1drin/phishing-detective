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
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onLogin((await api.admin.login(username.trim(), pw)).token); } catch (e2) { setErr(e2.message); }
  };
  return (
    <form className="card narrow admin-login" onSubmit={submit}>
      <span className="eyebrow">Educator access</span>
      <h1>Admin dashboard</h1>
      <p className="muted">View player progress, study results and manage the scenario bank.</p>
      <label htmlFor="un">Username</label>
      <input id="un" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
      <label htmlFor="pw">Password</label>
      <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
      {err && <p className="error">{err}</p>}
      <button className="btn btn-gold block">Sign in</button>
      <p className="muted small">Accounts are created by a superadmin. The first superadmin comes from the <code>SUPERADMIN_USERNAME</code> / <code>SUPERADMIN_PASSWORD</code> environment variables (see the README).</p>
    </form>
  );
}

function Dashboard({ token, onLogout }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState({});
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [me, stats, players, sessions, scenarioStats, scenarios] = await Promise.all([
        api.admin.me(token), api.admin.stats(token), api.admin.players(token), api.admin.sessions(token), api.admin.scenarioStats(token), api.admin.scenarios(token),
      ]);
      setData({ me, stats, players, sessions, scenarioStats, scenarios });
    } catch (e) {
      if (e.status === 401) onLogout(); else setError(e.message);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const tabs = [['overview', '📊 Overview'], ['scenarios-stats', '🎯 Miss rates'], ['players', '🕵️ Players'], ['sessions', '🎮 Sessions'], ['manage', '🗂 Scenario bank'], ['study', '⚙️ Study & accounts']];
  return (
    <div className="admin">
      <div className="admin-head">
        <div><span className="eyebrow">Educator dashboard{data.me ? ` · ${data.me.displayName || data.me.username} (${data.me.role})` : ''}</span><h1>Phishing Detective analytics</h1></div>
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
          {tab === 'players' && <Players rows={data.players} token={token} reload={load} />}
          {tab === 'sessions' && <Sessions rows={data.sessions} />}
          {tab === 'manage' && <ScenarioManager token={token} scenarios={data.scenarios} reload={load} />}
          {tab === 'study' && <StudyAdmin token={token} me={data.me} />}
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
      {['players', 'sessions', 'answers', 'quiz', 'quiz-items', 'surveys', 'scenarios'].map((k) => <button key={k} className="btn btn-sm" onClick={() => dl(k)}>{k}</button>)}
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
            <p className="muted small">Experimental group: paired comparison of each player's first pre-game vs first post-game quiz ({q.experimentalPairedCount ?? 0} with both). Bars show all {q.pairedCount} paired players.</p>
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
            <small>{q.improvementPoints == null ? '' : `${q.improvementPoints > 0 ? '+' : ''}${q.improvementPoints} percentage points · ${q.playersImprovedBy20}/${q.experimentalPairedCount} players improved ≥20%`}</small>
          </div>
        </div>
        <p className="muted small">All attempts: {q.preCount} pre-quizzes (avg {fmt(q.avgPre, '%')}), {q.postCount} post-quizzes (avg {fmt(q.avgPost, '%')}), {q.retentionCount} retention checks (avg {fmt(q.avgRetention, '%')}).</p>
      </div>

      <GroupComparison s={s} />
      <div className="two-col">
        <ConfidenceCard c={s.confidence} />
        <SurveyCard v={s.surveys} />
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

function Players({ rows, token, reload }) {
  const [err, setErr] = useState('');
  const setGroup = async (id, group) => {
    try { await api.admin.setGroup(token, id, group); reload(); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="card">
      <h3>Players ({rows.length})</h3>
      <p className="muted small">Players are randomly assigned at registration (ratio in Study settings). Changing a group here marks it as an admin override.</p>
      {err && <p className="error">{err}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nickname / ID</th><th>Group</th><th>Joined</th><th className="num">Rounds</th><th className="num">Score</th><th className="num">Accuracy</th><th className="num">Pre</th><th className="num">Post</th><th className="num">Retention</th><th className="num">Δ</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nickname}</b>{!p.consent_at && <div className="muted small">no consent record (legacy)</div>}</td>
                <td>
                  <select value={p.group_name} onChange={(e) => setGroup(p.id, e.target.value)} aria-label={`Group for ${p.nickname}`}>
                    <option value="experimental">experimental</option><option value="control">control</option>
                  </select>
                  <div className="muted small">{p.group_source}</div>
                </td>
                <td className="small muted">{p.created_at}</td>
                <td className="num">{p.sessions}</td><td className="num">{p.total_score}</td>
                <td className="num">{fmt(p.accuracy, '%')}</td><td className="num">{fmt(p.pre_score, '%')}</td><td className="num">{fmt(p.post_score, '%')}</td><td className="num">{fmt(p.retention_score, '%')}</td>
                <td className={`num ${p.post_score - p.pre_score > 0 ? 'good' : ''}`}>{p.pre_score != null && p.post_score != null ? `${p.post_score - p.pre_score > 0 ? '+' : ''}${Math.round(p.post_score - p.pre_score)}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const pFmt = (p) => (p == null ? '= -' : p < 0.001 ? '< .001' : `= ${p.toFixed(3).replace(/^0/, '')}`);
const testLine = (t, kind) => {
  if (!t || t.insufficient) return <span className="muted">not enough data</span>;
  if (kind === 't') return <>t({t.df}) = {t.t ?? '-'}, p {pFmt(t.p)}{t.cohensD != null && <>, d = {t.cohensD}</>}</>;
  if (kind === 'w') return <>W+ = {t.wPlus}, z = {t.z ?? '-'}, p {pFmt(t.p)}{t.r != null && <>, r = {t.r}</>}</>;
  if (kind === 'welch') return <>t({t.df == null ? '-' : Math.round(t.df * 10) / 10}) = {t.t ?? '-'}, p {pFmt(t.p)}</>;
  return <>U = {t.U}, z = {t.z ?? '-'}, p {pFmt(t.p)}</>;
};

function GroupComparison({ s }) {
  const g = s.groups;
  const row = (label, k) => (
    <tr><td>{label}</td>{['experimental', 'control'].map((n) => <td key={n} className="num">{g[n][k].n ? `${fmt(g[n][k].mean, '%')} (SD ${fmt(g[n][k].sd)}, n=${g[n][k].n})` : '-'}</td>)}</tr>
  );
  return (
    <div className="card">
      <h3>Experimental vs control group</h3>
      <p className="muted small">Means of first attempts. Control = wait-list group that does the neutral reading task instead of the game (they play after the retention check).</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th></th><th className="num">Experimental (game)</th><th className="num">Control (reading)</th></tr></thead>
          <tbody>
            <tr><td>Players</td><td className="num">{g.experimental.players}</td><td className="num">{g.control.players}</td></tr>
            {row('Pre-quiz', 'pre')}{row('Post-quiz', 'post')}{row('Retention', 'retention')}
            <tr><td>Paired gain (post − pre)</td>{['experimental', 'control'].map((n) => <td key={n} className="num">{g[n].improvementPoints == null ? '-' : `${g[n].improvementPoints > 0 ? '+' : ''}${g[n].improvementPoints} pts (${g[n].improvementPercent ?? '-'}%)`}</td>)}</tr>
            <tr><td>Paired t-test (pre vs post)</td>{['experimental', 'control'].map((n) => <td key={n} className="num small">{testLine(g[n].tTest, 't')}</td>)}</tr>
            <tr><td>Wilcoxon signed-rank</td>{['experimental', 'control'].map((n) => <td key={n} className="num small">{testLine(g[n].wilcoxon, 'w')}</td>)}</tr>
            <tr><td>Retention vs post (t-test)</td>{['experimental', 'control'].map((n) => <td key={n} className="num small">{testLine(g[n].retentionTTest, 't')}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="small">Between groups (gain): Welch {testLine(s.between.gainWelch, 'welch')} · Mann-Whitney {testLine(s.between.gainMannWhitney, 'u')}</p>
    </div>
  );
}

function ConfidenceCard({ c }) {
  const kinds = ['pre', 'post', 'retention'].filter((k) => c.byKind[k]);
  return (
    <div className="card">
      <h3>Confidence calibration</h3>
      <p className="muted small">"Confidently wrong" = a wrong quiz answer rated 4 or 5 (sure / very sure).</p>
      {!kinds.length ? <p className="muted small">No rated answers yet.</p> : (
        <table className="table">
          <thead><tr><th>Quiz</th><th className="num">Answers</th><th className="num">Confidently wrong</th><th className="num">% of errors</th><th className="num">Avg conf. right / wrong</th></tr></thead>
          <tbody>{kinds.map((k) => { const b = c.byKind[k]; return (
            <tr key={k}><td>{k}</td><td className="num">{b.answers}</td><td className="num">{b.confidentlyWrong} ({fmt(b.confidentlyWrongRate, '%')})</td><td className="num">{fmt(b.confidentlyWrongShareOfErrors, '%')}</td><td className="num">{fmt(b.avgConfidenceCorrect)} / {fmt(b.avgConfidenceWrong)}</td></tr>
          ); })}</tbody>
        </table>
      )}
    </div>
  );
}

function SurveyCard({ v }) {
  return (
    <div className="card">
      <h3>Usability & quality surveys</h3>
      <p>SUS: <b>{v.sus.n ? `${v.sus.mean} / 100` : '-'}</b> {v.sus.grade && <span className="pill">{v.sus.grade.adjective} · {v.sus.grade.acceptability}</span>} <span className="muted small">n={v.sus.n}{v.sus.sd != null && `, SD ${v.sus.sd}`}</span></p>
      <p>ISO/IEC 25010 overall: <b>{v.iso25010.overallMean ?? '-'}</b> {v.iso25010.overallInterpretation && <span className="pill">{v.iso25010.overallInterpretation}</span>} <span className="muted small">n={v.iso25010.n}</span></p>
      {v.iso25010.n > 0 && (
        <table className="table">
          <thead><tr><th>Characteristic</th><th className="num">Mean</th><th>Interpretation</th></tr></thead>
          <tbody>{v.iso25010.characteristics.map((c) => <tr key={c.characteristic}><td>{c.characteristic}</td><td className="num">{c.mean ?? '-'}</td><td>{c.interpretation || '-'}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function StudyAdmin({ token, me }) {
  const isSuper = me?.role === 'superadmin';
  const [settings, setSettings] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'educator' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const load = async () => {
    try {
      setSettings(await api.admin.settings(token));
      if (isSuper) setAdmins(await api.admin.admins(token));
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const run = async (fn, ok) => { setErr(''); setMsg(''); try { await fn(); setMsg(ok); load(); } catch (e) { setErr(e.message); } };
  if (!settings) return <div className="loading">Loading…</div>;
  return (
    <div className="overview">
      {msg && <p className="good">{msg}</p>}{err && <p className="error">{err}</p>}
      <div className="card">
        <h3>Study settings</h3>
        <div className="form-row">
          <label>Control-group ratio (0-1)<input type="number" step="0.05" min="0" max="1" value={settings.controlRatio} disabled={!isSuper} onChange={(e) => setSettings({ ...settings, controlRatio: e.target.value })} /></label>
          <label>Retention delay (days)<input type="number" min="0" max="365" value={settings.retentionDays} disabled={!isSuper} onChange={(e) => setSettings({ ...settings, retentionDays: e.target.value })} /></label>
          <label>Rounds before post-quiz<input type="number" min="1" max="20" value={settings.minRoundsForPost} disabled={!isSuper} onChange={(e) => setSettings({ ...settings, minRoundsForPost: e.target.value })} /></label>
          {isSuper && <button className="btn btn-gold" onClick={() => run(() => api.admin.saveSettings(token, settings), 'Settings saved')}>Save</button>}
        </div>
        <p className="muted small">New players are randomly assigned: control with probability = ratio (0.5 = half). {isSuper ? '' : 'Only a superadmin can change these.'}</p>
      </div>
      {isSuper && (
        <div className="card">
          <h3>Admin accounts</h3>
          <table className="table">
            <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Last login</th><th></th></tr></thead>
            <tbody>{admins.map((a) => (
              <tr key={a.id}>
                <td><b>{a.username}</b></td><td>{a.display_name || '-'}</td>
                <td><select value={a.role} onChange={(e) => run(() => api.admin.updateAdmin(token, a.id, { role: e.target.value }), 'Role updated')}><option value="educator">educator</option><option value="superadmin">superadmin</option></select></td>
                <td className="small muted">{a.last_login_at || 'never'}</td>
                <td>{a.id !== me.id && <button className="btn btn-sm btn-danger" onClick={() => window.confirm(`Delete ${a.username}?`) && run(() => api.admin.deleteAdmin(token, a.id), 'Account deleted')}>Delete</button>}</td>
              </tr>
            ))}</tbody>
          </table>
          <h4>Add an account</h4>
          <div className="form-row">
            <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label>Display name<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
            <label>Initial password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></label>
            <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="educator">educator</option><option value="superadmin">superadmin</option></select></label>
            <button className="btn btn-gold" onClick={() => run(async () => { await api.admin.createAdmin(token, form); setForm({ username: '', displayName: '', password: '', role: 'educator' }); }, 'Account created')}>Add</button>
          </div>
          <p className="muted small">Passwords: at least 10 characters with letters and numbers. Share them privately; the user should change it after first sign-in.</p>
        </div>
      )}
      <div className="card">
        <h3>Change my password</h3>
        <div className="form-row">
          <label>Current password<input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" /></label>
          <label>New password<input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn btn-gold" onClick={() => run(async () => { await api.admin.changePassword(token, pw.currentPassword, pw.newPassword); setPw({ currentPassword: '', newPassword: '' }); }, 'Password changed')}>Update</button>
        </div>
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
