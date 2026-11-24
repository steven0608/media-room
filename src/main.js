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
import { createLayout } from './ui/layout.js';
import { MusicMode } from './modes/music.js';
import { CinemaMode } from './modes/cinema.js';
import { KaraokeMode } from './modes/karaoke.js';
import { t as tr, onLang, toggleLang, applyDom, num, errorText, getLang } from './i18n.js';
import { link } from './link.js';
import { createHands } from './ui/hands.js';
import { createLife } from './room/life.js';
import { demo } from './demo.js';
import { license } from './license.js';
import { makeButton } from './ui/widgets.js';

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
const life = createLife(); // lanterns, mist, clouds, leaping fish, birds
scene.add(sky.group, aurora.mesh, meteors.group, life.group, environment.group, lake.mesh, soundRing.group, deck.group, motes.points, reeds.mesh, screen.group);

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
screen.group.add(cinema.group); // subtitles + progress bar move with the screen
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
// In VR the panel sits below the screen and tilts towards you like a lectern (about 25° down,
// the comfortable reading angle), so the picture above it is never covered. It also leans a
// little to the left of the console at your right hand.
const libraryMount = new THREE.Group();
libraryMount.add(library.group);
ui.add(libraryMount);

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
  } else if (key === 'quick' && m?.karaoke?.quick) {
    music.audio.pause();
    setMode('karaoke');
    karaoke.start({ id: m.karaoke.quick });
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
    library: () => openLibrary(),
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
const consoleHome = { vr: false, pos: new THREE.Vector3(), tilt: 0 };
function placeConsole(vr) {
  libraryMount.rotation.set(vr ? -0.44 : 0, vr ? 0.12 : 0, 0, 'YXZ');
  const [x, y, z, tilt] = vr ? [0.34, -0.42, -0.5, -0.62] : [0.4, -0.35, -0.68, -0.35];
  Object.assign(consoleHome, { vr, tilt });
  consoleHome.pos.set(x, y, z);
  consoleUi.group.position.set(x, y, z);
  consoleUi.group.rotation.set(tilt, Math.atan2(-x, -z), 0, 'YXZ');
}
// ---------------------------------------------------------------- move things where you like
const SCR = CONFIG.screen;
const scrH = screen.height;
const screenState = { yaw: 0, dh: 0, s: 1 };
const scrCenter = new THREE.Vector3(0, SCR.centerY, -SCR.radius);
const minDh = (s) => CONFIG.waterY + 0.15 - SCR.centerY + (scrH * s) / 2; // bottom stays above the water
function applyScreen(st) {
  const s = THREE.MathUtils.clamp(st.s ?? 1, 0.6, 1.6);
  const dh = THREE.MathUtils.clamp(st.dh ?? 0, minDh(s), 3);
  Object.assign(screenState, { yaw: st.yaw ?? 0, dh, s });
  const g = screen.group;
  g.rotation.y = screenState.yaw;
  g.scale.setScalar(s);
  g.position.copy(scrCenter).multiplyScalar(1 - s).applyAxisAngle(THREE.Object3D.DEFAULT_UP, screenState.yaw);
  g.position.y += dh; // scaled about its own centre, then raised/lowered
  soundRing.setYaw(screenState.yaw);
  lake.setScreenYaw(screenState.yaw);
}
const layout = createLayout({
  pointer, sfx,
  targets: {
    screen: {
      parent: screen.group, at: new THREE.Vector3(0, SCR.centerY + scrH / 2 + 0.3, -SCR.radius + 0.05), size: [1.3, 0.07],
      read: () => ({ ...screenState }),
      apply: applyScreen,
      defaults: () => ({ yaw: 0, dh: 0, s: 1 }),
      drag: (a, dyaw, dpitch) => ({ ...a, yaw: a.yaw - dyaw, dh: a.dh + dpitch * SCR.radius * a.s }),
      stick: (a, y, dt) => ({ ...a, s: a.s - y * dt * 0.8 }), // push forward = bigger
    },
    library: {
      parent: library.group, at: new THREE.Vector3(0, 0.53, -1.52), size: [0.24, 0.022],
      enabled: () => renderer.xr.isPresenting,
      read: () => ({ x: libraryMount.rotation.x, y: libraryMount.rotation.y }),
      apply: (st) => libraryMount.rotation.set(st.x, st.y, 0, 'YXZ'),
      defaults: () => ({ x: -0.44, y: 0.12 }),
      drag: (a, dyaw, dpitch) => ({ x: THREE.MathUtils.clamp(a.x + dpitch, -1.0, 0.35), y: a.y - dyaw }),
    },
    console: {
      parent: consoleUi.group, at: new THREE.Vector3(0, 0.178, 0.004), size: [0.14, 0.018],
      enabled: () => renderer.xr.isPresenting,
      read: () => ({ x: consoleUi.group.position.x, y: consoleUi.group.position.y, z: consoleUi.group.position.z }),
      apply: (st) => {
        consoleHome.custom = !st.home;
        consoleUi.group.position.set(st.x, st.y, st.z);
        consoleUi.group.rotation.set(consoleHome.tilt, Math.atan2(-st.x, -st.z), 0, 'YXZ');
      },
      defaults: () => ({ x: 0.34, y: -0.42, z: -0.5, home: true }),
      drag: (a, dyaw, dpitch) => {
        // swing it around you at the same distance
        const r = Math.hypot(a.x, a.y, a.z), yaw = Math.atan2(a.x, -a.z) + dyaw;
        const pitch = THREE.MathUtils.clamp(Math.asin(a.y / r) + dpitch, -1.2, 0.6);
        return { x: r * Math.cos(pitch) * Math.sin(yaw), y: r * Math.sin(pitch), z: -r * Math.cos(pitch) * Math.cos(yaw) };
      },
    },
  },
});
layout.restore('screen');

// In VR, while the library is open the console glides out to your right so it doesn't sit on
// top of the library, and glides back when the library closes.
const consoleAside = new THREE.Vector3(0.56, -0.42, -0.3);
const consoleWant = new THREE.Vector3();
function slideConsole(dt) {
  if (!consoleHome.vr || consoleHome.custom) return; // you placed it yourself: leave it there
  consoleWant.copy(library.isOpen ? consoleAside : consoleHome.pos);
  const g = consoleUi.group;
  if (g.position.distanceToSquared(consoleWant) < 1e-6) return;
  g.position.lerp(consoleWant, Math.min(1, dt * 7));
  g.rotation.set(consoleHome.tilt, Math.atan2(-g.position.x, -g.position.z), 0, 'YXZ');
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

/** Pause everything (system menu opened, page hidden). Play resumes with the usual controls. */
function pauseAll() {
  if (music.playing) music.pause();
  if (cinema.playing) cinema.pause();
  karaoke.pause();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAll(); });

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
  // only while in Cinema: leaving it pauses the film, and that must not cover the karaoke board or music
  if (mode === 'cinema') screen.setTexture(cinema.texture, cinema.aspect || 16 / 9);
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
  else if (k === 'l') openLibrary();
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
  if (layout.dragging) { if (Math.abs(y) > 0.15) layout.stick(y, dt); return; }
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
  if (hand === 'right' && i === 5) consoleUi && openLibrary(); // B
  if (hand === 'left' && i === 4) setMode(mode === 'music' ? 'cinema' : mode === 'cinema' ? 'karaoke' : 'music'); // X
  if (hand === 'left' && i === 5) placeUiAtHead();                     // Y = recentre the console/library
};

// Hands (controllers put down): pinch, fingertip touch, and palm-towards-face to bring the menus.
const hands = createHands({ renderer, rig, pointer, sfx, onPalm: () => { placeUiAtHead(); if (mode === 'cinema') cinema.poke(); } });

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
  // Ask for the microphone now, on the flat screen: the Quest can't always show the question inside
  // VR. Only when it hasn't been answered yet, and never for more than 12 seconds.
  if (!karaoke.autosing && !karaoke.mic.ready && navigator.mediaDevices?.getUserMedia) {
    const state = await karaoke.mic.permission();
    if (state === 'granted') karaoke.mic.open();
    else if (state !== 'denied') await Promise.race([karaoke.mic.open(), new Promise((r) => setTimeout(r, 12000))]);
  }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] });
    xrSession = session;
    await renderer.xr.setSession(session);
    hideOverlays();
    $('hud').classList.add('hidden');
    placeConsole(true);
    layout.restore('library', 'console');
    placeFrames = 25; // measure your head height after tracking settles
    if (trialOver()) showUnlock(true); // in VR: the unlock card instead of your library
    if (mode === 'idle') setMode('music');
    setFrameRate();
    session.addEventListener('end', () => {
      xrSession = null; placeConsole(false); ui.position.set(0, CONFIG.seatedEyeHeight, 0); ui.rotation.set(0, 0, 0); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      if (emailAfterExit) { emailAfterExit = false; showEmailCard(); } else showWelcome();
    });
    renderer.xr.getReferenceSpace()?.addEventListener?.('reset', () => { placeFrames = 5; });
    // Quest system menu (or the headset taken off): pause what's playing, as Meta's store requires.
    session.addEventListener('visibilitychange', () => { if (session.visibilityState !== 'visible') pauseAll(); });
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
function hideOverlays() { for (const id of ['pairing', 'welcome', 'emailcard']) $(id).classList.add('hidden'); }
function showWelcome() {
  hideOverlays();
  $('welcome').classList.remove('hidden');
  $('hud').classList.add('hidden');
}
const trialOver = () => !demo.active && trialLeft <= 0;
/** The library for this mode (after the free week: the unlock card instead). */
function openLibrary() {
  if (trialOver()) return showUnlock(true);
  library.toggle(mode === 'cinema' ? 'video' : mode === 'karaoke' ? 'karaoke' : 'music');
}
function startPreview() {
  if (trialOver()) return showUnlock(true);
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
  if (demo.active) { $('hud-status').textContent = `${tr(`mode.${mode}`)} · ${tr('demo.hud')}`; return; }
  updateTrialBadge();
  const via = link.active ? ` · ${tr(link.state === 'open' && link.route ? `link.route.${link.route}` : `link.state.${link.state}`)}` : '';
  const trial = Number.isFinite(trialLeft) && trialLeft > 0 ? ` · ${tr('trial.hud', { n: Math.ceil(trialLeft) })}` : '';
  $('hud-status').textContent = `${tr(`mode.${mode}`)}${c ? ` · ${tr('hud.counts', { music: num(c.music), video: num(c.video) })}` : ''}${via}${trial}`;
}
function updateWelcome() {
  const c = libraryCounts;
  if (c) $('welcome-sub').textContent = demo.active ? tr('demo.welcome', { music: num(c.music), video: num(c.video) }) : c.music || c.video ? tr('welcome.counts', { music: num(c.music), video: num(c.video) }) : tr('welcome.empty');
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
  license.init(); // what's owned + the local price (Meta store app only)
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
  for (const id of ['pair-demo', 'welcome-demo']) $(id).addEventListener('click', () => { $(id).blur(); $('welcome-demo').classList.add('hidden'); startDemo(); });
  $('pair-email').addEventListener('click', () => askEmail());
  $('pair-near').addEventListener('click', () => { if (nearbyHubs[0]) { hideOverlays(); connectNearby(nearbyHubs[0]); } });
  const vrOk = !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false));
  vrState = vrOk ? 'ok' : 'none';
  if (!vrOk) welcomeNote = { key: window.isSecureContext ? 'welcome.openInQuest' : 'welcome.needHttps' };
  // Served by the hub (home), or the public page reaching the hub over the encrypted link?
  const how = await link.init();
  if (how.mode === 'link') link.onState(() => updateHud());
  // The installed app: straight into VR (tapping the app icon counts as the click VR needs).
  if (APP_MODE && vrOk) await enterVR();
  if (params.has('demo')) return startDemo();
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
  // try first, then buy: your own media is free for a week (the PC's own preview never stops)
  if (!demo.active) {
    trialLeft = license.daysLeft(status.license, { local: !!status.local });
    if (trialLeft <= 0) return showUnlock(true);
  }
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
  $('welcome-demo').classList.remove('hidden'); // no hub reachable: the demo is a way in
  if (inVR()) connectUi.status(key, { vars, retry: key !== 'link.noHub' });
  welcomeNote = null;
  $('welcome-sub').textContent = tr(key, vars);
  if (!inVR()) showWelcome();
}
async function pairWith(code) {
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
}
function askPair() {
  watchNearby();
  if (!inVR()) return pairingUi();
  // not paired: say hello first (connect to the hub we found · code · get the hub · try the demo)
  if (link.active && !link.saved?.token) connectUi.welcome(pairWith);
  else connectUi.pair(pairWith);
}

// ---------------------------------------------------------------- one-click connect
// While you're on the welcome card (or reading "Get the hub"), keep looking for a hub in this
// home. As soon as one appears, the card offers "Connect to <PC>": one click, no code.
let nearbyTimer = null;
let nearbyHubs = [];
function watchNearby() {
  if (!link.active || nearbyTimer) return;
  const look = async () => {
    const choosing = inVR() ? ['welcome', 'gethub'].includes(connectUi.view) : !$('pairing').classList.contains('hidden');
    if (!choosing || demo.active || link.saved?.token) return;
    nearbyHubs = await link.nearby();
    connectUi.setNearby(nearbyHubs);
    const btn = $('pair-near');
    btn.classList.toggle('hidden', !nearbyHubs.length);
    if (nearbyHubs.length) btn.textContent = tr('connect.oneClick', { name: nearbyHubs[0].name || 'PC' });
  };
  look();
  nearbyTimer = setInterval(look, 4000);
}
const deviceName = () => (/OculusBrowser|Quest/i.test(navigator.userAgent) ? 'Quest headset' : 'Browser');
async function connectNearby(hub) {
  let cancelled = false;
  connectUi.onCancel(() => { cancelled = true; link.close(); askPair(); });
  busy('link.connecting');
  try {
    await link.connectTo(hub.id, deviceName(), {
      onWait: () => { if (inVR()) connectUi.waiting(hub.name); else $('welcome-sub').textContent = tr('connect.waitSub', { name: hub.name || 'PC' }); },
      cancelled: () => cancelled,
    });
  } catch (e) {
    if (cancelled) return;
    link.close();
    link.saved = null;
    problem(e.data?.code === 'pair-denied' ? 'connect.denied' : /timeout|connection failed|hub-offline/.test(e.message) ? 'link.blocked' : 'link.failed', { msg: e.message });
    return;
  }
  sfx.select?.();
  connectFlow();
}
connectUi.onConnect((hub) => connectNearby(hub));
connectUi.onRetry(() => connectFlow());
connectUi.onDemo(() => startDemo());

// ---------------------------------------------------------------- "email me the setup guide"
// Typing an address in VR is clumsy, so we step out to the flat screen for a moment, where the
// Quest's own keyboard (and voice typing) work, then offer "Back to VR".
let emailAfterExit = false;
function askEmail() {
  if (inVR() && xrSession) { emailAfterExit = true; xrSession.end(); return; }
  showEmailCard();
}
function showEmailCard() {
  hideOverlays();
  $('emailcard').classList.remove('hidden');
  $('email-status').textContent = '';
  $('email-back').textContent = tr(vrState === 'ok' ? 'email.backVr' : 'email.back');
  setTimeout(() => $('email-input').focus(), 150);
}
$('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const signal = link.signal || CONFIG.remote.signal;
  $('email-send').disabled = true;
  $('email-status').textContent = tr('email.sending');
  try {
    const r = await fetch(`${signal}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('email-input').value, lang: getLang(), news: $('email-news').checked }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'failed'), { data: j });
    $('email-status').textContent = tr('email.sent');
    $('email-status').style.color = 'var(--ok)';
    $('email-send').classList.add('hidden');
  } catch (err) {
    $('email-status').style.color = '';
    $('email-status').textContent = errorText(err);
  } finally { $('email-send').disabled = false; }
});
$('email-back').addEventListener('click', () => {
  $('emailcard').classList.add('hidden');
  $('email-send').classList.remove('hidden');
  if (vrState === 'ok') enterVR(); else showWelcome();
});
connectUi.onEmail(() => askEmail());

// ---------------------------------------------------------------- the demo room (no hub needed)
async function startDemo() {
  link.deactivate();
  await demo.start();
  sfx.select?.();
  demoBadge.group.visible = true;
  $('hud-demo')?.classList.remove('hidden');
  await connectFlow();
  if (inVR()) { setMode('music'); library.open?.('music'); }
}
// ---------------------------------------------------------------- try first, then buy
let trialLeft = Infinity;
function showUnlock(expired) {
  const buy = async () => {
    if (!(await license.buy())) return; // closed the store window: nothing changes
    trialLeft = Infinity;
    trialBadge.group.visible = false;
    $('welcome-unlock').classList.add('hidden');
    connectUi.hide();
    $('welcome-sub').textContent = tr('trial.thanks');
    sfx.select?.();
    connectFlow();
  };
  if (inVR()) {
    connectUi.unlock({ price: license.price, expired, canBuy: license.canBuy, buy, later: () => connectUi.hide() });
    return;
  }
  showWelcome();
  $('welcome-sub').textContent = `${tr(expired ? 'connect.unlockOver' : 'connect.unlockTitle')} · ${tr(license.canBuy ? 'connect.unlockSub' : 'connect.unlockNoStore', { price: license.price })}`;
  const btn = $('welcome-unlock');
  btn.textContent = tr('connect.unlockBtn', { price: license.price });
  btn.classList.toggle('hidden', !license.canBuy);
  btn.onclick = () => buy().catch((e) => { $('welcome-sub').textContent = e.message; });
  $('welcome-demo').classList.remove('hidden');
  if (expired) $('enter-vr').disabled = true;
}
// While in the free week, a small button near the console shows the days left and opens the unlock.
const trialBadge = makeButton(pointer, sfx, { w: 0.34, h: 0.05, label: '', accent: CONFIG.palette.amber, onClick: () => showUnlock(false) });
trialBadge.group.position.set(0, -0.19, 0.01);
trialBadge.group.visible = false;
consoleUi.group.add(trialBadge.group);
function updateTrialBadge() {
  const on = Number.isFinite(trialLeft) && trialLeft > 0 && !demo.active;
  trialBadge.group.visible = on;
  if (on) { const n = Math.ceil(trialLeft); trialBadge.setLabel(n <= 1 ? tr('trial.badge1') : tr('trial.badge', { n })); }
}
onLang(updateTrialBadge);

// In the demo, a button near the console leads back to connecting your own media.
const demoBadge = makeButton(pointer, sfx, { w: 0.3, h: 0.05, label: tr('demo.badge'), accent: CONFIG.palette.magenta, onClick: () => location.reload() });
demoBadge.group.position.set(0, -0.19, 0.01);
demoBadge.group.visible = false;
consoleUi.group.add(demoBadge.group);
onLang(() => demoBadge.setLabel(tr('demo.badge')));

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
  life.update(t, dt, s, (x, z, at, k) => lake.touch(x, z, at, k));
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
  slideConsole(dt);
  layout.update(dt);
  if (renderer.xr.isPresenting) hands.update(dt, renderer.xr.getCamera());
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
window.__room = { pointer, hands, life, consoleUi, layout, applyScreen, spectrum, aurora, soundRing, meteors, motes, connectUi, setMode, music, cinema, karaoke, library, engine, room, lake, enterVR, renderer, scene, camera, get mode() { return mode; } };

boot();
