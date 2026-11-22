// Your hands, when you put the controllers down (Quest hand tracking).
//   • You see them: a glowing dot for every joint, brighter fingertips.
//   • Pinch (thumb + index) = select along the hand's ray, like the trigger. (pointer.js)
//   • Touch a button with your index fingertip to press it, like a real button. (poke pointer)
//   • Turn a palm towards your face and hold it for a moment: the console and the library come
//     to where you are looking (what Y does on a controller). A ring fills on the palm as you hold.
// The first time hands appear in a session, a short hint floats above the left hand.
import * as THREE from 'three';
import { canvasTexture, font } from './text.js';
import { t } from '../i18n.js';

const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
const TIP = new Set(JOINTS.filter((j) => j.endsWith('-tip')).map((j) => JOINTS.indexOf(j)));
const PALM_HOLD = 0.7; // seconds
// bones: each finger is a chain from the wrist to its tip
const BONES = [];
for (const f of ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
  const chain = ['wrist', ...JOINTS.filter((j) => j.startsWith(f + '-'))];
  for (let k = 0; k < chain.length - 1; k++) BONES.push(JOINTS.indexOf(chain[k]), JOINTS.indexOf(chain[k + 1]));
}
for (const [a, b] of [['index-finger-metacarpal', 'middle-finger-metacarpal'], ['middle-finger-metacarpal', 'ring-finger-metacarpal'], ['ring-finger-metacarpal', 'pinky-finger-metacarpal']]) BONES.push(JOINTS.indexOf(a), JOINTS.indexOf(b));

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), head = new THREE.Vector3();
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();

export function createHands({ renderer, rig, pointer, sfx, onPalm }) {
  const N = JOINTS.length;
  const dotGeo = new THREE.SphereGeometry(1, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const hands = [];

  for (let i = 0; i < 2; i++) {
    const space = renderer.xr.getHand(i);
    rig.add(space);
    const dots = new THREE.InstancedMesh(dotGeo, dotMat, N);
    dots.frustumCulled = false;
    dots.visible = false;
    const col = new THREE.Color();
    for (let j = 0; j < N; j++) dots.setColorAt(j, col.setHex(TIP.has(j) ? 0x8ff3f6 : 0x6f7fc8));
    rig.add(dots);
    const bonePos = new Float32Array(BONES.length * 3);
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute('position', new THREE.BufferAttribute(bonePos, 3));
    const bones = new THREE.LineSegments(boneGeo, new THREE.LineBasicMaterial({ color: 0x7f90e0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    bones.frustumCulled = false;
    bones.visible = false;
    rig.add(bones);
    const world = new Float32Array(N * 3);

    // palm ring: fills while you hold your palm towards your face
    const ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { progress: { value: 0 }, alpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float progress, alpha; varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p) * 2.0;
          float a = fract(atan(p.x, p.y) / 6.28318 + 1.0);
          float band = smoothstep(0.70, 0.76, r) * smoothstep(1.0, 0.92, r);
          float fill = step(a, progress);
          vec3 c = mix(vec3(0.43, 0.5, 0.8), vec3(0.55, 0.95, 0.96), fill);
          gl_FragColor = vec4(c * band * alpha * (0.35 + 0.65 * fill), 1.0);
        }`,
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), ringMat);
    ring.visible = false;
    rig.add(ring);

    const h = { space, dots, bones, bonePos, world, ring, ringMat, handedness: null, active: false, poke: null, hold: 0, fired: false };
    space.addEventListener('connected', (e) => {
      if (!e.data.hand) return;
      h.handedness = e.data.handedness;
      h.active = true;
      h.poke = h.poke && h.poke.handedness === h.handedness ? h.poke : pointer.addPoke(h.handedness);
      showHint();
    });
    space.addEventListener('disconnected', () => {
      h.active = false;
      dots.visible = bones.visible = ring.visible = false;
      if (h.poke) h.poke.active = false;
    });
    hands.push(h);
  }

  // ---- the one-time hint above the left hand
  const hint = canvasTexture(768, 150);
  const hintMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26 * 150 / 768), new THREE.MeshBasicMaterial({ map: hint.tex, transparent: true, depthWrite: false }));
  hintMesh.visible = false;
  rig.add(hintMesh);
  let hintLeft = 0, hintShown = false;
  function showHint() {
    if (hintShown) return;
    hintShown = true;
    hintLeft = 9;
    const c = hint.ctx;
    c.clearRect(0, 0, 768, 150);
    c.fillStyle = 'rgba(14,18,40,0.82)';
    c.beginPath(); c.roundRect(4, 4, 760, 142, 40); c.fill();
    c.fillStyle = '#e8ecff';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = font(34, 600); c.fillText(t('hands.hint1'), 384, 52);
    c.fillStyle = '#9aa3c7';
    c.font = font(28, 500); c.fillText(t('hands.hint2'), 384, 102);
    hint.tex.needsUpdate = true;
  }

  const joint = (h, name) => h.space.joints?.[name];
  /** Put a rig child at a world position, facing your head. */
  function placeAt(obj, world) {
    obj.position.copy(rig.worldToLocal(world.clone()));
    obj.lookAt(head);
  }
  const wp = (o, out) => o.getWorldPosition(out);

  return {
    update(dt, camera) {
      camera.getWorldPosition(head);
      let anyLeft = null;
      for (const h of hands) {
        const tip = joint(h, 'index-finger-tip');
        const ok = h.active && tip && tip.visible !== false && joint(h, 'wrist');
        h.dots.visible = h.bones.visible = !!ok;
        if (!ok) { h.ring.visible = false; if (h.poke) h.poke.active = false; continue; }

        // dots
        for (let j = 0; j < N; j++) {
          const jt = joint(h, JOINTS[j]);
          if (!jt) { m4.makeScale(0, 0, 0); h.dots.setMatrixAt(j, m4); continue; }
          jt.getWorldPosition(v1);
          v1.toArray(h.world, j * 3);
          const r = (jt.jointRadius || 0.008) * (TIP.has(j) ? 0.9 : 0.55);
          m4.compose(v1, q.identity(), v3.set(r, r, r));
          h.dots.setMatrixAt(j, m4);
        }
        h.dots.instanceMatrix.needsUpdate = true;
        for (let k = 0; k < BONES.length; k++) h.bonePos.set(h.world.subarray(BONES[k] * 3, BONES[k] * 3 + 3), k * 3);
        h.bones.geometry.attributes.position.needsUpdate = true;
        h.bones.matrixAutoUpdate = false;
        h.bones.matrix.copy(rig.matrixWorld).invert();
        h.bones.matrixWorldNeedsUpdate = true;
        // keep the dots in world space: the InstancedMesh is a child of the rig, so undo it
        h.dots.matrixAutoUpdate = false;
        h.dots.matrix.copy(rig.matrixWorld).invert();
        h.dots.matrixWorldNeedsUpdate = true;

        // poke pointer along the index finger
        const distal = joint(h, 'index-finger-phalanx-distal');
        wp(tip, h.poke.origin);
        if (distal) h.poke.dir.copy(h.poke.origin).sub(wp(distal, v2)).normalize();
        h.poke.active = true;
        const ray = pointer.rayOf(h.handedness);
        if (ray) ray.quiet = !!(h.poke.hovered || h.poke.pressed);

        // palm towards your face?
        const wrist = wp(joint(h, 'wrist'), v1);
        const iMeta = joint(h, 'index-finger-metacarpal'), pMeta = joint(h, 'pinky-finger-metacarpal'), mTip = joint(h, 'middle-finger-tip');
        let facing = false;
        if (iMeta && pMeta && mTip) {
          const a = wp(iMeta, v2).sub(wrist);
          const b = wp(pMeta, v3).sub(wrist);
          const n = h.handedness === 'left' ? b.clone().cross(a) : a.clone().cross(b); // out of the palm (checked in the emulator)
          n.normalize();
          const centre = a.add(b).multiplyScalar(0.5).add(wrist); // between the knuckles
          const toHead = head.clone().sub(centre).normalize();
          const open = wp(mTip, new THREE.Vector3()).distanceTo(wrist) > 0.12;
          facing = open && n.dot(toHead) > 0.8 && !h.poke.pressed;
          // ring floats just off the palm, facing you
          placeAt(h.ring, centre.clone().addScaledVector(n, 0.035));
          if (h.handedness === 'left') anyLeft = centre.clone();
        }
        if (facing && !h.fired) {
          h.hold += dt;
          if (h.hold >= PALM_HOLD) { h.fired = true; sfx.select(); onPalm?.(h.handedness); }
        } else if (!facing) { h.hold = Math.max(0, h.hold - dt * 3); if (h.hold === 0) h.fired = false; }
        const show = h.hold > 0.08 && !h.fired;
        h.ring.visible = show || h.ringMat.uniforms.alpha.value > 0.02;
        h.ringMat.uniforms.alpha.value += ((show ? 1 : 0) - h.ringMat.uniforms.alpha.value) * Math.min(1, dt * 10);
        h.ringMat.uniforms.progress.value = Math.min(1, h.hold / PALM_HOLD);
      }

      // hint
      if (hintLeft > 0) {
        hintLeft -= dt;
        const left = hands.find((h) => h.active && h.handedness === 'left' && h.dots.visible);
        const anchor = anyLeft || (left ? wp(joint(left, 'wrist'), v1) : null);
        hintMesh.visible = !!anchor;
        if (anchor) {
          placeAt(hintMesh, v2.copy(anchor).setY(anchor.y + 0.21));
          hintMesh.material.opacity = Math.min(1, hintLeft);
        }
      } else hintMesh.visible = false;
    },
    reset() { hintShown = false; },
  };
}
