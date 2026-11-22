// One room, many moods. Every visual knob of the scene lives in `state`, and each mode
// is a preset of those knobs. Switching mode tweens from the current values to the
// preset — so music, cinema and karaoke feel like the same place changing its lighting,
// not three different apps.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const P = CONFIG.palette;

export const PRESETS = {
  idle: {
    sky: 1.0, stars: 1.0, moon: 1.0, tide: 0.3, glow: 0.3, motes: 1.0, deck: 1.0,
    screen: 0.55, screenGlass: 0.85, stage: 0, cones: 0, accent: P.amber, ambience: 1, lanterns: 1, aurora: 0.5, ring: 0.35, life: 1,
  },
  music: {
    sky: 1.0, stars: 1.0, moon: 1.0, tide: 1.0, glow: 1.0, motes: 1.0, deck: 0.9,
    screen: 0.7, screenGlass: 0.9, stage: 0, cones: 0, accent: P.cyan, ambience: 0.35, lanterns: 0.75, aurora: 1, ring: 1, life: 1,
  },
  cinema: {
    sky: 0.35, stars: 0.12, moon: 0.25, tide: 0.0, glow: 0.0, motes: 0.0, deck: 0.18,
    screen: 1.0, screenGlass: 1.0, stage: 0, cones: 0, accent: P.amber, ambience: 0, lanterns: 0.12, aurora: 0, ring: 0, life: 0.25,
  },
  karaoke: {
    sky: 0.7, stars: 0.8, moon: 0.6, tide: 0.55, glow: 0.7, motes: 1.0, deck: 0.7,
    screen: 1.0, screenGlass: 1.0, stage: 1, cones: 1, accent: P.magenta, ambience: 0, lanterns: 0.45, aurora: 0.5, ring: 0.8, life: 0.8,
  },
};

// How long each transition takes (the cinema dim is deliberately slow, like a theatre).
const DURATION = { idle: 1.5, music: 1.5, cinema: 2.5, karaoke: 1.8 };

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class RoomState {
  constructor() {
    this.mode = 'idle';
    this.state = this._clone(PRESETS.idle);
    this._from = null;
    this._to = null;
    this._t = 1;
    this._dur = 1;
    this.listeners = [];
  }

  _clone(p) {
    const s = { ...p };
    s.accent = new THREE.Color(p.accent);
    return s;
  }

  setMode(mode) {
    if (!PRESETS[mode] || mode === this.mode) return;
    this.mode = mode;
    this._from = { ...this.state, accent: this.state.accent.clone() };
    this._to = this._clone(PRESETS[mode]);
    this._t = 0;
    this._dur = DURATION[mode];
    for (const fn of this.listeners) fn(mode);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  update(dt) {
    if (this._t >= 1) return;
    this._t = Math.min(1, this._t + dt / this._dur);
    const k = ease(this._t);
    for (const key of Object.keys(this._to)) {
      if (key === 'accent') this.state.accent.copy(this._from.accent).lerp(this._to.accent, k);
      else this.state[key] = this._from[key] + (this._to[key] - this._from[key]) * k;
    }
  }
}
