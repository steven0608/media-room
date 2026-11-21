// "Tide" — the lake surface is the music visualizer.
//   bass   → slow swells rolling out from the deck
//   beats  → a bright ring ripple travels across the water
//   mids   → colour drift on the crests
//   treble → sparkles on the crests
// One mesh, one draw call; all the motion happens in the vertex shader on the GPU.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MOON_DIR } from './sky.js';

const P = CONFIG.palette;
const MAX_RIPPLES = 6;
const MAX_TOUCH = 5;   // ripples you make by pointing at the water
const EQ_HALF = THREE.MathUtils.degToRad(CONFIG.screen.arcDegrees) * 0.92 / 2;

function polarDisk(inner, outer, rings, segments) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= rings; i++) {
    const r = inner + (outer - inner) * Math.pow(i / rings, 2.3); // dense near you, sparse far away
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const w = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createLake(spectrum) {
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector2(-100, 0));
  let nextRipple = 0;
  const touches = Array.from({ length: MAX_TOUCH }, () => new THREE.Vector4(0, 0, -100, 0));
  let nextTouch = 0;

  const uniforms = {
    time: { value: 0 },
    bass: { value: 0 }, mid: { value: 0 }, treble: { value: 0 },
    tide: { value: 0 }, glow: { value: 0 }, skyBright: { value: 1 }, moonA: { value: 1 },
    ripples: { value: ripples },
    touches: { value: touches },
    spec: { value: spectrum.specTex },
    ringGlow: { value: 0 }, eqGlow: { value: 0 },
    accent: { value: new THREE.Color(P.cyan) },
    accent2: { value: new THREE.Color(P.magenta) },
    water: { value: new THREE.Color(P.water) },
    top: { value: new THREE.Color(P.skyTop) },
    horizon: { value: new THREE.Color(P.skyHorizon) },
    moonDir: { value: MOON_DIR },
    screenColor: { value: new THREE.Color(0x000000) },
    deckR: { value: CONFIG.deckRadius },
    swell: { value: CONFIG.tide.swell },
    speed: { value: CONFIG.tide.rippleSpeed },
    life: { value: CONFIG.tide.rippleLife },
  };

  const HEIGHT = /* glsl */ `
    uniform float time, bass, tide, deckR, swell, speed, life;
    uniform vec2 ripples[${MAX_RIPPLES}];
    uniform vec4 touches[${MAX_TOUCH}];
    float touchAt(vec2 p) {
      float g = 0.0;
      for (int i = 0; i < ${MAX_TOUCH}; i++) {
        float age = time - touches[i].z;
        if (age > 0.0 && age < 3.0) {
          float k = (length(p - touches[i].xy) - age * 2.6) / (0.18 + age * 0.22);
          g += touches[i].w * exp(-k * k) * (1.0 - age / 3.0);
        }
      }
      return g;
    }
    float ringAt(float d) {
      float g = 0.0;
      for (int i = 0; i < ${MAX_RIPPLES}; i++) {
        float age = time - ripples[i].x;
        if (age > 0.0 && age < life) {
          float k = (d - (deckR + age * speed)) / (0.7 + age * 0.45);
          g += ripples[i].y * exp(-k * k) * (1.0 - age / life);
        }
      }
      return g;
    }
    float heightAt(vec2 p, out float ring) {
      float d = length(p);
      float fall = smoothstep(110.0, 8.0, d);
      float h = 0.035 * sin(p.x * 0.33 + time * 0.55) + 0.03 * sin(p.y * 0.41 - time * 0.47)
              + 0.012 * sin((p.x + p.y) * 1.3 + time * 1.3);
      h += tide * bass * swell * sin(d * 0.5 - time * 2.1) * exp(-d * 0.03);
      ring = ringAt(d) * tide;
      float touch = touchAt(p);
      ring += touch * 0.8;
      h += ring * 0.32 + touch * 0.06;
      return h * fall;
    }`;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${HEIGHT}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vHeight, vRing, vDist;
      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        float ring, r2, r3;
        float h = heightAt(p.xz, ring);
        float e = 0.3;
        float hx = heightAt(p.xz + vec2(e, 0.0), r2);
        float hz = heightAt(p.xz + vec2(0.0, e), r3);
        vNormal = normalize(vec3(h - hx, e, h - hz));
        p.y += h;
        vWorld = p;
        vHeight = h;
        vRing = ring;
        vDist = length(p.xz);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, mid, treble, glow, skyBright, moonA, tide;
      uniform float bass, ringGlow, eqGlow;
      uniform sampler2D spec;
      #define bass_ bass
      uniform vec3 accent, accent2, water, top, horizon, moonDir, screenColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vHeight, vRing, vDist;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.5);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(horizon, top, clamp(R.y * 1.6, 0.0, 1.0)) * skyBright;
        vec3 col = water + sky * (0.12 + fres * 0.85);

        // moonlight glitter path
        float md = max(dot(R, moonDir), 0.0);
        col += vec3(0.8, 0.85, 1.0) * (pow(md, 220.0) * 3.0 + pow(md, 24.0) * 0.12) * moonA;

        // light from the big screen falling on the water in front of you
        float toward = smoothstep(0.0, -10.0, vWorld.z) * exp(-abs(vWorld.x) * 0.18);
        col += screenColor * toward * (0.2 + fres * 1.4);

        // music: glowing crests, ripple rings, colour drift, sparkles
        float crest = smoothstep(0.03, 0.28, vHeight);
        float near = smoothstep(90.0, 4.0, vDist);
        vec3 tint = mix(accent, accent2, clamp(mid * 1.2 + 0.25 * sin(vDist * 0.07 - time * 0.3), 0.0, 1.0));
        col += tint * (crest * 0.9 + vRing * 0.85) * glow * near;
        // bioluminescent shimmer: drifting veins of light whose brightness follows the mids
        vec2 q = vWorld.xz * 0.28;
        float n = vnoise(q + vec2(time * 0.08, -time * 0.05)) * 0.6 + vnoise(q * 2.3 - vec2(time * 0.11, time * 0.07)) * 0.4;
        float veins = smoothstep(0.5, 0.68, n) - smoothstep(0.7, 0.9, n);
        col += tint * veins * (0.08 + mid * 0.9 + bass_ * 0.4) * glow * near;
        // bass "breathing" band that rolls outward with the swell
        float band = pow(max(0.0, sin(vDist * 0.5 - time * 2.1)), 6.0) * smoothstep(40.0, 4.0, vDist);
        col += tint * band * bass_ * tide * glow * 0.35;
        float sp = hash(floor(vWorld.xz * 5.0) + floor(time * 9.0));
        col += vec3(1.0) * step(0.982, sp) * treble * glow * (0.3 + crest) * 1.4;

        // reflections: the sound ring around you and the equalizer bars under the screen
        vec2 wob = N.xz * 0.6;
        float rr = (vDist + wob.x - 4.4) / 0.4;
        col += accent * exp(-rr * rr) * ringGlow * 0.22;
        float ang = atan(vWorld.x + wob.x, -vWorld.z);
        if (abs(ang) < ${EQ_HALF.toFixed(4)} && vWorld.z < 0.0) {
          float m = abs(ang) / ${EQ_HALF.toFixed(4)};
          float lvl = texture2D(spec, vec2(0.03 + m * 0.85, 0.5)).r;
          float idx = (ang / ${EQ_HALF.toFixed(4)} * 0.5 + 0.5) * 48.0;
          float stripe = smoothstep(0.34, 0.24, abs(fract(idx) - 0.5));
          float along = smoothstep(9.1, 8.6, vDist) * smoothstep(5.5, 8.2 - lvl * 1.5, vDist);
          col += mix(accent, vec3(1.0), 0.3) * stripe * along * (0.15 + lvl) * eqGlow * 0.5;
        }

        col *= 1.0 - smoothstep(55.0, 185.0, vDist); // fade into the dark far away
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(polarDisk(2.6, 200, 110, 180), mat);
  mesh.position.y = CONFIG.waterY;
  mesh.frustumCulled = false;

  return {
    mesh,
    /** Called by the beat detector: start a ring ripple. */
    ripple(t, strength = 1) {
      ripples[nextRipple].set(t, Math.min(1.6, strength));
      nextRipple = (nextRipple + 1) % MAX_RIPPLES;
    },
    /** A ripple where you point at the water. */
    touch(x, z, t, strength = 1) {
      touches[nextTouch].set(x, z, t, strength);
      nextTouch = (nextTouch + 1) % MAX_TOUCH;
    },
    update(t, s, bands, screenColor, playing = false) {
      uniforms.ringGlow.value = s.ring ?? 0;
      uniforms.eqGlow.value = (s.ring ?? 0) * (playing ? 1 : 0.3);
      uniforms.time.value = t;
      uniforms.bass.value = bands.bass;
      uniforms.mid.value = bands.mid;
      uniforms.treble.value = bands.treble;
      uniforms.tide.value = s.tide;
      uniforms.glow.value = s.glow;
      uniforms.skyBright.value = s.sky;
      uniforms.moonA.value = s.moon;
      uniforms.accent.value.copy(s.accent);
      uniforms.screenColor.value.copy(screenColor);
    },
  };
}
