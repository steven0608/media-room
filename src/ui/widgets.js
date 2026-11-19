// Springy 3D buttons and glass panels. Every button swells and lifts when pointed at,
// squashes when pressed and overshoots back — the "direct manipulation" feel.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture, font, ellipsize } from './text.js';

/** Critically-damped-ish spring. */
export class Spring {
  constructor(value = 0, stiffness = 380, damping = 22) {
    this.value = value; this.target = value; this.vel = 0; this.k = stiffness; this.d = damping;
  }
  step(dt) {
    dt = Math.min(dt, 1 / 30);
    const a = (this.target - this.value) * this.k - this.vel * this.d;
    this.vel += a * dt;
    this.value += this.vel * dt;
    return this.value;
  }
}

const animated = new Set();
export function updateWidgets(dt, t) {
  for (const w of animated) w.update(dt, t);
}

// ---- icons (drawn with canvas paths so they stay crisp)
const ICONS = {
  play: (c, s) => { c.beginPath(); c.moveTo(s * 0.36, s * 0.26); c.lineTo(s * 0.76, s * 0.5); c.lineTo(s * 0.36, s * 0.74); c.closePath(); c.fill(); },
  pause: (c, s) => { c.fillRect(s * 0.32, s * 0.27, s * 0.12, s * 0.46); c.fillRect(s * 0.56, s * 0.27, s * 0.12, s * 0.46); },
  next: (c, s) => { c.beginPath(); c.moveTo(s * 0.3, s * 0.28); c.lineTo(s * 0.6, s * 0.5); c.lineTo(s * 0.3, s * 0.72); c.fill(); c.fillRect(s * 0.62, s * 0.28, s * 0.08, s * 0.44); },
  prev: (c, s) => { c.beginPath(); c.moveTo(s * 0.7, s * 0.28); c.lineTo(s * 0.4, s * 0.5); c.lineTo(s * 0.7, s * 0.72); c.fill(); c.fillRect(s * 0.3, s * 0.28, s * 0.08, s * 0.44); },
  plus: (c, s) => { c.fillRect(s * 0.28, s * 0.46, s * 0.44, s * 0.08); c.fillRect(s * 0.46, s * 0.28, s * 0.08, s * 0.44); },
  minus: (c, s) => { c.fillRect(s * 0.28, s * 0.46, s * 0.44, s * 0.08); },
  library: (c, s) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { c.beginPath(); c.roundRect(s * (0.26 + i * 0.17), s * (0.26 + j * 0.17), s * 0.13, s * 0.13, s * 0.03); c.fill(); } },
  music: (c, s) => { c.beginPath(); c.ellipse(s * 0.38, s * 0.68, s * 0.1, s * 0.08, -0.4, 0, 7); c.fill(); c.beginPath(); c.ellipse(s * 0.66, s * 0.6, s * 0.1, s * 0.08, -0.4, 0, 7); c.fill(); c.fillRect(s * 0.45, s * 0.26, s * 0.05, s * 0.42); c.fillRect(s * 0.73, s * 0.2, s * 0.05, s * 0.42); c.beginPath(); c.moveTo(s * 0.45, s * 0.26); c.lineTo(s * 0.78, s * 0.18); c.lineTo(s * 0.78, s * 0.28); c.lineTo(s * 0.45, s * 0.36); c.fill(); },
  cinema: (c, s) => { c.beginPath(); c.roundRect(s * 0.2, s * 0.3, s * 0.6, s * 0.4, s * 0.06); c.fill(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.moveTo(s * 0.44, s * 0.4); c.lineTo(s * 0.6, s * 0.5); c.lineTo(s * 0.44, s * 0.6); c.fill(); c.globalCompositeOperation = 'source-over'; },
  karaoke: (c, s) => { c.beginPath(); c.arc(s * 0.6, s * 0.36, s * 0.14, 0, 7); c.fill(); c.lineWidth = s * 0.07; c.lineCap = 'round'; c.beginPath(); c.moveTo(s * 0.5, s * 0.47); c.lineTo(s * 0.28, s * 0.74); c.stroke(); },
  back: (c, s) => { c.lineWidth = s * 0.08; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(s * 0.58, s * 0.28); c.lineTo(s * 0.36, s * 0.5); c.lineTo(s * 0.58, s * 0.72); c.stroke(); },
  close: (c, s) => { c.lineWidth = s * 0.08; c.lineCap = 'round'; c.beginPath(); c.moveTo(s * 0.32, s * 0.32); c.lineTo(s * 0.68, s * 0.68); c.moveTo(s * 0.68, s * 0.32); c.lineTo(s * 0.32, s * 0.68); c.stroke(); },
  rewind: (c, s) => { c.beginPath(); c.moveTo(s * 0.5, s * 0.3); c.lineTo(s * 0.25, s * 0.5); c.lineTo(s * 0.5, s * 0.7); c.fill(); c.beginPath(); c.moveTo(s * 0.75, s * 0.3); c.lineTo(s * 0.5, s * 0.5); c.lineTo(s * 0.75, s * 0.7); c.fill(); },
  forward: (c, s) => { c.beginPath(); c.moveTo(s * 0.5, s * 0.3); c.lineTo(s * 0.75, s * 0.5); c.lineTo(s * 0.5, s * 0.7); c.fill(); c.beginPath(); c.moveTo(s * 0.25, s * 0.3); c.lineTo(s * 0.5, s * 0.5); c.lineTo(s * 0.25, s * 0.7); c.fill(); },
  subs: (c, s) => { c.lineWidth = s * 0.06; c.beginPath(); c.roundRect(s * 0.2, s * 0.3, s * 0.6, s * 0.4, s * 0.06); c.stroke(); c.fillRect(s * 0.3, s * 0.52, s * 0.18, s * 0.06); c.fillRect(s * 0.52, s * 0.52, s * 0.18, s * 0.06); },
  stop: (c, s) => { c.beginPath(); c.roundRect(s * 0.3, s * 0.3, s * 0.4, s * 0.4, s * 0.05); c.fill(); },
};

/**
 * A rounded 3D button. Returns a Group with .setActive(bool), .setIcon(name), .setLabel(text).
 * size in metres. Registers itself with the pointer system.
 */
export function makeButton(pointer, sfx, { w = 0.07, h = 0.07, icon, label, accent = 0x5ce1e6, onClick, depth = 0.018 }) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, depth, 4, Math.min(w, h) * 0.28),
    new THREE.MeshBasicMaterial({ color: 0x141a36, transparent: true, opacity: 0.92 }),
  );
  const px = 256;
  const aspect = w / h;
  const { canvas, ctx, tex } = canvasTexture(Math.round(px * aspect), px);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, h * 0.96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  face.position.z = depth / 2 + 0.0008;
  const glowMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new RoundedBoxGeometry(w * 1.12, h * 1.12, depth * 0.5, 4, Math.min(w, h) * 0.32), glowMat);
  glow.position.z = -depth * 0.3;
  const inner = new THREE.Group();
  inner.add(glow, body, face);
  group.add(inner);

  const state = { icon, label, active: false, hover: false, accent: new THREE.Color(accent) };
  const scale = new Spring(1, 420, 18);
  const lift = new Spring(0, 300, 20);
  const glowS = new Spring(0, 200, 20);

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const col = state.active ? `#${state.accent.getHexString()}` : '#e8ecff';
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    if (state.icon && ICONS[state.icon]) {
      ctx.save();
      const s = state.label ? H * 0.78 : H;
      ctx.translate(state.label ? H * 0.12 : (W - s) / 2, state.label ? H * 0.11 : (H - s) / 2);
      ICONS[state.icon](ctx, s);
      ctx.restore();
    }
    if (state.label) {
      ctx.font = font(Math.round(H * 0.3), 600);
      ctx.textBaseline = 'middle';
      ctx.textAlign = state.icon ? 'left' : 'center';
      const x = state.icon ? H * 0.88 : W / 2;
      ctx.fillText(ellipsize(ctx, state.label, state.icon ? W - x - H * 0.1 : W - H * 0.2), x, H / 2);
    }
    if (state.active) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(W * 0.3, H * 0.86, W * 0.4, H * 0.04, H * 0.02);
      ctx.fill();
    }
    tex.needsUpdate = true;
  }
  draw();

  pointer.add(body, {
    onEnter: () => { state.hover = true; scale.target = 1.1; lift.target = 0.012; glowS.target = 0.55; sfx.hover(); },
    onLeave: () => { state.hover = false; scale.target = 1; lift.target = 0; glowS.target = state.active ? 0.25 : 0; },
    onDown: () => { scale.target = 0.88; scale.vel -= 2; lift.target = -0.004; },
    onUp: (hit) => {
      scale.target = state.hover ? 1.1 : 1;
      lift.target = state.hover ? 0.012 : 0;
      scale.vel += 4; // overshoot
      if (hit) { sfx.select(); onClick?.(); }
    },
  });

  const api = {
    group,
    body,
    update(dt) {
      const s = scale.step(dt);
      inner.scale.set(s, s, 1 + (s - 1) * 0.5);
      inner.position.z = lift.step(dt);
      glowMat.opacity = Math.max(0, glowS.step(dt));
      body.material.color.setHex(state.hover ? 0x1e2750 : 0x141a36);
    },
    setActive(v) { if (state.active !== v) { state.active = v; glowS.target = v ? 0.25 : 0; draw(); } },
    setIcon(i) { if (state.icon !== i) { state.icon = i; draw(); } },
    setLabel(l) { if (state.label !== l) { state.label = l; draw(); } },
    setAccent(c) { state.accent.set(c); glowMat.color.set(c); draw(); },
  };
  animated.add(api);
  return api;
}

/** A dark glass plate with rounded corners (background for groups of buttons). */
export function makePlate(w, h, r = 0.03) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), new THREE.MeshBasicMaterial({ color: 0x0b1026, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide })); // two-sided: tidy from behind too
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(shape.getPoints(24).map((p) => new THREE.Vector3(p.x, p.y, 0.001))),
    new THREE.LineBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.18 }),
  );
  m.add(edge);
  return m;
}
