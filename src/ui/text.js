// Text is drawn with the browser's own Canvas 2D and uploaded as a texture.
// That gives us Chinese, Japanese, Korean, emoji… using the fonts the Quest already has,
// with no font files to download.
import * as THREE from 'three';
import { link } from '../link.js';

export const FONT = '"Noto Sans SC", "Noto Sans CJK SC", "Noto Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

export function font(px, weight = 500) {
  return `${weight} ${px}px ${FONT}`;
}

/** Fit text to a width, adding "…" when it doesn't fit. */
export function ellipsize(ctx, text, maxW) {
  text = String(text ?? '');
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid; else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** A colourful placeholder cover from a title (hash → gradient + initials). */
export function drawPlaceholder(ctx, x, y, w, h, title, r = 18) {
  let hsh = 0;
  for (const ch of String(title)) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  const hue = hsh % 360;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, `hsl(${hue} 55% 34%)`);
  g.addColorStop(1, `hsl(${(hue + 50) % 360} 60% 18%)`);
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // soft ripple rings, a nod to the lake
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = Math.max(2, w * 0.012);
  for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.arc(x + w * 0.8, y + h * 0.85, (w * i) / 4.5, 0, Math.PI * 2); ctx.stroke(); }
  const label = [...String(title).replace(/^[\d\s\-_.[\]()【】]+/, '')].slice(0, 2).join('') || '♪';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = font(Math.round(h * 0.34), 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}

/** Image loader with a small cache; calls back when an image arrives so the panel can redraw. */
const images = new Map();
export function getImage(url, onLoad) {
  if (!url) return null;
  let e = images.get(url);
  if (!e) {
    e = { img: new Image(), ok: false, waiters: new Set() };
    e.img.decoding = 'async';
    e.img.onload = () => { e.ok = true; for (const w of e.waiters) w(); e.waiters.clear(); };
    e.img.onerror = () => { e.failed = true; e.waiters.clear(); };
    if (link.active && url.startsWith('/')) link.objectUrl(url).then((u) => { if (u) e.img.src = u; else e.failed = true; });
    else e.img.src = url;
    images.set(url, e);
    if (images.size > 600) images.delete(images.keys().next().value);
  }
  if (e.ok) return e.img;
  if (onLoad && !e.failed) e.waiters.add(onLoad);
  return null;
}

/** Draw an image cropped to fill a rounded box. */
export function drawCover(ctx, img, x, y, w, h, r = 18) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  ctx.restore();
}
