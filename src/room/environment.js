// The lake's surroundings (made in Blender: assets/blender/environment.py → models/environment.glb):
// pine forests on the far shores, a small island and reeds at the water's edge.
// Drawn as moonlit silhouettes with one cheap shader: near-black, fading into the horizon haze
// with distance, with a faint cool edge where the moon catches them. Reeds sway in the breeze.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from '../config.js';
import { MOON_DIR } from './sky.js';

export function createEnvironment() {
  const group = new THREE.Group();
  const uniforms = {
    time: { value: 0 },
    sky: { value: 1 },
    moonA: { value: 1 },
    horizon: { value: new THREE.Color(CONFIG.palette.skyHorizon) },
    moonDir: { value: MOON_DIR },
  };
  const silhouette = (sway) =>
    new THREE.ShaderMaterial({
      uniforms,
      side: sway ? THREE.DoubleSide : THREE.FrontSide,
      vertexShader: /* glsl */ `
        uniform float time;
        varying vec3 vWorld; varying vec3 vN;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          ${sway ? `float up = max(w.y + 0.6, 0.0);
          w.x += sin(time * 0.9 + w.z * 0.7) * 0.05 * up * up;
          w.z += cos(time * 0.7 + w.x * 0.5) * 0.03 * up * up;` : ''}
          vWorld = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float sky, moonA; uniform vec3 horizon, moonDir;
        varying vec3 vWorld; varying vec3 vN;
        void main() {
          float dist = length(vWorld.xz);
          vec3 col = vec3(0.006, 0.009, 0.02);
          col = mix(col, horizon * 0.3, smoothstep(55.0, 230.0, dist));             // haze with distance
          col += vec3(0.25, 0.3, 0.45) * pow(max(dot(normalize(vN), moonDir), 0.0), 3.0) * 0.07 * moonA; // moon edge
          gl_FragColor = vec4(col * sky, 1.0);
          #include <colorspace_fragment>
        }`,
    });

  new GLTFLoader().load('models/environment.glb', (gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = silhouette(o.name.startsWith('Reeds'));
      o.frustumCulled = false; // one big mesh per kind: culling would never help
    });
    group.add(gltf.scene);
  }, undefined, (e) => console.warn('environment not loaded', e));

  return {
    group,
    update(t, s) {
      uniforms.time.value = t;
      uniforms.sky.value = 0.55 + 0.45 * s.sky;
      uniforms.moonA.value = s.moon;
    },
  };
}

/**
 * The karaoke microphone (models/mic.glb), held in your right hand in VR.
 * Shaded with a small generated "matcap" (a painted sphere of light), so it looks metallic
 * without any real lights. Its ring takes the mode colour and pulses with your voice.
 */
export function createMic() {
  const group = new THREE.Group();
  group.visible = false;
  const matcap = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(46, 40, 6, 64, 64, 66);
    grad.addColorStop(0, '#f4f6ff');
    grad.addColorStop(0.25, '#9aa3c0');
    grad.addColorStop(0.65, '#2a3047');
    grad.addColorStop(1, '#0a0c16');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const metal = new THREE.MeshMatcapMaterial({ matcap });
  const body = new THREE.MeshMatcapMaterial({ matcap, color: 0x2b2f3d });
  const ringMat = new THREE.MeshBasicMaterial({ color: CONFIG.palette.magenta });
  new GLTFLoader().load('models/mic.glb', (gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.name.startsWith('MicRing') ? ringMat : o.name.startsWith('MicBody') ? body : metal;
    });
    // held like a real mic: grille up and forward from the hand
    gltf.scene.rotation.x = -Math.PI * 0.32;
    gltf.scene.position.set(0, 0.01, -0.03);
    group.add(gltf.scene);
  });
  return {
    group,
    update(visible, accent, level) {
      group.visible = visible;
      if (!visible) return;
      ringMat.color.copy(accent).multiplyScalar(0.6 + level * 1.6);
    },
  };
}
