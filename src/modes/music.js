// Music mode: plays a folder of songs from the hub and paints the now-playing card onto
// the big screen — cover, title, progress, the song's lyrics in time with the music, and
// buttons that connect to the other experiences: "Sing this" (karaoke) and "Watch video".
// The lake does the visualizing (see room/lake.js).
import { api, store } from '../api.js';
import { canvasTexture, font, ellipsize, roundRect, drawCover, drawPlaceholder, getImage, fmtTime } from '../ui/text.js';
import { t, onLang, lyricsScript } from '../i18n.js';
import { link } from '../link.js';
import { playStream, AUDIO_MIME } from '../mse.js';
import { demo } from '../demo.js';

const W = 1280, H = 720;

export class MusicMode {
  constructor({ engine, sfx }) {
    this.engine = engine;
    this.sfx = sfx;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];
    this.index = -1;
    this.folder = null;
    this.lyrics = null;   // { loading } | { source, synced, lines }
    this.match = null;    // { karaoke, videos, … } from /api/match
    this.regions = [];    // clickable areas on the screen (canvas pixels)
    this.hover = null;
    this.toast = null;
    this.onChange = () => {};
    this.onAction = () => {};
    const { canvas, ctx, tex } = canvasTexture(W, H);
    this.canvas = canvas; this.ctx = ctx; this.texture = tex;
    this.redrawClock = 0;
    this.lineIdx = -1;
    this.audio.addEventListener('ended', () => this.next(true));
    this.audio.addEventListener('play', () => this._changed());
    this.audio.addEventListener('pause', () => this._changed());
    this.audio.addEventListener('error', () => {
      this.error = 'music.cantPlay';
      this._changed();
      setTimeout(() => this.next(true), 1500);
    });
    onLang(() => { if (this.current) this._fetchLyrics(this.current); this.draw(); });
    this.draw();
  }

  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused && !this.audio.ended; }

  play(items, index, folder) {
    this.queue = items.slice();
    this.folder = folder || null;
    this._load(index, 0);
  }

  _load(i, startAt = 0) {
    if (!this.queue.length) return;
    this.index = (i + this.queue.length) % this.queue.length;
    const it = this.current;
    this.error = '';
    this.engine.attach(this.audio);
    this.stream?.stop();
    this.stream = null;
    if (link.active) this.stream = playStream(this.audio, `/stream-audio/${it.id}?t=${startAt || 0}`, AUDIO_MIME, { duration: it.duration ? it.duration - (startAt || 0) : undefined });
    else {
      this.audio.src = demo.url(`/media/${it.id}`);
      if (startAt) this.audio.currentTime = startAt;
    }
    this.audio.play().catch(() => {});
    store.set('lastMusic', { queue: this.queue.slice(0, 500), index: this.index, folder: this.folder });
    this.match = null;
    this.lineIdx = -1;
    this._fetchLyrics(it);
    this.refreshMatch();
    this._changed();
  }

  async _fetchLyrics(it) {
    this.lyrics = { loading: true };
    try {
      const r = await api(`/api/lyrics/${it.id}?script=${lyricsScript()}`);
      if (this.current?.id === it.id) this.lyrics = r;
    } catch {
      if (this.current?.id === it.id) this.lyrics = { source: null, lines: [] };
    }
    this.draw();
  }

  /** What else goes with this song (karaoke status, music videos). Called again while karaoke is being prepared. */
  async refreshMatch() {
    const it = this.current;
    if (!it) return;
    try {
      const m = await api(`/api/match/${it.id}`);
      if (this.current?.id !== it.id) return;
      const wasPreparing = this.match?.karaoke?.job && !this.match.karaoke.ready;
      this.match = m;
      if (wasPreparing && m.karaoke?.ready) {
        this.toast = { text: t('action.readyToast', { title: it.title }), until: performance.now() + 5000 };
        this.sfx.star(4);
        if (!this.lyrics?.synced || this.lyrics.source !== 'karaoke') this._fetchLyrics(it); // now word-timed
      }
    } catch { /* offline hub */ }
    this.draw();
  }

  /** Is a karaoke package for the current song being made? (main.js polls while true) */
  get preparing() {
    const k = this.match?.karaoke;
    return !!(k && !k.ready && k.job && (k.job.state === 'queued' || k.job.state === 'running'));
  }

  resume() {
    const last = store.get('lastMusic', null);
    if (!last?.queue?.length) return false;
    this.queue = last.queue;
    this.folder = last.folder;
    this._load(last.index || 0, 0);
    return true;
  }

  /** Play/pause. Returns false when there's nothing to play (the caller opens the library). */
  toggle() {
    if (!this.current) return this.resume();
    this.engine.unlock();
    if (this.audio.paused) this.audio.play().catch(() => {}); else this.audio.pause();
    return true;
  }
  pause() { this.audio.pause(); }
  next() { if (this.queue.length) this._load(this.index + 1); }
  prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 4) { if (link.active) this._load(this.index); else this.audio.currentTime = 0; }
    else this._load(this.index - 1);
  }

  _changed() {
    this.draw();
    this.onChange();
  }

  /** Pointer support for the buttons drawn on the screen. x, y in canvas pixels. */
  hit(x, y) {
    return this.regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || null;
  }
  setHover(r) {
    if ((r?.key ?? null) === (this.hover?.key ?? null)) return;
    this.hover = r;
    if (r) this.sfx.hover();
    this.draw();
  }
  click(r) {
    if (r) { this.sfx.select(); this.onAction(r.key, r); }
  }

  _currentLine() {
    const ly = this.lyrics;
    if (!ly?.synced || !ly.lines?.length) return -1;
    const time = this.audio.currentTime;
    let i = -1;
    for (let k = 0; k < ly.lines.length && ly.lines[k].t <= time + 0.15; k++) i = k;
    return i;
  }

  update(dt, active) {
    if (!active) return;
    this.redrawClock += dt;
    // lyrics sweep smoothly (~8 fps redraw); without lyrics twice a second is plenty
    const rate = this.lyrics?.synced && this.playing ? 0.12 : 0.5;
    const li = this._currentLine();
    if (this.redrawClock > rate || li !== this.lineIdx) { this.redrawClock = 0; this.lineIdx = li; this.draw(); }
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0a0f26');
    bg.addColorStop(1, '#04060f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    this.regions = [];
    const it = this.current;
    if (!it) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e8ecff';
      ctx.font = font(58, 700);
      ctx.fillText(t('music.pick'), W / 2, H / 2 - 90);
      ctx.fillStyle = '#9aa3c7';
      ctx.font = font(30);
      ctx.fillText(t('music.pickHint'), W / 2, H / 2 - 30);
      this.regions.push(bigButton(ctx, t('lib.openBig'), W / 2, H / 2 + 70, this.hover?.key === 'library'));
      this.texture.needsUpdate = true;
      return;
    }

    // --- cover
    const cs = 300, cx = 90, cy = 64;
    const img = getImage(it.cover, () => this.draw());
    ctx.save();
    ctx.shadowColor = 'rgba(92,225,230,0.45)';
    ctx.shadowBlur = 60;
    roundRect(ctx, cx, cy, cs, cs, 24);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    if (img) drawCover(ctx, img, cx, cy, cs, cs, 24);
    else drawPlaceholder(ctx, cx, cy, cs, cs, it.title, 24);

    // --- title block
    const tx = cx + cs + 64, tw = W - tx - 80;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffb35c';
    ctx.font = font(22, 700);
    ctx.fillText(t(this.playing ? 'music.nowPlaying' : 'music.paused'), tx, cy + 34);
    ctx.fillStyle = '#e8ecff';
    ctx.font = font(60, 750);
    ctx.fillText(ellipsize(ctx, it.title, tw), tx, cy + 108);
    ctx.fillStyle = '#b7bfdf';
    ctx.font = font(34, 500);
    ctx.fillText(ellipsize(ctx, [it.artist, it.album].filter(Boolean).join(' · ') || '—', tw), tx, cy + 158);

    // --- progress
    const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : it.duration || 0;
    const cur = this.audio.currentTime || 0;
    const py = cy + 196;
    roundRect(ctx, tx, py, tw, 10, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    g.addColorStop(0, '#5ce1e6');
    g.addColorStop(1, '#ff4fa3');
    roundRect(ctx, tx, py, Math.max(10, tw * (dur ? cur / dur : 0)), 10, 5);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = '#9aa3c7';
    ctx.font = font(24);
    ctx.fillText(fmtTime(cur), tx, py + 40);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(dur), tx + tw, py + 40);
    if (this.error) { ctx.textAlign = 'left'; ctx.fillStyle = '#ff9a8a'; ctx.fillText(t(this.error), tx, py + 76); }

    // --- action buttons: Sing this / Watch video
    let bx = tx;
    const by = cy + 262, bh = 56;
    const pill = (key, label, color, enabled = true, frac = null) => {
      ctx.font = font(26, 650);
      const w = Math.ceil(ctx.measureText(label).width) + 92;
      const hov = this.hover?.key === key && enabled;
      ctx.save();
      roundRect(ctx, bx, by - (hov ? 3 : 0), w, bh, bh / 2);
      ctx.fillStyle = hov ? color : 'rgba(255,255,255,0.08)';
      ctx.fill();
      if (frac != null) { // progress fill for "Karaoke 40%"
        ctx.clip();
        ctx.fillStyle = 'rgba(255,79,163,0.35)';
        ctx.fillRect(bx, by, w * frac, bh);
      }
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      roundRect(ctx, bx, by - (hov ? 3 : 0), w, bh, bh / 2);
      ctx.stroke();
      // icon dot
      ctx.fillStyle = hov ? '#140a10' : color;
      ctx.beginPath(); ctx.arc(bx + 34, by + bh / 2 - (hov ? 3 : 0), 9, 0, 7); ctx.fill();
      ctx.fillStyle = hov ? '#140a10' : enabled ? '#e8ecff' : '#9aa3c7';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 58, by + bh / 2 + 1 - (hov ? 3 : 0));
      if (enabled) this.regions.push({ key, x: bx, y: by - 4, w, h: bh + 8 });
      bx += w + 18;
    };
    const k = this.match?.karaoke;
    if (k?.ready) pill('sing', t('action.sing'), '#ff4fa3');
    else if (k?.job?.state === 'running') pill('sing', t('action.preparing', { pct: Math.round(k.job.progress * 100) }), '#ff4fa3', false, k.job.progress);
    else if (k?.job?.state === 'queued') pill('sing', t('action.queued'), '#ff4fa3', false, 0);
    else if (k?.job?.state === 'failed') pill('prepare', t('action.failed'), '#ff7a7a');
    else {
      // any song with timed lyrics can be sung right away; a full karaoke version needs the PC's tools
      if (k?.quick) pill('quick', t('action.singAlong'), '#ff4fa3');
      if (k?.canPrepare) pill('prepare', t(k?.quick ? 'action.makeKaraoke' : 'action.sing'), k?.quick ? '#c77dff' : '#ff4fa3');
    }
    const vids = this.match?.videos || [];
    if (vids.length) pill('video', t('action.video'), '#ffb35c');
    ctx.textBaseline = 'alphabetic';

    // --- lyrics band
    this._drawLyrics(cur);

    // --- toast ("ready to sing!")
    if (this.toast && performance.now() < this.toast.until) {
      ctx.font = font(28, 650);
      const w = ctx.measureText(this.toast.text).width + 60;
      roundRect(ctx, (W - w) / 2, 18, w, 52, 26);
      ctx.fillStyle = 'rgba(255,79,163,0.9)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.toast.text, W / 2, 45);
    }
    this.texture.needsUpdate = true;
  }

  _drawLyrics(time) {
    const ctx = this.ctx;
    const ly = this.lyrics;
    const top = 430;
    // a soft divider
    const grad = ctx.createLinearGradient(80, 0, W - 80, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(80, top, W - 160, 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!ly || ly.loading) {
      ctx.fillStyle = '#7d86ab'; ctx.font = font(28); ctx.fillText(t('music.findingLyrics'), W / 2, top + 140);
      return;
    }
    if (!ly.lines?.length) {
      ctx.fillStyle = '#5d6488'; ctx.font = font(26); ctx.fillText(t('music.noLyrics'), W / 2, top + 140);
      return;
    }
    const lines = ly.lines;
    let i;
    if (ly.synced) i = this._currentLine();
    else {
      // untimed lyrics: move through them evenly with the song
      const dur = this.audio.duration || this.current?.duration || 240;
      i = Math.floor((time / dur) * lines.length);
    }
    const line = (k) => lines[k]?.text || '';
    const maxW = W - 180;
    // previous, current (big, sweeping fill), next
    ctx.fillStyle = 'rgba(232,236,255,0.32)';
    ctx.font = font(30, 500);
    ctx.fillText(ellipsize(ctx, line(i - 1), maxW), W / 2, top + 54);
    const curText = i >= 0 ? line(i) : '♪';
    let px = 54;
    ctx.font = font(px, 750);
    let w = ctx.measureText(curText).width;
    if (w > maxW) { px = Math.floor((px * maxW) / w); ctx.font = font(px, 750); w = ctx.measureText(curText).width; }
    ctx.fillStyle = 'rgba(232,236,255,0.78)';
    ctx.fillText(curText, W / 2, top + 140);
    if (ly.synced && i >= 0) {
      const L = lines[i];
      const end = L.end ?? lines[i + 1]?.t ?? L.t + 5;
      const f = Math.min(1, Math.max(0, (time - L.t) / Math.max(0.3, end - L.t)));
      ctx.save();
      ctx.beginPath();
      ctx.rect((W - w) / 2 - 4, top + 140 - px, w * f + 4, px * 2);
      ctx.clip();
      const g = ctx.createLinearGradient((W - w) / 2, 0, (W + w) / 2, 0);
      g.addColorStop(0, '#5ce1e6');
      g.addColorStop(1, '#a6f6ff');
      ctx.shadowColor = 'rgba(92,225,230,0.7)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = g;
      ctx.fillText(curText, W / 2, top + 140);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(232,236,255,0.45)';
    ctx.font = font(32, 500);
    ctx.fillText(ellipsize(ctx, line(i + 1), maxW), W / 2, top + 222);
    ctx.fillStyle = 'rgba(232,236,255,0.22)';
    ctx.font = font(26, 500);
    ctx.fillText(ellipsize(ctx, line(i + 2), maxW), W / 2, top + 268);
  }
}

/** The big pill button on an empty screen. Returns its region. */
function bigButton(ctx, label, cx, cy, hov, color = '#ffb35c') {
  ctx.font = font(34, 750);
  const w = Math.ceil(ctx.measureText(label).width) + 90, h = 76, x = cx - w / 2, y = cy - h / 2;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 420);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 18 + pulse * 18;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = hov ? '#ffffff' : color;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#140a10';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 2);
  return { key: 'library', x, y, w, h };
}
