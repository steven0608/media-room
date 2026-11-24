// Karaoke mode: the big screen becomes the lyric board.
//   - lyrics fill word by word in time with the song (two lines: now + next)
//   - a pitch lane above shows the melody as bars and your voice as a glowing comet
//   - at the end, stars and a title (generous, octaves don't matter — kids can sing high)
// Songs are prepared on the PC by tools/karaoke_prep.py (instrumental + timed lyrics + melody).
// Quick sing-along songs (any song with timed lyrics, see hub/quick.js) have no melody: the song
// plays with the singer turned down (audio/vocalCut.js), and the score is how much of each line
// you sang.
import { api, store } from '../api.js';
import { Mic } from '../audio/pitch.js';
import { VoiceMonitor, TUNE_ORDER } from '../audio/voice.js';
import { canvasTexture, font, ellipsize, roundRect, fmtTime } from '../ui/text.js';
import { t as tr, onLang, lyricsScript } from '../i18n.js';
import { link } from '../link.js';
import { demo } from '../demo.js';
import { createVocalCut } from '../audio/vocalCut.js';

const W = 1280, H = 720;
const WINDOW = 6;       // seconds of melody visible in the pitch lane
const NOW_X = 0.24;     // where "now" sits across the lane
const TOLERANCE = 1.5;  // semitones either side that still count as a hit

/** A promise, or an error after ms milliseconds. */
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (n) => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
const fold = (d) => ((((d % 12) + 18) % 12) - 6); // distance in semitones, ignoring octaves

export class KaraokeMode {
  constructor({ engine, sfx }) {
    this.engine = engine;
    this.sfx = sfx;
    this.mic = new Mic(engine);
    // Hear yourself through the speakers (KTV style), with your own volume and echo settings.
    this.voice = new VoiceMonitor(engine, { volume: store.get('voiceVolume', 0.8), echo: store.get('voiceEcho', true), tune: store.get('voiceTune', 'off') });
    this.regions = []; // buttons drawn on the board: { key, x, y, w, h }
    this.hover = null;
    this.countT = 0;   // seconds left in the "3, 2, 1" before the song starts
    this.lastCue = '';
    this.audio = new Audio();
    this.audio.preload = 'auto';
    const { canvas, ctx, tex } = canvasTexture(W, H);
    this.canvas = canvas; this.ctx = ctx; this.texture = tex;
    this.song = null;
    this.state = 'empty'; // empty | loading | singing | score
    this.onChange = () => {};
    this.micLevel = 0;
    this.trail = [];
    this.hits = 0; this.total = 0; this.streak = 0; this.bestStreak = 0;
    this.noteIdx = 0;
    this.scoreT = 0;
    this.frame = 0;
    // ?autosing=1 pretends a perfect singer — for trying the board on a PC without a microphone.
    this.autosing = new URLSearchParams(location.search).has('autosing');
    this.audio.addEventListener('ended', () => this._finish());
    this.audio.addEventListener('play', () => this.onChange());
    this.audio.addEventListener('pause', () => this.onChange());
    onLang(() => this._relang());
    this.draw(0);
  }

  /** Language changed: redraw, and re-fetch the lyrics in the right script (简体/繁體). */
  async _relang() {
    if (this.song?.id) {
      try {
        const s = await (await fetch(`/karaoke/${this.song.id}/song.json?script=${lyricsScript()}`)).json();
        this.song.lines = s.lines; this.song.title = s.title; this.song.artist = s.artist;
      } catch { /* keep what we have */ }
    }
    this.draw(this.state === 'singing' ? this.now() : 0);
  }

  get playing() { return this.state === 'singing' && !this.audio.paused; }

  async start(item) {
    this.state = 'loading';
    this.message = 'karaoke.loading';
    this.draw(0);
    try {
      const r = await within(fetch(`/karaoke/${item.id}/song.json?script=${lyricsScript()}`), 20000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.song = await r.json();
      if (!this.song?.lines) throw new Error('no lyrics');
      this.song.id = item.id;
    } catch {
      this.state = 'empty';
      this.message = 'karaoke.loadFailed';
      return this.draw(0);
    }
    const midi = this.song.notes.map((n) => n.midi).sort((a, b) => a - b);
    this.lo = (midi[Math.floor(midi.length * 0.03)] ?? 50) - 2;
    this.hi = (midi[Math.floor(midi.length * 0.97)] ?? 70) + 2;
    this.hits = this.total = this.streak = this.bestStreak = 0;
    this.noteIdx = 0;
    this.trail = [];
    this.offset = (this.song.offset || 0) + store.get('karaokeOffset', 0);
    // The microphone joins whenever it's allowed: never wait for it (inside VR the Quest may not be
    // able to show the permission question, and the song must start anyway).
    if (!this.autosing && !this.mic.ready) {
      this.mic.open().then((ok) => { if (ok) { this.voice.connect(this.mic.source); this.onChange(); } });
    } else if (this.mic.ready) this.voice.connect(this.mic.source);
    this.engine.attach(this.audio);
    // the voice reducer sits between this song and the room's sound (passes straight through when off)
    if (!this.cut) {
      this.cut = createVocalCut(this.engine.ctx);
      const src = this.engine.sources.get(this.audio);
      src.disconnect();
      src.connect(this.cut.input);
      this.cut.output.connect(this.engine.analyser);
    }
    this.quick = !!this.song.quick;
    this.lineIdx = 0;
    this.cut.reset();
    this.cut.set(this.quick && store.get('vocalCut', true));
    const inst = `/karaoke/${item.id}/instrumental.m4a`;
    this.message = 'karaoke.loadingSong';
    this.draw(0);
    try {
      // away from home the song comes over the link in one piece: give it time, but not forever
      const src = link.active ? await within(link.objectUrl(inst), 120000) : demo.url(inst);
      if (!src) throw new Error('no audio');
      this.audio.src = src;
    } catch {
      this.state = 'empty';
      this.message = 'karaoke.loadFailed';
      return this.draw(0);
    }
    this.audio.currentTime = 0;
    this.audio.pause();
    // "3, 2, 1, Sing!" with sound, so everyone (kids too) knows when it starts.
    this.state = 'countdown';
    this.countT = 3.999;
    this.countEnd = performance.now() / 1000 + this.countT; // real time, even if frames stutter
    this.countAway = null;
    this.lastCue = '';
    this.onChange();
  }

  toggle() {
    if (this.state === 'countdown') return true; // let the count finish
    if (this.state !== 'singing') return false;
    this.engine.unlock();
    if (this.audio.paused) this.audio.play().catch(() => {}); else this.audio.pause();
    return true;
  }

  pause() { if (this.state === 'singing') this.audio.pause(); }

  _finish() {
    this.state = 'score';
    this.scoreT = 0;
    const ratio = this.total ? this.hits / this.total : 0;
    this.sang = this.hits > 20;
    // Generous on purpose: this is a family game, not a singing exam.
    if (this.quick) { // singing along through the lines (no pitch to match)
      this.stars = !this.sang ? 0 : ratio >= 0.7 ? 5 : ratio >= 0.55 ? 4 : ratio >= 0.4 ? 3 : ratio >= 0.25 ? 2 : 1;
      this.percent = Math.min(100, Math.round(ratio * 110 + (this.sang ? 8 : 0)));
    } else {
      this.stars = !this.sang ? 0 : ratio >= 0.55 ? 5 : ratio >= 0.4 ? 4 : ratio >= 0.27 ? 3 : ratio >= 0.14 ? 2 : 1;
      this.percent = Math.min(100, Math.round(ratio * 125 + (this.sang ? 15 : 0)));
    }
    this.starsShown = 0;
    this.onChange();
  }

  /** Quick sing-along: no melody, so a line counts while you are singing during it. */
  _singAlong(t, dt, clock) {
    const lines = this.song.lines;
    while (this.lineIdx < lines.length && lines[this.lineIdx].end < t) this.lineIdx++;
    const line = lines[this.lineIdx] && lines[this.lineIdx].t <= t ? lines[this.lineIdx] : null;
    let voice = null;
    if (this.autosing) {
      voice = line ? { midi: 62 + Math.sin(clock * 5) * 3 } : null;
      this.micLevel = line ? 0.6 + 0.3 * Math.sin(clock * 9) : 0.05;
    } else if (this.mic.ready && !this.audio.paused) {
      voice = this.mic.read();
      this.micLevel = this.mic.level;
    }
    if (!this.audio.paused) {
      this.cut.listen(true);
      const singing = !!voice || this.micLevel > 0.08;
      let hit = false;
      if (line) {
        this.total++;
        if (singing) { this.hits++; hit = true; this.streak += dt; this.bestStreak = Math.max(this.bestStreak, this.streak); }
        else this.streak = Math.max(0, this.streak - dt * 3);
      }
      if (voice) this.trail.push({ t, midi: (this.lo + this.hi) / 2 + fold(voice.midi - (this.lo + this.hi) / 2), hit });
      while (this.trail.length && this.trail[0].t < t - 1.6) this.trail.shift();
    }
    if (this.frame % 2 === 0) this.draw(t, clock);
  }

  /** The time in the song you are hearing right now. */
  now() {
    const latency = this.engine.ctx?.outputLatency || 0;
    return this.audio.currentTime - latency + this.offset;
  }

  update(dt, active, clock) {
    // You hear your own voice while a song is on (counting in, singing or paused), never elsewhere.
    this.voice.setOpen(active && (this.state === 'countdown' || this.state === 'singing'));
    if (!active) {
      this.micLevel = 0;
      // switched to another mode during "3, 2, 1": hold the count until you come back
      if (this.state === 'countdown' && this.countAway == null) this.countAway = performance.now() / 1000;
      return;
    }
    this.frame++;
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countT);
      const wall = performance.now() / 1000;
      // Only time spent in another mode is added back. (Slow frames are not "away": the count runs
      // on the clock, so it always finishes, even if the headset stutters while loading.)
      if (this.countAway != null) { this.countEnd += wall - this.countAway; this.countAway = null; }
      this.countT = this.countEnd - wall;
      const n = Math.ceil(this.countT);
      if (n !== before && n >= 1 && n <= 3) this.sfx.count(n);
      if (this.countT <= 0) {
        this.sfx.count(0, true);
        this.goT = clock;
        this.state = 'singing';
        this.audio.play().catch(() => {});
        this.onChange();
      }
      if (this.mic.ready) { this.mic.read(); this.micLevel = this.mic.level; }
      if (this.frame % 2 === 0) this.draw(this.offset - Math.max(0, this.countT), clock);
      return;
    }
    if (this.state === 'singing') {
      const t = this.now();
      // audible count-in before a line that comes after a long gap: tick on 3, 2, 1
      const ci = !this.audio.paused && this._countIn(t);
      if (ci) {
        const n = Math.ceil(ci.left);
        const key = `${ci.i}:${n}`;
        if (n >= 1 && n <= 3 && key !== this.lastCue) { this.lastCue = key; this.sfx.count(n); }
      }
      if (this.quick) return this._singAlong(t, dt, clock);
      const notes = this.song.notes;
      while (this.noteIdx < notes.length && notes[this.noteIdx].t + notes[this.noteIdx].d < t - 0.12) this.noteIdx++;
      const target = notes[this.noteIdx] && notes[this.noteIdx].t - 0.12 <= t ? notes[this.noteIdx] : null;
      this.voice.setTarget(target ? target.midi : null); // auto-tune "melody" pulls you to this note
      let voice = null;
      if (this.autosing) {
        voice = target ? { midi: target.midi + Math.sin(clock * 7) * 0.4 } : null;
        this.micLevel = target ? 0.6 + 0.3 * Math.sin(clock * 9) : 0.05;
      } else if (this.mic.ready && !this.audio.paused) {
        voice = this.mic.read();
        this.micLevel = this.mic.level;
      }
      if (!this.audio.paused) {
        let hit = false;
        if (target) {
          this.total++;
          if (voice && Math.abs(fold(voice.midi - target.midi)) <= TOLERANCE) { this.hits++; hit = true; this.streak += dt; this.bestStreak = Math.max(this.bestStreak, this.streak); }
          else this.streak = Math.max(0, this.streak - dt * 3); // a short slip doesn't end a run
        }
        if (voice) {
          // draw the voice in the octave nearest the melody, so high and low singers both fit the lane
          const ref = target ? target.midi : (this.lo + this.hi) / 2;
          this.trail.push({ t, midi: ref + fold(voice.midi - ref), hit });
        }
        while (this.trail.length && this.trail[0].t < t - 1.6) this.trail.shift();
      }
      if (this.frame % 2 === 0) this.draw(t, clock);
    } else if (this.state === 'score') {
      this.scoreT += dt;
      const want = Math.min(this.stars, Math.floor((this.scoreT - 1.2) / 0.45) + 1);
      if (this.scoreT > 1.2 && want > this.starsShown) { this.starsShown = want; this.sfx.star(want - 1); }
      this.micLevel = 0;
      if (this.frame % 2 === 0) this.draw(0, clock);
    }
  }

  // ------------------------------------------------------------------ drawing
  draw(t, clock = 0) {
    const ctx = this.ctx;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d0a22');
    bg.addColorStop(1, '#05040d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    if (this.state === 'empty' || this.state === 'loading') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff4fa3';
      ctx.font = font(64, 750);
      ctx.fillText(tr('karaoke.title'), W / 2, H / 2 - 40);
      ctx.fillStyle = '#9aa3c7';
      ctx.font = font(30);
      ctx.fillText(tr(this.message || 'karaoke.pick'), W / 2, H / 2 + 30);
      this.regions = []; this.tuneRegions = [];
    } else if (this.state === 'countdown') {
      this.regions = [];
      this._drawTuneRow(); // choose auto-tune while counting in
      this._drawLane(t);
      this._drawCountdown(clock);
      this._drawLyrics(t, false, false);
    } else if (this.state === 'singing') {
      this._drawLane(t);
      this._drawLyrics(t, true);
      this._drawHud(t);
      if (this.goT != null && clock - this.goT < 0.9) this._drawGo(clock - this.goT);
    } else { this.regions = []; this.tuneRegions = []; this._drawScore(clock); }
    this.texture.needsUpdate = true;
  }

  /** The line you're about to sing, if it follows a long gap and starts within 3.2 s. */
  _countIn(t) {
    const lines = this.song.lines;
    const i = lines.findIndex((l) => l.end > t - 0.3);
    if (i < 0) return null;
    const cur = lines[i];
    const prevEnd = i > 0 ? lines[i - 1].end : 0;
    const left = cur.t - t;
    return left > 0.05 && left < 3.2 && cur.t - prevEnd > 4 ? { i, left } : null;
  }

  /** Before the song: a big 3 · 2 · 1 with a ring that sweeps down each second. */
  _drawCountdown() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5,4,13,0.62)';
    ctx.fillRect(0, 0, W, H);
    const n = Math.ceil(this.countT);
    const cx = W / 2, cy = 235;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (n > 3) {
      ctx.fillStyle = '#e8ecff';
      ctx.font = font(78, 800);
      ctx.fillText(tr('karaoke.getReady'), cx, cy);
    } else {
      const frac = this.countT - (n - 1); // 1 → 0 through this second
      const pop = 1 + 0.35 * Math.max(0, frac - 0.75) * 4; // springs in at the start of each second
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath(); ctx.arc(cx, cy, 105, 0, Math.PI * 2); ctx.stroke();
      const g = ctx.createLinearGradient(cx - 105, 0, cx + 105, 0);
      g.addColorStop(0, '#ffb35c'); g.addColorStop(1, '#ff4fa3');
      ctx.strokeStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, 105, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy + 6);
      ctx.scale(pop, pop);
      ctx.shadowColor = 'rgba(255,140,80,0.8)';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ffffff';
      ctx.font = font(140, 800);
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#9aa3c7';
    ctx.font = font(30, 600);
    ctx.fillText(ellipsize(ctx, `${this.song.title} · ${this.song.artist}`, W - 200), cx, 70);
    ctx.fillStyle = '#c9cff0';
    ctx.font = font(32);
    ctx.fillText(tr('karaoke.readyHint'), cx, 368);
  }

  /** "Sing!" flashes up as the music starts. */
  _drawGo(age) {
    const ctx = this.ctx;
    const a = Math.max(0, 1 - age / 0.9);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.translate(W / 2, 372);
    const s = 1 + age * 0.5;
    ctx.scale(s, s);
    ctx.shadowColor = 'rgba(255,79,163,0.9)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ff4fa3';
    ctx.font = font(64, 800);
    ctx.fillText(tr('karaoke.go'), 0, 0);
    ctx.restore();
  }

  _y(midi) {
    const top = 70, bottom = 300;
    return bottom - ((Math.max(this.lo, Math.min(this.hi, midi)) - this.lo) / (this.hi - this.lo)) * (bottom - top);
  }
  _x(time, t) { return W * NOW_X + ((time - t) / WINDOW) * W; }

  _drawLane(t) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    roundRect(ctx, 40, 50, W - 80, 270, 24);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 40, 50, W - 80, 270, 24);
    ctx.clip();
    if (this.quick) { // no melody to follow: say what this is, and let your voice glow across the lane
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(201,207,240,0.28)'; ctx.font = font(30, 650);
      ctx.fillText(tr(this.cut?.on ? 'karaoke.quickLane' : 'karaoke.quickLaneOff'), W / 2, 185);
    }
    // melody bars
    for (let i = Math.max(0, this.noteIdx - 12); i < this.song.notes.length; i++) {
      const n = this.song.notes[i];
      if (n.t > t + WINDOW) break;
      const x0 = this._x(n.t, t), x1 = this._x(n.t + n.d, t), y = this._y(n.midi);
      const passed = n.t + n.d < t;
      const activeNow = n.t <= t && !passed;
      ctx.fillStyle = activeNow ? '#ffb35c' : passed ? 'rgba(255,79,163,0.28)' : 'rgba(232,236,255,0.5)';
      roundRect(ctx, x0, y - 7, Math.max(8, x1 - x0 - 3), 14, 7);
      ctx.fill();
    }
    // now line
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(W * NOW_X - 1, 56, 2, 258);
    // your voice: a comet with a fading trail
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1], b = this.trail[i];
      if (b.t - a.t > 0.12) continue;
      const age = (t - b.t) / 1.6;
      ctx.strokeStyle = b.hit ? `rgba(255,200,110,${1 - age})` : `rgba(92,225,230,${0.8 * (1 - age)})`;
      ctx.lineWidth = 7 * (1 - age) + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this._x(a.t, t), this._y(a.midi));
      ctx.lineTo(this._x(b.t, t), this._y(b.midi));
      ctx.stroke();
    }
    const head = this.trail[this.trail.length - 1];
    if (head && t - head.t < 0.15) {
      const x = W * NOW_X, y = this._y(head.midi);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 30);
      g.addColorStop(0, head.hit ? 'rgba(255,230,170,1)' : 'rgba(200,250,255,1)');
      g.addColorStop(0.3, head.hit ? 'rgba(255,179,92,0.7)' : 'rgba(92,225,230,0.6)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  _drawLyrics(t, countIn = true, showNext = true) {
    const ctx = this.ctx;
    const lines = this.song.lines;
    let i = lines.findIndex((l) => l.end > t - 0.3);
    if (i < 0) i = lines.length;
    const cur = lines[i], next = lines[i + 1];
    // count-in before a line that follows a long gap: 3 · 2 · 1, the current number big and lit
    // (you also hear a tick on each one)
    const ci = countIn && this._countIn(t);
    if (ci) {
      const n = Math.min(3, Math.ceil(ci.left));
      const frac = ci.left - (n - 1);
      ctx.textAlign = 'center';
      for (let k = 0; k < 3; k++) {
        const num = 3 - k;
        const on = num === n;
        const passed = num > n;
        ctx.save();
        ctx.translate(W / 2 + (k - 1) * 70, 372);
        const s = on ? 1 + 0.4 * Math.max(0, frac - 0.7) * 3.3 : 1;
        ctx.scale(s, s);
        if (on) { ctx.shadowColor = 'rgba(255,140,80,0.9)'; ctx.shadowBlur = 20; }
        ctx.fillStyle = on ? '#ffb35c' : passed ? 'rgba(255,179,92,0.3)' : 'rgba(255,255,255,0.18)';
        ctx.font = font(on ? 54 : 34, 800);
        ctx.fillText(String(num), 0, 0);
        ctx.restore();
      }
    }
    if (cur) this._drawLine(cur, t, 455, 76, true);
    if (next && showNext) this._drawLine(next, t, 575, 44, false);
    if (!cur) { ctx.textAlign = 'center'; ctx.fillStyle = '#9aa3c7'; ctx.font = font(40); ctx.fillText('♪', W / 2, 470); }
  }

  _drawLine(line, t, y, size, current) {
    const ctx = this.ctx;
    let px = size;
    const full = line.words.map((w) => w.text).join('');
    ctx.font = font(px, current ? 750 : 600);
    const maxW = W - 120;
    let width = ctx.measureText(full).width;
    if (width > maxW) { px = Math.floor((px * maxW) / width); ctx.font = font(px, current ? 750 : 600); width = ctx.measureText(full).width; }
    const x0 = (W - width) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = current ? 'rgba(232,236,255,0.72)' : 'rgba(232,236,255,0.34)';
    ctx.fillText(full, x0, y);
    if (!current) return;
    // how far the fill has travelled: full width of sung words + part of the current word
    let fillW = 0, acc = '';
    for (const w of line.words) {
      const before = ctx.measureText(acc).width;
      acc += w.text;
      const after = ctx.measureText(acc.trimEnd()).width;
      const f = Math.min(1, Math.max(0, (t - w.t) / Math.max(0.05, w.d)));
      if (f <= 0) break;
      fillW = before + (after - before) * f;
    }
    if (fillW > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - 4, y - px, fillW + 4, px * 2);
      ctx.clip();
      const g = ctx.createLinearGradient(x0, 0, x0 + width, 0);
      g.addColorStop(0, '#ffb35c');
      g.addColorStop(1, '#ff6f61');
      ctx.shadowColor = 'rgba(255,140,80,0.8)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = g;
      ctx.fillText(full, x0, y);
      ctx.restore();
    }
  }

  _drawHud(t) {
    const ctx = this.ctx;
    const s = this.song;
    ctx.textAlign = 'left';
    ctx.font = font(24, 600);
    ctx.fillStyle = '#9aa3c7';
    ctx.fillText(ellipsize(ctx, `${s.title} · ${s.artist}`, 700), 44, 28);
    ctx.textAlign = 'right';
    const inTune = this.streak > 2 ? tr('karaoke.inTune', { s: Math.floor(this.streak) }) : '';
    const micText = this.autosing ? [tr('karaoke.demo'), inTune].filter(Boolean).join(' · ') : this.mic.ready ? inTune || tr('karaoke.micOn') : tr(this.mic.error || 'karaoke.micOff');
    ctx.fillStyle = this.mic.ready || this.autosing ? '#5ce1e6' : '#ff9a8a';
    ctx.fillText(micText, W - 44, 28);
    // progress
    const dur = s.duration || this.audio.duration || 1;
    roundRect(ctx, 44, H - 40, W - 88, 8, 4); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
    roundRect(ctx, 44, H - 40, Math.max(8, (W - 88) * Math.min(1, t / dur)), 8, 4); ctx.fillStyle = '#ff4fa3'; ctx.fill();
    ctx.font = font(22); ctx.fillStyle = '#7d86ab'; ctx.textAlign = 'right';
    ctx.fillText(`${fmtTime(Math.max(0, t))} / ${fmtTime(dur)}${this.audio.paused ? ` · ${tr('karaoke.paused')}` : ''}`, W - 44, H - 64);
    this._drawVoiceButtons();
  }

  /** Bottom-left pills: My voice − / + and Echo. Point and pull the trigger (or click). */
  _drawVoiceButtons() {
    const ctx = this.ctx;
    const v = Math.round(this.voice.volume * 100);
    const y = H - 92, h = 40;
    const items = [
      { key: 'voice-', text: '−', w: 46 },
      { key: 'voiceLabel', text: v ? tr('karaoke.voice', { p: v }) : tr('karaoke.voiceOff'), w: 0, label: true },
      { key: 'voice+', text: '+', w: 46 },
      { key: 'echo', text: tr(this.voice.echo ? 'karaoke.echoOn' : 'karaoke.echoOff'), w: 0, on: this.voice.echo },
    ];
    this._drawTuneRow();
    if (this.quick && this.cut) items.push({ key: 'cut', text: tr(this.cut.mono ? 'karaoke.singerMono' : this.cut.on ? 'karaoke.singerLow' : 'karaoke.singerOn'), w: 0, on: this.cut.on });
    ctx.font = font(22, 650);
    ctx.textBaseline = 'middle';
    let x = 44;
    this.regions = [];
    for (const it of items) {
      const w = it.w || Math.ceil(ctx.measureText(it.text).width) + 32;
      if (!it.label) {
        const hov = this.hover?.key === it.key;
        roundRect(ctx, x, y, w, h, h / 2);
        ctx.fillStyle = it.on ? (hov ? 'rgba(255,79,163,0.5)' : 'rgba(255,79,163,0.3)') : hov ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
        ctx.fill();
        this.regions.push({ key: it.key, x, y, w, h });
      }
      ctx.fillStyle = it.label ? '#c9cff0' : '#e8ecff';
      ctx.textAlign = 'center';
      ctx.font = font(it.text.length === 1 ? 30 : 22, 650);
      ctx.fillText(it.text, x + w / 2, y + h / 2 + 1);
      x += w + 10;
    }
  }

  /**
   * Auto-tune, under the pitch lane on the right: Off | Natural | Melody | Robot, and the note
   * you're on while you sing (green when it's the song's note). Melody only for songs that know
   * their melody. Drawn before the voice row, so this.regions is reset there afterwards — keep both.
   */
  _drawTuneRow() {
    const ctx = this.ctx;
    const modes = TUNE_ORDER.filter((m) => m !== 'melody' || (this.song?.notes?.length > 0));
    const cur = this.voice.tune === 'melody' && !modes.includes('melody') ? 'natural' : this.voice.tune;
    const y = 334, h = 38;
    ctx.font = font(21, 650);
    ctx.textBaseline = 'middle';
    const chips = modes.map((m) => ({ m, text: tr(`karaoke.tune.${m}`), w: Math.ceil(ctx.measureText(tr(`karaoke.tune.${m}`)).width) + 28 }));
    const info = this.voice.tuneInfo;
    const noteOn = cur !== 'off' && info.voiced && info.note != null;
    const noteText = noteOn ? `♪ ${noteName(info.note)}` : '';
    const label = tr('karaoke.tune');
    const labelW = Math.ceil(ctx.measureText(label).width) + 12;
    const noteW = noteText ? Math.ceil(ctx.measureText(noteText).width) + 28 : 0;
    const total = labelW + chips.reduce((a, c) => a + c.w + 6, 0) + (noteW ? noteW + 10 : 0);
    let x = W - 44 - total;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c9cff0';
    ctx.fillText(label, x, y + h / 2 + 1);
    x += labelW;
    // one rounded track with the chips inside, the chosen one lit
    roundRect(ctx, x - 4, y - 4, chips.reduce((a, c) => a + c.w + 6, 0) + 2, h + 8, (h + 8) / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
    this.tuneRegions = [];
    for (const c of chips) {
      const on = c.m === cur, hov = this.hover?.key === `tune:${c.m}`;
      roundRect(ctx, x, y, c.w, h, h / 2);
      ctx.fillStyle = on ? (c.m === 'off' ? 'rgba(255,255,255,0.22)' : 'rgba(255,79,163,0.55)') : hov ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0)';
      ctx.fill();
      ctx.fillStyle = on ? '#ffffff' : '#c9cff0';
      ctx.textAlign = 'center';
      ctx.fillText(c.text, x + c.w / 2, y + h / 2 + 1);
      this.tuneRegions.push({ key: `tune:${c.m}`, x, y, w: c.w, h });
      x += c.w + 6;
    }
    if (noteText) {
      x += 6;
      const target = this.voice.target;
      const hit = target != null && ((info.note - target) % 12 + 12) % 12 === 0;
      roundRect(ctx, x, y, noteW, h, h / 2);
      ctx.fillStyle = hit ? 'rgba(107,227,164,0.3)' : 'rgba(92,225,230,0.18)'; ctx.fill();
      ctx.fillStyle = hit ? '#6be3a4' : '#5ce1e6';
      ctx.textAlign = 'center';
      ctx.fillText(noteText, x + noteW / 2, y + h / 2 + 1);
    }
    ctx.textAlign = 'left';
  }

  /** Pointer support for the board's buttons. x, y in canvas pixels. */
  hit(x, y) {
    return [...this.regions, ...(this.tuneRegions || [])].find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || null;
  }
  setHover(r) {
    if ((r?.key ?? null) === (this.hover?.key ?? null)) return;
    this.hover = r;
    if (r) this.sfx.hover();
  }
  click(r) {
    if (!r) return;
    this.sfx.select();
    if (r.key === 'voice-' || r.key === 'voice+') store.set('voiceVolume', this.voice.setVolume(this.voice.volume + (r.key === 'voice+' ? 0.1 : -0.1)));
    else if (r.key === 'echo') { this.voice.setEcho(!this.voice.echo); store.set('voiceEcho', this.voice.echo); }
    else if (r.key === 'cut' && this.cut && !this.cut.mono) { this.cut.set(!this.cut.on); store.set('vocalCut', this.cut.on); }
    else if (r.key.startsWith('tune:')) store.set('voiceTune', this.voice.setTune(r.key.slice(5)));
  }

  _drawScore(clock) {
    const ctx = this.ctx;
    const T = this.scoreT;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9aa3c7';
    ctx.font = font(30, 600);
    ctx.fillText(ellipsize(ctx, `${this.song.title} · ${this.song.artist}`, W - 200), W / 2, 90);
    if (!this.sang) {
      ctx.fillStyle = '#e8ecff'; ctx.font = font(72, 750); ctx.fillText(tr('score.lovely'), W / 2, 300);
      ctx.fillStyle = '#9aa3c7'; ctx.font = font(32);
      ctx.fillText(tr(this.mic.ready ? 'score.quiet' : 'score.noMic'), W / 2, 390);
    } else {
      // number counts up, then stars spring in one by one, then the title
      const shown = Math.round(this.percent * Math.min(1, T / 1.1));
      ctx.fillStyle = '#e8ecff'; ctx.font = font(120, 800);
      ctx.fillText(`${shown}`, W / 2, 220);
      for (let i = 0; i < 5; i++) {
        const born = 1.2 + i * 0.45;
        const lit = i < this.stars;
        const age = T - born;
        let sc = 1;
        if (lit && age > 0) sc = 1 + 0.6 * Math.exp(-age * 6) * Math.cos(age * 16); // springy pop
        const on = lit && age > 0;
        star(ctx, W / 2 + (i - 2) * 120, 380, (on ? 46 : 36) * sc, on ? '#ffb35c' : 'rgba(255,255,255,0.12)', on);
      }
      const titleAt = 1.2 + this.stars * 0.45 + 0.3;
      if (T > titleAt) {
        const a = Math.min(1, (T - titleAt) * 2.5);
        ctx.globalAlpha = a;
        const g = ctx.createLinearGradient(W / 2 - 250, 0, W / 2 + 250, 0);
        g.addColorStop(0, '#5ce1e6'); g.addColorStop(0.5, '#ff4fa3'); g.addColorStop(1, '#ffb35c');
        ctx.fillStyle = g; ctx.font = font(76, 800);
        ctx.fillText(tr('score.titles')[this.stars - 1], W / 2, 520 + (1 - a) * 20);
        ctx.fillStyle = '#9aa3c7'; ctx.font = font(28);
        ctx.fillText(tr('score.longest', { s: this.bestStreak.toFixed(1) }), W / 2, 600);
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = '#7d86ab'; ctx.font = font(26);
    ctx.fillText(tr('score.again'), W / 2, H - 50);
    void clock;
  }
}

function star(ctx, x, y, r, color, glow) {
  ctx.save();
  ctx.translate(x, y);
  if (glow) { ctx.shadowColor = 'rgba(255,179,92,0.9)'; ctx.shadowBlur = 30; }
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export { api };
