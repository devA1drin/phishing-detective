// Inbox mode: sort a whole inbox (6-10 messages) as Phishing or Legit against one shared clock.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';
import { getPrefs } from '../lib/prefs.js';
import MessageView from '../components/MessageView.jsx';
import Timer from '../components/Timer.jsx';
import { TrapOverlay, SafeLinkNote } from '../components/TrapOverlay.jsx';
import { Feedback, Summary, channelLabel } from './Game.jsx';

const preview = (sc) => {
  const t = sc.segments.filter((s) => s.type === 'text').map((s) => s.text).join('').replace(/^(Caller|You):\s*/, '');
  return t.length > 70 ? `${t.slice(0, 70)}…` : t;
};

export default function Inbox() {
  const { level } = useParams();
  const { refresh } = usePlayer();
  const nav = useNavigate();
  const [session, setSession] = useState(null);
  const [open, setOpen] = useState(0);
  const [tags, setTags] = useState({});      // scenarioId -> 'phishing' | 'legit'
  const [marks, setMarks] = useState({});    // scenarioId -> Set(partKeys)
  const [clicked, setClicked] = useState({}); // scenarioId -> true (opened a safe link)
  const [locked, setLocked] = useState({});  // scenarioId -> result (phished via link trap)
  const [trap, setTrap] = useState(null);
  const [results, setResults] = useState(null);
  const [summary, setSummary] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const startAt = useRef(0);
  const viewMs = useRef({});
  const viewStart = useRef(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.startSession(Number(level), { mode: 'inbox', language: getPrefs().language }).then((s) => {
      setSession(s); startAt.current = performance.now(); viewStart.current = performance.now(); setRemaining(s.inboxTimeLimit);
    }).catch((e) => setError(e.message));
  }, [level]);

  const scenarios = session?.scenarios || [];
  const current = scenarios[open];
  const trackView = () => {
    if (!current) return;
    viewMs.current[current.id] = (viewMs.current[current.id] || 0) + (performance.now() - viewStart.current);
    viewStart.current = performance.now();
  };
  const select = (i) => { trackView(); setOpen(i); };

  const submitAll = async () => {
    if (busy || results) return;
    setBusy(true); trackView();
    try {
      const out = {};
      for (const sc of scenarios) {
        if (locked[sc.id]) { out[sc.id] = locked[sc.id]; continue; }
        out[sc.id] = await api.answer(session.sessionId, {
          scenarioId: sc.id, choice: tags[sc.id] || null, timeMs: Math.max(1000, Math.round(viewMs.current[sc.id] || 0)),
          clickedParts: [...(marks[sc.id] || [])], linkClicked: !!clicked[sc.id],
        });
      }
      setResults(out);
      setSummary(await api.finish(session.sessionId));
      refresh();
      window.scrollTo({ top: 0 });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!session || results) return;
    const t = setInterval(() => setRemaining(Math.max(0, session.inboxTimeLimit - (performance.now() - startAt.current) / 1000)), 200);
    return () => clearInterval(t);
  }, [session, results]);
  useEffect(() => { if (session && !results && !busy && remaining <= 0 && performance.now() - startAt.current > 1000) submitAll(); }); // eslint-disable-line

  const toggle = (k) => setMarks((m) => { const n = new Set(m[current.id] || []); n.has(k) ? n.delete(k) : n.add(k); return { ...m, [current.id]: n }; });
  const openLink = async (index) => {
    try {
      const r = await api.linkClick(session.sessionId, { scenarioId: current.id, index, timeMs: Math.round(viewMs.current[current.id] || 1000), clickedParts: [...(marks[current.id] || [])] });
      setTrap(r.trap);
      if (r.result) setLocked((l) => ({ ...l, [current.id]: r.result })); else setClicked((c) => ({ ...c, [current.id]: true }));
    } catch (e) { setError(e.message); }
  };

  if (error) return <div className="card narrow"><p className="error">{error}</p><Link className="btn btn-ghost" to="/hub">Back to case board</Link></div>;
  if (!session) return <div className="loading">Filling your inbox…</div>;

  const sorted = scenarios.filter((s) => tags[s.id] || locked[s.id]).length;
  const res = results?.[current.id];
  const reveal = res && { flags: res.redFlags.map((f, i) => ({ ...f, n: i + 1 })), falseClicks: res.falseClickParts };

  return (
    <div className="inbox-page">
      {trap?.phished && <TrapOverlay trap={trap} onClose={() => setTrap(null)} />}
      {summary && <Summary s={summary} onAgain={() => nav(0)} />}
      <div className="game-hud card">
        <div className="hud-item"><span>Inbox</span><b>Level {session.level}</b></div>
        <div className="hud-item"><span>Sorted</span><b>{sorted}/{scenarios.length}</b></div>
        {!results ? (
          <>
            <div className="hud-timer"><Timer remaining={remaining} limit={session.inboxTimeLimit} /></div>
            <button className="btn btn-gold" disabled={busy || sorted < scenarios.length} onClick={submitAll}>{busy ? 'Checking…' : sorted < scenarios.length ? `Sort all ${scenarios.length} to submit` : 'Submit inbox ✓'}</button>
          </>
        ) : <div className="hud-item"><span>Score</span><b className="gold">{summary?.score ?? '…'}</b></div>}
      </div>
      <div className="inbox">
        <ul className="inbox-list" role="listbox" aria-label="Inbox">
          {scenarios.map((sc, i) => {
            const r = results?.[sc.id] || locked[sc.id];
            const tag = locked[sc.id] ? 'phished' : tags[sc.id];
            return (
              <li key={sc.id} role="option" aria-selected={i === open} className={`inbox-item ${i === open ? 'active' : ''} ${results ? (r?.isCorrect ? 'ok' : 'no') : ''}`} onClick={() => select(i)}>
                <div className="inbox-top">
                  <span className="small">{channelLabel[sc.channel]}</span>
                  {tag && <span className={`pill ${tag === 'legit' ? 'pill-green' : 'pill-red'}`}>{tag === 'phished' ? '🎣 opened' : tag === 'legit' ? '✅ Legit' : '🚩 Phishing'}</span>}
                  {results && <span>{r?.isCorrect ? '✅' : '❌'}</span>}
                </div>
                <b className="inbox-sender">{sc.senderName}</b>
                {sc.subject && <div className="inbox-subject">{sc.subject}</div>}
                <div className="inbox-preview muted small">{preview(sc)}</div>
              </li>
            );
          })}
        </ul>
        <div className="inbox-pane">
          <MessageView scenario={current} marked={marks[current.id] || new Set()} onToggle={results || locked[current.id] ? null : toggle}
            onOpenLink={results || locked[current.id] ? null : openLink} reveal={reveal} />
          {trap && !trap.phished && <SafeLinkNote trap={trap} onClose={() => setTrap(null)} />}
          {!results && !locked[current.id] && (
            <div className="choice-row">
              <button className={`btn big ${tags[current.id] === 'phishing' ? 'btn-red' : ''}`} onClick={() => { setTags({ ...tags, [current.id]: 'phishing' }); if (open < scenarios.length - 1) select(open + 1); }}>🚩 Phishing</button>
              <button className={`btn big ${tags[current.id] === 'legit' ? 'btn-green' : ''}`} onClick={() => { setTags({ ...tags, [current.id]: 'legit' }); if (open < scenarios.length - 1) select(open + 1); }}>✅ Legit</button>
            </div>
          )}
          {locked[current.id] && !results && <p className="bad small">🎣 You opened this message's scam link, so this case is lost. Sort the rest!</p>}
          {res && <Feedback f={res} />}
        </div>
      </div>
    </div>
  );
}
