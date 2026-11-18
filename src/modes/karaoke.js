// Karaoke mode: the big screen becomes the lyric board.
//   - lyrics fill word by word in time with the song (two lines: now + next)
//   - a pitch lane above shows the melody as bars and your voice as a glowing comet
//   - at the end, stars and a title (generous, octaves don't matter — kids can sing high)
// Songs are prepared on the PC by tools/karaoke_prep.py (instrumental + timed lyrics + melody).
import { api, store } from '../api.js';
import { Mic } from '../audio/pitch.js';
import { canvasTexture, font, ellipsize, roundRect, fmtTime } from '../ui/text.js';
import { t as tr, onLang, lyricsScript } from '../i18n.js';
import { link } from '../link.js';

const W = 1280, H = 720;
const WINDOW = 6;       // seconds of melody visible in the pitch lane
const NOW_X = 0.24;     // where "now" sits across the lane
const TOLERANCE = 1.5;  // semitones either side that still count as a hit

const fold = (d) => ((((d % 12) + 18) % 12) - 6); // distance in semitones, ignoring octaves

export class KaraokeMode {
  constructor({ engine, sfx }) {
    this.engine = engine;
    this.sfx = sfx;
    this.mic = new Mic(engine);
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
      this.song = await (await fetch(`/karaoke/${item.id}/song.json?script=${lyricsScript()}`)).json();
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
    if (!this.autosing) await this.mic.open();
    this.engine.attach(this.audio);
    const inst = `/karaoke/${item.id}/instrumental.m4a`;
    this.audio.src = link.active ? await link.objectUrl(inst) : inst;
    this.audio.currentTime = 0;
    this.state = 'singing';
    this.audio.play().catch(() => {});
    this.onChange();
  }

  toggle() {
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
    this.stars = !this.sang ? 0 : ratio >= 0.55 ? 5 : ratio >= 0.4 ? 4 : ratio >= 0.27 ? 3 : ratio >= 0.14 ? 2 : 1;
    this.percent = Math.min(100, Math.round(ratio * 125 + (this.sang ? 15 : 0)));
    this.starsShown = 0;
    this.onChange();
  }

  /** The time in the song you are hearing right now. */
  now() {
    const latency = this.engine.ctx?.outputLatency || 0;
    return this.audio.currentTime - latency + this.offset;
  }

  update(dt, active, clock) {
    if (!active) { this.micLevel = 0; return; }
    this.frame++;
    if (this.state === 'singing') {
      const t = this.now();
      const notes = this.song.notes;
      while (this.noteIdx < notes.length && notes[this.noteIdx].t + notes[this.noteIdx].d < t - 0.12) this.noteIdx++;
      const target = notes[this.noteIdx] && notes[this.noteIdx].t - 0.12 <= t ? notes[this.noteIdx] : null;
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
    } else if (this.state === 'singing') {
      this._drawLane(t);
      this._drawLyrics(t);
      this._drawHud(t);
    } else this._drawScore(clock);
    this.texture.needsUpdate = true;
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

  _drawLyrics(t) {
    const ctx = this.ctx;
    const lines = this.song.lines;
    let i = lines.findIndex((l) => l.end > t - 0.3);
    if (i < 0) i = lines.length;
    const cur = lines[i], next = lines[i + 1];
    const prevEnd = i > 0 ? lines[i - 1].end : 0;
    // count-in dots before a line that follows a long gap
    if (cur && cur.t - t > 0.25 && cur.t - prevEnd > 4 && cur.t - t < 3.2) {
      const left = cur.t - t;
      for (let k = 0; k < 3; k++) {
        const on = left > k + 0.2;
        const frac = Math.min(1, Math.max(0, left - k));
        ctx.fillStyle = on ? '#ffb35c' : 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.arc(W / 2 + (k - 1) * 46, 372, on ? 6 + 8 * frac : 5, 0, 7); ctx.fill();
      }
    }
    if (cur) this._drawLine(cur, t, 455, 76, true);
    if (next) this._drawLine(next, t, 575, 44, false);
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
