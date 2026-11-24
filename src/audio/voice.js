// "Hear yourself": the karaoke microphone played back through the speakers, like a KTV room.
//
//   mic → [auto-tune] → low-cut → presence lift → boost → compressor ─┬─ dry ──┐
//                                                       ├─ room reverb ────────┼→ voice volume → speakers
//                                                       └─ short echo (KTV) ───┘
//
// It goes straight to the speakers, past the visuals' analyser, so your voice never drives
// the lights or the beat. The mic keeps echo cancellation on: the headset's speakers are
// right next to its microphones, and the browser removes what it plays (including this
// playback) from what the mic hears, which is what stops the howl of feedback.
// A little reverb and echo also hide the headset's small mic-to-speaker delay.
// Auto-tune presets (audio/autotune-worklet.js, from Moon Booth). amount = how far you're pulled
// to the note, speed = how quickly. "melody" pulls to the song's own note when the karaoke
// version knows it (otherwise the nearest note); "robot" snaps at once (the pop sound).
export const TUNE = {
  off:     { amount: 0,    speed: 0.05 },
  natural: { amount: 0.75, speed: 0.07 },
  melody:  { amount: 0.85, speed: 0.05 },
  robot:   { amount: 1,    speed: 0.004 },
};
export const TUNE_ORDER = ['off', 'natural', 'melody', 'robot'];

export class VoiceMonitor {
  constructor(engine, { volume = 0.8, echo = true, tune = 'off' } = {}) {
    this.engine = engine;
    this.volume = volume;
    this.echo = echo;
    this.tune = TUNE[tune] ? tune : 'off';
    this.open = false;
    this.out = null;
    this.tuner = null;
    this.tuneInfo = { available: false, voiced: false, note: null };
    this.target = null;
  }

  /** Auto-tune: off | natural | melody | robot. */
  setTune(mode) {
    this.tune = TUNE[mode] ? mode : 'off';
    this._tuneApply();
    return this.tune;
  }

  /** The song's note right now (MIDI), for "melody" mode; null between notes. */
  setTarget(midi) {
    const m = this.tune === 'melody' && midi != null ? Math.round(midi) : null;
    if (m === this.target) return;
    this.target = m;
    this.tuner?.port.postMessage({ target: m });
  }

  _tuneApply() {
    const p = TUNE[this.tune];
    this.tuner?.port.postMessage({ amount: this.open ? p.amount : 0, speed: p.speed, target: this.tune === 'melody' ? this.target : null });
  }

  /** Load the tuner and put it first in the chain (in the background: singing never waits for it). */
  async _addTuner(ctx, source, input) {
    try {
      await ctx.audioWorklet.addModule(new URL('./autotune-worklet.js', import.meta.url));
      const tuner = new AudioWorkletNode(ctx, 'autotune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      tuner.port.onmessage = (e) => { this.tuneInfo.voiced = e.data.voiced; this.tuneInfo.note = e.data.note; };
      source.disconnect(input);
      source.connect(tuner).connect(input);
      this.tuner = tuner;
      this.tuneInfo.available = true;
      this._tuneApply();
    } catch (e) {
      console.warn('auto-tune unavailable', e); // everything else still works
    }
  }

  /** Plug in the microphone (a MediaStreamAudioSourceNode). Safe to call more than once. */
  connect(source) {
    if (this.out || !source) return;
    const ctx = this.engine.unlock();
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass'; lowCut.frequency.value = 110; lowCut.Q.value = 0.7; // rumble, handling noise
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = 0.9; presence.gain.value = 3;
    const boost = ctx.createGain();
    boost.gain.value = 2.2; // auto-gain is off (it fights pitch detection), so lift the voice here
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.18;
    const input = ctx.createGain(); // the tuner slots in between the mic and this
    source.connect(input).connect(lowCut).connect(presence).connect(boost).connect(comp);
    this._addTuner(ctx, source, input);

    const out = ctx.createGain();
    out.gain.value = 0;
    comp.connect(out); // dry

    // room reverb: a generated 1.7 s tail (no impulse files to download)
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.7, 2.6);
    this.verbGain = ctx.createGain();
    comp.connect(verb).connect(this.verbGain).connect(out);

    // KTV echo: one short slap that fades away
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.21;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 2800;
    this.echoGain = ctx.createGain();
    comp.connect(delay).connect(tone).connect(fb).connect(delay);
    tone.connect(this.echoGain).connect(out);

    out.connect(ctx.destination);
    this.out = out;
    this._apply();
  }

  /** Voice on (while singing) or off (other modes, the score screen). Fades, never clicks. */
  setOpen(v) {
    if (this.open === v) return;
    this.open = v;
    this._apply();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1.5, Math.round(v * 20) / 20));
    this._apply();
    return this.volume;
  }

  setEcho(on) {
    this.echo = on;
    this._apply();
  }

  _apply() {
    if (!this.out) return;
    const t = this.engine.ctx.currentTime;
    this.out.gain.setTargetAtTime(this.open ? this.volume : 0, t, 0.06);
    this.verbGain.gain.setTargetAtTime(this.echo ? 0.32 : 0.1, t, 0.05);
    this.echoGain.gain.setTargetAtTime(this.echo ? 0.3 : 0, t, 0.05);
    this._tuneApply(); // tuning only while you're singing
  }
}

/** A stereo noise burst with an exponential fade: a soft, smooth room. */
function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
