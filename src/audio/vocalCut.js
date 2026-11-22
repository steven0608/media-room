// Voice reducer for quick sing-along: most songs put the lead singer in the middle of the stereo
// image, so left − right cancels the voice (and anything else dead centre). The bass and kick
// live there too, so the lows of left + right are added back. On a mono recording left − right is
// silence, so the reducer listens for the first few seconds and steps aside if it finds no stereo.
//
//   source → [splitter] → L − R (above 150 Hz) ─┐
//                       → (L + R)/2 below 150 Hz ┴→ wet ─┐
//   source ──────────────────────────────────── dry ─────┴→ output
export function createVocalCut(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0;

  const split = ctx.createChannelSplitter(2);
  input.connect(split);
  const l = ctx.createGain(), r = ctx.createGain();
  r.gain.value = -1;
  split.connect(l, 0);
  split.connect(r, 1);
  const side = ctx.createGain();
  side.channelCount = 1;
  side.channelCountMode = 'explicit';
  l.connect(side); r.connect(side);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
  side.connect(hp);
  const mid = ctx.createGain(); mid.gain.value = 0.5;
  mid.channelCount = 1; mid.channelCountMode = 'explicit';
  const l2 = ctx.createGain(), r2 = ctx.createGain();
  split.connect(l2, 0); split.connect(r2, 1);
  l2.connect(mid); r2.connect(mid);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150;
  mid.connect(lp);
  hp.connect(wet); lp.connect(wet);
  wet.connect(output);
  input.connect(dry); dry.connect(output);

  // is there any stereo at all? compare the energy of L − R with the whole signal
  const aSide = ctx.createAnalyser(), aAll = ctx.createAnalyser();
  aSide.fftSize = aAll.fftSize = 2048;
  side.connect(aSide); input.connect(aAll);
  const buf = new Float32Array(2048);
  const rms = (a) => { a.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
  let want = false, sideE = 0, allE = 0, mono = false;

  const api = {
    input, output,
    get on() { return want && !mono; },
    get mono() { return mono; },
    set(on) {
      want = on;
      const k = on && !mono ? 1 : 0;
      wet.gain.setTargetAtTime(k, ctx.currentTime, 0.08);
      dry.gain.setTargetAtTime(1 - k, ctx.currentTime, 0.08);
    },
    /** Call while the song plays: after a few seconds of sound, decide whether it is stereo. */
    listen(playing) {
      if (!playing || mono || allE > 40) return;
      const a = rms(aAll);
      if (a < 0.01) return; // silence (intro) tells us nothing
      sideE += rms(aSide) / a;
      allE += 1;
      if (allE > 40 && sideE / allE < 0.04) { mono = true; api.set(want); }
    },
    reset() { sideE = 0; allE = 0; mono = false; api.set(want); },
  };
  return api;
}
