// Talking to the hub. Everything is same-origin, so cookies and media "just work".
export async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

// localStorage can throw (private mode, blocked storage) — the room must work without it.
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`mr.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`mr.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};
