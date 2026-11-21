// Move things where you like: the screen, the library and the console each have a small glowing
// grab bar. Point at it, hold the trigger and drag — the thing swings around you with your hand.
// While holding the screen's bar, push the thumbstick forward/back to make the screen bigger or
// smaller. Your layout is remembered on this headset; double-click a bar to put that thing back.
import * as THREE from 'three';
import { store } from '../api.js';

const tmp = new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const yawOf = (d) => Math.atan2(d.x, -d.z);
const pitchOf = (d) => Math.asin(clamp(d.y, -1, 1));

/** A slim rounded bar plus a larger invisible grab area around it. */
function makeHandle(w, h, accent) {
  const r = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -r);
  shape.lineTo(w / 2 - r, -r); shape.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  shape.lineTo(-w / 2 + r, r); shape.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5);
  const mat = new THREE.MeshBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.32, depthWrite: false });
  const bar = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), mat);
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, h * 4), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.add(bar);
  bar.position.z = 0.001;
  return { hit, mat, accent: new THREE.Color(accent), glow: 0, target: 0.32 };
}

/**
 * targets: { [name]: { parent, at: Vector3, size: [w, h], read() → state, apply(state), defaults() → state,
 *                     drag(start, dyaw, dpitch) → state, stick?(state, y, dt) → state, enabled?() } }
 */
export function createLayout({ pointer, sfx, targets, accent = 0x5ce1e6 }) {
  const saved = store.get('layout', {}) || {};
  const handles = {};
  let drag = null;
  const lastDown = {};

  for (const [name, tg] of Object.entries(targets)) {
    const h = makeHandle(tg.size[0], tg.size[1], accent);
    h.hit.position.copy(tg.at);
    tg.parent.add(h.hit);
    handles[name] = h;
    pointer.add(h.hit, {
      onEnter: () => { h.target = 0.95; sfx.hover(); },
      onLeave: () => { if (drag?.name !== name) h.target = 0.32; },
      onDown: (hit, p) => {
        const now = performance.now();
        if (now - (lastDown[name] || 0) < 400) { // double-click: back to where it started
          tg.apply(tg.defaults());
          delete saved[name];
          store.set('layout', saved);
          sfx.back();
          drag = null;
          return;
        }
        lastDown[name] = now;
        const d = p.ray.ray.direction;
        drag = { name, p, yaw0: yawOf(d), pitch0: pitchOf(d), start: tg.read() };
        sfx.select();
      },
      onUp: () => end(),
    });
  }

  function end() {
    if (!drag) return;
    const tg = targets[drag.name];
    saved[drag.name] = tg.read();
    store.set('layout', saved);
    handles[drag.name].target = 0.32;
    drag = null;
  }

  return {
    get dragging() { return !!drag; },
    /** Put back whatever was saved for these targets (call after their defaults are set). */
    restore(...names) {
      for (const n of names) if (saved[n]) targets[n].apply(saved[n]);
    },
    /** Thumbstick while dragging (the screen: bigger/smaller). Returns true if it was used. */
    stick(y, dt) {
      if (!drag || !targets[drag.name].stick) return false;
      const tg = targets[drag.name];
      tg.apply(tg.stick(tg.read(), y, dt));
      return true;
    },
    update(dt) {
      for (const [name, h] of Object.entries(handles)) {
        const tg = targets[name];
        h.hit.visible = tg.enabled ? tg.enabled() : true;
        const want = drag?.name === name ? 1 : h.target;
        h.glow += (want - h.glow) * Math.min(1, dt * 12);
        h.mat.opacity = h.glow;
        h.mat.color.setHex(0xcfd8ff).lerp(h.accent, drag?.name === name ? 1 : Math.max(0, h.glow - 0.32));
        h.hit.scale.setScalar(1 + (drag?.name === name ? 0.15 : 0));
      }
      if (!drag) return;
      if (drag.p.pressed?.object !== handles[drag.name].hit) return end(); // let go elsewhere
      const d = tmp.copy(drag.p.ray.ray.direction);
      const tg = targets[drag.name];
      let dyaw = yawOf(d) - drag.yaw0;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); // no jump when you sweep past behind you
      tg.apply(tg.drag(drag.start, dyaw, pitchOf(d) - drag.pitch0));
    },
  };
}
