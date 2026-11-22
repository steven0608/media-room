// One input system for both worlds:
//   desktop – the mouse is a ray from the camera; drag on empty space to look around
//   VR      – each controller is a ray; trigger (or grip) = press, thumbsticks for scroll/turn
//   hands   – pinch = press along the hand's ray; or touch a button with your index fingertip
//             (a "poke" pointer: a 6 cm ray along the finger, fed by ui/hands.js)
// Anything clickable registers a mesh with handlers in mesh.userData.ui:
//   { onEnter, onLeave, onDown(hit, ptr), onMove(hit, ptr), onUp(hit, ptr), onWheel(dy) }
import * as THREE from 'three';

const tmpMat = new THREE.Matrix4();
// Poke: the ray starts POKE_BACK behind the fingertip, so a hit closer than that means the
// fingertip is touching (or through) the surface. Buttons sink when pressed, so letting go is
// measured on the finger, not the surface: once it pulls back POKE_PULL from its deepest point.
// Then it has to pull back POKE_REARM (or slide off) before it can press again: one tap = one click.
const POKE_BACK = 0.03, POKE_PRESS = 0.029, POKE_PULL = 0.012, POKE_REARM = 0.03, POKE_REACH = 0.07;
const pokeRay = new THREE.Raycaster();

function visible(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class PointerSystem {
  constructor({ renderer, camera, rig, canvas, sfx }) {
    this.renderer = renderer;
    this.camera = camera;
    this.rig = rig;
    this.canvas = canvas;
    this.sfx = sfx;
    this.targets = [];
    this.pointers = [];
    this.onLook = null;  // desktop drag-to-look callback (dx, dy)
    this.onStick = null; // VR thumbstick callback (handedness, x, y, dt)
    this.onButton = null; // VR face buttons (handedness, index)

    // --- mouse
    this.mouse = this._makePointer('mouse');
    this.mouse.ndc = new THREE.Vector2(0, 0);
    this.mouse.active = false;
    let dragging = false, last = null;
    const setNdc = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mouse.active = true;
    };
    canvas.addEventListener('pointermove', (e) => {
      setNdc(e);
      if (dragging && last) { this.onLook?.(e.clientX - last.x, e.clientY - last.y); last = { x: e.clientX, y: e.clientY }; }
    });
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      setNdc(e); // touch screens and some automation send no move before the press
      this._update(this.mouse);
      if (this.mouse.hovered) this._down(this.mouse);
      else { dragging = true; last = { x: e.clientX, y: e.clientY }; }
    });
    canvas.addEventListener('pointerup', () => { dragging = false; last = null; this._up(this.mouse); });
    canvas.addEventListener('pointerleave', () => { this.mouse.active = false; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.mouse.hovered?.object.userData.ui.onWheel?.(e.deltaY);
    }, { passive: false });

    // --- controllers
    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i);
      rig.add(ctrl);
      const p = this._makePointer(`ctrl${i}`);
      p.controller = ctrl;
      p.visual = this._makeRayVisual();
      ctrl.add(p.visual);
      ctrl.addEventListener('connected', (e) => {
        p.source = e.data;
        p.handedness = e.data.handedness;
        p.active = e.data.targetRayMode === 'tracked-pointer' || e.data.targetRayMode === 'transient-pointer' || !!e.data.hand;
        p.isHand = !!e.data.hand;
        p.visual.visible = p.active;
        p.visual.userData.wand.visible = !p.isHand; // your real hand is drawn instead
      });
      ctrl.addEventListener('disconnected', () => { p.active = false; p.visual.visible = false; this._leave(p); });
      ctrl.addEventListener('selectstart', () => this._down(p));
      ctrl.addEventListener('selectend', () => this._up(p));
      ctrl.addEventListener('squeezestart', () => this._down(p));
      ctrl.addEventListener('squeezeend', () => this._up(p));
      p.buttonsPrev = [];
    }
  }

  _makePointer(id) {
    const p = { id, ray: new THREE.Raycaster(), hovered: null, pressed: null, active: false };
    p.ray.far = 30;
    this.pointers.push(p);
    return p;
  }

  _makeRayVisual() {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.0015, 0.004, 1, 6, 1, true);
    geo.translate(0, -0.5, 0);
    geo.rotateX(-Math.PI / 2); // points down -Z
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(0xcfd8ff) }, len: { value: 1 } },
      vertexShader: `varying float vT; void main(){ vT = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; varying float vT; void main(){ float a = vT * 0.55; gl_FragColor = vec4(color * a, a); }`,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.scale.z = 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.visible = false;
    // little "wand" so you can see your hand
    const wand = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.07, 4, 10), new THREE.MeshBasicMaterial({ color: 0x1c2550 }));
    wand.rotation.x = -Math.PI / 2;
    wand.position.z = 0.03;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: 0x5ce1e6 }));
    tip.position.z = -0.012;
    g.add(beam, dot, wand, tip);
    g.userData = { beam, dot, mat, tip, wand };
    g.visible = false;
    return g;
  }

  /** A fingertip pointer for hands. hands.js sets .origin/.dir/.active every frame. */
  addPoke(handedness) {
    const p = this._makePointer(`poke-${handedness}`);
    p.poke = true;
    p.pokeArmed = true;
    p.pokeMax = 0;
    p.handedness = handedness;
    p.origin = new THREE.Vector3();
    p.dir = new THREE.Vector3(0, 0, -1);
    p.ray.far = POKE_REACH;
    return p;
  }

  /** The hand ray of this hand (to quieten it while the finger is touching something). */
  rayOf(handedness) {
    return this.pointers.find((p) => p.controller && p.handedness === handedness && p.isHand);
  }

  add(mesh, handlers) {
    mesh.userData.ui = handlers;
    this.targets.push(mesh);
  }

  remove(mesh) {
    this.targets = this.targets.filter((m) => m !== mesh);
  }

  haptic(p, intensity = 0.3, ms = 18) {
    const act = p.source?.gamepad?.hapticActuators?.[0];
    try { act?.pulse(intensity, ms); } catch { /* not supported */ }
  }

  _update(p) {
    if (p === this.mouse) {
      if (!p.active || this.renderer.xr.isPresenting) return this._leave(p);
      p.ray.setFromCamera(p.ndc, this.camera);
    } else if (p.poke) {
      if (!p.active) { if (p.pressed) this._up(p); return this._leave(p); }
      p.ray.ray.origin.copy(p.dir).multiplyScalar(-POKE_BACK).add(p.origin);
      p.ray.ray.direction.copy(p.dir);
    } else {
      if (!p.active) return;
      if (p.quiet) { // the finger of this hand is touching something: no ray
        if (p.visual) p.visual.visible = false;
        if (p.pressed) this._up(p);
        return this._leave(p);
      }
      if (p.visual) p.visual.visible = true;
      tmpMat.identity().extractRotation(p.controller.matrixWorld);
      p.ray.ray.origin.setFromMatrixPosition(p.controller.matrixWorld);
      p.ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    }
    const hits = p.ray.intersectObjects(this.targets.filter(visible), false);
    const hit = hits[0] || null;
    p.hit = hit;
    const obj = p.pressed?.object ?? hit?.object ?? null;
    if (!p.pressed && (p.hovered?.object ?? null) !== (hit?.object ?? null)) {
      this._leave(p);
      if (hit) {
        p.hovered = hit;
        hit.object.userData.ui.onEnter?.(hit, p);
        this.haptic(p, 0.12, 10);
      }
    } else if (hit && !p.pressed) {
      p.hovered = hit;
    }
    if (obj) {
      const h = p.pressed ? this._hitOn(p, p.pressed.object) : hit;
      if (h) obj.userData.ui.onMove?.(h, p);
    }
    if (p.poke) {
      const depth = p.origin.dot(p.dir);
      if (p.pressed) {
        p.pokeMax = Math.max(p.pokeMax, depth);
        const on = this._pokeHit(p, p.pressed.object); // still over the thing you pressed?
        if (!on || p.pokeMax - depth > POKE_PULL) { p.pokeLast = p.pressed.object; this._up(p, on); p.pokeArmed = false; }
      } else if (!p.pokeArmed) {
        // ready again once the finger has really pulled back, or moved off that button
        const back = p.pokeMax - depth > POKE_REARM && (!hit || hit.distance > POKE_PRESS + 0.008);
        if (back || !this._pokeHit(p, p.pokeLast)) p.pokeArmed = true;
      } else if (hit && hit.distance < POKE_PRESS) {
        this._down(p);
        p.pokeMax = depth;
        p.onPoke?.();
      }
    }
    if (p.visual) {
      const { beam, dot, tip } = p.visual.userData;
      const d = hit ? hit.distance : 2;
      beam.scale.z = d;
      dot.visible = !!hit;
      if (hit) dot.position.set(0, 0, -d);
      tip.material.color.setHex(hit ? 0xffb35c : 0x5ce1e6);
    }
  }

  // A long ray through the fingertip: is the finger still over this object (in front or pushed in)?
  _pokeHit(p, object) {
    pokeRay.ray.origin.copy(p.dir).multiplyScalar(-0.1).add(p.origin);
    pokeRay.ray.direction.copy(p.dir);
    pokeRay.far = 0.2;
    return pokeRay.intersectObject(object, false)[0] || null;
  }

  // While dragging, keep hitting the pressed object even if the ray slides off it.
  _hitOn(p, object) {
    const h = p.ray.intersectObject(object, false)[0];
    return h || null;
  }

  _leave(p) {
    if (p.hovered && !p.pressed) {
      p.hovered.object.userData.ui.onLeave?.(p);
      p.hovered = null;
    }
  }

  _down(p) {
    if (!p.hovered) return;
    p.pressed = p.hovered;
    p.hovered.object.userData.ui.onDown?.(p.hovered, p);
    this.haptic(p, 0.45, 25);
  }

  _up(p, hitOverride) {
    if (!p.pressed) return;
    const target = p.pressed.object;
    const h = hitOverride !== undefined ? hitOverride : this._hitOn(p, target);
    p.pressed = null;
    target.userData.ui.onUp?.(h, p);
    if (!h) { target.userData.ui.onLeave?.(p); p.hovered = null; }
  }

  update(dt) {
    for (const p of this.pointers) {
      this._update(p);
      // thumbsticks + face buttons
      const gp = p.source?.gamepad;
      if (gp) {
        const x = gp.axes[2] ?? 0, y = gp.axes[3] ?? 0;
        if (Math.abs(x) > 0.15 || Math.abs(y) > 0.15) {
          const target = p.hovered?.object.userData.ui;
          if (target?.onStick && Math.abs(y) > Math.abs(x)) target.onStick(y, dt);
          else this.onStick?.(p.handedness, x, y, dt);
        } else this.onStick?.(p.handedness, 0, 0, dt);
        gp.buttons.forEach((b, i) => {
          if (b.pressed && !p.buttonsPrev[i] && i >= 3) this.onButton?.(p.handedness, i);
          p.buttonsPrev[i] = b.pressed;
        });
      }
    }
  }
}
