// Procedural textures drawn on canvases: plaster, wood, roof tiles, stone, shoji paper,
// fabric and a water normal map. Everything is generated once and shared.
import * as THREE from 'three';

// Tileable value noise: lattice values wrap at `period`, so octaves tile seamlessly.
function makeNoise(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const lattice = new Float32Array(256 * 256);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
  const v = (x, y, p) => lattice[((y % p + p) % p) * 256 + ((x % p + p) % p)];
  return (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi, period), b = v(xi + 1, yi, period), c = v(xi, yi + 1, period), d = v(xi + 1, yi + 1, period);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}
const noise = makeNoise(7);
// Fractal noise over [0,size) that tiles; returns 0..1.
function fbm(x, y, size, base = 4, octaves = 5) {
  let sum = 0, amp = 0.5, norm = 0, freq = base;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x / size * freq, y / size * freq, freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
function toTexture(c, color = true, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Fill a canvas pixel by pixel from f(x, y) -> [r, g, b].
function paint(size, f) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = f(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

// Greyscale grain used as a bump map on cloth, skin and stone.
export const grainTex = () => once('grain', () => toTexture(paint(256, (x, y) => {
  const n = fbm(x, y, 256, 16, 4) * 0.7 + Math.random() * 0.3;
  const v = n * 255;
  return [v, v, v];
}), false, [3, 3]));

// Woven fabric: fine crosshatch with soft variation.
export const clothTex = () => once('cloth', () => toTexture(paint(256, (x, y) => {
  const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
  const n = fbm(x, y, 256, 8, 3);
  const v = 200 + weave * 30 + n * 25;
  return [v, v, v];
}), true, [2, 2]));

// White lime plaster with stains and speckles.
export const plasterTex = () => once('plaster', () => toTexture(paint(256, (x, y) => {
  const n = fbm(x, y, 256, 4, 5);
  const stain = Math.max(0, fbm(x + 77, y * 0.6, 256, 2, 3) - 0.55) * 1.4;
  const speck = Math.random() < 0.02 ? -25 : 0;
  const v = 228 + (n - 0.5) * 40 + speck - stain * 60;
  return [v, v - 4, v - 14 - stain * 20];
}), true, [1.5, 1]));

// Dark cedar with vertical grain.
export const woodTex = () => once('wood', () => toTexture(paint(256, (x, y) => {
  const grain = fbm(x * 0.15, y * 3, 256, 4, 4);
  const streak = Math.sin((x + grain * 40) * 0.35) * 0.5 + 0.5;
  const v = 0.55 + grain * 0.35 + streak * 0.15;
  return [150 * v, 100 * v, 62 * v];
}), true, [1, 1]));

// Kawara roof tiles: rows of rounded tiles with shading.
export const roofTex = () => once('roof', () => toTexture(paint(256, (x, y) => {
  const col = (x % 32) / 32, row = (y % 32) / 32;
  const curve = Math.sin(col * Math.PI);
  const lip = row > 0.86 ? 0.55 : 1;
  const n = fbm(x, y, 256, 8, 3);
  const v = (0.45 + curve * 0.5) * lip * (0.85 + n * 0.3);
  return [120 * v, 128 * v, 140 * v];
}), true, [3, 3]));

// Cobbled stone: cellular cracks between rough stones.
export const stoneTex = () => once('stone', () => {
  const pts = [];
  for (let i = 0; i < 40; i++) pts.push([Math.random() * 256, Math.random() * 256, 0.75 + Math.random() * 0.4]);
  return toTexture(paint(256, (x, y) => {
    let d1 = 1e9, d2 = 1e9, tone = 1;
    for (const [px, py, t] of pts) {
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
        const d = (x - px - ox) ** 2 + (y - py - oy) ** 2;
        if (d < d1) { d2 = d1; d1 = d; tone = t; } else if (d < d2) d2 = d;
      }
    }
    const edge = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) / 6);
    const n = fbm(x, y, 256, 8, 4);
    const v = (0.35 + edge * 0.65) * tone * (0.75 + n * 0.4);
    return [150 * v, 146 * v, 138 * v];
  }), true, [1, 1]);
});

// Shoji paper with a dark lattice.
export const shojiTex = () => once('shoji', () => toTexture(paint(128, (x, y) => {
  const bar = (x % 32) < 3 || (y % 32) < 3;
  if (bar) return [60, 40, 26];
  const n = fbm(x, y, 128, 8, 3);
  const v = 225 + n * 25;
  return [v, v - 6, v - 20];
}), true, [1, 1]));

// Bark: vertical ridges.
export const barkTex = () => once('bark', () => toTexture(paint(128, (x, y) => {
  const ridge = fbm(x * 2, y * 0.3, 128, 6, 4);
  const v = 0.35 + ridge * 0.7;
  return [110 * v, 80 * v, 60 * v];
}), true, [2, 3]));

// Normal map for rippling water, derived from a tileable height field.
export const waterNormalTex = () => once('waterN', () => {
  const S = 256, h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = fbm(x, y, S, 6, 5);
  const c = paint(S, (x, y) => {
    const l = h[y * S + (x + S - 1) % S], r = h[y * S + (x + 1) % S];
    const u = h[((y + S - 1) % S) * S + x], d = h[((y + 1) % S) * S + x];
    const nx = (l - r) * 6, ny = (u - d) * 6, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    return [(nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (nz / len * 0.5 + 0.5) * 255];
  });
  return toTexture(c, false, [6, 6]);
});

// Make a repeat-adjusted copy of a shared texture (same image, own repeat).
export function tiled(tex, rx, ry) {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

// Tiger-skin loincloth worn by the oni.
export const tigerTex = () => once('tiger', () => toTexture(paint(256, (x, y) => {
  const n = fbm(x, y, 256, 4, 4);
  const stripe = Math.sin((x + n * 60) * 0.12 + Math.sin(y * 0.05) * 2);
  const v = 0.8 + n * 0.3;
  if (stripe > 0.55) return [30 * v, 22 * v, 14 * v];
  return [225 * v, 160 * v, 40 * v];
}), true, [2, 1]));
