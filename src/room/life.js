// Life around the lake, so the night is never still:
//   • sky lanterns (孔明灯) rising slowly over the far shores, swaying and flickering
//   • mist drifting low over the water, slowly circling the lake
//   • thin clouds sliding across the sky and past the moon
//   • fish leaping now and then, with splash rings and droplets (and real ripples near you)
//   • a small flock of birds crossing the sky once in a while
// Lanterns, mist and clouds move entirely on the graphics card (no per-frame CPU work);
// fish and birds are a handful of matrices. 6 draw calls in all. The `life` knob of each
// mode preset scales it: full in music, calm in cinema.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MOON_DIR } from './sky.js';

const W = CONFIG.waterY;
const rand = (a, b) => a + Math.random() * (b - a);

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.13 + 7.1) * 0.3 + noise(p * 4.37 + 3.3) * 0.1; }`;

// ---------------------------------------------------------------- sky lanterns
function createLanterns(count = 22) {
  const base = new THREE.PlaneGeometry(1, 1.3);
  const geo = new THREE.InstancedBufferGeometry().copy(base);
  geo.instanceCount = count;
  const seed = new Float32Array(count), az = new Float32Array(count), dist = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seed[i] = Math.random();
    // all around, but not straight behind the screen's centre (they'd peek over the picture)
    let a; do { a = Math.random() * Math.PI * 2; } while (Math.abs(Math.atan2(Math.sin(a - Math.PI * 1.5), Math.cos(a - Math.PI * 1.5))) < 0.35);
    az[i] = a;
    dist[i] = rand(22, 60);
  }
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 1));
  geo.setAttribute('az', new THREE.InstancedBufferAttribute(az, 1));
  geo.setAttribute('dist', new THREE.InstancedBufferAttribute(dist, 1));
  const uniforms = { time: { value: 0 }, alpha: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float seed, az, dist;
      uniform float time;
      varying vec2 vUv;
      varying float vA, vFlick;
      void main() {
        vUv = uv;
        float H = 46.0;
        float speed = 0.35 + seed * 0.45;
        float y = mod(time * speed + seed * H, H);          // rise, then start again at the shore
        float a = az + time * 0.004 * (seed - 0.5) + sin(time * 0.07 + seed * 20.0) * 0.01;
        vec3 c = vec3(cos(a) * dist, ${W.toFixed(2)} + 1.5 + y, sin(a) * dist);
        c.x += sin(time * 0.6 + seed * 40.0) * 0.5;          // swaying on the air
        c.z += cos(time * 0.5 + seed * 30.0) * 0.5;
        float size = 0.8 + seed * 0.5;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        float tilt = sin(time * 0.9 + seed * 10.0) * 0.08;
        vec2 q = position.xy;
        q = vec2(q.x * cos(tilt) - q.y * sin(tilt), q.x * sin(tilt) + q.y * cos(tilt));
        mv.xy += q * size * 2.2;                             // the quad includes the halo
        vA = smoothstep(0.0, 4.0, y) * smoothstep(H, H * 0.62, y);
        vFlick = 0.8 + 0.2 * sin(time * 7.0 + seed * 90.0) * sin(time * 3.1 + seed * 13.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float alpha;
      varying vec2 vUv;
      varying float vA, vFlick;
      void main() {
        vec2 p = (vUv - 0.5) * vec2(2.2, 2.86);              // lantern units: body ~ |x|<0.45, |y|<0.6
        float w = mix(0.36, 0.48, clamp(p.y * 0.8 + 0.5, 0.0, 1.0)); // wider at the top
        float body = smoothstep(w, w - 0.08, abs(p.x)) * smoothstep(0.62, 0.52, abs(p.y));
        float flame = exp(-dot(p - vec2(0.0, -0.4), p - vec2(0.0, -0.4)) * 9.0);
        float halo = exp(-dot(p, p) * 1.3) * 0.45;
        vec3 paper = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.75, 0.38), flame);
        vec3 col = paper * (body * (0.55 + flame * 0.9) + halo) * vFlick;
        gl_FragColor = vec4(col * vA * alpha, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------- mist banks
function createMist(count = 12) {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry().copy(base);
  geo.instanceCount = count;
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = (i + Math.random() * 0.6) / count;
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 1));
  const uniforms = { time: { value: 0 }, alpha: { value: 1 }, light: { value: 1 }, tint: { value: new THREE.Color(0x8fa3d8) } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float time;
      varying vec2 vUv;
      varying float vSeed, vFade;
      void main() {
        vUv = uv; vSeed = seed;
        float a = seed * 6.2832 + time * (0.006 + seed * 0.006);   // slowly circling the lake
        float r = 11.0 + fract(seed * 7.3) * 28.0;
        vec3 c = vec3(cos(a) * r, ${W.toFixed(2)}, sin(a) * r);
        // face you around the vertical axis only, so it stands on the water
        vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam);
        vec3 side = vec3(-toCam.z, 0.0, toCam.x);
        float w = 14.0 + fract(seed * 3.7) * 10.0, h = 3.0 + fract(seed * 5.1) * 2.5;
        vec3 p = c + side * position.x * w + vec3(0.0, position.y * h, 0.0);
        vFade = smoothstep(7.0, 13.0, length(cameraPosition.xz - c.xz)); // never in your face
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, alpha, light;
      uniform vec3 tint;
      varying vec2 vUv;
      varying float vSeed, vFade;
      ${NOISE}
      void main() {
        vec2 q = vec2(vUv.x * 3.0 + vSeed * 17.0 + time * 0.03, vUv.y * 1.2 - time * 0.015);
        float n = fbm(q * 1.4 + vec2(time * 0.02, 0.0));
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
        float fall = pow(1.0 - vUv.y, 1.2);                         // densest on the water
        float a = smoothstep(0.28, 0.8, n) * edge * fall * vFade * 0.85 * alpha;
        gl_FragColor = vec4(tint * light * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -3; // before nearer see-through things (menus, fireflies)
  return { mesh, uniforms };
}

// ---------------------------------------------------------------- clouds
function createClouds() {
  // a band of sky from just above the hills to ~50° up, all the way round
  const geo = new THREE.SphereGeometry(360, 64, 12, 0, Math.PI * 2, THREE.MathUtils.degToRad(38), THREE.MathUtils.degToRad(49));
  const uniforms = { time: { value: 0 }, alpha: { value: 1 }, moonDir: { value: MOON_DIR } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, alpha;
      uniform vec3 moonDir;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        float el = vDir.y;
        vec2 q = vDir.xz / (el + 0.25) * 2.2;                  // flat cloud layer seen from below
        q += vec2(time * 0.012, time * 0.004);
        float n = fbm(q) * 0.75 + noise(q * 5.0 - time * 0.02) * 0.25;
        float c = smoothstep(0.52, 0.8, n);
        float band = smoothstep(0.02, 0.14, el) * smoothstep(0.78, 0.45, el);
        float m = max(dot(vDir, moonDir), 0.0);
        vec3 lit = mix(vec3(0.10, 0.12, 0.22), vec3(0.75, 0.78, 0.9), pow(m, 24.0));   // silver lining by the moon
        float a = c * band * alpha * (0.42 + pow(m, 8.0) * 0.4);
        gl_FragColor = vec4(lit, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -4; // after the stars, moon and aurora; before everything nearer
  return { mesh, uniforms };
}

// ---------------------------------------------------------------- fish, splashes, droplets
function createFish() {
  // a small leaping fish: a tapered body with a tail, dark with a moonlit sheen
  const shape = new THREE.Shape();
  shape.moveTo(0.16, 0);
  shape.quadraticCurveTo(0.08, 0.05, -0.08, 0.025);
  shape.lineTo(-0.15, 0.06); shape.lineTo(-0.13, 0); shape.lineTo(-0.15, -0.06);
  shape.lineTo(-0.08, -0.025);
  shape.quadraticCurveTo(0.08, -0.05, 0.16, 0);
  const fishGeo = new THREE.ShapeGeometry(shape, 6);
  const POOL = 2;
  const fish = [];
  const fishMat = new THREE.MeshBasicMaterial({ color: 0x9fb0e0, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const group = new THREE.Group();
  for (let i = 0; i < POOL; i++) {
    const m = new THREE.Mesh(fishGeo, fishMat);
    m.visible = false;
    m.scale.setScalar(2.2);
    group.add(m);
    fish.push({ mesh: m, age: 1, life: 1, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 1, height: 0.5, splashed: false });
  }

  // splash rings: flat quads on the water, ring drawn in the shader (sharp at any distance)
  const RINGS = 8;
  const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const rGeo = new THREE.InstancedBufferGeometry().copy(ringGeo);
  rGeo.instanceCount = RINGS;
  const ringData = new Float32Array(RINGS * 4).fill(-100); // x, z, start time, strength
  const ringAttr = new THREE.InstancedBufferAttribute(ringData, 4);
  ringAttr.setUsage(THREE.DynamicDrawUsage);
  rGeo.setAttribute('ring', ringAttr);
  const ringUniforms = { time: { value: 0 }, alpha: { value: 1 } };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 ring;
      uniform float time;
      varying vec2 vP;
      varying float vAge, vS;
      void main() {
        vAge = time - ring.z; vS = ring.w;
        float R = 4.0;
        vP = position.xz * R;
        vec3 p = vec3(ring.x, ${(W + 0.02).toFixed(3)}, ring.y) + position * R;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float alpha;
      varying vec2 vP;
      varying float vAge, vS;
      void main() {
        if (vAge < 0.0 || vAge > 3.2) discard;
        float d = length(vP);
        float g = 0.0;
        for (int k = 0; k < 3; k++) {
          float r = vAge * (0.75 - float(k) * 0.17);
          float w = 0.09 + vAge * 0.06;
          g += exp(-pow((d - r) / w, 2.0)) * (1.0 - float(k) * 0.3);
        }
        float a = g * vS * (1.0 - vAge / 3.2) * alpha * 1.1;
        gl_FragColor = vec4(vec3(0.7, 0.8, 1.0) * a, 1.0);
      }`,
  });
  const rings = new THREE.Mesh(rGeo, ringMat);
  rings.frustumCulled = false;
  group.add(rings);
  let nextRing = 0;

  // droplets
  const DROPS = 48;
  const dPos = new Float32Array(DROPS * 3).fill(-1000);
  const dVel = new Float32Array(DROPS * 3);
  const dLife = new Float32Array(DROPS);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dMat = new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const drops = new THREE.Points(dGeo, dMat);
  drops.frustumCulled = false;
  group.add(drops);
  let nextDrop = 0;

  function splash(x, z, t, s, onTouch) {
    ringData.set([x, z, t, s], nextRing * 4);
    nextRing = (nextRing + 1) % RINGS;
    ringAttr.needsUpdate = true;
    for (let k = 0; k < 10; k++) {
      const i = nextDrop; nextDrop = (nextDrop + 1) % DROPS;
      const a = Math.random() * Math.PI * 2, sp = rand(0.4, 1.1) * s;
      dPos.set([x, W + 0.02, z], i * 3);
      dVel.set([Math.cos(a) * sp, rand(1.4, 2.6) * s, Math.sin(a) * sp], i * 3);
      dLife[i] = 1;
    }
    if (Math.hypot(x, z) < 16) onTouch?.(x, z, t, 0.7 * s); // close by: the water itself ripples too
  }

  let timer = 2;
  const tmp = new THREE.Vector3(), tan = new THREE.Vector3();
  return {
    group,
    leapSoon() { timer = 0; },
    update(t, dt, life, onTouch) {
      ringUniforms.time.value = t;
      ringUniforms.alpha.value = Math.min(1, life * 1.5);
      timer -= dt * life;
      if (timer <= 0 && life > 0.05) {
        timer = rand(3, 9);
        const f = fish.find((x) => x.age >= x.life);
        if (f) {
          const a = Math.random() * Math.PI * 2, r = rand(5, 16);
          f.from.set(Math.cos(a) * r, W, Math.sin(a) * r);
          const h = Math.random() * Math.PI * 2;
          f.dir.set(Math.cos(h), 0, Math.sin(h));
          f.len = rand(0.9, 1.8); f.height = rand(0.35, 0.75);
          f.age = 0; f.life = rand(0.6, 0.85); f.splashed = false;
          f.mesh.visible = true;
          splash(f.from.x, f.from.z, t, 0.7, onTouch);
        }
      }
      for (const f of fish) {
        if (f.age >= f.life) { f.mesh.visible = false; continue; }
        f.age += dt;
        const k = Math.min(1, f.age / f.life);
        tmp.copy(f.from).addScaledVector(f.dir, f.len * k);
        tmp.y = W + 4 * f.height * k * (1 - k);
        f.mesh.position.copy(tmp);
        // nose along the arc
        const slope = 4 * f.height * (1 - 2 * k) / f.len;
        tan.copy(f.dir).setY(slope).normalize();
        f.mesh.rotation.set(0, Math.atan2(-tan.z, tan.x), Math.atan(slope), 'YZX');
        if (k >= 1 && !f.splashed) { f.splashed = true; splash(tmp.x, tmp.z, t, 1, onTouch); }
      }
      // droplets: a little gravity
      let any = false;
      for (let i = 0; i < DROPS; i++) {
        if (dLife[i] <= 0) continue;
        any = true;
        dVel[i * 3 + 1] -= 9.8 * dt;
        dPos[i * 3] += dVel[i * 3] * dt; dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt; dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
        if (dPos[i * 3 + 1] < W) { dLife[i] = 0; dPos[i * 3 + 1] = -1000; }
      }
      if (any) dGeo.attributes.position.needsUpdate = true;
      dMat.opacity = 0.85 * Math.min(1, life * 1.5);
    },
  };
}

// ---------------------------------------------------------------- birds
function createBirds(count = 7) {
  // one bird: two wings (a shallow V), flapped in the vertex shader
  const pos = new Float32Array([
    0, 0, 0.12, -0.9, 0.02, -0.08, 0, 0, -0.12,   // left wing
    0, 0, 0.12, 0, 0, -0.12, 0.9, 0.02, -0.08,    // right wing
  ]);
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const geo = new THREE.InstancedBufferGeometry().copy(base);
  geo.instanceCount = count;
  const phase = new Float32Array(count).map(() => Math.random() * 6.28);
  geo.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
  const uniforms = { time: { value: 0 }, alpha: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float phase;
      uniform float time;
      void main() {
        vec3 p = position;
        float span = abs(p.x);
        p.y += sin(time * 7.0 + phase) * span * 0.55;
        gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float alpha;
      void main() { gl_FragColor = vec4(vec3(0.02, 0.025, 0.05), alpha); }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.visible = false;
  const offsets = Array.from({ length: count }, (_, i) => {
    const row = Math.ceil(i / 2), side = i === 0 ? 0 : (i % 2 ? -1 : 1);
    return new THREE.Vector3(side * row * 2.2, rand(-0.4, 0.4), row * 2.6); // V formation (behind the leader)
  });
  const flock = { on: false, age: 0, life: 1, from: new THREE.Vector3(), vel: new THREE.Vector3() };
  let timer = rand(15, 30);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), o = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    update(t, dt, life) {
      uniforms.time.value = t;
      timer -= dt;
      if (!flock.on && timer <= 0 && life > 0.5) {
        // cross the sky in front of you, often past the moon
        const az = Math.atan2(MOON_DIR.x, -MOON_DIR.z) + rand(-0.7, 0.7);
        const dist = rand(70, 100), el = Math.asin(MOON_DIR.y) + rand(-0.12, 0.1); // at the moon's height: silhouettes
        const mid = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az)).multiplyScalar(dist);
        mid.y = W + dist * Math.tan(el);
        const across = new THREE.Vector3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        flock.from.copy(mid).addScaledVector(across, -dist * 0.9);
        flock.vel.copy(across).multiplyScalar(rand(7, 10)).setY(rand(-0.4, 0.6));
        flock.age = 0; flock.life = dist * 1.8 / flock.vel.length(); flock.on = true;
      }
      if (!flock.on) { mesh.visible = false; return; }
      flock.age += dt;
      if (flock.age >= flock.life) { flock.on = false; timer = rand(35, 70); mesh.visible = false; return; }
      mesh.visible = true;
      const k = flock.age / flock.life;
      uniforms.alpha.value = Math.min(1, k * 6, (1 - k) * 6) * 0.9;
      const dir = flock.vel.clone().normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      s.setScalar(2.4);
      for (let i = 0; i < count; i++) {
        o.copy(offsets[i]).applyQuaternion(q);
        p.copy(flock.from).addScaledVector(flock.vel, flock.age).add(o);
        p.addScaledVector(up, Math.sin(t * 1.3 + i) * 0.25);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- all together
export function createLife() {
  const lanterns = createLanterns();
  const mist = createMist();
  const clouds = createClouds();
  const fish = createFish();
  const birds = createBirds();
  const group = new THREE.Group();
  group.add(clouds.mesh, lanterns.mesh, birds.mesh, mist.mesh, fish.group);
  return {
    group,
    /** s = room state (uses s.life, s.sky); onTouch(x, z, t, strength) makes real water ripples. */
    update(t, dt, s, onTouch) {
      const life = s.life ?? 1;
      lanterns.uniforms.time.value = t;
      lanterns.uniforms.alpha.value = life;
      lanterns.mesh.visible = life > 0.02;
      mist.uniforms.time.value = t;
      mist.uniforms.alpha.value = 0.35 + life * 0.65;
      mist.uniforms.light.value = s.sky ?? 1;
      clouds.uniforms.time.value = t;
      clouds.uniforms.alpha.value = 0.4 + 0.6 * (s.sky ?? 1);
      fish.update(t, dt, life, onTouch);
      birds.update(t, dt, life);
    },
    /** For trying it out: a fish leaps on the next frame. */
    leap() { fish.leapSoon(); },
  };
}
