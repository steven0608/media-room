// "Connect anywhere" — the headset's end of the link (see hub/remote.js for the hub's end).
//
// When the room page is served by the hub itself (home network), nothing here is used.
// When it's served from the public address (e.g. GitHub Pages), the page has no hub behind it,
// so it finds the user's hub through the meeting point and opens a direct, end-to-end
// encrypted WebRTC data channel. Then every request the room makes — "/api/…", "/media/…",
// "/stream/…", "/karaoke/…" — travels over that channel to the hub, which answers with its
// normal handler. The rest of the room doesn't know the difference.
import { CONFIG } from './config.js';
import { store } from './api.js';

const nativeFetch = window.fetch.bind(window);
const HUB_PATH = /^\/(api|media|stream|stream-audio|karaoke)\b/;
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

class Link {
  constructor() {
    this.active = false;      // true when requests go over WebRTC
    this.route = null;        // 'lan' | 'direct' | 'relay'
    this.state = 'idle';      // idle | connecting | open | offline | failed
    this.listeners = new Set();
    this.pending = new Map(); // request id → { resolve, reject, controller, timer }
    this.nextId = 1;
    this.saved = store.get('link', null); // { signal, hubId, token }
    this.blobCache = new Map();
  }

  onState(fn) { this.listeners.add(fn); }
  _set(state, extra = {}) {
    Object.assign(this, { state }, extra);
    for (const fn of this.listeners) fn(this);
  }

  /** Which meeting point to use: ?signal= (testing) → saved → the address baked into config.js. */
  get signal() {
    const q = new URLSearchParams(location.search).get('signal');
    return (q || this.saved?.signal || CONFIG.remote.signal || '').replace(/\/+$/, '');
  }

  /**
   * Decide how this page reaches the hub.
   *  → { mode: 'direct' }                 page is served by the hub
   *  → { mode: 'link', paired: bool }     page is the public one; uses the link
   *  → { mode: 'none' }                   neither (no hub and no meeting point configured)
   */
  async init() {
    try {
      const r = await nativeFetch('/api/status', { signal: AbortSignal.timeout(2500) });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        const s = await r.json();
        if (Array.isArray(s.urls)) return { mode: 'direct' };
      }
    } catch { /* not a hub */ }
    if (!this.signal) return { mode: 'none' };
    this.active = true;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      return url.startsWith('/') && HUB_PATH.test(url) ? this.fetch(url, init) : nativeFetch(input, init);
    };
    return { mode: 'link', paired: !!(this.saved?.hubId && this.saved?.token) };
  }

  /** First time: swap the 6-digit code for the hub's id, connect, and get this headset's own key. */
  async pair(code, device) {
    const r = await nativeFetch(`${this.signal}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'pairing failed'); e.data = j; throw e; }
    this.saved = { signal: this.signal, hubId: j.id, token: null };
    this.pairCode = code; // lets the hub give this not-yet-paired headset the relay
    try { await this.connect(); } finally { this.pairCode = null; }
    const res = await this.fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, device }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(body.error || 'pairing failed'); e.data = body; throw e; }
    this.saved.token = body.token;
    store.set('link', this.saved);
    this._send({ t: 'hello', token: body.token });
  }

  /** Hubs in this home (same internet address), for "Connect to <PC>". → [{ id, name }] */
  async nearby() {
    try {
      const r = await nativeFetch(`${this.signal}/nearby`, { signal: AbortSignal.timeout(6000) });
      return r.ok ? (await r.json()).hubs || [] : [];
    } catch { return []; }
  }

  /**
   * One-click connect: no code. The hub lets this headset in straight away when it's on the same
   * Wi-Fi while the hub's setup page is open; otherwise the PC shows "Allow" and we wait for it.
   * onWait() is called once if we have to wait. Resolves when paired; throws if denied or gone.
   */
  async connectTo(hubId, device, { onWait, cancelled = () => false } = {}) {
    this.saved = { signal: this.signal, hubId, token: null };
    await this.connect();
    const post = await this.fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: true, device }) });
    let body = await post.json().catch(() => ({}));
    if (!post.ok) { const e = new Error(body.error || 'pairing failed'); e.data = body; throw e; }
    if (body.pending) {
      onWait?.();
      const id = body.id;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled()) throw Object.assign(new Error('cancelled'), { data: { code: 'cancelled' } });
        const r = await this.fetch(`/api/pair/request/${id}`);
        body = await r.json().catch(() => ({}));
        if (body.state === 'approved') break;
        if (body.state === 'denied' || body.state === 'gone') throw Object.assign(new Error(body.state), { data: { code: `pair-${body.state}` } });
      }
    }
    this.saved.token = body.token;
    store.set('link', this.saved);
    this._send({ t: 'hello', token: body.token });
  }

  /** Stop routing requests to a hub (the demo room answers them instead). */
  deactivate() {
    if (!this.active) return;
    this.active = false;
    window.fetch = nativeFetch;
    this.close();
  }

  forget() {
    store.set('link', null);
    this.saved = null;
    this.close();
  }

  // ---------------------------------------------------------------- connection
  connect() {
    if (this.state === 'open') return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this._connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async _connect() {
    if (!this.saved?.hubId) throw new Error('not paired');
    this._set('connecting');
    const signal = this.saved.signal || this.signal;
    const ws = new WebSocket(`${signal.replace(/^http/, 'ws')}/connect?id=${this.saved.hubId}`);
    this.ws = ws;

    return new Promise((resolve, reject) => {
      let pc = null;
      let iceWait = null;
      const fail = (why) => { cleanup(); this._set(why === 'hub-offline' ? 'offline' : 'failed', { error: why }); reject(new Error(why)); };
      const timer = setTimeout(() => fail('timeout'), 25000);
      const cleanup = () => { clearTimeout(timer); clearTimeout(iceWait); };

      // Build the WebRTC side once we know the network routes (relay passes come from our own hub).
      const start = async (iceServers) => {
        if (pc) return;
        clearTimeout(iceWait);
        pc = new RTCPeerConnection({ iceServers });
        const dc = pc.createDataChannel('mr', { ordered: true });
        dc.binaryType = 'arraybuffer';
        this.pc = pc; this.dc = dc;
        pc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type: 'candidate', candidate: e.candidate.candidate, mid: e.candidate.sdpMid })); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') fail('connection failed'); };
        dc.onopen = async () => {
          cleanup();
          this._send({ t: 'hello', token: this.saved.token || undefined });
          this._set('open', { route: await this._route() });
          resolve();
        };
        dc.onclose = () => { if (this.dc === dc) this._closed(); };
        dc.onmessage = (e) => this._onMessage(e.data);
        await pc.setLocalDescription(await pc.createOffer());
        ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }));
      };

      ws.onopen = () => {
        // Ask the hub for routes. It includes relay passes only for headsets it has paired
        // (our device key, or the code we're pairing with right now).
        ws.send(JSON.stringify({ type: 'ice', token: this.saved.token || undefined, code: this.pairCode || undefined }));
        iceWait = setTimeout(() => start(STUN), 5000); // an older hub won't answer: go without the relay
      };
      ws.onmessage = async (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'hub-offline') return fail('hub-offline');
        if (m.type === 'ice') return start(Array.isArray(m.iceServers) && m.iceServers.length ? m.iceServers : STUN);
        if (!pc) return;
        if (m.type === 'answer') await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        else if (m.type === 'candidate' && m.candidate) await pc.addIceCandidate({ candidate: m.candidate.replace(/^a=/, ''), sdpMid: m.mid || '0' }).catch(() => {});
      };
      ws.onerror = () => fail('meeting point unreachable');
    });
  }

  async _route() {
    try {
      const stats = await this.pc.getStats();
      let pair;
      stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
      if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
      const l = stats.get(pair?.localCandidateId)?.candidateType;
      const r = stats.get(pair?.remoteCandidateId)?.candidateType;
      if (l === 'relay' || r === 'relay') return 'relay';
      if (l === 'host' && r === 'host') return 'lan';
      return 'direct';
    } catch { return null; }
  }

  _closed() {
    for (const [, p] of this.pending) p.fail(new Error('link closed'));
    this.pending.clear();
    this._set('idle');
    try { this.ws?.close(); } catch { /* closed */ }
  }

  close() {
    try { this.dc?.close(); this.pc?.close(); this.ws?.close(); } catch { /* closed */ }
    this._closed();
  }

  _send(o) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(o));
  }

  _onMessage(data) {
    if (typeof data === 'string') {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.t === 'head') p.head(m.status, m.headers);
      else if (m.t === 'end') p.end();
      else if (m.t === 'err') p.fail(new Error(m.error || 'stream error'));
      return;
    }
    const id = new DataView(data).getUint32(0);
    this.pending.get(id)?.chunk(new Uint8Array(data, 4));
  }

  // ---------------------------------------------------------------- requests
  /** fetch() over the link. Bodies stream in as they arrive (music/video start before the end). */
  async fetch(path, init = {}) {
    await this.connect();
    const id = this.nextId++;
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    return new Promise((resolve, reject) => {
      let controller;
      const body = new ReadableStream({
        start: (c) => { controller = c; },
        cancel: () => { this._send({ t: 'cancel', id }); this.pending.delete(id); },
      });
      let headDone = false;
      const p = {
        head: (status, h) => {
          headDone = true;
          const noBody = status === 204 || status === 304;
          resolve(new Response(noBody ? null : body, { status, headers: Object.fromEntries(Object.entries(h || {}).filter(([k]) => k !== 'set-cookie').map(([k, v]) => [k, String(v)])) }));
        },
        chunk: (u8) => { try { controller.enqueue(u8); } catch { /* reader gone */ } },
        end: () => { this.pending.delete(id); try { controller.close(); } catch { /* already */ } },
        fail: (err) => {
          this.pending.delete(id);
          if (!headDone) reject(err);
          else try { controller.error(err); } catch { /* already */ }
        },
      };
      this.pending.set(id, p);
      this._send({ t: 'req', id, method: init.method || 'GET', path, headers, body: init.body ?? null });
    });
  }

  /** A blob: URL for something the browser loads by itself (cover images, subtitles, karaoke audio). */
  async objectUrl(path) {
    if (this.blobCache.has(path)) return this.blobCache.get(path);
    const job = this.fetch(path).then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null));
    this.blobCache.set(path, job);
    if (this.blobCache.size > 400) {
      const [k, v] = this.blobCache.entries().next().value;
      this.blobCache.delete(k);
      v.then((u) => u && URL.revokeObjectURL(u));
    }
    return job;
  }
}

export const link = new Link();
