// The in-VR "connect" card: what you see when the app opens straight into VR before the room
// can reach your hub. Views:
//   welcome  first time: Pair with my hub · Get the hub · Try the demo
//   gethub   where to download the hub (a short address to type on the PC), three steps
//   pair     the number pad for the 6-digit code (with Back and Try the demo)
//   status   "Connecting…", or a problem with Try again (and Try the demo)
// so nothing ever needs the flat browser page.
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
  let onDemo = () => {};
  let onConnect = () => {};
  let onCancel = () => {};
  let pairFn = null;
  let nearby = []; // hubs found in this home: [{ id, name }]

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
  retry.group.position.set(-0.11, -0.12, 0);
  group.add(retry.group);

  // the choices (welcome / get the hub) and the small row under the number pad
  const B = (label, accent, x, y, w, onClick, icon) => {
    const b = makeButton(pointer, sfx, { w, h: 0.066, label: t(label), accent, icon, onClick });
    b.group.position.set(x, y, 0);
    b.key = label;
    group.add(b.group);
    return b;
  };
  const toPair = () => { if (pairFn) api.pair(pairFn); };
  const choice = {
    pair: B('connect.havePair', P.amber, 0, -0.03, 0.4, toPair),
    get: B('connect.getHub', P.cyan, 0, -0.115, 0.4, () => show('gethub')),
    demo: B('connect.demo', P.magenta, 0, -0.2, 0.4, () => onDemo()),
  };
  // when your hub is found: one big Connect, the rest below it
  const connectBtn = B('connect.oneClick', P.amber, 0, -0.03, 0.44, () => nearby[0] && onConnect(nearby[0]));
  connectBtn.key = null; // label carries the PC's name (set in draw)
  const found = {
    code: B('connect.haveCode', P.cyan, -0.105, -0.115, 0.2, toPair),
    get: B('connect.getHubShort', P.cyan, 0.105, -0.115, 0.2, () => show('gethub')),
    demo: B('connect.demo', P.magenta, 0, -0.2, 0.42, () => onDemo()),
  };
  const cancelBtn = B('connect.cancel', P.cyan, 0, -0.12, 0.2, () => onCancel());
  // the unlock (after the free week, or from the trial button)
  let onBuy = () => {};
  const buyBtn = B('connect.unlockBtn', P.amber, 0, -0.06, 0.42, () => onBuy());
  buyBtn.key = null; // label carries the price
  const laterBtn = B('connect.demo', P.magenta, 0, -0.145, 0.42, () => (state.expired ? onDemo() : laterBtn.group.userData.later?.()));
  laterBtn.key = null;
  let onEmail = () => {};
  const emailBtn = B('connect.emailMe', P.amber, 0, -0.115, 0.42, () => onEmail());
  const ghub = {
    email: emailBtn,
    pair: B('connect.pairNow', P.cyan, -0.16, -0.2, 0.15, toPair),
    demo: B('connect.demo', P.magenta, 0, -0.2, 0.15, () => onDemo()),
    back: B('connect.back', P.cyan, 0.16, -0.2, 0.15, () => show('welcome')),
  };
  const under = {
    back: B('connect.back', P.cyan, -0.09, -0.3, 0.16, () => show('welcome')),
    demo: B('connect.demo', P.magenta, 0.09, -0.3, 0.16, () => onDemo()),
  };
  const statusDemo = B('connect.demo', P.magenta, 0.11, -0.12, 0.2, () => onDemo());
  // ---- the email keyboard (in VR: leaving VR can close the installed app, so we type here)
  let kb = null;
  let onEmailSend = async () => {};
  function buildKeyboard() {
    if (kb) return kb;
    const g = new THREE.Group();
    const rows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm.-_'];
    const KW = 0.043, GAP = 0.004, top = -0.005;
    const keys = [];
    const press = (k) => { if (state.emailBusy) return; state.emailMsg = ''; if (k === 'del') state.email = state.email.slice(0, -1); else if (state.email.length < 80) state.email += k; draw(); };
    rows.forEach((row, r) => {
      [...row].forEach((ch, i) => {
        const b = makeButton(pointer, sfx, { w: KW, h: 0.042, label: ch, accent: P.cyan, onClick: () => press(ch) });
        b.group.position.set((i - (row.length - 1) / 2) * (KW + GAP), top - r * 0.048, 0);
        g.add(b.group); keys.push(b);
      });
    });
    const y4 = top - 4 * 0.048, y5 = y4 - 0.052;
    const wide = (label, x, y, w, fn, accent = P.cyan) => { const b = makeButton(pointer, sfx, { w, h: 0.042, label, accent, onClick: fn }); b.group.position.set(x, y, 0); g.add(b.group); keys.push(b); return b; };
    wide('@gmail.com', -0.16, y4, 0.15, () => press('@gmail.com'));
    wide('@', -0.05, y4, 0.05, () => press('@'));
    wide('.com', 0.025, y4, 0.08, () => press('.com'));
    wide('⌫', 0.105, y4, 0.06, () => press('del'));
    const news = wide('', 0.19, y4, 0.09, () => { state.news = !state.news; draw(); }, P.amber);
    const cancel = wide('', -0.1, y5, 0.16, () => onCancel());
    const send = wide('', 0.1, y5, 0.2, async () => {
      if (state.emailBusy) return;
      state.emailBusy = true; state.emailMsg = t('email.sending'); draw();
      try { state.emailMsg = await onEmailSend(state.email, state.news); state.emailDone = true; } catch (e) { state.emailMsg = e.message; }
      finally { state.emailBusy = false; draw(); }
    }, P.amber);
    g.traverse((o) => { o.renderOrder = 42; if (o.material) o.material.depthTest = false; });
    g.position.set(0, -0.035, 0);
    group.add(g);
    kb = { g, keys, news, cancel, send };
    return kb;
  }

  // the info view (first-visit tour, "turn on your microphone?"): one or two buttons
  let info = null; // { title, sub, icon, page: [i, n], primary: { label, onClick }, secondary? }
  const infoMain = B('connect.next', P.amber, 0.105, -0.2, 0.2, () => info?.primary?.onClick());
  const infoAlt = B('connect.cancel', P.cyan, -0.105, -0.2, 0.2, () => info?.secondary?.onClick());
  infoMain.key = infoAlt.key = null;
  const allExtra = [...Object.values(choice), ...Object.values(ghub), ...Object.values(under), statusDemo, ...Object.values(found), cancelBtn, buyBtn, laterBtn, infoMain, infoAlt];
  function show(view) {
    Object.assign(state, { view, error: '' });
    group.visible = true;
    draw();
  }

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
    const title = { pair: t('connect.pairTitle'), welcome: t('connect.welcomeTitle'), gethub: t('connect.getTitle'), waiting: t('connect.waitTitle'),
      unlock: t(state.expired ? 'connect.unlockOver' : 'connect.unlockTitle'), info: info?.title, email: t('email.vrTitle') }[state.view] || t('app.name');
    c.fillText(title, W / 2, 140);
    c.fillStyle = '#9aa3c7';
    c.font = font(34);
    const msg = state.view === 'pair' ? (state.busy ? t('link.connecting') : t('connect.pairSub'))
      : state.view === 'welcome' ? (nearby.length ? t('connect.foundSub', { name: nearby[0].name || 'PC' }) : t('connect.welcomeSub'))
      : state.view === 'waiting' ? t('connect.waitSub', { name: state.waitName || 'PC' })
      : state.view === 'unlock' ? (state.error || t(state.canBuy ? 'connect.unlockSub' : 'connect.unlockNoStore', { price: state.price }))
      : state.view === 'info' ? info?.sub || ''
      : state.view === 'email' ? (state.emailMsg || t('email.vrSub'))
      : state.view === 'gethub' ? t('connect.getSub')
      : t(state.msg, state.vars || {});
    wrap(c, msg, W / 2, 205, W - 120, 44);
    if (state.view === 'email') { // what you've typed, big, with a caret
      roundRect(c, 60, 288, W - 120, 92, 20);
      c.fillStyle = 'rgba(255,255,255,0.07)'; c.fill();
      c.lineWidth = 3; c.strokeStyle = state.emailDone ? '#6be3a4' : 'rgba(92,225,230,0.7)'; c.stroke();
      c.fillStyle = state.email ? '#ffffff' : '#6f789e'; c.font = font(44, 650);
      const caret = !state.emailDone && Math.floor(performance.now() / 500) % 2 ? '|' : ' ';
      c.fillText(ellipsize(c, (state.email || t('email.placeholder')) + (state.email ? caret : ''), W - 160), W / 2, 336);
    }
    if (state.view === 'info' && info) {
      if (info.icon) { c.font = font(110); c.fillText(info.icon, W / 2, 380); }
      if (info.page) { // page dots
        const [i, n] = info.page;
        for (let k = 0; k < n; k++) {
          c.fillStyle = k === i ? '#ffb35c' : 'rgba(207,216,255,0.3)';
          c.beginPath(); c.arc(W / 2 + (k - (n - 1) / 2) * 30, 500, k === i ? 9 : 7, 0, Math.PI * 2); c.fill();
        }
      }
    }
    if (state.view === 'gethub') {
      // the address, big, in a box — typed on the PC
      roundRect(c, 70, 300, W - 140, 104, 22);
      c.fillStyle = 'rgba(92,225,230,0.12)'; c.fill();
      c.lineWidth = 2; c.strokeStyle = 'rgba(92,225,230,0.6)'; c.stroke();
      c.fillStyle = '#ffffff'; c.font = font(44, 750);
      c.fillText(ellipsize(c, CONFIG.getHubAddress, W - 180), W / 2, 354);
      c.fillStyle = '#9aa3c7'; c.font = font(28, 500);
      c.fillText(t('connect.getSteps'), W / 2, 448);
      c.fillStyle = '#5ce1e6'; c.font = font(26, 600);
      c.fillText(ellipsize(c, t('connect.getHint'), W - 100), W / 2, 500);
    }
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
    } else if ((state.view === 'status' && state.msg === 'link.connecting') || state.view === 'waiting') {
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
    const hasHub = state.view === 'welcome' && nearby.length > 0;
    for (const b of Object.values(choice)) b.group.visible = state.view === 'welcome' && !hasHub;
    for (const b of Object.values(found)) b.group.visible = hasHub;
    connectBtn.group.visible = hasHub;
    if (hasHub) connectBtn.setLabel(t('connect.oneClick', { name: nearby[0].name || 'PC' }));
    cancelBtn.group.visible = state.view === 'waiting';
    buyBtn.group.visible = laterBtn.group.visible = state.view === 'unlock';
    if (kb) {
      kb.g.visible = state.view === 'email';
      kb.news.setLabel(`${state.news ? '☑' : '☐'} ${t('email.newsShort')}`);
      kb.cancel.setLabel(t(state.emailDone ? 'email.done' : 'connect.back'));
      kb.send.setLabel(t(state.emailBusy ? 'email.sending' : 'email.sendShort'));
      kb.send.group.visible = state.view === 'email' && !state.emailDone;
    }
    const isInfo = state.view === 'info' && !!info;
    infoMain.group.visible = isInfo;
    infoAlt.group.visible = isInfo && !!info.secondary;
    if (isInfo) {
      infoMain.setLabel(info.primary.label);
      if (info.secondary) infoAlt.setLabel(info.secondary.label);
      // one button: centred and wider; two: side by side
      infoMain.group.position.x = info.secondary ? 0.105 : 0;
    }
    buyBtn.setLabel(state.busy && state.view === 'unlock' ? t('connect.unlocking') : t('connect.unlockBtn', { price: state.price || '' }));
    laterBtn.setLabel(t(state.expired ? 'connect.demo' : 'connect.notNow'));
    for (const b of Object.values(ghub)) b.group.visible = state.view === 'gethub';
    for (const b of Object.values(under)) b.group.visible = state.view === 'pair';
    statusDemo.group.visible = state.view === 'status' && !!state.retry;
    for (const b of allExtra) if (b.key) b.setLabel(t(b.key));
    okBtn.setLabel(t('pair.button'));
    retry.setLabel(t('connect.retry'));
  }
  onLang(draw);

  // Always in front of the room (the big screen's own text must not show through), and solid.
  // fixed layers, whatever the card's tilt: backing, then the text, then the buttons
  group.traverse((o) => { o.renderOrder = 42; if (o.material) o.material.depthTest = false; });
  plate.traverse((o) => { o.renderOrder = 40; });
  headMesh.renderOrder = 41;
  plate.material.opacity = 0.96;

  const api = {
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
      pairFn = fn;
      Object.assign(state, { view: 'pair', digits: '', error: '', busy: false });
      group.visible = true;
      draw();
    },
    onRetry(fn) { onRetry = fn; },
    onDemo(fn) { onDemo = fn; },
    onConnect(fn) { onConnect = fn; },
    onEmail(fn) { onEmail = fn; },
    onCancel(fn) { onCancel = fn; },
    /** Hubs found in this home; the welcome card offers one-click Connect when there is one. */
    setNearby(list) {
      const before = nearby.map((h) => h.id).join();
      nearby = list || [];
      if (nearby.map((h) => h.id).join() !== before && (state.view === 'welcome' || state.view === 'gethub')) { if (nearby.length) sfx.select?.(); show('welcome'); }
    },
    /**
     * The unlock card. { price, expired, canBuy, buy: async () => bought?, later } — expired: the free
     * week is over (the other button is the demo); otherwise it's "Not now" (back to the room).
     */
    unlock({ price, expired, canBuy, buy, later }) {
      Object.assign(state, { price, expired, canBuy, error: '', busy: false });
      onBuy = async () => {
        if (state.busy) return;
        state.busy = true; state.error = ''; draw();
        try { await buy(); } catch (e) { state.error = e.message; } finally { state.busy = false; if (group.visible) draw(); }
      };
      if (!expired) laterBtn.group.userData.later = later;
      show('unlock');
    },
    /** Type an email address in VR. send(email, news) → resolves with a message, or throws. */
    emailForm(send) {
      onEmailSend = send;
      buildKeyboard();
      Object.assign(state, { email: state.email || '', emailMsg: '', emailBusy: false, emailDone: false, news: !!state.news });
      show('email');
    },
    /** A short card: { title, sub, icon, page: [i, n], primary: { label, onClick }, secondary? }. */
    info(card) { info = card; show('info'); },
    /** "Almost there: click Allow on your PC". */
    waiting(name) { state.waitName = name; show('waiting'); },
    get view() { return group.visible ? state.view : null; },
    /** First time here: Pair with my hub · Get the hub · Try the demo. fn = what Pair does with a code. */
    welcome(fn) { pairFn = fn; onCode = fn; show('welcome'); },
    press, // same as pointing at a key (used by tests)
    hide() { group.visible = false; },
    update() { if (group.visible && ((state.view === 'status' && state.msg === 'link.connecting') || state.view === 'waiting' || state.view === 'email')) draw(); },
  };
  return api;
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
