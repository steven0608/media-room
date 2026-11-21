// The sound ring: the live sound wave drawn as a ribbon of light floating on the water all
// around you. Quiet music → a gently breathing circle; loud music → a jagged, glowing wave.
// It sits low enough never to cover the screen. One ribbon mesh; the wave comes from a
// 256-point texture, mirrored so the circle closes without a seam.
//
// The equalizer: 48 glowing bars standing on the water under the screen, mirrored so the
// bass is in the middle. One instanced draw call; heights come from the spectrum texture.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createSoundRing(spectrum) {
  const R = 4.4, SEG = 384, H = 0.6;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    for (const v of [0, 1]) { pos.push(Math.cos(a) * R, 0, Math.sin(a) * R); uv.push(i / SEG, v); }
    if (i < SEG) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);

  const uniforms = {
    time: { value: 0 }, strength: { value: 0 }, amp: { value: 0 }, pulse: { value: 0 },
    wave: { value: spectrum.waveTex },
    accent: { value: new THREE.Color() },
    baseY: { value: CONFIG.waterY + 0.22 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float time, amp, baseY, pulse;
      uniform sampler2D wave;
      varying vec2 vUv;
      varying float vY;
      void main() {
        vUv = uv;
        float u = abs(fract(uv.x * 2.0) * 2.0 - 1.0); // mirrored twice round the circle: no seam
        float w = texture2D(wave, vec2(u, 0.5)).r * 2.0 - 1.0;
        float breathe = 0.03 * sin(uv.x * 6.2831 * 3.0 + time * 0.8);
        float y = baseY + breathe + w * amp * (1.0 + pulse * 0.6);
        vY = w;
        vec3 p = position;
        p.y = y + (uv.y - 0.5) * ${H.toFixed(2)};
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float strength, pulse;
      uniform vec3 accent;
      varying vec2 vUv;
      varying float vY;
      void main() {
        float d = abs(vUv.y - 0.5) * 2.0;           // 0 at the line, 1 at the ribbon's edge
        float core = smoothstep(0.08, 0.0, d);
        float glow = exp(-d * 5.0) * 0.45;
        vec3 col = mix(accent, vec3(1.0), core * 0.7 + abs(vY) * 0.5);
        float a = (core + glow) * strength * (0.7 + pulse * 0.6);
        gl_FragColor = vec4(col * a, 1.0);
      }`,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.frustumCulled = false;

  // ---- equalizer bars under the screen
  const { radius, arcDegrees } = CONFIG.screen;
  const N = 48;
  const arc = THREE.MathUtils.degToRad(arcDegrees) * 0.92;
  const barGeo = new THREE.BoxGeometry(radius * arc / N * 0.62, 1, 0.05);
  barGeo.translate(0, 0.5, 0);
  const bars = new THREE.InstancedMesh(barGeo, null, N);
  const index = new Float32Array(N);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const a = -arc / 2 + (i + 0.5) * (arc / N);
    const r = radius - 0.45;
    m4.makeRotationY(-a).setPosition(Math.sin(a) * r, CONFIG.waterY, -Math.cos(a) * r);
    bars.setMatrixAt(i, m4);
    index[i] = (i + 0.5) / N;
  }
  bars.geometry.setAttribute('barIndex', new THREE.InstancedBufferAttribute(index, 1));
  const barUniforms = { spec: { value: spectrum.specTex }, strength: { value: 0 }, accent: { value: new THREE.Color() }, pulse: { value: 0 } };
  bars.material = new THREE.ShaderMaterial({
    uniforms: barUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float barIndex;
      uniform sampler2D spec;
      uniform float pulse;
      varying float vH, vLevel;
      void main() {
        float m = abs(barIndex - 0.5) * 2.0;
        float lvl = texture2D(spec, vec2(0.03 + m * 0.85, 0.5)).r;
        vLevel = lvl;
        vec3 p = position;
        vH = p.y;
        p.y *= 0.015 + lvl * 0.26 * (1.0 + pulse * 0.3); // tallest bar stays just under the picture
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float strength; uniform vec3 accent;
      varying float vH, vLevel;
      void main() {
        vec3 col = mix(accent, vec3(1.0), smoothstep(0.6, 1.0, vH) * 0.8);
        float a = strength * (0.35 + vLevel * 0.9) * (0.4 + 0.6 * vH);
        gl_FragColor = vec4(col * a, 1.0);
      }`,
  });
  bars.frustumCulled = false;

  const group = new THREE.Group();
  group.add(ring, bars);
  return {
    group,
    /** The equalizer stays under the screen when you move it. */
    setYaw(yaw) { bars.rotation.y = yaw; },
    update(t, s, playing) {
      const k = s.ring ?? 0;
      uniforms.time.value = t;
      uniforms.strength.value = k;
      uniforms.amp.value += ((playing ? 0.32 : 0.0) - uniforms.amp.value) * 0.05;
      uniforms.pulse.value = spectrum.pulse;
      uniforms.accent.value.copy(s.accent);
      barUniforms.strength.value = k * (playing ? 1 : 0.4);
      barUniforms.accent.value.copy(s.accent);
      barUniforms.pulse.value = spectrum.pulse;
      ring.visible = k > 0.01;
      bars.visible = k > 0.01;
    },
  };
}
