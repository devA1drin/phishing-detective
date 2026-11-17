// "You got phished" explainer shown when a player opens a phishing link or scans a malicious QR.
// It is entirely in-app: no real URL is ever opened.
export function TrapOverlay({ trap, onClose }) {
  return (
    <div className="trap-backdrop" role="dialog" aria-modal="true" aria-labelledby="trap-title">
      <div className="trap card">
        <div className="trap-hook" aria-hidden="true">🎣</div>
        <h2 id="trap-title">{trap.title}</h2>
        <div className="fake-browser">
          <div className="fake-bar"><span className="dot r" /><span className="dot y" /><span className="dot g" /><code>{trap.href}</code></div>
          <div className="fake-page">
            <div className="fake-logo" />
            <div className="fake-input">Mobile number / email</div>
            <div className="fake-input">Password / MPIN</div>
            <div className="fake-input">One-Time PIN</div>
            <div className="fake-btn">Verify account</div>
            <span className="stamp small-stamp">FAKE PAGE</span>
          </div>
        </div>
        <p>{trap.message}</p>
        {trap.why && <p className="small"><b>Why it was a trap:</b> {trap.why}</p>}
        <h4>If this happens for real</h4>
        <ol className="small">{trap.whatToDo.map((t) => <li key={t}>{t}</li>)}</ol>
        <p className="muted small">This was a simulation. Phishing Detective never opens real links.</p>
        <button className="btn btn-gold block" onClick={onClose} autoFocus>See the debrief →</button>
      </div>
    </div>
  );
}

export function SafeLinkNote({ trap, onClose }) {
  return (
    <div className="safe-note card" role="status">
      <b>✅ {trap.title}</b>
      <p className="small">{trap.message}</p>
      <button className="btn btn-sm" onClick={onClose}>Back to the case</button>
    </div>
  );
}
