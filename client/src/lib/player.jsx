import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
const KEY = 'pd.player';

export function PlayerProvider({ children }) {
  const [player, setPlayer] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  });
  const [progress, setProgress] = useState(null);

  const refresh = useCallback(async () => {
    if (!player) return null;
    try {
      const p = await api.progress(player.id);
      setProgress(p);
      return p;
    } catch (e) {
      if (e.status === 404) { localStorage.removeItem(KEY); setPlayer(null); }
      return null;
    }
  }, [player]);

  useEffect(() => { refresh(); }, [refresh]);

  const login = (p) => { localStorage.setItem(KEY, JSON.stringify(p)); setPlayer(p); };
  const logout = () => { localStorage.removeItem(KEY); setPlayer(null); setProgress(null); };

  return <Ctx.Provider value={{ player, progress, refresh, login, logout }}>{children}</Ctx.Provider>;
}

export const usePlayer = () => useContext(Ctx);
