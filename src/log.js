// A small flight recorder: errors and key moments on the headset (entering VR, the microphone's
// answer, the connection coming and going, library failures) are sent to the hub every few
// seconds, so a problem seen in the headset can be read on the PC (hub: /api/log, PC only).
// Nothing personal: only what the app did and what went wrong.
const buf = [];
let sending = false;

export function log(event, detail) {
  const line = { t: new Date().toISOString().slice(11, 23), e: String(event).slice(0, 60) };
  if (detail !== undefined) line.d = typeof detail === 'string' ? detail.slice(0, 300) : safe(detail);
  buf.push(line);
  if (buf.length > 200) buf.splice(0, buf.length - 200);
}

function safe(o) {
  try { return JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' ? v.slice(0, 200) : v))); } catch { return String(o).slice(0, 300); }
}

async function flush() {
  if (sending || !buf.length) return;
  sending = true;
  const lines = buf.splice(0, buf.length);
  try {
    const r = await fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ua: navigator.userAgent.slice(0, 120), lines }) });
    if (!r.ok) throw new Error(r.status);
  } catch {
    buf.unshift(...lines.slice(-100)); // keep the latest for the next try
  }
  sending = false;
}

addEventListener('error', (e) => log('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => log('rejection', String(e.reason?.stack || e.reason).slice(0, 300)));
document.addEventListener('visibilitychange', () => { log('visibility', document.visibilityState); if (document.hidden) flush(); });
addEventListener('pagehide', () => { log('pagehide'); flush(); });
setInterval(flush, 5000);
log('start', { app: new URLSearchParams(location.search).has('app'), href: location.pathname });
