// The deck you sit on, the karaoke stage and the lanterns.
//
// The objects are modelled and lit in Blender (assets/blender/room.py → app/models/room.glb).
// Their lighting is baked into two textures:
//   *_base.jpg     moonlight and sky — always on
//   *_lantern.jpg  only the lanterns' warm light — faded in/out per mode (bright when idle,
//                  almost off for cinema)
// On top of that the shader adds the live effects: the accent-coloured glow at the rim, the
// light spilling from the big screen, and the karaoke stage pulsing with your voice.
// Until the model has loaded (or if it can't be), a simple procedural deck stands in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from '../config.js';
import { radialTexture } from './sky.js';

const P = CONFIG.palette;
const STAGE_LOWERED = -0.18; // the riser hides just below the deck until karaoke

export function createDeck() {
  const group = new THREE.Group();
  const R = CONFIG.deckRadius;

  // ---------------------------------------------------------------- shared live uniforms
  const live = {
    accent: { value: new THREE.Color(P.amber) },
    screenColor: { value: new THREE.Color(0) },
    light: { value: 1 },
    lanterns: { value: 1 },
    glow: { value: 0.3 },
    level: { value: 0 }, // mic level in karaoke
    time: { value: 0 },
  };

  // ---------------------------------------------------------------- fallback (procedural) deck
  const fallbackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.wood).multiplyScalar(0.8) });
  const fallback = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.97, 0.3, 96, 1), fallbackMat);
  fallback.position.y = -0.15;
  group.add(fallback);

  // ---------------------------------------------------------------- live accents (code, not baked)
  const ringMat = new THREE.MeshBasicMaterial({ color: P.amber, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.012, 0.018, 8, 192), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.03;
  group.add(ring);

  const stageGroup = new THREE.Group();
  stageGroup.position.y = STAGE_LOWERED;
  group.add(stageGroup);
  const arc = THREE.MathUtils.degToRad(126);
  const stageRingMat = new THREE.MeshBasicMaterial({ color: P.magenta, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const stageRing = new THREE.Mesh(new THREE.TorusGeometry(R + 0.31, 0.022, 8, 96, arc), stageRingMat);
  stageRing.rotation.set(Math.PI / 2, 0, -Math.PI / 2 - arc / 2);
  stageRing.position.y = 0.16;
  stageGroup.add(stageRing);

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

  // ---------------------------------------------------------------- the Blender model
  const lanternPapers = [];
  const halos = [];
  const haloTex = radialTexture([[0, 'rgba(255,190,120,0.75)'], [0.35, 'rgba(255,150,80,0.22)'], [1, 'rgba(255,120,60,0)']]);
  const paperMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.42) });

  const loadTex = (name) => {
    const t = new THREE.TextureLoader().load(`textures/${name}.jpg`);
    t.flipY = false; // glTF UV convention
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const bakedMaterial = (base, lantern, { stage = false } = {}) =>
    new THREE.ShaderMaterial({
      uniforms: { ...live, baseMap: { value: loadTex(base) }, lanternMap: { value: loadTex(lantern) }, isStage: { value: stage ? 1 : 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vWorld; varying vec3 vN;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D baseMap, lanternMap;
        uniform vec3 accent, screenColor;
        uniform float light, lanterns, glow, level, isStage;
        varying vec2 vUv; varying vec3 vWorld; varying vec3 vN;
        void main() {
          vec3 base = texture2D(baseMap, vUv).rgb;
          vec3 warm = texture2D(lanternMap, vUv).rgb;
          vec3 col = base * light * 0.85 + warm * lanterns;
          float lum = dot(base, vec3(0.3, 0.55, 0.15)) * 2.2;           // albedo stand-in for live light
          float r = length(vWorld.xz);
          float top = max(vN.y, 0.0);
          col += accent * lum * smoothstep(${(R - 0.7).toFixed(2)}, ${R.toFixed(2)}, r) * top * (0.35 * glow + 0.9 * level);
          col += screenColor * lum * smoothstep(1.5, -3.0, vWorld.z) * (0.4 + 0.6 * top);
          col += vec3(1.0, 0.31, 0.64) * lum * level * isStage * 0.8;   // the stage glows with your voice
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });

  let model = null;
  new GLTFLoader().load(
    'models/room.glb',
    (gltf) => {
      const deckMat = bakedMaterial('deck_base', 'deck_lantern');
      const stageMat = bakedMaterial('stage_base', 'stage_lantern', { stage: true });
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.name.startsWith('Deck')) o.material = deckMat;
        else if (o.name.startsWith('Stage')) o.material = stageMat;
        else if (o.name.startsWith('LanternPaper')) {
          o.material = paperMat;
          lanternPapers.push(o);
          // a soft additive halo around each lantern (cheap "bloom")
          o.geometry.computeBoundingBox();
          const c = o.geometry.boundingBox.getCenter(new THREE.Vector3());
          const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          halo.position.copy(c);
          halo.scale.setScalar(1.3);
          halo.userData.baseScale = 1.3;
          halos.push(halo);
        }
      });
      const stageMesh = gltf.scene.getObjectByName('Stage');
      if (stageMesh) stageGroup.add(stageMesh); // moves with the stage (rises in karaoke)
      for (const h of halos) group.add(h);
      group.add(gltf.scene);
      fallback.visible = false;
      model = gltf.scene;
    },
    undefined,
    (err) => console.warn('room model not loaded; using the simple deck', err),
  );

  return {
    group,
    get loaded() { return !!model; },
    update(t, s, screenColor, micLevel = 0, bass = 0) {
      live.time.value = t;
      live.light.value = s.deck;
      live.lanterns.value = s.lanterns ?? 1;
      live.glow.value = s.glow * 0.6 + 0.25;
      live.accent.value.copy(s.accent);
      live.screenColor.value.copy(screenColor);
      live.level.value = micLevel * s.stage;
      fallbackMat.color.setHex(P.wood).multiplyScalar(0.35 + 0.5 * s.deck);

      // lanterns: a gentle candle-like breathing, scaled by the mode
      const flicker = 0.92 + 0.05 * Math.sin(t * 2.3) + 0.03 * Math.sin(t * 7.1);
      const lv = (s.lanterns ?? 1) * flicker * (1 + bass * 0.45); // and they breathe with the bass
      paperMat.color.setRGB(1.0 * (0.25 + 0.85 * lv), 0.72 * (0.25 + 0.85 * lv), 0.42 * (0.25 + 0.85 * lv));
      for (const h of halos) { h.material.opacity = Math.min(1, 0.9 * lv); h.scale.setScalar(h.userData.baseScale * (1 + bass * 0.25)); }

      ringMat.color.copy(s.accent).multiplyScalar(0.5 + s.glow * 0.8 + micLevel * s.stage);
      ring.material.opacity = Math.max(0.15, s.deck);
      // the stage rises out of the deck for karaoke
      stageGroup.position.y = STAGE_LOWERED + s.stage * -STAGE_LOWERED;
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
