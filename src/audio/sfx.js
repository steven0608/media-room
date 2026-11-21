// UI sounds, synthesised on the fly — no sound files, no licences.
// One "soft glass and wood" family: quiet ticks, two-note plucks, filtered swells.
// They bypass the media analyser so they never trigger the visuals.
export class Sfx {
  constructor(engine) {
    this.engine = engine;
    this.out = null;
    this.mediaPlaying = false;
  }
  _ctx() {
    const ctx = this.engine.unlock();
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.connect(ctx.destination);
    }
    // Duck UI sounds ~18 dB while music/video plays (creative review).
    this.out.gain.value = this.mediaPlaying ? 0.12 : 1;
    return ctx;
  }
  _tone(freq, t0, dur, { type = 'sine', vol = 0.08, glideTo, dest } = {}) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest || this.out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  hover() {
    const ctx = this._ctx();
    this._tone(2400, ctx.currentTime, 0.04, { vol: 0.015 });
  }
  select() {
    const ctx = this._ctx();
    const t = ctx.currentTime;
    this._tone(660, t, 0.18, { type: 'triangle', vol: 0.07 });
    this._tone(990, t + 0.06, 0.22, { type: 'triangle', vol: 0.06 });
  }
  back() {
    const ctx = this._ctx();
    const t = ctx.currentTime;
    this._tone(740, t, 0.15, { type: 'triangle', vol: 0.06 });
    this._tone(494, t + 0.05, 0.2, { type: 'triangle', vol: 0.05 });
  }
  swell(up = true) {
    const ctx = this._ctx();
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1.6, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(up ? 300 : 1800, t);
    f.frequency.exponentialRampToValueAtTime(up ? 1800 : 250, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.5);
    g.gain.linearRampToValueAtTime(0, t + 1.5);
    n.connect(f).connect(g).connect(this.out);
    n.start(t);
  }
  clunk(delay = 0) {
    const ctx = this._ctx();
    this._tone(110, ctx.currentTime + delay, 0.25, { type: 'sine', vol: 0.12, glideTo: 60 });
  }
  /**
   * Karaoke count-in: "3, 2, 1" ticks and a bright "go". Unlike the other UI sounds these are
   * never ducked under the song: their whole job is to be heard over the music.
   */
  count(n, go = false) {
    const ctx = this.engine.unlock();
    if (!this.cue) {
      this.cue = ctx.createGain();
      this.cue.gain.value = 1;
      this.cue.connect(ctx.destination);
    }
    const t = ctx.currentTime;
    const dest = this.cue; // the un-ducked bus
    if (go) {
      this._tone(1046, t, 0.35, { type: 'triangle', vol: 0.22, dest });
      this._tone(1568, t + 0.07, 0.45, { type: 'triangle', vol: 0.18, dest });
    } else {
      this._tone(n === 1 ? 988 : 784, t, 0.16, { type: 'triangle', vol: 0.24, dest });
      this._tone(n === 1 ? 1976 : 1568, t, 0.06, { type: 'sine', vol: 0.06, dest }); // a little "click" on top
    }
  }

  /** A drop touching the lake: a soft, falling plink, pitched a little differently each time. */
  drop() {
    const ctx = this._ctx();
    const f = 900 + Math.random() * 500;
    this._tone(f, ctx.currentTime, 0.22, { type: 'sine', vol: 0.05, glideTo: f * 0.45 });
  }

  star(i) {
    const ctx = this._ctx();
    const notes = [523, 659, 784, 1047, 1319];
    this._tone(notes[i % 5], ctx.currentTime, 0.5, { type: 'triangle', vol: 0.08 });
  }
}
