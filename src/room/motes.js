// Fireflies drifting over the water. They brighten with the treble in music mode and
// fade out completely for cinema. Instanced as one Points draw call.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createMotes(count = 360) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 3.4 + Math.pow(Math.random(), 0.8) * 26;
    pos.set([Math.cos(a) * r, CONFIG.waterY + 0.15 + Math.random() * 2.6, Math.sin(a) * r], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: { value: 0 }, alpha: { value: 1 }, energy: { value: 0 },
      color: { value: new THREE.Color(CONFIG.palette.amber) }, pxScale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float time, energy, pxScale;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = time * (0.15 + seed * 0.2);
        p.x += sin(t * 2.0 + seed * 30.0) * 0.8;
        p.z += cos(t * 1.7 + seed * 50.0) * 0.8;
        p.y += sin(t * 3.0 + seed * 10.0) * 0.35;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float blink = 0.5 + 0.5 * sin(time * (0.8 + seed * 1.5) + seed * 60.0);
        vA = blink * (0.55 + energy * 0.9);
        gl_PointSize = (7.0 + seed * 9.0) * (1.0 + energy * 0.6) * pxScale / max(-mv.z, 0.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float alpha; uniform vec3 color;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (smoothstep(0.5, 0.0, d) * 0.6 + smoothstep(0.12, 0.0, d)) * vA * alpha;
        gl_FragColor = vec4(mix(color, vec3(1.0), smoothstep(0.1, 0.0, d)) * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points,
    update(t, s, bands, pxScale) {
      mat.uniforms.time.value = t;
      mat.uniforms.alpha.value = s.motes;
      mat.uniforms.energy.value = bands.treble * s.glow;
      mat.uniforms.color.value.setHex(CONFIG.palette.amber).lerp(s.accent, 0.35);
      mat.uniforms.pxScale.value = pxScale;
      points.visible = s.motes > 0.01;
    },
  };
}
