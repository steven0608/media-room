// Auto-tune: real-time pitch correction for the singer's mic, on the audio thread.
// (From Moon Booth; Still Water adds "melody": pull to the song's own note when the karaoke
// version knows it, in whichever octave you sing, instead of just the nearest note.)
//
//   1. Find the pitch (YIN on a 2× decimated copy of the input, ~90 times a second).
//   2. Pick the nearest note (chromatic, A = 440, with a little hysteresis so it doesn't flicker).
//   3. Shift toward it with a pitch-synchronous delay line: the read head drifts at the shift
//      ratio and, when it runs out of room, jumps by a whole number of pitch periods with a short
//      crossfade. Because each jump is a whole period, the two signals being blended are in phase,
//      so there's no warble. With no correction there are no jumps: it's just a ~13 ms delay.
//
// Settings arrive on the port: { amount: 0..1 (how far to pull to the note), speed: seconds
// (retune time: ~0.005 = the hard "robot" pop sound, ~0.08 = natural) }. amount 0 = bypass.

const DEC = 2;                 // detection runs at sampleRate / 2
const W = 512;                 // YIN window (decimated samples)
const HOP = 1024;              // run detection every HOP input samples
const MIN_HZ = 75, MAX_HZ = 1000;
const N = 8192;                // delay buffer (power of two)

class AutoTune extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fs = sampleRate;
    this.fs2 = sampleRate / DEC;
    this.tauMax = Math.floor(this.fs2 / MIN_HZ);
    this.tauMin = Math.max(2, Math.floor(this.fs2 / MAX_HZ));
    this.dlen = 4096;
    this.dbuf = new Float32Array(this.dlen);     // decimated input ring
    this.dw = 0; this.decAcc = 0; this.decN = 0;
    this.sinceHop = 0;
    this.diff = new Float32Array(this.tauMax + 2);
    this.frame = new Float32Array(W + this.tauMax + 2);

    this.buf = new Float32Array(N);              // full-rate input ring (the delay line)
    this.w = 0;
    this.T = Math.round(this.fs / 220);          // current period (input samples)
    this.voiced = false;
    this.note = null;
    this.ratio = 1;
    this.ratioTarget = 1;

    this.Tmax = Math.ceil(this.fs / MIN_HZ);
    this.Dmin = 48;
    this.Dmax = this.Dmin + 2 * this.Tmax;
    this.D = (this.Dmin + this.Dmax) / 2;
    this.fading = false; this.Dold = 0; this.fadePos = 0; this.fadeLen = 1;

    this.amount = 0; this.speed = 0.04;
    this.mix = 0;                                 // 0 = dry bypass, 1 = tuned
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (typeof m.amount === "number") this.amount = Math.max(0, Math.min(1, m.amount));
      if (typeof m.speed === "number") this.speed = Math.max(0.002, m.speed);
      if ("target" in m) this.target = typeof m.target === "number" ? m.target : null; // the song's note (MIDI), or none
    };
    this.target = null;
    this.reportIn = 0;
  }

  detect() {
    const L = W + this.tauMax + 1, x = this.frame, len = this.dlen;
    let start = this.dw - L; if (start < 0) start += len;
    let energy = 0;
    for (let i = 0; i < L; i++) { const v = this.dbuf[(start + i) & (len - 1)]; x[i] = v; if (i < W) energy += v * v; }
    if (Math.sqrt(energy / W) < 0.008) return 0;          // too quiet: nothing to tune
    const d = this.diff;
    d[0] = 1;
    let run = 0, best = -1, bestVal = 1;
    for (let tau = 1; tau <= this.tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const q = x[j] - x[j + tau]; s += q * q; }
      run += s;
      const c = run > 0 ? (s * tau) / run : 1;            // cumulative mean normalized difference
      d[tau] = c;
      if (tau >= this.tauMin && c < bestVal) { bestVal = c; best = tau; }
    }
    // first dip under the threshold, walked down to its bottom (avoids octave errors)
    let tau = -1;
    for (let t = this.tauMin; t < this.tauMax; t++) {
      if (d[t] < 0.15) { while (t + 1 < this.tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) { if (bestVal < 0.25) tau = best; else return 0; }
    // parabolic interpolation around the minimum
    const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
    const den = a + c - 2 * b;
    const t = den !== 0 ? tau + (a - c) / (2 * den) : tau;
    return this.fs2 / t;
  }

  retarget(f0) {
    if (!f0) { this.voiced = false; this.ratioTarget = 1; return; }
    this.voiced = true;
    this.T = this.fs / f0;
    const midi = 69 + 12 * Math.log2(f0 / 440);
    if (this.target != null) {
      // the melody's note, in the octave nearest to where you are singing (kids sing high)
      this.note = this.target + 12 * Math.round((midi - this.target) / 12);
    } else if (this.note == null || Math.abs(midi - this.note) > 0.62) this.note = Math.round(midi);
    const corr = (this.note - midi) * this.amount;         // semitones to move
    this.ratioTarget = Math.pow(2, corr / 12);
  }

  read(delay) {
    let p = this.w - delay;
    while (p < 0) p += N;
    const i = Math.floor(p), f = p - i;
    const a = this.buf[i & (N - 1)], b = this.buf[(i + 1) & (N - 1)];
    return a + (b - a) * f;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0], out = outputs[0]?.[0];
    if (!out) return true;
    const n = out.length;
    const on = this.amount > 0;
    const blockDt = n / this.fs;
    // smoothing for this block
    const tau = this.voiced ? this.speed : 0.03;
    const k = 1 - Math.exp(-blockDt / tau);
    const mixK = 1 - Math.exp(-blockDt / 0.02);
    const mixTarget = on ? 1 : 0;

    for (let s = 0; s < n; s++) {
      const x = input ? input[s] : 0;
      this.buf[this.w] = x;

      // decimate for detection
      this.decAcc += x; if (++this.decN === DEC) { this.dbuf[this.dw] = this.decAcc / DEC; this.dw = (this.dw + 1) & (this.dlen - 1); this.decAcc = 0; this.decN = 0; }
      if (++this.sinceHop >= HOP) { this.sinceHop = 0; if (on || this.mix > 0.001) this.retarget(this.detect()); }

      let y = x;
      if (this.mix > 0.0005 || on) {
        // drift the read head at the shift ratio; jump a whole number of periods when needed
        const step = 1 - this.ratio;
        this.D += step;
        if (this.fading) this.Dold += step;
        if (!this.fading && (this.D < this.Dmin || this.D > this.Dmax)) {
          const T = Math.min(this.Tmax, Math.max(this.fs / MAX_HZ, this.T));
          const center = (this.Dmin + this.Dmax) / 2;
          const periods = Math.max(1, Math.round(Math.abs(center - this.D) / T));
          this.Dold = this.D;
          this.D = this.D < this.Dmin ? this.D + periods * T : this.D - periods * T;
          this.D = Math.min(this.Dmax, Math.max(this.Dmin, this.D));
          this.fading = true; this.fadePos = 0; this.fadeLen = Math.max(96, Math.min(720, Math.round(T)));
        }
        let tuned;
        if (this.fading) {
          const a = 0.5 - 0.5 * Math.cos((Math.PI * this.fadePos) / this.fadeLen);
          tuned = this.read(this.Dold) * (1 - a) + this.read(this.D) * a;
          if (++this.fadePos >= this.fadeLen) this.fading = false;
        } else {
          tuned = this.read(this.D);
        }
        y = x + (tuned - x) * this.mix;
      }
      out[s] = y;
      this.w = (this.w + 1) & (N - 1);
    }
    this.ratio += (this.ratioTarget - this.ratio) * k;
    this.mix += (mixTarget - this.mix) * mixK;
    if (!on && this.mix < 0.0005) { this.mix = 0; this.ratio = 1; }

    // tell the page what note you're on (for the remote's tuner), ~6 times a second
    this.reportIn -= n;
    if (this.reportIn <= 0) {
      this.reportIn = this.fs / 6;
      this.port.postMessage({ voiced: this.voiced, note: this.voiced ? this.note : null, ratio: this.ratio });
    }
    return true;
  }
}

registerProcessor("autotune", AutoTune);
