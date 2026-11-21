// The in-VR "connect" card: what you see when the app opens straight into VR before the room
// can reach your hub. It shows "Connecting…", a hub-offline message with Try again, or a
// number pad to type the 6-digit pairing code — so nothing ever needs the flat browser page.
import * as THREE from 'three';
import { makeButton, makePlate } from './widgets.js';
import { canvasTexture, font, ellipsize, roundRect } from './text.js';
import { CONFIG } from '../config.js';
import { t, onLang } from '../i18n.js';

const P = CONFIG.palette;
const W = 1024, H = 560;

export function createConnectPanel({ pointer, sfx }) {
  const group = new THREE.Group();
  group.visible = false;
  const plate = makePlate(0.52, 0.62, 0.04);
  plate.position.set(0, -0.03, -0.012);
  group.add(plate);

  const head = canvasTexture(W, H);
  const headMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48 * (H / W)), new THREE.MeshBasicMaterial({ map: head.tex, transparent: true, depthWrite: false }));
  headMesh.position.set(0, 0.14, 0.002);
  group.add(headMesh);

  const state = { view: 'status', msg: 'link.connecting', vars: null, digits: '', error: '', busy: false };
  let onCode = async () => {};
  let onRetry = () => {};

  // number pad: 1 2 3 / 4 5 6 / 7 8 9 / ⌫ 0 Pair
  const pad = new THREE.Group();
  pad.position.set(0, -0.125, 0);
  group.add(pad);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  const buttons = keys.map((k, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const b = makeButton(pointer, sfx, {
      w: k === 'ok' ? 0.13 : 0.1, h: 0.062,
      label: k === 'ok' ? t('pair.button') : k === 'del' ? undefined : k,
      icon: k === 'del' ? 'back' : undefined,
      accent: k === 'ok' ? P.amber : P.cyan,
      onClick: () => press(k),
    });
    b.group.position.set((col - 1) * 0.135, -row * 0.075 + 0.11, 0);
    pad.add(b.group);
    return { k, b };
  });
  const okBtn = buttons.find((x) => x.k === 'ok').b;

  const retry = makeButton(pointer, sfx, { w: 0.2, h: 0.066, label: t('connect.retry'), accent: P.amber, onClick: () => onRetry() });
  retry.group.position.set(0, -0.12, 0);
  group.add(retry.group);

  function press(k) {
    if (state.busy) return;
    state.error = '';
    if (k === 'del') state.digits = state.digits.slice(0, -1);
    else if (k === 'ok') submit();
    else if (state.digits.length < 6) {
      state.digits += k;
      if (state.digits.length === 6) setTimeout(submit, 250); // the sixth digit sends it
    }
    draw();
  }

  async function submit() {
    if (state.busy || state.digits.length !== 6) return;
    state.busy = true;
    draw();
    try {
      await onCode(state.digits);
    } catch (e) {
      state.error = e.message || 'error';
      if (!e.keepCode) state.digits = '';
    } finally {
      state.busy = false;
      draw();
    }
  }

  function draw() {
    const c = head.ctx;
    c.clearRect(0, 0, W, H);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // moon + title
    c.fillStyle = '#cfd8ff';
    c.beginPath(); c.arc(W / 2, 62, 26, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0b1026';
    c.beginPath(); c.arc(W / 2 + 12, 54, 22, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e8ecff';
    c.font = font(58, 750);
    c.fillText(state.view === 'pair' ? t('connect.pairTitle') : t('app.name'), W / 2, 140);
    c.fillStyle = '#9aa3c7';
    c.font = font(34);
    const msg = state.view === 'pair' ? (state.busy ? t('link.connecting') : t('connect.pairSub')) : t(state.msg, state.vars || {});
    wrap(c, msg, W / 2, 205, W - 120, 44);
    if (state.view === 'pair') {
      // six digit slots
      const sw = 104, gap = 18, x0 = W / 2 - (6 * sw + 5 * gap) / 2, y = 300;
      for (let i = 0; i < 6; i++) {
        const x = x0 + i * (sw + gap);
        const filled = i < state.digits.length;
        const cur = i === state.digits.length && !state.busy;
        roundRect(c, x, y, sw, 120, 20);
        c.fillStyle = filled ? 'rgba(92,225,230,0.16)' : 'rgba(255,255,255,0.06)';
        c.fill();
        c.lineWidth = cur ? 5 : 2;
        c.strokeStyle = cur ? '#5ce1e6' : 'rgba(207,216,255,0.25)';
        c.stroke();
        if (filled) { c.fillStyle = '#ffffff'; c.font = font(72, 750); c.fillText(state.digits[i], x + sw / 2, y + 64); }
      }
      if (state.error) { c.fillStyle = '#ff9a8a'; c.font = font(30, 600); wrap(c, state.error, W / 2, 470, W - 80, 38); }
    } else if (state.view === 'status' && state.msg === 'link.connecting') {
      // a gentle three-dot pulse
      const ph = performance.now() / 400;
      for (let k = 0; k < 3; k++) {
        c.fillStyle = `rgba(92,225,230,${0.3 + 0.7 * Math.max(0, Math.sin(ph - k * 0.7))})`;
        c.beginPath(); c.arc(W / 2 + (k - 1) * 40, 330, 11, 0, Math.PI * 2); c.fill();
      }
    }
    head.tex.needsUpdate = true;
    pad.visible = state.view === 'pair';
    retry.group.visible = state.view === 'status' && !!state.retry;
    okBtn.setLabel(t('pair.button'));
    retry.setLabel(t('connect.retry'));
  }
  onLang(draw);

  return {
    group,
    get visible() { return group.visible; },
    /** Show a message: key from i18n, optional Try again button. */
    status(msg, { vars, retry: canRetry = false } = {}) {
      Object.assign(state, { view: 'status', msg, vars, retry: canRetry });
      group.visible = true;
      draw();
    },
    /** Show the number pad. fn(code) resolves when paired, or throws an Error with a message to show. */
    pair(fn) {
      onCode = fn;
      Object.assign(state, { view: 'pair', digits: '', error: '', busy: false });
      group.visible = true;
      draw();
    },
    onRetry(fn) { onRetry = fn; },
    press, // same as pointing at a key (used by tests)
    hide() { group.visible = false; },
    update() { if (group.visible && state.view === 'status' && state.msg === 'link.connecting') draw(); },
  };
}

function wrap(c, text, x, y, maxW, lh) {
  const words = /[　-鿿]/.test(text) ? [...text] : text.split(' ');
  const sep = /[　-鿿]/.test(text) ? '' : ' ';
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + sep + w : w;
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => c.fillText(ellipsize(c, l, maxW), x, y + i * lh));
}
