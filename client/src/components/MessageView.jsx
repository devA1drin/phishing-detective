import { useState } from 'react';

/**
 * Renders a scenario as an email, SMS or social DM.
 * Every suspicious-able part (sender, subject, sentences, links, attachments)
 * is clickable when `onToggle` is provided. `reveal` highlights red flags after answering.
 */
export default function MessageView({ scenario, marked = new Set(), onToggle, reveal }) {
  const [hoverUrl, setHoverUrl] = useState(null);
  const interactive = !!onToggle;

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
    return (
      <a
        key={k}
        href={l.href}
        title={l.href}
        data-part={k}
        className={`${cls(k)} msg-link`}
        onMouseEnter={() => setHoverUrl(l.href)}
        onMouseLeave={() => setHoverUrl(null)}
        onFocus={() => setHoverUrl(l.href)}
        onBlur={() => setHoverUrl(null)}
        onClick={(e) => { e.preventDefault(); setHoverUrl(l.href); interactive && onToggle(k); }}
        rel="noreferrer noopener"
      >
        {l.text}
        <span className="link-tip" role="tooltip">Real URL: {l.href}</span>
        <Badge k={k} />
      </a>
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
      {hoverUrl ? <>🔗 {hoverUrl}</> : 'Hover over (or tap) a link to see where it really goes'}
    </div>
  );

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
