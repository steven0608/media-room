// The library: a curved glass panel that wraps around you at arm's reach.
// Folders are cover tiles, songs are rows, videos are thumbnails. Grab and drag to
// scroll (it keeps its momentum), or use the thumbstick / mouse wheel.
// It's drawn with Canvas 2D (fast, and Chinese titles just work) onto a curved mesh.
import * as THREE from 'three';
import { api } from '../api.js';
import { Spring } from './widgets.js';
import { canvasTexture, font, ellipsize, roundRect, drawPlaceholder, drawCover, getImage, fmtTime } from './text.js';
import { t, onLang } from '../i18n.js';

const W = 1792, H = 944;
const PAD = 48, HEADER = 196, GAP = 26, COLS = 6;
const TILE = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);
const ROW_H = 96;
const TABS = ['music', 'video', 'karaoke', 'nas']; // nas: browse any NAS folder live, not just scanned ones

export class LibraryPanel {
  constructor({ pointer, sfx, onPlayMusic, onPlayVideo, onKaraoke }) {
    this.sfx = sfx;
    this.cb = { onPlayMusic, onPlayVideo, onKaraoke };
    this.tab = 'music';
    this.folder = { music: null, video: null, nas: '' };
    this.addState = ''; // '' | 'adding' | 'added' (Add to library, NAS folders tab)
    this.data = null;
    this.loading = false;
    this.error = '';
    this.scroll = 0;
    this.vel = 0;
    this.hover = null;
    this.openT = 0;
    this.isOpen = false;
    this.dirty = true;
    this.regions = [];
    this.playingId = null;
    this.pollT = 0;
    onLang(() => { this.dirty = true; });

    const radius = 1.55, arc = THREE.MathUtils.degToRad(68);
    const height = (radius * arc * H) / W;
    const geo = new THREE.CylinderGeometry(radius, radius, height, 48, 1, true, Math.PI - arc / 2, arc);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const { canvas, ctx, tex } = canvasTexture(W, H);
    this.canvas = canvas; this.ctx = ctx; this.tex = tex;
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, opacity: 0 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 10;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.visible = false;
    this.scale = new Spring(0.85, 260, 20);

    let press = null;
    pointer.add(this.mesh, {
      onMove: (hit, p) => {
        const { x, y } = this._xy(hit);
        if (p.pressed && press) {
          const dy = press.y - y;
          if (Math.abs(dy) > 14) press.drag = true;
          if (press.drag) {
            const now = performance.now();
            const ns = press.scroll0 + dy;
            this.vel = (ns - this.scroll) / Math.max(1, now - (press.tPrev || now)) * 1000;
            press.tPrev = now;
            this.scroll = ns;
            this._clamp();
            this.dirty = true;
          }
          return;
        }
        const r = this._regionAt(x, y);
        if ((r?.key ?? null) !== (this.hover?.key ?? null)) {
          this.hover = r;
          this.dirty = true;
          if (r) { sfx.hover(); pointer.haptic(p, 0.1, 8); }
        }
      },
      onLeave: () => { this.hover = null; this.dirty = true; },
      onDown: (hit) => { const { y } = this._xy(hit); press = { y, scroll0: this.scroll, drag: false }; this.vel = 0; },
      onUp: (hit) => {
        const wasDrag = press?.drag;
        press = null;
        if (wasDrag || !hit) return;
        const { x, y } = this._xy(hit);
        const r = this._regionAt(x, y);
        if (r?.action) r.action();
      },
      onWheel: (dy) => { this.scroll += dy * 1.1; this._clamp(); this.dirty = true; },
      onStick: (y, dt) => { this.scroll += y * 1500 * dt; this._clamp(); this.dirty = true; },
    });
  }

  _xy(hit) {
    return { x: hit.uv.x * W, y: (1 - hit.uv.y) * H };
  }

  open(tab) {
    if (tab) this.tab = tab;
    if (!this.isOpen) {
      this.isOpen = true;
      this.group.visible = true;
      this.scale.value = 0.82;
      this.scale.target = 1;
      this.openT = 0;
      this.sfx.select();
    }
    this.load();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scale.target = 0.85;
    this.sfx.back();
  }

  toggle(tab) {
    if (this.isOpen && (!tab || tab === this.tab)) this.close();
    else this.open(tab);
  }

  async load(quiet = false) {
    this.loading = !quiet;
    this.error = '';
    this.dirty = true;
    const tab = this.tab;
    try {
      let data;
      if (tab === 'karaoke') {
        const r = await api('/api/karaoke');
        const busy = r.jobs.filter((j) => j.state !== 'done').map((j) => ({ ...j, kind: 'job', id: `job-${j.id}` }));
        data = { crumbs: [], folders: [], items: [...busy, ...r.songs.map((s) => ({ ...s, kind: 'karaoke' }))] };
      } else if (tab === 'nas') {
        data = await api(`/api/nas/browse?path=${encodeURIComponent(this.folder.nas || '')}`);
      } else {
        data = await api(`/api/library/${tab}${this.folder[tab] ? `?folder=${this.folder[tab]}` : ''}`);
      }
      if (tab !== this.tab) return;
      this.data = data;
      if (!quiet) {
        this.scroll = 0;
        this.vel = 0;
        this.openT = Math.min(this.openT, 0.2);
      }
    } catch (e) {
      this.error = e.status === 401 ? { key: 'lib.notPaired' } : { key: 'lib.loadFailed', vars: { msg: e.message } };
      this.data = null;
    }
    this.loading = false;
    this.dirty = true;
  }

  addLabel() {
    if (this.addState === 'adding') return t('lib.adding');
    if (this.addState === 'added') return t('lib.added');
    return this.data?.canAdd ? t('lib.addToLibrary') : t('lib.inLibrary');
  }

  /** NAS folders: make the folder you're in part of the scanned library. */
  async addToLibrary() {
    const p = this.data?.path;
    if (!p || this.addState) return;
    this.sfx.select();
    this.addState = 'adding';
    this.dirty = true;
    try { await api('/api/nas/add', { method: 'POST', body: { path: p } }); this.addState = 'added'; } catch (e) { this.addState = ''; this.error = { key: 'lib.loadFailed', vars: { msg: e.message } }; }
    this.dirty = true;
  }

  /** Reload without resetting the scroll position (for progress updates). */
  async refreshQuietly() {
    await this.load(true);
  }

  go(folderId) {
    this.folder[this.tab] = folderId;
    this.addState = '';
    this.load();
  }

  // ---------- layout ----------
  _layout() {
    const regions = [];
    const d = this.data;
    // header: tabs, back, close
    let x = PAD;
    this.ctx.font = font(32, 650);
    for (const id of TABS) {
      const label = t(`lib.${id}`);
      const w = Math.ceil(this.ctx.measureText(label).width) + 64;
      regions.push({ key: `tab:${id}`, x, y: 40, w, h: 64, header: true, kind: 'tab', id, label, action: () => { if (this.tab !== id) { this.tab = id; this.sfx.select(); this.load(); } } });
      x += w + 14;
    }
    regions.push({ key: 'close', x: W - PAD - 64, y: 40, w: 64, h: 64, header: true, kind: 'close', action: () => this.close() });
    if (this.tab === 'nas' && d?.path) {
      this.ctx.font = font(28, 600);
      const label = this.addLabel();
      const w = Math.ceil(this.ctx.measureText(label).width) + 56;
      const canAdd = d.canAdd && !this.addState;
      regions.push({ key: 'add', x: W - PAD - w, y: 122, w, h: 52, header: true, kind: canAdd ? 'add' : 'info', label, action: canAdd ? () => this.addToLibrary() : null });
    }
    if (d?.crumbs?.length > 1 && this.tab !== 'karaoke') {
      const parent = d.crumbs[d.crumbs.length - 2];
      this.ctx.font = font(28, 600);
      regions.push({ key: 'back', x: PAD, y: 122, w: Math.ceil(this.ctx.measureText(t('lib.back')).width) + 48, h: 52, header: true, kind: 'back', action: () => { this.sfx.back(); this.go(parent.id); } });
    }
    // content
    let y = HEADER;
    const tiles = [];
    const folders = d?.folders || [];
    const items = d?.items || [];
    const thumbH = this.tab === 'video' ? Math.round(TILE * 9 / 16) : TILE;
    folders.forEach((f, i) => {
      const c = i % COLS, r = Math.floor(i / COLS);
      tiles.push({ key: `f:${f.id}`, kind: 'folder', data: f, i, x: PAD + c * (TILE + GAP), y: y + r * (TILE + 86 + GAP), w: TILE, h: TILE + 70, action: () => { this.sfx.select(); this.go(f.id); } });
    });
    if (folders.length) y += Math.ceil(folders.length / COLS) * (TILE + 86 + GAP) + 10;
    if (this.tab === 'nas') {
      const vids = items.filter((it) => it.kind === 'video');
      const songs = items.filter((it) => it.kind === 'music');
      const vh = Math.round(TILE * 9 / 16);
      vids.forEach((it, i) => {
        const c = i % COLS, r = Math.floor(i / COLS);
        tiles.push({ key: `i:${it.id}`, kind: 'tile', data: it, i: i + folders.length, thumbH: vh, x: PAD + c * (TILE + GAP), y: y + r * (vh + 86 + GAP), w: TILE, h: vh + 70, action: () => this.cb.onPlayVideo(it) });
      });
      if (vids.length) y += Math.ceil(vids.length / COLS) * (vh + 86 + GAP);
      const colW = (W - PAD * 2 - GAP) / 2;
      songs.forEach((it, i) => {
        const c = i % 2, r = Math.floor(i / 2);
        tiles.push({ key: `i:${it.id}`, kind: 'row', data: it, i: i + folders.length + vids.length, x: PAD + c * (colW + GAP), y: y + r * (ROW_H + 10), w: colW, h: ROW_H, action: () => this.cb.onPlayMusic(songs, i, null) });
      });
      if (songs.length) y += Math.ceil(songs.length / 2) * (ROW_H + 10);
    } else if (this.tab === 'music') {
      const colW = (W - PAD * 2 - GAP) / 2;
      items.forEach((it, i) => {
        const c = i % 2, r = Math.floor(i / 2);
        tiles.push({ key: `i:${it.id}`, kind: 'row', data: it, i: i + folders.length, x: PAD + c * (colW + GAP), y: y + r * (ROW_H + 10), w: colW, h: ROW_H, action: () => this.cb.onPlayMusic(items, i, d.folder) });
      });
      if (items.length) y += Math.ceil(items.length / 2) * (ROW_H + 10);
    } else {
      items.forEach((it, i) => {
        const c = i % COLS, r = Math.floor(i / COLS);
        tiles.push({
          key: `i:${it.id}`, kind: 'tile', data: it, i: i + folders.length, thumbH,
          x: PAD + c * (TILE + GAP), y: y + r * (thumbH + 86 + GAP), w: TILE, h: thumbH + 70,
          action: () => (it.kind === 'job' ? null : this.tab === 'karaoke' ? this.cb.onKaraoke(it) : this.cb.onPlayVideo(it)),
        });
      });
      if (items.length) y += Math.ceil(items.length / COLS) * (thumbH + 86 + GAP);
    }
    this.contentH = y - HEADER + 30;
    this.regions = regions;
    this.tiles = tiles;
  }

  _clamp() {
    const max = Math.max(0, (this.contentH || 0) - (H - HEADER));
    if (this.scroll < 0) { this.scroll = Math.max(this.scroll, -120); }
    if (this.scroll > max) { this.scroll = Math.min(this.scroll, max + 120); }
  }

  _regionAt(x, y) {
    for (const r of this.regions) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    if (y < HEADER) return null;
    const cy = y + this.scroll;
    for (const tile of this.tiles || []) if (x >= tile.x && x <= tile.x + tile.w && cy >= tile.y && cy <= tile.y + tile.h) return tile;
    return null;
  }

  // ---------- drawing ----------
  _draw() {
    this._layout();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    // glass background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(16,22,52,0.985)');
    bg.addColorStop(1, 'rgba(8,11,28,0.985)');
    roundRect(ctx, 4, 4, W - 8, H - 8, 44);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(207,216,255,0.2)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // content (clipped under the header)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER - 6, W, H - HEADER - 4);
    ctx.clip();
    const intro = this.openT;
    for (const tile of this.tiles) {
      const ty = tile.y - this.scroll;
      if (ty > H || ty + tile.h < HEADER - 10) continue;
      const appear = Math.min(1, Math.max(0, intro * 3 - Math.min(tile.i, 18) * 0.06));
      if (appear <= 0) continue;
      ctx.globalAlpha = appear;
      const hov = this.hover?.key === tile.key;
      const lift = hov ? 6 : 0;
      ctx.save();
      ctx.translate(0, (1 - appear) * 30 - lift);
      if (tile.kind === 'row') this._drawRow(tile, ty, hov);
      else this._drawTile(tile, ty, hov);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // empty / loading / error states
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.loading && !this.data) {
      ctx.fillStyle = '#9aa3c7'; ctx.font = font(40); ctx.fillText(t('lib.loading'), W / 2, H / 2 + 40);
    } else if (this.error) {
      ctx.fillStyle = '#ff9a8a'; ctx.font = font(38); ctx.fillText(t(this.error.key, this.error.vars), W / 2, H / 2 + 40);
    } else if (this.data && !this.tiles.length) {
      ctx.fillStyle = '#9aa3c7'; ctx.font = font(38);
      ctx.fillText(ellipsize(ctx, t(this.tab === 'karaoke' ? 'lib.emptyKaraoke' : this.tab === 'nas' ? 'lib.nasEmpty' : 'lib.empty'), W - 160), W / 2, H / 2 + 40);
    }

    // header
    for (const r of this.regions) this._drawHeaderItem(r);
    const crumbs = this.data?.crumbs || [];
    if (crumbs.length && this.tab !== 'karaoke') {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = font(34, 600);
      ctx.fillStyle = '#e8ecff';
      const back = this.regions.find((r) => r.key === 'back');
      const x0 = back ? back.x + back.w + 20 : PAD;
      ctx.fillText(ellipsize(ctx, crumbs.map((c) => c.name).join('  ›  '), W - x0 - PAD - 200), x0, 148);
    }
    if (this.loading && this.data) { ctx.fillStyle = '#5ce1e6'; ctx.fillRect(PAD, HEADER - 8, (W - PAD * 2) * ((performance.now() / 900) % 1), 3); }

    // scrollbar
    const viewH = H - HEADER - 20;
    if (this.contentH > viewH) {
      const barH = Math.max(60, (viewH * viewH) / this.contentH);
      const barY = HEADER + (Math.max(0, Math.min(this.scroll, this.contentH - viewH)) / (this.contentH - viewH)) * (viewH - barH);
      roundRect(ctx, W - 22, barY, 8, barH, 4);
      ctx.fillStyle = 'rgba(207,216,255,0.35)';
      ctx.fill();
    }
    this.tex.needsUpdate = true;
  }

  _drawHeaderItem(r) {
    const ctx = this.ctx;
    const hov = this.hover?.key === r.key;
    const active = r.kind === 'tab' && r.id === this.tab;
    ctx.save();
    roundRect(ctx, r.x, r.y - (hov ? 3 : 0), r.w, r.h, r.h / 2);
    if (active) {
      const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
      g.addColorStop(0, '#ffb35c'); g.addColorStop(1, '#ff6f61');
      ctx.fillStyle = g;
    } else ctx.fillStyle = hov ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.fillStyle = active ? '#1a0f08' : '#e8ecff';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = r.y + r.h / 2 - (hov ? 3 : 0);
    if (r.kind === 'tab') { ctx.font = font(32, 650); ctx.fillText(t(`lib.${r.id}`), r.x + r.w / 2, cy); }
    if (r.kind === 'back') { ctx.font = font(28, 600); ctx.fillText(t('lib.back'), r.x + r.w / 2, cy); }
    if (r.kind === 'add' || r.kind === 'info') { ctx.font = font(28, 600); ctx.fillStyle = r.kind === 'add' ? '#ffb35c' : '#9aa3c7'; ctx.fillText(this.addLabel(), r.x + r.w / 2, cy); }
    if (r.kind === 'close') {
      ctx.lineWidth = 5; ctx.lineCap = 'round';
      const c = r.x + r.w / 2, s = 13;
      ctx.beginPath(); ctx.moveTo(c - s, cy - s); ctx.lineTo(c + s, cy + s); ctx.moveTo(c + s, cy - s); ctx.lineTo(c - s, cy + s); ctx.stroke();
    }
    ctx.restore();
  }

  _drawTile(tile, y, hov) {
    const ctx = this.ctx;
    const d = tile.data;
    const ch = tile.kind === 'folder' ? TILE : tile.thumbH;
    const redraw = () => { this.dirty = true; };
    if (hov) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,179,92,0.65)';
      ctx.shadowBlur = 36;
      roundRect(ctx, tile.x, y, tile.w, ch, 20);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }
    const img = getImage(d.cover, redraw);
    if (img) drawCover(ctx, img, tile.x, y, tile.w, ch, 20);
    else drawPlaceholder(ctx, tile.x, y, tile.w, ch, d.name || d.title, 20);
    if (tile.kind === 'folder') {
      // folder tab + count
      ctx.fillStyle = 'rgba(8,11,28,0.72)';
      roundRect(ctx, tile.x + 12, y + 12, 90, 40, 20); ctx.fill();
      ctx.fillStyle = '#e8ecff'; ctx.font = font(24, 600); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.count > 999 ? `${(d.count / 1000).toFixed(1)}k` : String(d.count), tile.x + 57, y + 33);
    }
    if (d.duration && tile.kind === 'tile') {
      ctx.fillStyle = 'rgba(8,11,28,0.72)'; roundRect(ctx, tile.x + tile.w - 100, y + ch - 48, 88, 36, 18); ctx.fill();
      ctx.fillStyle = '#e8ecff'; ctx.font = font(22, 600); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtTime(d.duration), tile.x + tile.w - 56, y + ch - 30);
    }
    if (hov) { roundRect(ctx, tile.x, y, tile.w, ch, 20); ctx.strokeStyle = '#ffb35c'; ctx.lineWidth = 5; ctx.stroke(); }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e8ecff';
    ctx.font = font(28, 600);
    ctx.fillText(ellipsize(ctx, d.name || d.title, tile.w), tile.x, y + ch + 12);
    let sub = tile.kind === 'folder' ? t('lib.folder') : d.artist || (d.kind === 'video' ? (d.ext || '').toUpperCase() : '');
    if (d.kind === 'job') {
      // a song being prepared: dim cover + progress ring
      const pct = Math.round((d.progress || 0) * 100);
      ctx.fillStyle = 'rgba(8,11,28,0.62)'; roundRect(ctx, tile.x, y, tile.w, ch, 20); ctx.fill();
      const cx = tile.x + tile.w / 2, cy = y + ch / 2;
      ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(cx, cy, 52, 0, 7); ctx.stroke();
      ctx.strokeStyle = d.state === 'failed' ? '#ff7a7a' : '#ff4fa3'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, d.progress || 0)); ctx.stroke();
      ctx.fillStyle = '#e8ecff'; ctx.font = font(30, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.state === 'queued' ? '…' : `${pct}%`, cx, cy);
      sub = d.state === 'failed' ? t('lib.failed') : d.state === 'queued' ? t('lib.queued') : t('lib.preparing', { pct });
    } else if (d.kind === 'karaoke') sub = [d.artist, t('lib.ready')].filter(Boolean).join(' · ');
    ctx.fillStyle = '#9aa3c7';
    ctx.font = font(23);
    ctx.fillText(ellipsize(ctx, sub, tile.w), tile.x, y + ch + 46);
  }

  _drawRow(tile, y, hov) {
    const ctx = this.ctx;
    const d = tile.data;
    const playing = d.id === this.playingId;
    roundRect(ctx, tile.x, y, tile.w, tile.h, 22);
    ctx.fillStyle = hov ? 'rgba(255,179,92,0.16)' : playing ? 'rgba(92,225,230,0.12)' : 'rgba(255,255,255,0.045)';
    ctx.fill();
    if (hov || playing) { ctx.strokeStyle = hov ? '#ffb35c' : 'rgba(92,225,230,0.6)'; ctx.lineWidth = 3; ctx.stroke(); }
    const s = tile.h - 20;
    const img = getImage(d.cover, () => { this.dirty = true; });
    if (img) drawCover(ctx, img, tile.x + 10, y + 10, s, s, 14);
    else drawPlaceholder(ctx, tile.x + 10, y + 10, s, s, d.title, 14);
    if (playing) {
      // little equalizer bars
      ctx.fillStyle = '#5ce1e6';
      const tm = performance.now() / 160;
      for (let i = 0; i < 3; i++) { const bh = 10 + 14 * Math.abs(Math.sin(tm + i * 1.7)); ctx.fillRect(tile.x + 26 + i * 14, y + tile.h / 2 + 14 - bh, 9, bh); }
      this.dirty = true;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tx = tile.x + s + 30;
    const tw = tile.w - s - 150;
    ctx.fillStyle = '#e8ecff';
    ctx.font = font(30, 600);
    ctx.fillText(ellipsize(ctx, d.title, tw), tx, y + 34);
    ctx.fillStyle = '#9aa3c7';
    ctx.font = font(24);
    ctx.fillText(ellipsize(ctx, [d.artist, d.album].filter(Boolean).join(' · ') || ' ', tw), tx, y + 68);
    ctx.textAlign = 'right';
    ctx.fillText(d.duration ? fmtTime(d.duration) : (d.ext || '').toUpperCase(), tile.x + tile.w - 22, y + tile.h / 2);
    if (d.karaoke) {
      // ready to sing: a small magenta mic badge
      const bx = tile.x + tile.w - 118, by = y + tile.h / 2;
      ctx.fillStyle = 'rgba(255,79,163,0.18)'; ctx.beginPath(); ctx.arc(bx, by, 22, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff4fa3'; ctx.strokeStyle = '#ff4fa3';
      ctx.beginPath(); ctx.arc(bx + 4, by - 5, 7, 0, 7); ctx.fill();
      ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx, by + 1); ctx.lineTo(bx - 8, by + 11); ctx.stroke();
    }
  }

  update(dt) {
    const s = this.scale.step(dt);
    this.group.scale.set(s, s, s);
    this.mat.opacity = Math.min(1, Math.max(0, this.isOpen ? this.mat.opacity + dt * 5 : this.mat.opacity - dt * 6));
    if (!this.isOpen && this.mat.opacity <= 0) this.group.visible = false;
    if (!this.group.visible) return;
    if (this.openT < 1) { this.openT = Math.min(1, this.openT + dt * 1.6); this.dirty = true; }
    // momentum + rubber-band
    if (Math.abs(this.vel) > 5) {
      this.scroll += this.vel * dt;
      this.vel *= Math.pow(0.04, dt);
      this.dirty = true;
    } else this.vel = 0;
    const max = Math.max(0, (this.contentH || 0) - (H - HEADER - 20));
    if (this.scroll < 0) { this.scroll += (0 - this.scroll) * Math.min(1, dt * 10); this.dirty = true; }
    if (this.scroll > max) { this.scroll += (max - this.scroll) * Math.min(1, dt * 10); this.dirty = true; }
    if (this.loading) this.dirty = true;
    // songs being prepared: refresh the Karaoke tab every couple of seconds
    if (this.tab === 'karaoke' && !this.loading && this.data?.items.some((i) => i.kind === 'job' && i.state !== 'failed')) {
      this.pollT += dt;
      if (this.pollT > 2) { this.pollT = 0; this.refreshQuietly(); }
    }
    if (this.dirty) { this.dirty = false; this._draw(); }
  }
}
