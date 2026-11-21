// Aurora: curtains of light across the sky ahead of you, folding slowly in the wind.
// In music they come alive. Each part of the sky follows one slice of the spectrum (bass in
// the middle, treble out at the sides), so the curtains rise and brighten with the song, and
// a beat sends a bright shimmer up through them.
// One mesh, additive, with most of the maths per vertex so it's cheap on the headset.
import * as THREE from 'three';

export function createAurora(spectrum) {
  const R = 175, SPAN = THREE.MathUtils.degToRad(210), SEG = 180, ROWS = 10;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, v = j / ROWS;
      const a = -SPAN / 2 + u * SPAN; // 0 = straight ahead (−Z)
      pos.push(Math.sin(a) * R, 0, -Math.cos(a) * R);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);

  const uniforms = {
    time: { value: 0 }, strength: { value: 0 }, energy: { value: 0 }, pulse: { value: 0 },
    spec: { value: spectrum.specTex },
    accent: { value: new THREE.Color() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float time, energy, pulse;
      uniform sampler2D spec;
      varying vec2 vUv;
      varying float vLevel, vEdge;
      void main() {
        vUv = uv;
        // mirror the spectrum: bass straight ahead, treble at both edges
        float m = abs(uv.x - 0.5) * 2.0;
        float lvl = texture2D(spec, vec2(0.04 + m * 0.9, 0.5)).r;
        vLevel = lvl;
        // the curtain's lower edge waves; music lifts and stretches it
        float edge = 0.5 * sin(uv.x * 9.0 + time * 0.13) + 0.3 * sin(uv.x * 23.0 - time * 0.21);
        vEdge = edge;
        vec3 p = position;
        float base = 24.0 + edge * 4.0;
        float height = 38.0 + 22.0 * energy * lvl + 10.0 * pulse * lvl;
        p.y = base + uv.y * height;
        // fold the curtain in and out like cloth
        float fold = sin(uv.x * 14.0 + time * 0.09) * 9.0 + sin(uv.x * 31.0 - time * 0.17) * 4.0;
        p.xz *= 1.0 + fold / 175.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, strength, energy, pulse;
      uniform vec3 accent;
      varying vec2 vUv;
      varying float vLevel, vEdge;
      void main() {
        // vertical rays drifting sideways
        float x = vUv.x;
        float rays = 0.55 + 0.25 * sin(x * 260.0 + time * 0.6) + 0.2 * sin(x * 610.0 - time * 1.1);
        // bright just above the lower edge, fading towards the top
        float v = vUv.y;
        float lower = smoothstep(0.0, 0.08, v);
        float body = exp(-v * 2.6) * lower;
        // a shimmer that travels up the curtain on each beat
        float shimmer = pulse * exp(-pow((v - (1.0 - pulse) * 0.9) * 6.0, 2.0)) * 0.9;
        // sides fade out; slow breathing patches along the band
        float sides = smoothstep(0.0, 0.12, x) * smoothstep(1.0, 0.88, x);
        float patches = 0.55 + 0.45 * sin(x * 7.0 - time * 0.07 + vEdge);
        float a = (body * rays * patches + shimmer * vLevel) * sides;
        a *= strength * (0.35 + energy * (0.4 + vLevel * 1.6));
        // colour: green-cyan at the edge, into the room's accent, then violet at the top
        vec3 low = vec3(0.25, 1.0, 0.7);
        vec3 col = mix(low, accent, smoothstep(0.05, 0.45, v));
        col = mix(col, vec3(0.55, 0.3, 1.0), smoothstep(0.45, 1.0, v));
        gl_FragColor = vec4(col * a * 0.45, 1.0); // bright, but the screen stays the star
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5; // in the sky, behind everything else that's transparent

  return {
    mesh,
    update(t, s, playing) {
      uniforms.time.value = t;
      uniforms.strength.value = s.aurora ?? 0;
      uniforms.energy.value += ((playing ? 1 : 0) - uniforms.energy.value) * 0.02;
      uniforms.pulse.value = spectrum.pulse;
      uniforms.accent.value.copy(s.accent);
      mesh.visible = (s.aurora ?? 0) > 0.01;
    },
  };
}
