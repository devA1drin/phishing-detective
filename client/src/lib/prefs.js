// Player preferences kept in the browser: round mode and message language filter.
const KEY = 'pd.prefs';
const DEFAULTS = { mode: 'classic', language: 'all' };
export const getPrefs = () => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEFAULTS }; }
};
export const setPrefs = (patch) => {
  const next = { ...getPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
};
