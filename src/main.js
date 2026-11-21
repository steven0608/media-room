// Media Room — entry point. Builds the night-lake room, wires the three modes,
// and runs the same page as a desktop preview or as an immersive VR session.
import * as THREE from 'three';
import { api, store } from './api.js';
import { CONFIG } from './config.js';
import { RoomState } from './room/roomState.js';
import { createSky } from './room/sky.js';
import { createLake } from './room/lake.js';
import { createDeck } from './room/deck.js';
import { createMotes } from './room/motes.js';
import { createAurora } from './room/aurora.js';
import { createSoundRing } from './room/soundRing.js';
import { createMeteors } from './room/meteors.js';
import { Spectrum } from './audio/spectrum.js';
import { createScreen } from './room/screen.js';
import { createReeds } from './room/reeds.js';
import { createEnvironment, createMic } from './room/environment.js';
import { AudioEngine, BeatDetector } from './audio/engine.js';
import { Sfx } from './audio/sfx.js';
import { PointerSystem } from './ui/pointer.js';
import { updateWidgets } from './ui/widgets.js';
import { createConsole } from './ui/console.js';
import { LibraryPanel } from './ui/library.js';
import { createConnectPanel } from './ui/connect.js';
import { MusicMode } from './modes/music.js';
import { CinemaMode } from './modes/cinema.js';
import { KaraokeMode } from './modes/karaoke.js';
import { t as tr, onLang, toggleLang, applyDom, num, errorText } from './i18n.js';
import { link } from './link.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer + scene
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const rig = new THREE.Group(); // you: snap-turn rotates this
scene.add(rig);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 1000);
camera.position.set(0, CONFIG.seatedEyeHeight, 0);
rig.add(camera);

const room = new RoomState();
const engine = new AudioEngine();
const spectrum = new Spectrum(engine); // the sound, shaped for the visuals (shared by everything that dances)
const sky = createSky(room);
const lake = createLake(spectrum);
const aurora = createAurora(spectrum);
const soundRing = createSoundRing(spectrum);
const meteors = createMeteors();
const deck = createDeck();
const motes = createMotes();
const screen = createScreen(renderer);
const reeds = createReeds();
const environment = createEnvironment();
scene.add(sky.group, aurora.mesh, meteors.group, environment.group, lake.mesh, soundRing.group, deck.group, motes.points, reeds.mesh, screen.group);

// The karaoke microphone rides on your right controller (grip space) in VR.
const mic = createMic();
for (let i = 0; i < 2; i++) {
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(grip);
  grip.addEventListener('connected', (e) => { if (e.data.handedness === 'right' || !mic.group.parent) grip.add(mic.group); });
}

// ---------------------------------------------------------------- audio + input
const sfx = new Sfx(engine);
const beat = new BeatDetector(CONFIG.beat);
const pointer = new PointerSystem({ renderer, camera, rig, canvas, sfx });

// UI anchor: follows where you sit (and your height in VR)
const ui = new THREE.Group();
ui.position.set(0, CONFIG.seatedEyeHeight, 0);
scene.add(ui);

// ---------------------------------------------------------------- modes
const music = new MusicMode({ engine, sfx });
const cinema = new CinemaMode({ engine, sfx, screen, pointer });
const karaoke = new KaraokeMode({ engine, sfx, screen, pointer, room });
scene.add(cinema.group);
if (karaoke.group) scene.add(karaoke.group);
const modes = { music, cinema, karaoke };
let mode = 'idle';

const library = new LibraryPanel({
  pointer,
  sfx,
  onPlayMusic: (items, i, folder) => { setMode('music'); music.play(items, i, folder); library.playingId = music.current?.id; library.dirty = true; },
  onPlayVideo: (item) => { setMode('cinema'); library.close(); cinema.play(item); },
  onKaraoke: (song) => { setMode('karaoke'); library.close(); karaoke.start(song); },
});
library.group.position.y = -0.06;
ui.add(library.group);

// Touch the water: point at the lake and pull the trigger for ripples (hold and sweep to draw
// them); the fireflies swarm to where you touch. VR only, so desktop drag-to-look still works.
const waterTouch = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
waterTouch.position.y = CONFIG.waterY + 0.05;
scene.add(waterTouch);
let lastDrop = 0;
const touchWater = (hit, strength) => {
  const { x, z } = hit.point;
  if (Math.hypot(x, z) < CONFIG.deckRadius + 0.3) return false; // that is the deck, not water
  lake.touch(x, z, t, strength);
  motes.attractTo(x, CONFIG.waterY + 0.6, z, 1);
  return true;
};
pointer.add(waterTouch, {
  onDown: (hit, p) => { if (hit && touchWater(hit, 1)) { sfx.drop(); lastDrop = t; pointer.haptic(p, 0.35, 20); } },
  onMove: (hit, p) => { if (p.pressed && hit && t - lastDrop > 0.14 && touchWater(hit, 0.7)) { lastDrop = t; pointer.haptic(p, 0.15, 8); } },
  onUp: () => motes.attractTo(0, 0, 0, 0),
  onLeave: () => motes.attractTo(0, 0, 0, 0),
});

// Buttons drawn on the big screen (Music: "Sing this", "Watch video").
const screenUv = (hit) => ({ x: hit.uv.x * 1280, y: (1 - hit.uv.y) * 720 });
// Karaoke: "My voice − / +" and "Echo".
const screenTarget = () => (mode === 'music' ? music : mode === 'karaoke' ? karaoke : null);
pointer.add(screen.mesh, {
  onMove: (hit) => { const m = screenTarget(); if (m) { const p = screenUv(hit); m.setHover(m.hit(p.x, p.y)); } },
  onLeave: () => { music.setHover(null); karaoke.setHover(null); },
  onUp: (hit) => { const m = screenTarget(); if (hit && m) { const p = screenUv(hit); m.click(m.hit(p.x, p.y)); } },
});
music.onAction = async (key) => {
  const m = music.match;
  if (key === 'sing' && m?.karaoke?.ready) {
    setMode('karaoke');
    karaoke.start({ id: m.karaoke.id });
  } else if (key === 'prepare' && music.current) {
    // Queue this song for karaoke; the screen shows progress and says when it's ready.
    try { m.karaoke = await api(`/api/karaoke/prepare/${music.current.id}`, { method: 'POST' }); } catch { /* shown as unavailable */ }
    music.draw();
    music.refreshMatch();
  } else if (key === 'video' && m?.videos?.length) {
    setMode('cinema');
    cinema.play(m.videos[0]);
  }
};
// While a song is being prepared, check on it every 2 seconds.
setInterval(() => { if (music.preparing) music.refreshMatch(); }, 2000);

const consoleUi = createConsole({
  pointer,
  sfx,
  actions: {
    mode: (m) => setMode(m),
    library: () => library.toggle(mode === 'cinema' ? 'video' : mode === 'karaoke' ? 'karaoke' : 'music'),
    toggle: () => togglePlay(),
    prev: () => (mode === 'cinema' ? cinema.skip(-10) : music.prev()),
    next: () => (mode === 'cinema' ? cinema.skip(+10) : music.next()),
    volume: (d) => setVolume(engine.volume + d),
  },
});
ui.add(consoleUi.group);

// The installed Quest app opens straight into VR, so connecting and pairing happen on this
// card in front of you instead of on a flat page.
const APP_MODE = params.has('app') || matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: fullscreen)').matches || typeof window.getDigitalGoodsService === 'function';
const connectUi = createConnectPanel({ pointer, sfx });
connectUi.group.position.set(0, -0.02, -0.78);
ui.add(connectUi.group);
// In VR the console sits low at your right hand; on a flat monitor it moves up into view.
function placeConsole(vr) {
  const [x, y, z, tilt] = vr ? [0.34, -0.42, -0.5, -0.62] : [0.4, -0.35, -0.68, -0.35];
  consoleUi.group.position.set(x, y, z);
  consoleUi.group.rotation.set(tilt, Math.atan2(-x, -z), 0, 'YXZ');
}
placeConsole(false);

function setVolume(v) {
  engine.setVolume(v);
  consoleUi.setVolume(engine.volume);
  store.set('volume', engine.volume);
}
engine.volume = store.get('volume', 0.8);
consoleUi.setVolume(engine.volume);

function setMode(m) {
  if (m === mode) return;
  const prevMode = mode;
  mode = m;
  room.setMode(m);
  consoleUi.setMode(m);
  consoleUi.setSkipIcons(m === 'cinema');
  if (m !== 'music' && music.playing) music.pause();
  if (m !== 'cinema' && cinema.playing) cinema.pause();
  if (m !== 'karaoke') karaoke.pause();
  if (m === 'music') screen.setTexture(music.texture);
  if (m === 'cinema') screen.setTexture(cinema.info ? cinema.texture : null, cinema.aspect || 16 / 9);
  if (m === 'karaoke') screen.setTexture(karaoke.texture);
  if (prevMode !== 'idle') sfx.swell(m !== 'cinema');
  if (library.isOpen) library.open(m === 'cinema' ? 'video' : m === 'karaoke' ? 'karaoke' : 'music');
  setFrameRate();
  updateHud();
}

function togglePlay() {
  if (mode === 'cinema') { if (!cinema.toggle()) library.open('video'); }
  else if (mode === 'karaoke') { if (!karaoke.toggle()) library.open('karaoke'); }
  else { setMode('music'); if (!music.toggle()) library.open('music'); }
}

music.onChange = () => {
  consoleUi.setPlaying(music.playing);
  consoleUi.setNowPlaying(music.current ? `${music.current.title}${music.current.artist ? ` · ${music.current.artist}` : ''}` : '');
  library.playingId = music.current?.id;
  library.dirty = true;
  sfx.mediaPlaying = music.playing || cinema.playing;
};
cinema.onChange = () => {
  consoleUi.setPlaying(cinema.playing);
  if (cinema.info) consoleUi.setNowPlaying(cinema.info.title);
  screen.setTexture(cinema.texture, cinema.aspect || 16 / 9);
  sfx.mediaPlaying = music.playing || cinema.playing;
};
karaoke.onChange = () => consoleUi.setPlaying(karaoke.playing);

// ---------------------------------------------------------------- desktop look + keys
let yaw = 0, pitch = -0.04;
pointer.onLook = (dx, dy) => {
  yaw -= dx * 0.0035;
  pitch = THREE.MathUtils.clamp(pitch - dy * 0.0035, -1.1, 1.1);
};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === '1') setMode('music');
  else if (k === '2') setMode('cinema');
  else if (k === '3') setMode('karaoke');
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'l') library.toggle(mode === 'cinema' ? 'video' : mode === 'karaoke' ? 'karaoke' : 'music');
  else if (k === 'arrowright') mode === 'cinema' ? cinema.skip(10) : music.next();
  else if (k === 'arrowleft') mode === 'cinema' ? cinema.skip(-10) : music.prev();
  else if (k === 'arrowup' || k === '+' || k === '=') setVolume(engine.volume + 0.05);
  else if (k === 'arrowdown' || k === '-') setVolume(engine.volume - 0.05);
  else if (k === 'escape') library.isOpen ? library.close() : showWelcome();
  if (mode === 'cinema') cinema.poke();
});

// ---------------------------------------------------------------- VR controls
let turnReady = true, skipReady = true;
const tmpV = new THREE.Vector3();
function headWorld(out) {
  return renderer.xr.isPresenting ? renderer.xr.getCamera().getWorldPosition(out) : camera.getWorldPosition(out);
}
function snapTurn(dir) {
  const a = THREE.MathUtils.degToRad(CONFIG.snapTurnDegrees) * -dir;
  const head = headWorld(new THREE.Vector3());
  rig.position.sub(head).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).add(head);
  rig.rotation.y += a;
  ui.rotation.y += a;
  ui.position.sub(head).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).add(head);
}
pointer.onStick = (hand, x, y, dt) => {
  if (mode === 'cinema' && (x || y)) cinema.poke();
  if (hand === 'right') {
    if (Math.abs(x) > 0.7 && turnReady) { snapTurn(Math.sign(x)); turnReady = false; }
    if (Math.abs(x) < 0.3) turnReady = true;
  } else if (hand === 'left') {
    if (Math.abs(y) > 0.3) setVolume(engine.volume - y * dt * 0.6);
    if (Math.abs(x) > 0.7 && skipReady) { skipReady = false; const d = Math.sign(x); mode === 'cinema' ? cinema.skip(10 * d) : d > 0 ? music.next() : music.prev(); }
    if (Math.abs(x) < 0.3) skipReady = true;
  }
};
pointer.onButton = (hand, i) => {
  if (mode === 'cinema') cinema.poke();
  if (hand === 'right' && i === 4) togglePlay();                       // A
  if (hand === 'right' && i === 5) consoleUi && library.toggle(mode === 'cinema' ? 'video' : mode === 'karaoke' ? 'karaoke' : 'music'); // B
  if (hand === 'left' && i === 4) setMode(mode === 'music' ? 'cinema' : mode === 'cinema' ? 'karaoke' : 'music'); // X
  if (hand === 'left' && i === 5) placeUiAtHead();                     // Y = recentre the console/library
};

function placeUiAtHead() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(tmpV);
  ui.position.copy(tmpV);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
  ui.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
}

// ---------------------------------------------------------------- XR session
let xrSession = null;
let placeFrames = 0;
async function enterVR() {
  engine.unlock();
  // Ask for the microphone now, on the flat page: permission prompts are unreliable inside VR.
  if (hasKaraoke && !karaoke.autosing) await karaoke.mic.open();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] });
    xrSession = session;
    await renderer.xr.setSession(session);
    hideOverlays();
    $('hud').classList.add('hidden');
    placeConsole(true);
    placeFrames = 25; // measure your head height after tracking settles
    if (mode === 'idle') setMode('music');
    setFrameRate();
    session.addEventListener('end', () => { xrSession = null; placeConsole(false); ui.position.set(0, CONFIG.seatedEyeHeight, 0); ui.rotation.set(0, 0, 0); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); showWelcome(); });
    renderer.xr.getReferenceSpace()?.addEventListener?.('reset', () => { placeFrames = 5; });
  } catch (e) {
    welcomeNote = { key: 'welcome.vrFailed', vars: { msg: e.message } };
    updateWelcome();
  }
}
function setFrameRate() {
  const s = xrSession;
  if (!s?.updateTargetFrameRate || !s.supportedFrameRates) return;
  const want = mode === 'cinema' ? CONFIG.frameRate.cinema : CONFIG.frameRate.other;
  const rates = [...s.supportedFrameRates];
  const best = rates.includes(want) ? want : rates.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), rates[0]);
  s.updateTargetFrameRate(best).catch(() => {});
}

// ---------------------------------------------------------------- overlays
function hideOverlays() { for (const id of ['pairing', 'welcome']) $(id).classList.add('hidden'); }
function showWelcome() {
  hideOverlays();
  $('welcome').classList.remove('hidden');
  $('hud').classList.add('hidden');
}
function startPreview() {
  engine.unlock();
  hideOverlays();
  $('hud').classList.remove('hidden');
  if (mode === 'idle') setMode('music');
}
let libraryCounts = null;
let hasKaraoke = false;
let vrState = 'checking'; // checking | ok | none
let welcomeNote = null;    // { key, vars }
function updateHud() {
  const c = libraryCounts;
  const via = link.active ? ` · ${tr(link.state === 'open' && link.route ? `link.route.${link.route}` : `link.state.${link.state}`)}` : '';
  $('hud-status').textContent = `${tr(`mode.${mode}`)}${c ? ` · ${tr('hud.counts', { music: num(c.music), video: num(c.video) })}` : ''}${via}`;
}
function updateWelcome() {
  const c = libraryCounts;
  if (c) $('welcome-sub').textContent = c.music || c.video ? tr('welcome.counts', { music: num(c.music), video: num(c.video) }) : tr('welcome.empty');
  $('enter-vr').textContent = tr(vrState === 'ok' ? 'welcome.enterVr' : vrState === 'none' ? 'welcome.noVr' : 'welcome.checkingVr');
  $('welcome-note').textContent = welcomeNote ? tr(welcomeNote.key, welcomeNote.vars) : '';
}
function relang() {
  applyDom();
  updateHud();
  updateWelcome();
  document.querySelectorAll('#code-boxes input').forEach((inp, i) => inp.setAttribute('aria-label', tr('pair.digit', { n: i + 1 })));
}
onLang(relang);
for (const id of ['lang-welcome', 'lang-hud']) $(id).addEventListener('click', toggleLang);

function pairingUi() {
  const boxes = $('code-boxes');
  const inputs = Array.from({ length: 6 }, (_, i) => {
    const inp = document.createElement('input');
    inp.inputMode = 'numeric';
    inp.maxLength = 6; // accept a whole code typed or pasted into one box (spread out below)
    inp.setAttribute('aria-label', tr('pair.digit', { n: i + 1 }));
    inp.addEventListener('input', () => {
      const d = inp.value.replace(/\D/g, '');
      d.split('').slice(0, 6 - i).forEach((ch, k) => { inputs[i + k].value = ch; });
      if (!d) inp.value = '';
      const next = Math.min(5, i + Math.max(1, d.length));
      if (d && next !== i) inputs[next].focus();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && i) inputs[i - 1].focus(); });
    inp.addEventListener('paste', (e) => {
      const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (d.length) { e.preventDefault(); d.split('').forEach((ch, k) => { inputs[k].value = ch; }); inputs[Math.min(5, d.length)].focus(); }
    });
    boxes.appendChild(inp);
    return inp;
  });
  $('pairing').classList.remove('hidden');
  inputs[0].focus();
  let busy = false;
  const button = $('pair-form').querySelector('button[type=submit]');
  $('pair-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return; // connecting can take up to 20 s — don't start it again on every tap
    busy = true;
    button.disabled = true;
    button.textContent = tr('link.connecting');
    $('pair-error').textContent = '';
    try {
      const code = inputs.map((x) => x.value).join('');
      const device = /OculusBrowser|Quest/i.test(navigator.userAgent) ? 'Quest headset' : 'Browser';
      // On the public page the code also finds your hub, through the meeting point.
      if (link.active) await link.pair(code, device);
      else await api('/api/pair', { method: 'POST', body: { code, device } });
      location.reload();
    } catch (err) {
      const msg = err.message === 'hub-offline' ? tr('link.offline')
        : /timeout|connection failed/.test(err.message) ? tr('link.blocked')
        : errorText(err);
      $('pair-error').textContent = msg;
      if (!/timeout|connection failed|hub-offline/.test(err.message)) inputs.forEach((x) => { x.value = ''; }); // keep a good code for a retry
      inputs[0].focus();
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = tr('pair.button');
    }
  });
}

async function boot() {
  if (params.has('emulate')) {
    // Desktop testing without a headset: Meta's Immersive Web Emulation Runtime pretends to be a Quest.
    const { XRDevice, metaQuest3 } = await import('../vendor/iwer/iwer.module.min.js');
    const device = new XRDevice(metaQuest3);
    device.installRuntime({ forceInstall: true }); // replace the desktop browser's own (headset-less) WebXR
    window.__xrDevice = device;
  }
  relang();
  $('preview').addEventListener('click', startPreview);
  $('enter-vr').addEventListener('click', enterVR);
  const vrOk = !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false));
  vrState = vrOk ? 'ok' : 'none';
  if (!vrOk) welcomeNote = { key: window.isSecureContext ? 'welcome.openInQuest' : 'welcome.needHttps' };
  // Served by the hub (home), or the public page reaching the hub over the encrypted link?
  const how = await link.init();
  if (how.mode === 'link') link.onState(() => updateHud());
  // The installed app: straight into VR (tapping the app icon counts as the click VR needs).
  if (APP_MODE && vrOk) await enterVR();
  if (how.mode === 'none') return problem('link.noHub');
  connectFlow();
}

/** Reach the hub (and pair if needed). Safe to run again from "Try again". */
async function connectFlow() {
  if (link.active) {
    if (!link.saved?.hubId || !link.saved?.token) return askPair();
    busy('link.connecting');
    try { await link.connect(); } catch (e) {
      if (e.message === 'not paired') return askPair();
      return problem(e.message === 'hub-offline' ? 'link.offline' : /timeout|connection failed/.test(e.message) ? 'link.blocked' : 'link.failed', { msg: e.message });
    }
  }
  let status;
  try { status = await api('/api/status'); } catch (e) { return problem('welcome.hubDown', { msg: e.message }); }
  if (!status.authorized) { if (link.active) link.forget(); return askPair(); } // new headset, or the hub forgot it
  if (link.active && status.link) link.route = status.link; // the hub knows if we're home or away
  if (link.active && !routeTimer) {
    // The link can start on the relay and settle on a direct path a moment later: re-check the label.
    const refresh = () => api('/api/status').then((s) => { if (s.link && s.link !== link.route) { link.route = s.link; updateHud(); } }).catch(() => {});
    setTimeout(refresh, 3000);
    routeTimer = setInterval(refresh, 30000);
  }
  libraryCounts = status.library?.counts || null;
  api('/api/karaoke').then((r) => { hasKaraoke = r.songs.length > 0; }).catch(() => {});
  connectUi.hide();
  updateHud();
  updateWelcome();
  $('enter-vr').disabled = vrState !== 'ok';
  if (renderer.xr.isPresenting) return;
  showWelcome();
  if (params.has('autostart')) startPreview();
}

let routeTimer = null;
const inVR = () => renderer.xr.isPresenting;
function busy(key) {
  if (inVR()) connectUi.status(key);
  $('welcome-sub').textContent = tr(key);
  if (!inVR()) showWelcome();
}
function problem(key, vars) {
  if (inVR()) connectUi.status(key, { vars, retry: key !== 'link.noHub' });
  welcomeNote = null;
  $('welcome-sub').textContent = tr(key, vars);
  if (!inVR()) showWelcome();
}
function askPair() {
  if (!inVR()) return pairingUi();
  connectUi.pair(async (code) => {
    const device = /OculusBrowser|Quest/i.test(navigator.userAgent) ? 'Quest headset' : 'Browser';
    try {
      if (link.active) await link.pair(code, device);
      else await api('/api/pair', { method: 'POST', body: { code, device } });
    } catch (err) {
      const reach = /timeout|connection failed|hub-offline|unreachable/.test(err.message);
      const wrong = ['wrong-code', 'too-many'].includes(err.data?.code) || /code/i.test(err.message);
      const e = new Error(err.message === 'hub-offline' ? tr('link.offline') : reach ? tr('link.blocked') : wrong ? tr('connect.wrongCode') : errorText(err));
      e.keepCode = reach; // a good code stays for a retry
      throw e;
    }
    connectFlow();
  });
}
connectUi.onRetry(() => connectFlow());

// ---------------------------------------------------------------- frame loop
const timer = new THREE.Timer();
let t = 0;
const black = new THREE.Color(0);
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  t += dt;

  if (!renderer.xr.isPresenting) {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (!$('welcome').classList.contains('hidden') || !$('pairing').classList.contains('hidden')) {
      yaw = Math.sin(t * 0.05) * 0.25; // slow drift behind the welcome card
    }
  } else if (placeFrames > 0 && --placeFrames === 0) {
    placeUiAtHead();
  }

  room.update(dt);
  const s = room.state;
  const mediaOn = (mode === 'music' && music.playing) || (mode === 'cinema' && cinema.playing) || (mode === 'karaoke' && karaoke.playing);
  const bands = engine.update(dt);
  let hit = 0;
  if (mediaOn && mode !== 'cinema') {
    hit = beat.update(engine.bassFlux(), t);
    if (hit) lake.ripple(t, hit);
  } else if (!mediaOn) {
    for (const k of ['bass', 'mid', 'treble']) bands[k] *= 1 - Math.min(1, dt * 2);
  }
  const dancing = mediaOn && mode !== 'cinema';
  spectrum.update(dt, dancing, hit);
  waterTouch.visible = renderer.xr.isPresenting && mode !== 'cinema';

  const pxScale = renderer.xr.isPresenting ? 2.2 : renderer.domElement.height / 900;
  screen.update(t, dt, s, mode === 'cinema' ? 0.6 : 0.3);
  const spill = mode === 'cinema' || mode === 'karaoke' ? screen.light : black;
  sky.update(t, s, pxScale);
  lake.update(t, s, bands, spill, dancing);
  aurora.update(t, s, dancing);
  soundRing.update(t, s, dancing);
  meteors.update(t, dt, s, camera, hit, dancing);
  deck.update(t, s, spill, karaoke.micLevel || 0, dancing ? spectrum.range(0, 0.15) : 0);
  environment.update(t, s);
  mic.update(renderer.xr.isPresenting && mode === 'karaoke', s.accent, karaoke.micLevel || 0);
  motes.update(t, s, bands, pxScale, spectrum.pulse);
  reeds.update(t, dt, mediaOn ? s : { ...s, glow: s.glow * 0.25 }, engine);
  music.update(dt, mode === 'music');
  cinema.update(dt, mode === 'cinema');
  karaoke.update(dt, mode === 'karaoke', t);
  library.update(dt);
  updateWidgets(dt, t);
  // while the connect card is up, it's the only thing to press
  consoleUi.group.visible = !connectUi.visible;
  if (connectUi.visible && library.isOpen) library.close();
  if (connectUi.visible && t % 0.2 < dt) connectUi.update();
  pointer.update(dt);

  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

// Desktop testing hooks (used by automated checks; harmless otherwise)
window.__room = { spectrum, aurora, soundRing, meteors, motes, connectUi, setMode, music, cinema, karaoke, library, engine, room, lake, enterVR, renderer, scene, camera, get mode() { return mode; } };

boot();
