const PLAYER_KEY = 'pd.player';
export const playerToken = () => {
  try { return JSON.parse(localStorage.getItem(PLAYER_KEY))?.token || null; } catch { return null; }
};

async function request(method, url, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status; err.details = data.details; err.data = data;
    throw err;
  }
  return data;
}
// Player calls carry the player's signed token automatically
const p = (method, url, body) => request(method, url, body, playerToken());

const sq = (sec) => (sec ? `?section=${encodeURIComponent(sec)}` : '');
async function saveFile(t, url, filename) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const api = {
  register: (nickname, pin, consent) => request('POST', '/api/players/register', { nickname, pin, consent }),
  login: (nickname, pin) => request('POST', '/api/players/login', { nickname, pin }),
  progress: () => p('GET', '/api/players/me/progress'),
  readingDone: () => p('POST', '/api/players/me/reading-done'),
  leaderboard: () => request('GET', '/api/leaderboard'),
  startSession: (level, opts = {}) => p('POST', '/api/sessions', { level, ...opts }),
  linkClick: (sessionId, payload) => p('POST', `/api/sessions/${sessionId}/link-click`, payload),
  answer: (sessionId, payload) => p('POST', `/api/sessions/${sessionId}/answers`, payload),
  finish: (sessionId) => p('POST', `/api/sessions/${sessionId}/finish`),
  quiz: (kind) => request('GET', `/api/quiz/${kind}`),
  submitQuiz: (kind, answers) => p('POST', `/api/quiz/${kind}/submit`, { answers }),
  coach: (sessionId, payload) => p('POST', `/api/sessions/${sessionId}/coach`, payload),
  daily: () => p('GET', '/api/daily'),
  badges: () => p('GET', '/api/players/me/badges'),
  joinSection: (code) => p('POST', '/api/players/me/section', { code }),
  classLeaderboard: () => request('GET', '/api/leaderboard/classes'),
  certificate: () => p('GET', '/api/certificates/me'),
  issueCertificate: () => p('POST', '/api/certificates/me'),
  verify: (code) => request('GET', `/api/verify/${encodeURIComponent(code)}`),
  certificatePdfUrl: (code) => `/api/certificates/${encodeURIComponent(code)}/pdf`,
  surveyItems: () => request('GET', '/api/surveys/items'),
  submitSurvey: (kind, answers) => p('POST', `/api/surveys/${kind}`, { answers }),
  admin: {
    login: (username, password) => request('POST', '/api/admin/login', { username, password }),
    me: (t) => request('GET', '/api/admin/me', undefined, t),
    changePassword: (t, currentPassword, newPassword) => request('PUT', '/api/admin/me/password', { currentPassword, newPassword }, t),
    stats: (t, sec) => request('GET', `/api/admin/stats${sq(sec)}`, undefined, t),
    players: (t, sec) => request('GET', `/api/admin/players${sq(sec)}`, undefined, t),
    playerReport: (t, id) => request('GET', `/api/admin/players/${id}/report`, undefined, t),
    sectionReport: (t, id) => request('GET', `/api/admin/sections/${id}/report`, undefined, t),
    deleteSection: (t, id) => request('DELETE', `/api/admin/sections/${id}`, undefined, t),
    setGroup: (t, id, group) => request('PUT', `/api/admin/players/${id}/group`, { group }, t),
    sessions: (t, sec) => request('GET', `/api/admin/sessions${sq(sec)}`, undefined, t),
    scenarioStats: (t, sec) => request('GET', `/api/admin/scenario-stats${sq(sec)}`, undefined, t),
    scenarios: (t) => request('GET', '/api/admin/scenarios', undefined, t),
    createScenario: (t, s) => request('POST', '/api/admin/scenarios', s, t),
    updateScenario: (t, id, s) => request('PUT', `/api/admin/scenarios/${id}`, s, t),
    deleteScenario: (t, id) => request('DELETE', `/api/admin/scenarios/${id}`, undefined, t),
    aiStatus: (t) => request('GET', '/api/admin/ai/status', undefined, t),
    aiGenerate: (t, opts) => request('POST', '/api/admin/ai/generate', opts, t),
    reviewScenario: (t, id, status) => request('POST', `/api/admin/scenarios/${id}/review`, { status }, t),
    scenariosByStatus: (t, status) => request('GET', `/api/admin/scenarios?status=${status}`, undefined, t),
    sections: (t) => request('GET', '/api/admin/sections', undefined, t),
    createSection: (t, name) => request('POST', '/api/admin/sections', { name }, t),
    admins: (t) => request('GET', '/api/admin/admins', undefined, t),
    createAdmin: (t, a) => request('POST', '/api/admin/admins', a, t),
    updateAdmin: (t, id, a) => request('PUT', `/api/admin/admins/${id}`, a, t),
    deleteAdmin: (t, id) => request('DELETE', `/api/admin/admins/${id}`, undefined, t),
    settings: (t) => request('GET', '/api/admin/settings', undefined, t),
    saveSettings: (t, s) => request('PUT', '/api/admin/settings', s, t),
    download: (t, kind, sec) => saveFile(t, `/api/admin/export/${kind}.csv${sq(sec)}`, `phishing-detective-${kind}${sec ? `-section-${sec}` : ''}.csv`),
    chapter4Pdf: (t, sec) => saveFile(t, `/api/admin/reports/chapter4.pdf${sq(sec)}`, `phishing-detective-chapter4${sec ? `-section-${sec}` : ''}.pdf`),
  },
};
