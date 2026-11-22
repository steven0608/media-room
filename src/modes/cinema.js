// Cinema mode: a <video> element drawn onto the big curved screen.
// The hub tells us how to play each file (direct / remux / transcode — see hub/media.js).
// For remux/transcode streams, seeking reloads the stream from the new time, and we keep
// `offset` so the clock you see is the real position in the film.
// Subtitles come as WebVTT and are drawn under the picture (a video texture can't show them).
import * as THREE from 'three';
import { api, store } from '../api.js';
import { canvasTexture, font, ellipsize, roundRect, fmtTime } from '../ui/text.js';
import { CONFIG } from '../config.js';
import { t, onLang, lyricsScript } from '../i18n.js';
import { link } from '../link.js';
import { playStream } from '../mse.js';
import { demo } from '../demo.js';

export class CinemaMode {
  constructor({ engine, sfx, screen, pointer }) {
    this.engine = engine;
    this.sfx = sfx;
    this.screen = screen;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.info = null;
    this.offset = 0;
    this.subIndex = -1;
    this.cueText = '';
    this.controlsT = 0;
    this.onChange = () => {};
    this.message = null; // { key, vars } — translated when drawn

    // --- UI under the screen: title, seek bar, times, subtitle toggle (one curved strip)
    const { radius, arcDegrees, centerY } = CONFIG.screen;
    const arc = THREE.MathUtils.degToRad(arcDegrees * 0.82);
    const r = radius - 0.4;
    const SW = 2048, SH = 128;
    const bar = canvasTexture(SW, SH);
    this.bar = bar;
    const barH = (r * arc * SH) / SW;
    const geo = new THREE.CylinderGeometry(r, r, barH, 48, 1, true, Math.PI - arc / 2, arc);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    this.barMat = new THREE.MeshBasicMaterial({ map: bar.tex, transparent: true, side: THREE.BackSide, depthWrite: false, opacity: 0 });
    this.barMesh = new THREE.Mesh(geo, this.barMat);
    this.barMesh.position.y = centerY - screen.height / 2 - barH / 2 - 0.12;
    this.barMesh.renderOrder = 5;
    this.barHover = null;
    const region = (hit) => {
      const x = hit.uv.x * SW;
      if (x < 150) return 'play';
      if (x > SW - 150) return 'subs';
      if (x > 330 && x < SW - 330) return { seek: (x - 330) / (SW - 660) };
      return null;
    };
    pointer.add(this.barMesh, {
      onMove: (hit) => { this.controlsT = 3.5; const r2 = region(hit); this.barHover = typeof r2 === 'object' && r2 ? r2.seek : r2; this.drawBar(); },
      onLeave: () => { this.barHover = null; this.drawBar(); },
      onUp: (hit) => {
        if (!hit) return;
        const r2 = region(hit);
        if (r2 === 'play') this.toggle();
        else if (r2 === 'subs') this.cycleSubs();
        else if (r2?.seek != null && this.duration) this.seekTo(r2.seek * this.duration);
        this.sfx.select();
      },
    });

    // --- subtitles plane (flat, just in front of the screen's lower edge)
    this.subs = canvasTexture(2048, 256);
    const subW = screen.width * 0.8;
    this.subMesh = new THREE.Mesh(new THREE.PlaneGeometry(subW, (subW * 256) / 2048), new THREE.MeshBasicMaterial({ map: this.subs.tex, transparent: true, depthWrite: false }));
    this.subMesh.position.set(0, centerY - screen.height * 0.36, -radius + 0.3);
    this.subMesh.renderOrder = 6;

    this.group = new THREE.Group();
    this.group.add(this.barMesh, this.subMesh);

    this.video.addEventListener('play', () => this.onChange());
    this.video.addEventListener('pause', () => { this.controlsT = 4; this.onChange(); });
    this.video.addEventListener('loadedmetadata', () => this._aspect());
    this.video.addEventListener('error', () => { this.message = { key: 'cinema.cantPlay' }; this.drawBar(); });
    this.video.addEventListener('waiting', () => { this.message = { key: 'cinema.buffering' }; this.drawBar(); });
    this.video.addEventListener('playing', () => { if (this.message?.key === 'cinema.buffering' || this.message?.key === 'cinema.opening') this.message = null; this.drawBar(); });
    onLang(() => { this.drawBar(); if (this.subIndex >= 0) this._loadTrack(); });
    this.drawBar();
  }

  get playing() { return !this.video.paused && !this.video.ended; }
  get duration() { return this.info?.duration || this.video.duration || 0; }
  get time() { return this.offset + (this.video.currentTime || 0); }

  _aspect() {
    const a = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
    this.aspect = a;
    if (this.active) this.screen.setTexture(this.texture, a); // a film loading in the background stays off the screen
  }

  async play(item) {
    this.message = { key: 'cinema.opening' };
    this.drawBar();
    try {
      this.info = await api(`/api/video/${item.id}`);
    } catch (e) {
      this.message = { key: 'cinema.cantOpen', vars: { msg: e.message } };
      this.drawBar();
      return;
    }
    this.item = item;
    this.subIndex = -1;
    this.cueText = '';
    this._clearTracks();
    this.engine.attach(this.video);
    const saved = store.get(`pos.${item.id}`, 0);
    const start = saved > 30 && saved < this.info.duration - 60 ? saved : 0;
    this._src(start);
    this.video.play().catch(() => {});
    this.controlsT = 4;
    this.message = start ? { key: 'cinema.resumed', vars: { time: fmtTime(start) } } : null;
    // A music video: show the matched song's lyrics straight away.
    if (this.info.subs[0]?.lyrics) { this.subIndex = 0; this._loadTrack(); }
    this.onChange();
  }

  _src(t) {
    const direct = this.info.mode === 'direct';
    this.offset = direct ? 0 : t;
    this.stream?.stop();
    this.stream = null;
    if (link.active) this.stream = playStream(this.video, `${this.info.url}?t=${t.toFixed(2)}`, this.info.mime, { duration: this.info.duration - t });
    else this.video.src = demo.url(direct ? this.info.url : `${this.info.url}?t=${t.toFixed(2)}`);
    if (direct && t) this.video.currentTime = t;
    if (!direct && this.subIndex >= 0) this._loadTrack();
  }

  seekTo(t) {
    if (!this.info) return;
    t = Math.max(0, Math.min(this.duration - 1, t));
    const was = this.playing || this.video.paused === false;
    if (this.info.mode === 'direct') this.video.currentTime = t;
    else { this._src(t); }
    if (was || true) this.video.play().catch(() => {});
    this.controlsT = 3;
  }

  skip(s) { this.seekTo(this.time + s); }

  toggle() {
    if (!this.info) return false;
    this.engine.unlock();
    if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause();
    return true;
  }

  pause() { this.video.pause(); }

  _clearTracks() {
    for (const t of [...this.video.querySelectorAll('track')]) t.remove();
  }

  cycleSubs() {
    const list = this.info?.subs || [];
    if (!list.length) { this.message = { key: 'cinema.noSubs' }; this.drawBar(); return; }
    this.subIndex = this.subIndex + 1 >= list.length ? -1 : this.subIndex + 1;
    this._loadTrack();
    this.message = this.subIndex >= 0 ? { key: 'cinema.subsOn', vars: { label: this._subLabel(list[this.subIndex]) } } : { key: 'cinema.subsOff' };
    this.drawBar();
  }

  _subLabel(s) {
    return s.lyrics ? t('cinema.lyrics') : s.label;
  }

  /** (Re)load the chosen subtitle track — after a seek in a stream, or a language change. */
  _loadTrack() {
    const list = this.info?.subs || [];
    this._clearTracks();
    this.cueText = '';
    const sub = list[this.subIndex];
    if (sub) {
      const tr = document.createElement('track');
      tr.kind = 'subtitles';
      const src = sub.lyrics ? `${sub.url}?script=${lyricsScript()}` : sub.url;
      if (link.active) link.objectUrl(src).then((u) => { if (u) tr.src = u; });
      else tr.src = demo.url(src);
      tr.default = true;
      this.video.appendChild(tr);
      tr.track.mode = 'hidden';
      tr.addEventListener('cuechange', () => {
        const cues = [...(tr.track.activeCues || [])];
        this.cueText = cues.map((c) => c.text.replace(/<[^>]+>/g, '')).join('\n');
        this.drawSubs();
      });
      // Remux/transcode streams restart at `offset`, so their cue times need shifting.
      const offset = this.offset;
      tr.addEventListener('load', () => {
        if (offset) for (const c of [...tr.track.cues]) { c.startTime -= offset; c.endTime -= offset; }
      });
    }
    this.drawSubs();
  }


  drawSubs() {
    const { ctx, tex, canvas } = this.subs;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.cueText) {
      const lines = this.cueText.split('\n').slice(-2);
      ctx.font = font(72, 600);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => {
        const y = canvas.height / 2 + (i - (lines.length - 1) / 2) * 92;
        const w = Math.min(canvas.width - 40, ctx.measureText(l).width + 60);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRect(ctx, (canvas.width - w) / 2, y - 46, w, 92, 18);
        ctx.fill();
        ctx.fillStyle = '#f2f2f2';
        ctx.fillText(l, canvas.width / 2, y + 2);
      });
    }
    tex.needsUpdate = true;
  }

  drawBar() {
    const { ctx, tex, canvas } = this.bar;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 4, 4, W - 8, H - 8, 56);
    ctx.fillStyle = 'rgba(8,11,28,0.82)';
    ctx.fill();
    // play/pause
    ctx.fillStyle = this.barHover === 'play' ? '#ffb35c' : '#e8ecff';
    if (this.playing) { ctx.fillRect(54, 38, 16, 52); ctx.fillRect(84, 38, 16, 52); }
    else { ctx.beginPath(); ctx.moveTo(56, 34); ctx.lineTo(104, 64); ctx.lineTo(56, 94); ctx.fill(); }
    // times
    ctx.font = font(40, 600);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8ecff';
    ctx.fillText(fmtTime(this.time), 160, 64);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(this.duration), W - 170, 64);
    // seek bar
    const x0 = 330, x1 = W - 330, y = 64;
    roundRect(ctx, x0, y - 7, x1 - x0, 14, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    const f = this.duration ? this.time / this.duration : 0;
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#ffb35c'); g.addColorStop(1, '#ff6f61');
    roundRect(ctx, x0, y - 7, Math.max(14, (x1 - x0) * f), 14, 7);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * f, y, 16, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    if (typeof this.barHover === 'number') {
      const hx = x0 + (x1 - x0) * this.barHover;
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(hx - 2, y - 26, 4, 52);
      ctx.font = font(30, 600); ctx.textAlign = 'center'; ctx.fillStyle = '#ffb35c';
      ctx.fillText(fmtTime(this.barHover * this.duration), hx, 22);
    }
    // title or message above the bar
    ctx.font = font(30, 500);
    ctx.textAlign = 'center';
    ctx.fillStyle = this.message ? '#ffb35c' : '#9aa3c7';
    const label = this.message ? t(this.message.key, this.message.vars) : this.info ? this.info.title : t('cinema.choose');
    if (typeof this.barHover !== 'number') ctx.fillText(ellipsize(ctx, label, x1 - x0 - 40), W / 2, 104);
    // subtitles button
    ctx.strokeStyle = this.barHover === 'subs' ? '#ffb35c' : this.subIndex >= 0 ? '#5ce1e6' : '#e8ecff';
    ctx.lineWidth = 6;
    roundRect(ctx, W - 130, 38, 76, 52, 10);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(W - 116, 66, 20, 7); ctx.fillRect(W - 90, 66, 22, 7);
    tex.needsUpdate = true;
  }

  update(dt, active) {
    this.active = active;
    this.group.visible = active;
    if (!active) return;
    this.controlsT -= dt;
    const show = this.controlsT > 0 || !this.playing;
    this.barMat.opacity += ((show ? 1 : 0) - this.barMat.opacity) * Math.min(1, dt * 6);
    this.barMesh.visible = this.barMat.opacity > 0.02;
    this._clock = (this._clock || 0) + dt;
    if (this._clock > 0.5) {
      this._clock = 0;
      if (this.barMesh.visible) this.drawBar();
      if (this.item && this.playing) store.set(`pos.${this.item.id}`, Math.floor(this.time));
    }
  }

  /** Any input in cinema mode wakes the controls for a few seconds. */
  poke() { this.controlsT = 3.5; }
}
