// The side-table console at your right hand: modes, transport, library, volume and language.
// Within reach, tilted towards you, so it works with a ray now and with a finger poke later.
import * as THREE from 'three';
import { makeButton, makePlate } from './widgets.js';
import { canvasTexture, font, ellipsize } from './text.js';
import { CONFIG } from '../config.js';
import { t, onLang, toggleLang } from '../i18n.js';

const P = CONFIG.palette;

export function createConsole({ pointer, sfx, actions }) {
  const group = new THREE.Group();
  const plate = makePlate(0.46, 0.29, 0.035);
  plate.position.z = -0.012;
  group.add(plate);

  const B = (opts) => { const b = makeButton(pointer, sfx, opts); group.add(b.group); return b; };

  // row 1: modes
  const modes = {
    music: B({ w: 0.135, h: 0.056, icon: 'music', label: t('mode.music'), accent: P.cyan, onClick: () => actions.mode('music') }),
    cinema: B({ w: 0.135, h: 0.056, icon: 'cinema', label: t('mode.cinema'), accent: P.amber, onClick: () => actions.mode('cinema') }),
    karaoke: B({ w: 0.135, h: 0.056, icon: 'karaoke', label: t('mode.karaoke'), accent: P.magenta, onClick: () => actions.mode('karaoke') }),
  };
  modes.music.group.position.set(-0.145, 0.095, 0);
  modes.cinema.group.position.set(0, 0.095, 0);
  modes.karaoke.group.position.set(0.145, 0.095, 0);

  // row 2: library + transport
  const library = B({ w: 0.135, h: 0.062, icon: 'library', label: t('console.library'), accent: P.amber, onClick: () => actions.library() });
  library.group.position.set(-0.145, 0.02, 0);
  const prev = B({ w: 0.062, h: 0.062, icon: 'prev', onClick: () => actions.prev() });
  const play = B({ w: 0.074, h: 0.074, icon: 'play', accent: P.amber, onClick: () => actions.toggle() });
  const next = B({ w: 0.062, h: 0.062, icon: 'next', onClick: () => actions.next() });
  prev.group.position.set(-0.008, 0.02, 0);
  play.group.position.set(0.075, 0.02, 0);
  next.group.position.set(0.158, 0.02, 0);

  // row 3: volume, now-playing line, language
  const vdown = B({ w: 0.05, h: 0.05, icon: 'minus', onClick: () => actions.volume(-0.1) });
  const vup = B({ w: 0.05, h: 0.05, icon: 'plus', onClick: () => actions.volume(+0.1) });
  vdown.group.position.set(-0.185, -0.07, 0);
  vup.group.position.set(-0.035, -0.07, 0);
  const lang = B({ w: 0.058, h: 0.05, label: t('lang.switch'), accent: P.cyan, onClick: () => toggleLang() });
  lang.group.position.set(0.188, -0.07, 0);
  const vol = canvasTexture(256, 48);
  const volBar = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.016), new THREE.MeshBasicMaterial({ map: vol.tex, transparent: true }));
  volBar.position.set(-0.11, -0.07, 0.002);
  group.add(volBar);
  const np = canvasTexture(384, 96);
  const npLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.0325), new THREE.MeshBasicMaterial({ map: np.tex, transparent: true }));
  npLabel.position.set(0.087, -0.07, 0.002);
  group.add(npLabel);

  let lastVol = -1, lastNp = null;
  const api = {
    group,
    setMode(m) { for (const [k, b] of Object.entries(modes)) b.setActive(k === m); },
    setPlaying(on) { play.setIcon(on ? 'pause' : 'play'); },
    setSkipIcons(cinema) { prev.setIcon(cinema ? 'rewind' : 'prev'); next.setIcon(cinema ? 'forward' : 'next'); },
    setVolume(v) {
      if (Math.abs(v - lastVol) < 0.001) return;
      lastVol = v;
      const c = vol.ctx;
      c.clearRect(0, 0, 256, 48);
      c.fillStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.roundRect(4, 16, 248, 16, 8); c.fill();
      const g = c.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, '#5ce1e6'); g.addColorStop(1, '#ffb35c');
      c.fillStyle = g; c.beginPath(); c.roundRect(4, 16, Math.max(16, 248 * v), 16, 8); c.fill();
      vol.tex.needsUpdate = true;
    },
    setNowPlaying(text, force = false) {
      if (text === lastNp && !force) return;
      lastNp = text;
      const c = np.ctx;
      c.clearRect(0, 0, 384, 96);
      c.fillStyle = '#9aa3c7';
      c.font = font(32, 500);
      c.textBaseline = 'middle';
      c.fillText(ellipsize(c, text || t('console.nothing'), 376), 4, 48);
      np.tex.needsUpdate = true;
    },
  };
  onLang(() => {
    for (const k of Object.keys(modes)) modes[k].setLabel(t(`mode.${k}`));
    library.setLabel(t('console.library'));
    lang.setLabel(t('lang.switch'));
    api.setNowPlaying(lastNp, true);
  });
  return api;
}
