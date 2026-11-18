// The round wooden deck you sit on, with a glowing edge ring. In karaoke mode the
// front arc of the deck rises into a lit stage with two sweeping light cones.
// Wood is drawn procedurally in the shader (planks + grain) — no texture files.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const P = CONFIG.palette;

export function createDeck() {
  const group = new THREE.Group();
  const R = CONFIG.deckRadius;

  const uniforms = {
    wood: { value: new THREE.Color(P.wood) },
    accent: { value: new THREE.Color(P.amber) },
    screenColor: { value: new THREE.Color(0) },
    light: { value: 1 },
    glow: { value: 0.3 },
    level: { value: 0 }, // mic level in karaoke (makes the floor pulse)
    time: { value: 0 },
  };
  const woodMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 wood, accent, screenColor;
      uniform float light, glow, level, time;
      varying vec3 vWorld; varying vec3 vN;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float plank = floor(vWorld.x / 0.16);
        float seg = floor((vWorld.z + hash(plank) * 3.0) / 1.4);
        float tone = 0.78 + 0.32 * hash(plank * 7.1 + seg * 3.3);
        float grain = 0.9 + 0.1 * sin(vWorld.z * 38.0 + sin(vWorld.x * 9.0 + plank) * 3.0);
        float gap = smoothstep(0.0, 0.012, fract(vWorld.x / 0.16) * 0.16) * smoothstep(0.16, 0.148, fract(vWorld.x / 0.16) * 0.16);
        vec3 base = wood * tone * grain * mix(0.35, 1.0, gap);
        float r = length(vWorld.xz);
        // moonlight from the front-left, warm bounce near the edge ring, screen spill from the front
        float top = max(vN.y, 0.0);
        vec3 col = base * (0.45 + 0.35 * top) * light;
        col += base * accent * smoothstep(${(R - 0.9).toFixed(2)}, ${R.toFixed(2)}, r) * (0.6 * glow + 0.8 * level);
        col += base * screenColor * smoothstep(1.5, -3.0, vWorld.z) * 1.6;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.97, 0.3, 96, 1), woodMat);
  deck.position.y = -0.15;
  group.add(deck);

  // Glowing edge ring
  const ringMat = new THREE.MeshBasicMaterial({ color: P.amber, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.02, 0.025, 8, 160), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.005;
  group.add(ring);

  // --- karaoke stage: the front arc lifts 25 cm, with its own light ring
  const stageGroup = new THREE.Group();
  const stageMat = woodMat.clone();
  stageMat.uniforms = THREE.UniformsUtils.clone(uniforms);
  const arc = Math.PI * 0.7;
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.35, 0.25, 64, 1, false, Math.PI - arc / 2, arc), stageMat);
  stage.position.set(0, -0.125, 0);
  const stageRingMat = new THREE.MeshBasicMaterial({ color: P.magenta, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const stageRing = new THREE.Mesh(new THREE.TorusGeometry(R + 0.37, 0.03, 8, 96, arc), stageRingMat);
  stageRing.rotation.set(Math.PI / 2, 0, -Math.PI / 2 - arc / 2);
  stageRing.position.y = 0.005;
  stageGroup.add(stage, stageRing);
  group.add(stageGroup);

  // Two fake volumetric light cones (additive gradient cones, no real lights)
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(P.magenta) }, alpha: { value: 0 } },
    vertexShader: /* glsl */ `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 color; uniform float alpha; varying float vY;
      void main(){ float a = pow(vY, 1.6) * alpha * 0.22; gl_FragColor = vec4(color * a, a); }`,
  });
  const cones = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 3.2, 5.5, -4.5);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6.5, 32, 1, true), coneMat);
    cone.position.y = -3.25;
    pivot.add(cone);
    pivot.userData.side = side;
    cones.push(pivot);
    group.add(pivot);
  }

  return {
    group,
    update(t, s, screenColor, micLevel = 0) {
      uniforms.light.value = s.deck;
      uniforms.glow.value = s.glow * 0.6 + 0.25;
      uniforms.accent.value.copy(s.accent);
      uniforms.screenColor.value.copy(screenColor);
      uniforms.level.value = micLevel * s.stage;
      for (const k of ['light', 'glow', 'accent', 'screenColor', 'level']) stageMat.uniforms[k].value = uniforms[k].value;
      ringMat.color.copy(s.accent).multiplyScalar(0.5 + s.glow * 0.8 + micLevel * s.stage);
      ring.material.opacity = Math.max(0.15, s.deck);
      // stage rises with an overshoot spring feel driven by the tween
      stageGroup.position.y = -0.3 + s.stage * 0.3;
      stageGroup.visible = s.stage > 0.01;
      stageRingMat.color.setHex(P.magenta).multiplyScalar(0.6 + micLevel * 2.0);
      coneMat.uniforms.alpha.value = s.cones;
      coneMat.uniforms.color.value.copy(s.accent);
      for (const c of cones) {
        c.visible = s.cones > 0.01;
        c.rotation.z = c.userData.side * (0.35 + 0.18 * Math.sin(t * 0.5 + c.userData.side));
        c.rotation.x = 0.25 + 0.1 * Math.sin(t * 0.37 + c.userData.side * 2.0);
      }
    },
  };
}
