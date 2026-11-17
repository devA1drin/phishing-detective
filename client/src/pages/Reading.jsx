// Control-group neutral reading task (general digital-wellness material, no phishing cues),
// so the control group spends comparable time without receiving the game's training.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePlayer } from '../lib/player.jsx';

const MIN_SECONDS = 60;

export default function Reading() {
  const { refresh } = usePlayer();
  const nav = useNavigate();
  const [left, setLeft] = useState(MIN_SECONDS);
  const [error, setError] = useState('');
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const done = async () => {
    try { await api.readingDone(); await refresh(); nav('/hub'); } catch (e) { setError(e.message); }
  };
  return (
    <article className="card narrow reading">
      <span className="eyebrow">Reading task · about 5 minutes</span>
      <h1>Healthy digital habits for students</h1>
      <p>Most of your school life now runs on a phone or laptop: modules, group chats, online classes and payments. A few simple habits make that life smoother and safer.</p>
      <h2>1. Keep your devices updated</h2>
      <p>Updates fix bugs and close security holes. Turn on automatic updates for your phone's operating system and apps, and restart your laptop at least once a week so pending updates can finish installing.</p>
      <h2>2. Back up what matters</h2>
      <p>Phones get lost and laptops fail, usually right before a deadline. Keep your thesis files, modules and photos in at least two places, for example your laptop plus a cloud drive or a USB flash drive. Follow the 3-2-1 idea: three copies, on two kinds of storage, one kept somewhere else.</p>
      <h2>3. Use a screen lock and strong, different passwords</h2>
      <p>A PIN, pattern or fingerprint stops anyone who picks up your phone. For accounts, a long passphrase (four or more random words) is easier to remember and harder to guess than a short password. Using a different password for each important account means one leak doesn't unlock everything. A password manager can remember them for you.</p>
      <h2>4. Be careful on public Wi-Fi</h2>
      <p>Free Wi-Fi in cafés and malls is convenient but shared with strangers. Avoid doing banking or entering passwords on open networks; mobile data is usually safer. Turn off auto-connect so your phone doesn't join unknown networks by itself.</p>
      <h2>5. Manage your screen time and privacy settings</h2>
      <p>Check which apps can use your camera, microphone and location, and remove permissions they don't need. Set your social-media profiles so only friends see your posts, and think twice before sharing your school, address or daily routine publicly. Take breaks from screens: the 20-20-20 rule (every 20 minutes, look at something 20 feet away for 20 seconds) helps tired eyes.</p>
      <h2>6. Know where to ask for help</h2>
      <p>If something about your account or device seems wrong, talk to your school's IT office, a teacher, or a trusted family member. Asking early usually makes problems smaller.</p>
      <hr />
      {error && <p className="error">{error}</p>}
      <button className="btn btn-gold" disabled={left > 0} onClick={done}>{left > 0 ? `Keep reading… (${left}s)` : "I've finished reading →"}</button>
    </article>
  );
}
