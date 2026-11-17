import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Encodes a (fictional) URL as a QR image. Nothing is ever opened. */
function useQrImages(links) {
  const [imgs, setImgs] = useState({});
  useEffect(() => {
    let alive = true;
    (links || []).forEach((l, i) => {
      if (!l.qr) return;
      QRCode.toDataURL(l.href, { margin: 1, width: 168, color: { dark: '#0b1220', light: '#ffffff' } })
        .then((url) => alive && setImgs((m) => ({ ...m, [i]: url })))
        .catch(() => {});
    });
    return () => { alive = false; };
  }, [links]);
  return imgs;
}

/** Reads a call transcript aloud with the browser's speech engine (optional, offline). */
function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => supported && window.speechSynthesis.cancel(), [supported]);
  const play = (lines) => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    const fil = voices.find((v) => /fil|tl/i.test(v.lang));
    lines.forEach((l, i) => {
      const u = new SpeechSynthesisUtterance(l.text);
      if (fil) u.voice = fil;
      u.rate = 1.02; u.pitch = l.speaker === 'caller' ? 0.85 : 1.25;
      if (i === lines.length - 1) u.onend = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    });
    setSpeaking(true);
  };
  const stop = () => { if (supported) window.speechSynthesis.cancel(); setSpeaking(false); };
  return { supported, speaking, play, stop };
}

/** Splits segments into transcript lines: [{ speaker, segments }] */
function callLines(segments) {
  const lines = [];
  let cur = null;
  for (const s of segments) {
    if (s.type === 'break') { cur = null; continue; }
    if (!cur) { cur = { speaker: 'caller', segments: [] }; lines.push(cur); }
    if (cur.segments.length === 0 && s.type === 'text') {
      const m = s.text.match(/^(Caller|You):\s*/);
      if (m) { cur.speaker = m[1] === 'You' ? 'you' : 'caller'; cur.segments.push({ ...s, display: s.text.slice(m[0].length) }); continue; }
    }
    cur.segments.push(s);
  }
  return lines;
}

/**
 * Renders a scenario as an email, SMS, social DM or phone-call transcript.
 * Every suspicious-able part (sender, subject, sentences, links, attachments)
 * is clickable when `onToggle` is provided. `reveal` highlights red flags after answering.
 * `onOpenLink(index)` enables the link trap: links/QR codes get an "Open" action.
 */
export default function MessageView({ scenario, marked = new Set(), onToggle, onOpenLink, reveal }) {
  const [hoverUrl, setHoverUrl] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const qrImgs = useQrImages(scenario.links);
  const speech = useSpeech();
  const interactive = !!onToggle;
  useEffect(() => { setMenuFor(null); setHoverUrl(null); }, [scenario.id]);

  const flagInfo = (key) => reveal?.flags.find((f) => f.partKey === key);
  const cls = (key) => {
    const c = ['part'];
    if (interactive) c.push('clickable');
    if (marked.has(key)) c.push('marked');
    const f = flagInfo(key);
    if (f) c.push(f.found ? 'flag-found' : 'flag-missed');
    else if (reveal && reveal.falseClicks.includes(key)) c.push('false-click');
    return c.join(' ');
  };
  const Badge = ({ k }) => {
    const f = flagInfo(k);
    return f ? <sup className={`flag-num ${f.found ? 'ok' : ''}`}>{f.n}</sup> : null;
  };
  const Part = ({ k, children, as: Tag = 'span', className = '' }) => (
    <Tag
      className={`${cls(k)} ${className}`}
      data-part={k}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onToggle(k) : undefined}
      onKeyDown={interactive ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle(k)) : undefined}
    >
      {children}<Badge k={k} />
    </Tag>
  );

  const linkEl = (index) => {
    const l = scenario.links[index];
    if (!l) return null;
    const k = `link:${index}`;
    const open = menuFor === k;
    const menu = open && (interactive || onOpenLink) && (
      <span className="link-menu" role="menu" onClick={(e) => e.stopPropagation()}>
        <span className="link-menu-url">{l.qr ? '📷 Decoded QR URL:' : '🔍 Real URL:'} <code>{l.href}</code></span>
        <span className="link-menu-actions">
          {interactive && <button type="button" className="btn btn-sm" onClick={() => { onToggle(k); setMenuFor(null); }}>{marked.has(k) ? '↩ Unmark clue' : '🚩 Mark as suspicious'}</button>}
          {onOpenLink && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setMenuFor(null); onOpenLink(index); }}>{l.qr ? '📲 Open scanned link' : '↗ Open link'}</button>}
        </span>
      </span>
    );
    const handlers = {
      onMouseEnter: () => setHoverUrl(l.href),
      onMouseLeave: () => setHoverUrl(null),
      onFocus: () => setHoverUrl(l.href),
      onBlur: () => setHoverUrl(null),
      onClick: (e) => {
        e.preventDefault();
        setHoverUrl(l.href);
        if (interactive || onOpenLink) setMenuFor(open ? null : k);
      },
    };
    if (l.qr) {
      return (
        <span key={k} className="qr-block">
          <span className={`${cls(k)} qr-code`} data-part={k} role="button" tabIndex={0} {...handlers}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handlers.onClick(e)}>
            {qrImgs[index] ? <img src={qrImgs[index]} alt={`QR code: ${l.text}`} width="132" height="132" /> : <span className="qr-loading">QR</span>}
            <span className="qr-caption">{l.text}</span>
            {(reveal || (!interactive && !onOpenLink)) && <span className="qr-decoded small">Decodes to: <code>{l.href}</code></span>}
            <Badge k={k} />
          </span>
          {menu}
        </span>
      );
    }
    return (
      <span key={k} className="link-wrap">
        <a href={l.href} title={l.href} data-part={k} className={`${cls(k)} msg-link`} rel="noreferrer noopener" {...handlers}>
          {l.text}
          <span className="link-tip" role="tooltip">Real URL: {l.href}</span>
          <Badge k={k} />
        </a>
        {menu}
      </span>
    );
  };

  const body = (
    <div className="msg-body">
      {scenario.segments.map((s, i) => {
        if (s.type === 'link') return linkEl(s.index);
        if (s.type !== 'text' || !/[\p{L}\p{N}]/u.test(s.text)) return <span key={i}>{s.text}</span>;
        return <Part key={i} k={s.id}>{s.text}</Part>;
      })}
    </div>
  );

  const attachments = scenario.attachments?.length > 0 && (
    <div className="attachments">
      {scenario.attachments.map((a, i) => (
        <Part key={i} k={`att:${i}`} className="attachment">
          <span className="att-icon">📎</span>
          <span><b>{a.name}</b><small>{a.size}</small></span>
        </Part>
      ))}
    </div>
  );

  const status = (
    <div className={`statusbar ${hoverUrl ? 'show' : ''}`} aria-live="polite">
      {hoverUrl ? <>🔗 {hoverUrl}</> : scenario.links?.some((l) => l.qr) ? 'Tap a QR code to "scan" it and see the decoded URL' : 'Hover over (or tap) a link to see where it really goes'}
    </div>
  );

  const renderSeg = (s, i) => {
    if (s.type === 'link') return linkEl(s.index);
    const text = s.display ?? s.text;
    if (!text) return null;
    if (s.type !== 'text' || !/[\p{L}\p{N}]/u.test(text)) return <span key={i}>{text}</span>;
    return <Part key={i} k={s.id}>{text}</Part>;
  };

  if (scenario.channel === 'call') {
    const lines = callLines(scenario.segments);
    const spoken = lines.map((l) => ({ speaker: l.speaker, text: l.segments.map((x) => x.display ?? x.text ?? '').join('') }));
    return (
      <div className="msg msg-call">
        <div className="call-head">
          <span className="call-icon" aria-hidden="true">📞</span>
          <div>
            <Part k="sender" className="phone-sender">{scenario.senderName}</Part>
            <div className="muted small">{scenario.senderAddress} · incoming call · transcript</div>
          </div>
          {speech.supported && (
            <button type="button" className="btn btn-sm btn-ghost call-play" onClick={() => (speech.speaking ? speech.stop() : speech.play(spoken))}>
              {speech.speaking ? '⏹ Stop' : '🔊 Listen'}
            </button>
          )}
        </div>
        <div className="call-transcript">
          {lines.map((l, i) => (
            <div key={i} className={`call-line ${l.speaker}`}>
              <span className="speaker">{l.speaker === 'caller' ? 'Caller' : 'You'}</span>
              <div className="call-bubble">{l.segments.map((s, j) => renderSeg(s, `${i}-${j}`))}</div>
            </div>
          ))}
        </div>
        <div className="statusbar">🎧 Vishing check: who is calling, what are they asking for, and how fast?</div>
      </div>
    );
  }

  if (scenario.channel === 'email') {
    return (
      <div className="msg msg-email">
        <div className="email-toolbar"><span className="dot r" /><span className="dot y" /><span className="dot g" /><span className="email-app">Inbox · student mail</span></div>
        <div className="email-head">
          <Part k="subject" as="h3" className="email-subject">{scenario.subject}</Part>
          <div className="email-from">
            <span className="avatar lg">{scenario.senderName.slice(0, 1)}</span>
            <div>
              <div className="sender-name">{scenario.senderName}</div>
              <Part k="sender" className="sender-addr">&lt;{scenario.senderAddress}&gt;</Part>
              <div className="muted small">to me</div>
            </div>
          </div>
        </div>
        {body}
        {attachments}
        {status}
      </div>
    );
  }

  const isSms = scenario.channel === 'sms';
  return (
    <div className={`msg msg-phone ${isSms ? 'msg-sms' : 'msg-social'}`}>
      <div className="phone-head">
        <span className="avatar">{isSms ? '✉' : scenario.senderName.slice(0, 1)}</span>
        <div>
          <Part k="sender" className="phone-sender">{scenario.senderName}</Part>
          <div className="muted small">
            {isSms ? (scenario.senderAddress !== scenario.senderName ? scenario.senderAddress : 'Text Message') : `${scenario.platform || 'Social'} · ${scenario.senderAddress}`}
          </div>
        </div>
      </div>
      <div className="phone-thread">
        <div className="muted small center">Today</div>
        <div className="bubble">{body}{attachments}</div>
      </div>
      {status}
    </div>
  );
}
