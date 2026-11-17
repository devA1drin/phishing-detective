export default function Timer({ remaining, limit }) {
  const pct = Math.max(0, (remaining / limit) * 100);
  const tone = pct > 50 ? 'ok' : pct > 25 ? 'warn' : 'danger';
  return (
    <div className="timer" aria-label={`${Math.ceil(remaining)} seconds left`}>
      <div className="timer-track"><div className={`timer-fill ${tone}`} style={{ width: `${pct}%` }} /></div>
      <span className={`timer-num ${tone}`}>⏱ {Math.ceil(remaining)}s</span>
    </div>
  );
}
