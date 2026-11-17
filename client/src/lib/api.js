async function request(method, url, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status; err.details = data.details;
    throw err;
  }
  return data;
}

export const api = {
  register: (nickname) => request('POST', '/api/players', { nickname }),
  progress: (id) => request('GET', `/api/players/${id}/progress`),
  leaderboard: () => request('GET', '/api/leaderboard'),
  startSession: (playerId, level) => request('POST', '/api/sessions', { playerId, level }),
  answer: (sessionId, payload) => request('POST', `/api/sessions/${sessionId}/answers`, payload),
  finish: (sessionId) => request('POST', `/api/sessions/${sessionId}/finish`),
  quiz: (kind) => request('GET', `/api/quiz/${kind}`),
  submitQuiz: (kind, playerId, answers) => request('POST', `/api/quiz/${kind}/submit`, { playerId, answers }),
  admin: {
    login: (password) => request('POST', '/api/admin/login', { password }),
    stats: (t) => request('GET', '/api/admin/stats', undefined, t),
    players: (t) => request('GET', '/api/admin/players', undefined, t),
    sessions: (t) => request('GET', '/api/admin/sessions', undefined, t),
    scenarioStats: (t) => request('GET', '/api/admin/scenario-stats', undefined, t),
    scenarios: (t) => request('GET', '/api/admin/scenarios', undefined, t),
    createScenario: (t, s) => request('POST', '/api/admin/scenarios', s, t),
    updateScenario: (t, id, s) => request('PUT', `/api/admin/scenarios/${id}`, s, t),
    deleteScenario: (t, id) => request('DELETE', `/api/admin/scenarios/${id}`, undefined, t),
    async download(t, kind) {
      const res = await fetch(`/api/admin/export/${kind}.csv`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `phishing-detective-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  },
};
