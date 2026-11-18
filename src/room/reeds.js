// Light reeds: a wide arc of glowing stems standing in the water in front of you.
// Each stem is one slice of the spectrum (bass on the outside edges, treble in the
// middle, mirrored), so the music becomes a living skyline. One instanced draw call.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createReeds(count = 120) {
  const half = count / 2;
  const geo = new THREE.PlaneGeometry(0.07, 1, 1, 1);
  geo.translate(0, 0.5, 0);
  const inst = new THREE.InstancedBufferGeometry().copy(geo);
  inst.instanceCount = count;
  const offsets = new Float32Array(count * 3);
  const angles = new Float32Array(count);
  const levels = new Float32Array(count);
  const seeds = new Float32Array(count);
  const arc = THREE.MathUtils.degToRad(150);
  for (let i = 0; i < count; i++) {
    const a = Math.PI + (i / (count - 1) - 0.5) * arc; // centred on −Z (in front)
    const r = 13 + Math.sin(i * 1.7) * 0.9 + Math.random() * 0.8;
    offsets.set([Math.sin(a) * r, CONFIG.waterY, Math.cos(a) * r], i * 3);
    angles[i] = a;
    seeds[i] = Math.random();
  }
  inst.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  inst.setAttribute('angle', new THREE.InstancedBufferAttribute(angles, 1));
  inst.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 1));
  const levelAttr = new THREE.InstancedBufferAttribute(levels, 1);
  levelAttr.setUsage(THREE.DynamicDrawUsage);
  inst.setAttribute('level', levelAttr);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 }, alpha: { value: 0 },
      accent: { value: new THREE.Color(CONFIG.palette.cyan) },
      accent2: { value: new THREE.Color(CONFIG.palette.magenta) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 offset; attribute float angle, level, seed;
      uniform float time;
      varying float vY, vLevel, vSeed;
      void main() {
        float h = 0.15 + level * 4.2;
        vec3 p = position;
        p.y *= h;
        p.x += sin(time * 0.8 + seed * 20.0) * 0.06 * position.y; // a gentle sway
        float c = cos(angle), s = sin(angle);
        vec3 w = vec3(p.x * c, p.y, -p.x * s) + offset;
        vY = position.y; vLevel = level; vSeed = seed;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float alpha; uniform vec3 accent, accent2;
      varying float vY, vLevel, vSeed;
      void main() {
        vec3 col = mix(accent, accent2, vY * 0.8 + vSeed * 0.2);
        col = mix(col, vec3(1.0), smoothstep(0.85, 1.0, vY) * 0.7);   // bright tip
        float a = (0.18 + 0.82 * vY) * (0.35 + vLevel) * alpha;
        a *= smoothstep(1.0, 0.92, vY) + smoothstep(0.9, 1.0, vY) * 0.6;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(inst, mat);
  mesh.frustumCulled = false;

  // Map stems → log-spaced frequency bins, mirrored around the centre.
  const binFor = [];
  for (let i = 0; i < count; i++) {
    const k = Math.abs(i - (half - 0.5)) / half; // 0 centre … 1 edges
    const f = 60 * Math.pow(9000 / 60, 1 - k);   // edges = bass, centre = treble
    binFor.push(f);
  }

  const peak = new Float32Array(count).fill(0.25);
  return {
    mesh,
    update(t, dt, s, engine) {
      mat.uniforms.time.value = t;
      mat.uniforms.alpha.value = s.glow * s.tide;
      mat.uniforms.accent.value.copy(s.accent);
      mesh.visible = mat.uniforms.alpha.value > 0.01;
      if (!mesh.visible) return;
      const freq = engine.freq;
      const hzPerBin = engine.ctx ? engine.ctx.sampleRate / engine.analyser.fftSize : 23.4;
      for (let i = 0; i < count; i++) {
        let v = 0;
        if (freq) {
          const b = Math.min(freq.length - 2, Math.round(binFor[i] / hzPerBin));
          v = (freq[b] + freq[b + 1]) / 510;
        }
        peak[i] = Math.max(v, peak[i] * Math.pow(0.7, dt), 0.2);
        const target = Math.pow(v / peak[i], 2.4);
        levels[i] += (target - levels[i]) * Math.min(1, dt * (target > levels[i] ? 20 : 4));
      }
      levelAttr.needsUpdate = true;
    },
  };
}
