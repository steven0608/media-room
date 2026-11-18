// The big curved screen across the water. It shows whatever texture it's given:
// the now-playing card (music), a video (cinema) or the lyric board (karaoke).
// When idle it's dark glass with a faint sheen. A soft halo behind it takes its colour
// from the picture ("bias lighting"), and that colour also lights the water and deck.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { radialTexture } from './sky.js';

export function createScreen(renderer) {
  const { radius, arcDegrees, centerY } = CONFIG.screen;
  const arc = THREE.MathUtils.degToRad(arcDegrees);
  const width = radius * arc;
  const height = (width * 9) / 16;

  const geo = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true, Math.PI - arc / 2, arc);
  // Viewed from inside, the cylinder's u runs right-to-left: flip it.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));

  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;

  const uniforms = {
    map: { value: blank },
    hasMap: { value: 0 },
    bright: { value: 1 },
    glass: { value: 1 },
    accent: { value: new THREE.Color(CONFIG.palette.amber) },
    time: { value: 0 },
    aspect: { value: 16 / 9 },   // content aspect; letterboxes inside the 16:9 screen
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float hasMap, bright, glass, time, aspect; uniform vec3 accent;
      varying vec2 vUv;
      void main() {
        // letterbox/pillarbox: fit content of 'aspect' inside 16:9
        vec2 uv = vUv;
        float screenA = 16.0 / 9.0;
        vec2 scale = aspect > screenA ? vec2(1.0, screenA / aspect) : vec2(aspect / screenA, 1.0);
        vec2 c = (uv - 0.5) / scale + 0.5;
        float inside = step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);
        vec3 pic = texture2D(map, clamp(c, 0.0, 1.0)).rgb * inside * hasMap;
        // dark glass: deep blue-black with a slow diagonal sheen and edge glow
        float sheen = smoothstep(0.35, 0.0, abs(uv.x * 0.8 + uv.y * 0.6 - 0.2 - fract(time * 0.02) * 2.0)) * 0.04;
        float edge = smoothstep(0.02, 0.0, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
        vec3 glassCol = vec3(0.012, 0.016, 0.035) + sheen + accent * edge * 0.35;
        vec3 col = mix(glassCol, pic, hasMap) * bright;
        gl_FragColor = vec4(col, glass);
        #include <colorspace_fragment>
      }`,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = centerY;
  mesh.renderOrder = 2;

  // Bias-light halo behind the screen
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.7, height * 2.1),
    new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  halo.position.set(0, centerY, -radius - 0.6);
  halo.renderOrder = 1;

  const group = new THREE.Group();
  group.add(halo, mesh);

  // --- average colour of the picture, sampled a few times a second (bias light + room spill)
  const sampleRT = new THREE.WebGLRenderTarget(8, 4);
  const sampleScene = new THREE.Scene();
  const sampleCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sampleMat = new THREE.MeshBasicMaterial({ map: blank });
  sampleScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sampleMat));
  const px = new Uint8Array(8 * 4 * 4);
  const avg = new THREE.Color(0);
  const target = new THREE.Color(0);
  let sampleClock = 0;

  function sampleColor() {
    if (!uniforms.hasMap.value) { target.setRGB(0, 0, 0); return; }
    const xr = renderer.xr.enabled;
    const prev = renderer.getRenderTarget();
    renderer.xr.enabled = false; // render the tiny pass outside the XR camera
    renderer.setRenderTarget(sampleRT);
    renderer.render(sampleScene, sampleCam);
    renderer.readRenderTargetPixels(sampleRT, 0, 0, 8, 4, px);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xr;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const n = (px.length / 4) * 255;
    target.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
  }

  return {
    group,
    width, height,
    mesh, // for pointer hits (buttons drawn on the screen)
    /** Average picture colour, smoothed — used to light the water/deck. */
    light: avg,
    setTexture(tex, aspect = 16 / 9) {
      uniforms.map.value = tex || blank;
      uniforms.hasMap.value = tex ? 1 : 0;
      uniforms.aspect.value = aspect;
      sampleMat.map = tex || blank;
      sampleMat.needsUpdate = true;
    },
    get texture() { return uniforms.hasMap.value ? uniforms.map.value : null; },
    update(t, dt, s, spill = 0.35) {
      uniforms.time.value = t;
      uniforms.bright.value = 0.35 + 0.65 * s.screen;
      uniforms.glass.value = s.screenGlass;
      uniforms.accent.value.copy(s.accent);
      const k = 0.94 + 0.06 * s.screen; // the screen "grows" a little when it's the star
      mesh.scale.set(k, k, k);
      sampleClock += dt;
      if (sampleClock > 0.2) { sampleClock = 0; sampleColor(); }
      avg.lerp(target, Math.min(1, dt * 2.5));
      halo.material.color.copy(avg).multiplyScalar(0.55 * spill * 2);
      halo.material.opacity = uniforms.hasMap.value ? 1 : 0;
    },
  };
}
