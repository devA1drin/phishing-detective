import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
const KEY = 'pd.player';

export function PlayerProvider({ children }) {
  const [player, setPlayer] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem(KEY));
      return p?.token ? p : null; // pre-PIN sessions (no token) must sign in again
    } catch { return null; }
  });
  const [progress, setProgress] = useState(null);

  const logout = useCallback(() => { localStorage.removeItem(KEY); setPlayer(null); setProgress(null); }, []);

  const refresh = useCallback(async () => {
    if (!player) return null;
    try {
      const p = await api.progress();
      setProgress(p);
      return p;
    } catch (e) {
      if (e.status === 401 || e.status === 404) logout();
      return null;
    }
  }, [player, logout]);

  useEffect(() => { refresh(); }, [refresh]);

  // p = { token, player: { id, nickname, group } }
  const login = ({ token, player: pl }) => {
    const v = { ...pl, token };
    localStorage.setItem(KEY, JSON.stringify(v));
    setPlayer(v);
  };

  return <Ctx.Provider value={{ player, progress, refresh, login, logout }}>{children}</Ctx.Provider>;
}

export const usePlayer = () => useContext(Ctx);
