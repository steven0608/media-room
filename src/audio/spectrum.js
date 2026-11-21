// The sound, shaped for the visuals. Every frame it turns the analyser's raw data into:
//   spectrum  64 bands, 40 Hz → 12 kHz on a log scale, each auto-levelled (quiet songs still
//             move), fast to rise and slow to fall — in `levels` and the 64×1 texture `specTex`
//   waveform  the live sound wave, 256 points from a steady starting point so it doesn't
//             jitter — in the 256×1 texture `waveTex`
//   pulse     a 0..1 kick that jumps on each beat and decays — in `pulse`
// Textures are tiny (one row of bytes), so the GPU can read them in any shader for free.
import * as THREE from 'three';

const BANDS = 64;
const WAVE = 256;

export class Spectrum {
  constructor(engine) {
    this.engine = engine;
    this.levels = new Float32Array(BANDS);
    this.peaks = new Float32Array(BANDS).fill(0.25);
    this.pulse = 0;
    this.specData = new Uint8Array(BANDS);
    this.waveData = new Uint8Array(WAVE).fill(128);
    this.specTex = tex(this.specData, BANDS);
    this.waveTex = tex(this.waveData, WAVE);
    this.time = null;
    this.edges = null;
  }

  /** active: is music playing (otherwise everything eases back to calm). */
  update(dt, active, beat = 0) {
    const e = this.engine;
    this.pulse = Math.max(beat ? Math.min(1, 0.45 + beat * 0.4) : 0, this.pulse * Math.exp(-dt * 5));
    if (!e.analyser || !e.freq) return;
    if (!this.edges) {
      // log-spaced band edges, in analyser bins
      const hz = e.ctx.sampleRate / e.analyser.fftSize;
      this.edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((40 * Math.pow(12000 / 40, i / BANDS)) / hz)));
      this.time = new Uint8Array(e.analyser.fftSize);
    }
    const up = Math.min(1, dt * 22), down = Math.min(1, dt * 3.2);
    for (let b = 0; b < BANDS; b++) {
      let raw = 0;
      if (active) {
        const a = this.edges[b], z = Math.max(a, this.edges[b + 1] - 1);
        let s = 0;
        for (let i = a; i <= z; i++) s += e.freq[i];
        raw = s / ((z - a + 1) * 255);
      }
      this.peaks[b] = Math.max(raw, this.peaks[b] * Math.pow(0.7, dt), 0.12);
      const target = Math.pow(Math.min(1, raw / this.peaks[b]), 1.6);
      const l = this.levels[b];
      this.levels[b] = l + (target - l) * (target > l ? up : down);
      this.specData[b] = Math.round(this.levels[b] * 255);
    }
    this.specTex.needsUpdate = true;

    // waveform: start at a rising zero crossing so the shape stands still instead of sliding
    const w = this.waveData;
    if (active) {
      e.analyser.getByteTimeDomainData(this.time);
      let start = 0;
      for (let i = 1; i < 512; i++) if (this.time[i - 1] < 128 && this.time[i] >= 128) { start = i; break; }
      for (let i = 0; i < WAVE; i++) w[i] = (w[i] + this.time[start + i * 4]) >> 1; // light smoothing over frames
    } else {
      for (let i = 0; i < WAVE; i++) w[i] = Math.round(w[i] + (128 - w[i]) * down);
    }
    this.waveTex.needsUpdate = true;
  }

  /** Average of a band range (0..1 across the 64 bands). */
  range(a, b) {
    const i0 = Math.floor(a * BANDS), i1 = Math.max(i0 + 1, Math.floor(b * BANDS));
    let s = 0;
    for (let i = i0; i < i1; i++) s += this.levels[i];
    return s / (i1 - i0);
  }
}

function tex(data, width) {
  const t = new THREE.DataTexture(data, width, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
