// Shooting stars. A big beat in the music can send one streaking across the sky
// (now and then, never a shower); in a quiet room one drifts by every half minute or so.
// Three reusable streaks; each is a thin quad rebuilt on the CPU every frame (4 vertices).
import * as THREE from 'three';

const POOL = 3;

export function createMeteors() {
  const group = new THREE.Group();
  const streaks = [];
  for (let i = 0; i < POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
    geo.setIndex([0, 2, 1, 2, 3, 1]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { alpha: { value: 0 }, color: { value: new THREE.Color(0xdfe6ff) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float alpha; uniform vec3 color; varying vec2 vUv;
        void main() {
          float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float a = pow(vUv.x, 2.5) * pow(across, 2.0) * alpha;  // bright head (x=1), fading tail
          gl_FragColor = vec4(mix(color, vec3(1.0), pow(vUv.x, 8.0)) * a, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    streaks.push({ mesh, age: 1, life: 1, from: new THREE.Vector3(), vel: new THREE.Vector3() });
  }

  const head = new THREE.Vector3(), tail = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
  let cooldown = 3, idleTimer = 12;

  function spawn(color) {
    const s = streaks.find((x) => x.age >= x.life);
    if (!s) return;
    // somewhere in the sky ahead, 25–60° up, moving mostly sideways and a little down
    const az = (Math.random() - 0.5) * 2.6;
    const el = THREE.MathUtils.degToRad(25 + Math.random() * 35);
    s.from.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(300);
    const dir = Math.random() < 0.5 ? 1 : -1;
    s.vel.set(Math.cos(az) * dir, -0.35 - Math.random() * 0.25, Math.sin(az) * dir).normalize().multiplyScalar(170 + Math.random() * 90);
    s.age = 0;
    s.life = 0.75 + Math.random() * 0.45;
    s.mesh.material.uniforms.color.value.copy(color).lerp(new THREE.Color(0xffffff), 0.6);
    s.mesh.visible = true;
  }

  return {
    group,
    update(t, dt, s, camera, beat, playing) {
      cooldown -= dt;
      idleTimer -= dt;
      const allowed = (s.stars ?? 1) > 0.5;
      if (allowed && playing && beat > 1.15 && cooldown <= 0 && Math.random() < 0.35) { spawn(s.accent); cooldown = 4 + Math.random() * 4; }
      if (allowed && idleTimer <= 0) { spawn(s.accent); idleTimer = 20 + Math.random() * 25; }
      camera.getWorldPosition(toCam);
      for (const st of streaks) {
        if (st.age >= st.life) { st.mesh.visible = false; continue; }
        st.age += dt;
        const k = st.age / st.life;
        head.copy(st.vel).multiplyScalar(st.age).add(st.from);
        tail.copy(st.vel).multiplyScalar(Math.max(0, st.age - 0.28)).add(st.from);
        // a ribbon facing you: its width runs across both the motion and your line of sight
        side.copy(head).sub(tail).cross(tail.clone().sub(toCam)).normalize().multiplyScalar(0.9);
        const p = st.mesh.geometry.attributes.position;
        p.setXYZ(0, tail.x - side.x, tail.y - side.y, tail.z - side.z);
        p.setXYZ(1, tail.x + side.x, tail.y + side.y, tail.z + side.z);
        p.setXYZ(2, head.x - side.x, head.y - side.y, head.z - side.z);
        p.setXYZ(3, head.x + side.x, head.y + side.y, head.z + side.z);
        p.needsUpdate = true;
        st.mesh.material.uniforms.alpha.value = Math.sin(Math.PI * k) * (s.stars ?? 1);
      }
    },
  };
}
