// Night sky: a gradient dome, ~3000 twinkling stars in one draw call, a moon with a
// soft halo, and a ring of dark hills so the horizon has a shape. No textures needed.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const P = CONFIG.palette;
export const MOON_DIR = new THREE.Vector3(-0.42, 0.36, -0.83).normalize();

export function createSky(room) {
  const group = new THREE.Group();

  // --- dome
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(P.skyTop) },
      horizon: { value: new THREE.Color(P.skyHorizon) },
      moonDir: { value: MOON_DIR },
      bright: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, moonDir;
      uniform float bright;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
        c *= smoothstep(-0.25, 0.02, h);                        // dark below the horizon
        float m = max(dot(vDir, moonDir), 0.0);
        c += vec3(0.55, 0.6, 0.85) * (pow(m, 60.0) * 0.35 + pow(m, 8.0) * 0.05); // moon glow in the air
        gl_FragColor = vec4(c * bright, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), domeMat);
  dome.renderOrder = -10;
  group.add(dome);

  // --- stars
  const N = 3000;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 * Math.PI;
    const y = Math.pow(Math.random(), 0.7) * 0.97 + 0.03; // more stars higher up
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(u) * r * 350, y * 350, Math.sin(u) * r * 350], i * 3);
    seed[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, alpha: { value: 1 }, pxScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float time, pxScale;
      varying float vA;
      void main() {
        vA = (0.35 + 0.65 * seed) * (0.75 + 0.25 * sin(time * (0.6 + seed * 2.2) + seed * 40.0));
        gl_PointSize = (1.2 + seed * seed * 2.6) * pxScale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float alpha;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * alpha;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  // --- moon + halo (two additive sprites)
  const moonTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.42, 'rgba(240,244,255,1)'], [0.5, 'rgba(220,228,255,0.6)'], [0.56, 'rgba(200,210,255,0)']]);
  const haloTex = radialTexture([[0, 'rgba(200,210,255,0.55)'], [0.25, 'rgba(160,175,255,0.18)'], [1, 'rgba(120,140,255,0)']]);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, color: P.moon, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  moon.position.copy(MOON_DIR).multiplyScalar(300);
  moon.scale.setScalar(16);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.position.copy(moon.position);
  halo.scale.setScalar(110);
  group.add(halo, moon);

  // --- distant hills: one ring mesh, silhouette against the horizon glow
  const SEG = 256;
  const hillPos = [];
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const n = Math.sin(a * 3.1) * 0.5 + Math.sin(a * 7.3 + 1.7) * 0.3 + Math.sin(a * 17.9 + 4.1) * 0.12 + Math.sin(a * 41.0) * 0.05;
    const front = Math.max(0, Math.cos(a + Math.PI / 2)); // keep the hills low behind the screen (−Z)
    const h = (9 + n * 9) * (1 - 0.75 * Math.pow(front, 3));
    const r = 190;
    hillPos.push(Math.cos(a) * r, CONFIG.waterY - 0.5, Math.sin(a) * r, Math.cos(a) * r, CONFIG.waterY + h, Math.sin(a) * r);
    if (i < SEG) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const hillGeo = new THREE.BufferGeometry();
  hillGeo.setAttribute('position', new THREE.Float32BufferAttribute(hillPos, 3));
  hillGeo.setIndex(idx);
  const hills = new THREE.Mesh(hillGeo, new THREE.MeshBasicMaterial({ color: 0x03050c, side: THREE.DoubleSide, fog: false }));
  group.add(hills);

  return {
    group,
    update(t, s, pxScale) {
      domeMat.uniforms.bright.value = s.sky;
      starMat.uniforms.time.value = t;
      starMat.uniforms.alpha.value = s.stars;
      starMat.uniforms.pxScale.value = pxScale;
      moon.material.opacity = s.moon;
      halo.material.opacity = s.moon * 0.9;
      void room;
    },
  };
}

export function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
