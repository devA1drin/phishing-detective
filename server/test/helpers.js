// Shared test harness: boots the app against in-memory SQLite (or DATABASE_URL if set).
process.env.DB_FILE ??= ':memory:';
process.env.SUPERADMIN_USERNAME = 'root';
process.env.SUPERADMIN_PASSWORD = 'test-pass-1234';
process.env.APP_SECRET ??= 'test-secret';

export async function boot() {
  const { createApp } = await import('../src/index.js');
  const app = await createApp();
  let server;
  await new Promise((r) => { server = app.listen(0, r); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const j = async (method, path, body, token) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return { server, base, j, close: () => new Promise((r) => server.close(r)) };
}

export const uniq = (p) => `${p}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
