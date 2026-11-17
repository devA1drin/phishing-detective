import { Link, NavLink, useNavigate } from 'react-router-dom';
import { usePlayer } from '../lib/player.jsx';

export function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#16233a" />
      <circle cx="27" cy="27" r="13" fill="none" stroke="#f5b942" strokeWidth="5" />
      <path d="M37 37l12 12" stroke="#f5b942" strokeWidth="6" strokeLinecap="round" />
      <path d="M21 27h12M27 21v12" stroke="#ef5b5b" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function Header() {
  const { player, progress, logout } = usePlayer();
  const nav = useNavigate();
  return (
    <header className="topbar">
      <Link to={player ? '/hub' : '/'} className="brand">
        <Logo />
        <span>Phishing <b>Detective</b></span>
      </Link>
      <nav className="topnav">
        {player && <NavLink to="/hub">Case Board</NavLink>}
        <NavLink to="/admin">Educators</NavLink>
        {player && (
          <div className="badge-player" title="Your detective ID">
            <span className="avatar">{player.nickname.slice(0, 1).toUpperCase()}</span>
            <span className="hide-sm">{player.nickname}</span>
            {progress && <span className="pill pill-gold hide-sm">{progress.totalScore} pts</span>}
            <button className="link-btn" onClick={() => { logout(); nav('/'); }}>Sign out</button>
          </div>
        )}
      </nav>
    </header>
  );
}
