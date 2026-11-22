// The demo room: Still Water with no hub at all — for a first look, and for store review.
// It answers the same addresses a hub does ("/api/…", "/media/…", "/karaoke/…") from answers
// recorded off a real hub running on original demo content (tools/demo/record-demo.mjs →
// app/demo/responses.json + app/demo/files/). So the room behaves exactly as it would at home:
// three original songs, two sing-alongs with scoring, a short film, lyrics, matching.
const nativeFetch = window.fetch.bind(window);
const HUB_PATH = /^\/(api|media|stream|stream-audio|karaoke)\b/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

class Demo {
  constructor() {
    this.active = false;
    this.data = null;
  }

  /** Switch the room to the demo (call before anything asks the hub). */
  async start() {
    if (this.active) return;
    const r = await nativeFetch(new URL('demo/responses.json', document.baseURI));
    this.data = await r.json();
    this.active = true;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      return url.startsWith('/') && HUB_PATH.test(url) ? this.answer(url, init) : nativeFetch(input, init);
    };
  }

  /** Where the browser should load a media/cover address from (unchanged outside the demo). */
  url(p) {
    if (!this.active || !p || !p.startsWith('/')) return p;
    const f = this.data.files[p] || this.data.files[p.split('?')[0]];
    return f ? new URL(f, document.baseURI).href : p;
  }

  async answer(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const [p, q = ''] = url.split('?');
    const R = this.data.responses;
    if (method !== 'GET') {
      if (/^\/api\/karaoke\/prepare\//.test(p)) return json({ ready: false, error: 'demo', code: 'demo' }, 400);
      return json({ ok: true, demo: true });
    }
    if (R[url]) return json(R[url]);
    // lyrics / karaoke words in another script than recorded → the original
    const script = new URLSearchParams(q).get('script');
    if (script && R[`${p}?script=original`]) return json(R[`${p}?script=original`]);
    if (R[p]) return json(R[p]);
    if (/^\/api\/search\/(music|video)$/.test(p)) {
      const kind = p.split('/').pop();
      const needle = (new URLSearchParams(q).get('q') || '').toLowerCase();
      const seen = new Map();
      for (const [k, v] of Object.entries(R)) {
        if (!k.startsWith(`/api/library/${kind}`)) continue;
        for (const it of v.items || []) if (!needle || `${it.title} ${it.artist} ${it.name}`.toLowerCase().includes(needle)) seen.set(it.id, it);
      }
      return json({ items: [...seen.values()] });
    }
    if (p === '/api/nas/browse') return json({ path: '', crumbs: [{ id: '', name: 'NAS' }], folders: [], items: [], canAdd: false, demo: true });
    const f = this.data.files[url] || this.data.files[p];
    if (f) return nativeFetch(new URL(f, document.baseURI));
    return json({ error: 'Not in the demo', code: 'demo' }, 404);
  }
}

export const demo = new Demo();
