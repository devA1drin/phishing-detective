// Shared row/param normalisation so the same SQL works on SQLite and Postgres.
export const JSON_COLS = new Set(['links', 'attachments', 'red_flags', 'safe_signs', 'scenario_ids', 'answers', 'value', 'data', 'meta', 'categories']);
export const BOOL_COLS = new Set(['is_phishing', 'active', 'is_correct', 'link_clicked']);

/** Timestamps are rendered as "YYYY-MM-DD HH:MM:SS" (UTC) on both engines. */
export const ts = (d) => (d instanceof Date ? d.toISOString().replace('T', ' ').slice(0, 19) : d);

export function normaliseRow(row) {
  if (!row) return row;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Date) row[k] = ts(v);
    else if (JSON_COLS.has(k) && typeof v === 'string') { try { row[k] = JSON.parse(v); } catch { /* keep */ } }
    else if (BOOL_COLS.has(k) && typeof v === 'number') row[k] = v === 1;
  }
  return row;
}

export function normaliseParam(v, kind) {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return kind === 'sqlite' ? (v ? 1 : 0) : v;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Parse "YYYY-MM-DD HH:MM:SS" (UTC) → epoch ms */
export const parseTs = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : null);
