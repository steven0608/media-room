// Microphone + pitch detection for karaoke.
// The mic is only analysed, never played back (so there's no echo loop and no delay to hear).
// Pitch uses the McLeod method (normalised autocorrelation): good for one singing voice,
// wrong now and then by an octave (the score ignores octaves) and unsure on breathy notes.
export class Mic {
  constructor(engine) {
    this.engine = engine;
    this.analyser = null;
    this.buf = null;
    this.level = 0;
    this.error = '';
  }

  get ready() { return !!this.analyser; }

  /** Ask for the microphone. Call from a click, ideally before entering VR. */
  async open() {
    if (this.analyser) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation on: with the Quest's open speakers the mic also hears the backing track.
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      const ctx = this.engine.unlock();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.sampleRate = ctx.sampleRate;
      return true;
    } catch (e) {
      this.error = e.name === 'NotAllowedError' ? 'karaoke.micDenied' : 'karaoke.noMic'; // i18n keys
      return false;
    }
  }

  /** → { midi, clarity } or null when nobody is singing. */
  read() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    this.level += (Math.min(1, rms * 9) - this.level) * 0.3;
    if (rms < 0.012) return null;
    return detectPitch(this.buf, this.sampleRate);
  }
}

const half = new Float32Array(1024);
/** McLeod pitch method on a half-rate copy of the buffer (plenty for voices, 4× cheaper). */
export function detectPitch(buf, sampleRate) {
  const n = half.length;
  for (let i = 0; i < n; i++) half[i] = (buf[i * 2] + buf[i * 2 + 1]) * 0.5;
  const sr = sampleRate / 2;
  const minTau = Math.floor(sr / 1000); // highest note ~1000 Hz
  const maxTau = Math.min(n - 1, Math.floor(sr / 70)); // lowest ~70 Hz
  let best = -1, bestVal = 0, prev = 0, prevPrev = 0, rising = false;
  let firstPeakTau = -1, firstPeakVal = 0;
  let globalMax = 0;
  const nsdf = detectPitch.nsdf || (detectPitch.nsdf = new Float32Array(1024));
  for (let tau = minTau; tau <= maxTau; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i < n - tau; i++) {
      acf += half[i] * half[i + tau];
      m += half[i] * half[i] + half[i + tau] * half[i + tau];
    }
    const v = m > 0 ? (2 * acf) / m : 0;
    nsdf[tau] = v;
    if (v > globalMax) globalMax = v;
  }
  if (globalMax < 0.5) return null;
  const threshold = globalMax * 0.9;
  for (let tau = minTau + 1; tau < maxTau; tau++) {
    const v = nsdf[tau];
    if (v > nsdf[tau - 1] && v >= nsdf[tau + 1] && v >= threshold) { firstPeakTau = tau; firstPeakVal = v; break; }
  }
  void best; void bestVal; void prev; void prevPrev; void rising;
  if (firstPeakTau < 0) return null;
  // parabolic interpolation around the peak for sub-sample accuracy
  const a = nsdf[firstPeakTau - 1], b = nsdf[firstPeakTau], c = nsdf[firstPeakTau + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  const freq = sr / (firstPeakTau + shift);
  return { midi: 69 + 12 * Math.log2(freq / 440), clarity: firstPeakVal };
}
