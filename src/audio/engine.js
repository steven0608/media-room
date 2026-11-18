// One AudioContext for the whole room.
//   <audio>/<video> → analyser (visuals) → volume → speakers
// The analyser sits before the volume knob, so the visuals don't shrink when you turn it down.
// Media comes from the same origin as the page, which is what keeps the analyser from
// going silent (cross-origin media without CORS is "tainted" and reads as zeros).
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.sources = new WeakMap();
    this.freq = null;
    this.prevBass = null;
    this.bands = { bass: 0, mid: 0, treble: 0, level: 0 };
    this.volume = 0.8;
  }

  /** Must be called from a user gesture (click / Enter VR) — browsers block audio until then. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.55;
      this.analyser.minDecibels = -95;
      this.analyser.maxDecibels = -12;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.analyser.connect(this.gain).connect(this.ctx.destination);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Route a media element through the analyser (once per element). */
  attach(el) {
    this.unlock();
    if (!this.sources.has(el)) {
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.analyser);
      this.sources.set(el, src);
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  /** Bass/mid/treble 0..1 with fast attack and slow release. Call once per frame. */
  update(dt) {
    const b = this.bands;
    if (!this.analyser) return b;
    this.analyser.getByteFrequencyData(this.freq);
    const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hzPerBin));
      const z = Math.min(this.freq.length - 1, Math.ceil(hi / hzPerBin));
      let s = 0;
      for (let i = a; i <= z; i++) s += this.freq[i];
      return s / ((z - a + 1) * 255);
    };
    const raw = { bass: band(30, 140), mid: band(140, 2000), treble: band(2000, 9000) };
    // Auto-gain: divide by each band's recent peak (slowly decaying), so a quiet ballad and a
    // loud DJ track both use the full range. Squared so quiet parts stay calm and peaks pop.
    this.peaks ||= { bass: 0.3, mid: 0.3, treble: 0.2 };
    const target = {};
    for (const k of ['bass', 'mid', 'treble']) {
      this.peaks[k] = Math.max(raw[k], this.peaks[k] * Math.pow(0.85, dt), 0.12);
      target[k] = Math.pow(Math.min(1, raw[k] / this.peaks[k]), 2.2);
    }
    for (const k of ['bass', 'mid', 'treble']) {
      const up = target[k] > b[k];
      const rate = up ? 18 : 2.5; // attack fast, decay eased (UX review: no harsh flashing)
      b[k] += (target[k] - b[k]) * Math.min(1, dt * rate);
    }
    b.level = (b.bass + b.mid + b.treble) / 3;
    return b;
  }

  /** Bass spectral flux for the beat detector: how much the low end just jumped. */
  bassFlux() {
    if (!this.freq) return 0;
    const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
    const z = Math.ceil(160 / hzPerBin);
    if (!this.prevBass) this.prevBass = new Uint8Array(z + 1);
    let flux = 0;
    for (let i = 1; i <= z; i++) {
      const d = this.freq[i] - this.prevBass[i];
      if (d > 0) flux += d;
      this.prevBass[i] = this.freq[i];
    }
    return flux / (z * 255);
  }
}

/** Fires when the bass flux clearly beats its recent median. */
export class BeatDetector {
  constructor({ ratio = 1.45, minGapMs = 140 } = {}) {
    this.ratio = ratio;
    this.minGap = minGapMs / 1000;
    this.hist = [];
    this.last = -1;
  }
  update(flux, t) {
    this.hist.push(flux);
    if (this.hist.length > 60) this.hist.shift();
    const sorted = [...this.hist].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] || 0;
    if (flux > median * this.ratio + 0.012 && t - this.last > this.minGap) {
      this.last = t;
      return Math.min(1.5, flux / (median + 0.02));
    }
    return 0;
  }
}
