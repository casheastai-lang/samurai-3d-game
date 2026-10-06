// Visual effects: particles, slashes, sword trails, lightning, ambient petals/embers, floating text.
import * as THREE from 'three';
import { $, rand } from './util.js';

let scene = null, camera = null, height = null;
export function initFx(sc, cam, heightFn) {
  scene = sc; camera = cam; height = heightFn;
  scene.add(points, trail.mesh, ambient.points);
}

// ============================================================ Particles & effects
const PMAX = 1400;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pBase = new Float32Array(PMAX * 3);
const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pGrav = new Float32Array(PMAX);
for (let i = 0; i < PMAX; i++) pPos[i * 3 + 1] = -9999;
// Soft round dot so particles never render as hard squares.
const dotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.3, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
points.frustumCulled = false;
let pNext = 0;
const tmpColor = new THREE.Color();
function burst(x, y, z, n, color, spd = 5, up = 3, life = 0.7, grav = 12) {
  tmpColor.set(color);
  for (let k = 0; k < n; k++) {
    const i = pNext; pNext = (pNext + 1) % PMAX;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2, s = Math.random() * spd;
    pVel[i * 3] = Math.cos(a) * s; pVel[i * 3 + 1] = Math.random() * up; pVel[i * 3 + 2] = Math.sin(a) * s;
    pBase[i * 3] = tmpColor.r; pBase[i * 3 + 1] = tmpColor.g; pBase[i * 3 + 2] = tmpColor.b;
    pLife[i] = pMax[i] = life * rand(0.6, 1.2);
    pGrav[i] = grav;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -9999; continue; }
    pVel[i * 3 + 1] -= pGrav[i] * dt;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    const f = Math.min(1, (pLife[i] / pMax[i]) * 2);
    pCol[i * 3] = pBase[i * 3] * f; pCol[i * 3 + 1] = pBase[i * 3 + 1] * f; pCol[i * 3 + 2] = pBase[i * 3 + 2] * f;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

const effects = [];
const arcGeo = {
  h: new THREE.RingGeometry(0.9, 3.0, 28, 1, -Math.PI / 2 - 1.25, 2.5).rotateX(-Math.PI / 2),
  wide: new THREE.RingGeometry(0.9, 3.8, 40, 1, -Math.PI / 2 - 2.2, 4.4).rotateX(-Math.PI / 2),
  v: new THREE.RingGeometry(0.9, 3.1, 28, 1, -Math.PI / 2 - 1.25, 2.5).rotateX(-Math.PI / 2).rotateZ(Math.PI / 2),
};
function spawnSlash(kind, color, delay, follow, life = 0.2, scale = 1) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(arcGeo[kind], mat);
  scene.add(m);
  effects.push({
    t: -delay, life,
    update(t) {
      const p = follow();
      m.position.set(p.x, p.y + (kind === 'v' ? 1.3 : 1.2), p.z);
      m.rotation.y = p.facing;
      if (t < 0) return;
      const k = t / this.life;
      mat.opacity = 0.4 * (1 - k);
      m.scale.setScalar((0.85 + k * 0.3) * scale);
    },
    dispose() { scene.remove(m); mat.dispose(); },
  });
}
function spawnRing(x, z, r, dur, color = 0xff2a10) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.35, r, 48).rotateX(-Math.PI / 2), mat);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2), fillMat);
  const y = height(x, z) + 0.12;
  ring.position.set(x, y, z); fill.position.set(x, y + 0.01, z);
  scene.add(ring, fill);
  effects.push({
    t: 0, life: dur,
    update(t) { fill.scale.setScalar(Math.max(0.01, t / dur)); mat.opacity = 0.5 + 0.4 * Math.sin(t * 20); },
    dispose() { scene.remove(ring, fill); ring.geometry.dispose(); fill.geometry.dispose(); mat.dispose(); fillMat.dispose(); },
  });
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    if (e.t >= e.life) { e.dispose(); effects.splice(i, 1); continue; }
    e.update(e.t);
  }
}

// Floating text (damage numbers, gold, etc.)
const floaters = [];
const floatRoot = $('floaters');
function floatText(pos, text, cls, life = 1.0) {
  const el = document.createElement('div');
  el.className = 'floater ' + cls;
  el.textContent = text;
  floatRoot.appendChild(el);
  floaters.push({ el, pos: pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0, rand(-0.4, 0.4))), t: 0, life });
}
const projV = new THREE.Vector3();
function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t >= f.life) { f.el.remove(); floaters.splice(i, 1); continue; }
    f.pos.y += dt * 1.5;
    projV.copy(f.pos).project(camera);
    if (projV.z > 1) { f.el.style.display = 'none'; continue; }
    f.el.style.display = '';
    f.el.style.left = ((projV.x + 1) / 2 * window.innerWidth) + 'px';
    f.el.style.top = ((1 - projV.y) / 2 * window.innerHeight) + 'px';
    f.el.style.opacity = String(1 - Math.pow(f.t / f.life, 3));
  }
}


// ---------- Sword trail: a ribbon between the blade's base and tip over the last few frames.
const TRAIL_N = 14;
const trail = (() => {
  const pos = new Float32Array(TRAIL_N * 2 * 3), col = new Float32Array(TRAIL_N * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.frustumCulled = false;
  return { mesh, pos, col, geo, samples: [], color: new THREE.Color() };
})();
// Call each frame with world positions of blade base and tip, and whether the sword is swinging.
export function updateTrail(base, tip, active, color, dt = 1 / 60) {
  trail.color.set(color);
  if (active) trail.samples.unshift({ b: base.clone(), t: tip.clone(), a: 1 });
  // Fade by time, not frames, so the trail looks the same at any frame rate.
  for (const s of trail.samples) s.a -= dt * (active ? 5 : 12);
  while (trail.samples.length > TRAIL_N || (trail.samples.length && trail.samples[trail.samples.length - 1].a <= 0)) trail.samples.pop();
  const n = trail.samples.length;
  for (let i = 0; i < TRAIL_N; i++) {
    const s = trail.samples[Math.min(i, n - 1)];
    const k = i * 6;
    if (!s) { trail.pos.fill(0, k, k + 6); trail.col.fill(0, k, k + 6); continue; }
    trail.pos[k] = s.b.x; trail.pos[k + 1] = s.b.y; trail.pos[k + 2] = s.b.z;
    trail.pos[k + 3] = s.t.x; trail.pos[k + 4] = s.t.y; trail.pos[k + 5] = s.t.z;
    const f = i < n ? Math.max(0, s.a) * (1 - i / TRAIL_N) : 0;
    const f2 = f * 0.7;
    trail.col[k] = 0; trail.col[k + 1] = 0; trail.col[k + 2] = 0;
    trail.col[k + 3] = trail.color.r * f2; trail.col[k + 4] = trail.color.g * f2; trail.col[k + 5] = trail.color.b * f2;
  }
  trail.geo.attributes.position.needsUpdate = true;
  trail.geo.attributes.color.needsUpdate = true;
}

// ---------- Lightning bolt between two points.
export function spawnBolt(a, b, color = 0xfff6a0) {
  const pts = [];
  const segs = 8;
  for (let i = 0; i <= segs; i++) {
    const p = a.clone().lerp(b, i / segs);
    if (i > 0 && i < segs) p.add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)));
    pts.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  effects.push({
    t: 0, life: 0.22,
    update(t) { mat.opacity = 1 - t / 0.22; },
    dispose() { scene.remove(line); geo.dispose(); mat.dispose(); },
  });
}

// ---------- Ambient particles around the camera: sakura petals, embers, or ash.
const AMB = 260;
const ambient = (() => {
  const pos = new Float32Array(AMB * 3), vel = new Float32Array(AMB * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.16, map: dotTex, color: 0xffb7d0, transparent: true, opacity: 0.9, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { pos, vel, geo, mat, points, seeded: false, mode: '' };
})();
const AMB_MODES = {
  petals: { color: 0xffb7d0, size: 0.22, fall: -0.8, drift: 1.2, blend: THREE.NormalBlending },
  embers: { color: 0xff7a2a, size: 0.2, fall: 1.4, drift: 0.8, blend: THREE.AdditiveBlending },
  ash:    { color: 0x9a8f88, size: 0.18, fall: -0.4, drift: 0.6, blend: THREE.NormalBlending },
  snow:   { color: 0xf4f8ff, size: 0.16, fall: -1.6, drift: 0.9, blend: THREE.NormalBlending },
  fireflies: { color: 0xd8ff6a, size: 0.14, fall: 0.05, drift: 0.7, blend: THREE.AdditiveBlending },
  shadow: { color: 0xa070ff, size: 0.13, fall: 0.25, drift: 0.5, blend: THREE.AdditiveBlending },
  gold:   { color: 0xffc830, size: 0.2, fall: -0.7, drift: 1.3, blend: THREE.NormalBlending },
  mist:   { color: 0xbfe8ff, size: 0.16, fall: 0.15, drift: 0.4, blend: THREE.AdditiveBlending },
  none:   null,
};
export function updateAmbient(dt, center, mode, time) {
  const m = AMB_MODES[mode];
  ambient.points.visible = !!m;
  if (!m) return;
  if (ambient.mode !== mode) {
    ambient.mode = mode;
    ambient.mat.color.set(m.color); ambient.mat.size = m.size; ambient.mat.blending = m.blend; ambient.mat.needsUpdate = true;
    ambient.seeded = false;
  }
  const R = 24;
  for (let i = 0; i < AMB; i++) {
    const k = i * 3;
    let x = ambient.pos[k], y = ambient.pos[k + 1], z = ambient.pos[k + 2];
    if (!ambient.seeded || Math.abs(x - center.x) > R || Math.abs(z - center.z) > R || y < center.y - 4 || y > center.y + 16) {
      x = center.x + rand(-R, R); z = center.z + rand(-R, R);
      y = ambient.seeded ? (m.fall < 0 ? center.y + 15 : center.y - 3) : center.y + rand(-3, 15);
      ambient.vel[k] = rand(-1, 1) * m.drift; ambient.vel[k + 2] = rand(-1, 1) * m.drift;
    }
    x += (ambient.vel[k] + Math.sin(time * 1.3 + i) * 0.5) * dt;
    y += m.fall * dt * (0.6 + (i % 5) * 0.15);
    z += ambient.vel[k + 2] * dt;
    ambient.pos[k] = x; ambient.pos[k + 1] = y; ambient.pos[k + 2] = z;
  }
  ambient.seeded = true;
  ambient.geo.attributes.position.needsUpdate = true;
}

export { burst, updateParticles, spawnSlash, spawnRing, updateEffects, floatText, updateFloaters, effects };

// ---------- Sweeping slash streaks ----------
// A crescent strip whose texture is brightest at the leading edge and fades toward the
// tail and the inner rim. It rotates through the swing while fading, so it reads as the
// motion smear of a blade rather than a static shape.
const arcCache = new Map();
function arcGeometry(arc) {
  if (arcCache.has(arc)) return arcCache.get(arc);
  const seg = 40, pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = -arc / 2 + arc * u;
    for (const [r, v] of [[0.45, 0], [1, 1]]) {
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      uv.push(u, v);
    }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  arcCache.set(arc, g);
  return g;
}
let smearTex = null;
function smearTexture() {
  if (smearTex) return smearTex;
  const W = 256, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = 1 - y / (H - 1);
    const along = Math.pow(u, 1.8) * (1 - Math.pow(Math.max(0, u - 0.94) / 0.06, 2));
    const edge = Math.exp(-Math.pow((v - 0.86) / 0.07, 2)) + Math.pow(v, 3) * 0.35;
    const streak = 0.85 + 0.15 * Math.sin(v * 60 + u * 9);
    const a = Math.max(0, Math.min(1, along * edge * streak));
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * a; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  smearTex = new THREE.CanvasTexture(c);
  return smearTex;
}
// follow() -> {x, y, z, facing}. plane: 'h' horizontal, 'v' vertical, or a tilt angle.
// dir: +1 / -1 sweep direction. radius in metres, arc and sweep in radians.
export function spawnSwing({ follow, plane = 'h', dir = 1, color = 0xffffff, radius = 2.6, arc = 2.4, sweep = 1.2, life = 0.2, delay = 0, height: hy = 1.25, intensity = 1 }) {
  const mat = new THREE.MeshBasicMaterial({ map: smearTexture(), color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const outer = new THREE.Group(), tilt = new THREE.Group();
  const m = new THREE.Mesh(arcGeometry(arc), mat);
  tilt.rotation.z = plane === 'h' ? 0 : plane === 'v' ? Math.PI / 2 : plane;
  m.scale.set(dir * radius, 1, radius);
  tilt.add(m); outer.add(tilt);
  scene.add(outer);
  effects.push({
    t: -delay, life,
    update(t) {
      const p = follow();
      outer.position.set(p.x, p.y + hy, p.z);
      outer.rotation.y = p.facing;
      if (t < 0) return;
      const k = t / this.life;
      m.rotation.y = dir * (-sweep / 2 + sweep * Math.min(1, k * 1.6));
      mat.opacity = intensity * (k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75);
    },
    dispose() { scene.remove(outer); mat.dispose(); },
  });
}

// ---------- Impact flash ----------
let starTex = null;
function starTexture() {
  if (starTex) return starTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + 0.3;
    ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31); ctx.stroke();
  }
  starTex = new THREE.CanvasTexture(c);
  return starTex;
}
// A bright starburst at the point of contact, plus sparks and blood (or demon ichor).
export function spawnImpact(x, y, z, { color = 0xfff0c0, size = 1.4, blood = null, dx = 0, dz = 0 } = {}) {
  const mat = new THREE.SpriteMaterial({ map: starTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.position.set(x, y, z);
  sp.material.rotation = Math.random() * Math.PI;
  scene.add(sp);
  effects.push({
    t: 0, life: 0.14,
    update(t) { const k = t / 0.14; sp.scale.setScalar(size * (0.4 + k)); mat.opacity = 1 - k; },
    dispose() { scene.remove(sp); mat.dispose(); },
  });
  burst(x, y, z, 10, color, 7, 3, 0.25, 14);
  if (blood !== null) {
    // Spray mostly away from the attacker.
    for (let i = 0; i < 18; i++) {
      const k = pNext; pNext = (pNext + 1) % PMAX;
      tmpColor.set(blood);
      pPos[k * 3] = x; pPos[k * 3 + 1] = y; pPos[k * 3 + 2] = z;
      pVel[k * 3] = dx * rand(2, 6) + rand(-1.5, 1.5); pVel[k * 3 + 1] = rand(0.5, 4); pVel[k * 3 + 2] = dz * rand(2, 6) + rand(-1.5, 1.5);
      pBase[k * 3] = tmpColor.r; pBase[k * 3 + 1] = tmpColor.g; pBase[k * 3 + 2] = tmpColor.b;
      pLife[k] = pMax[k] = rand(0.4, 0.8);
      pGrav[k] = 16;
    }
  }
}

// ---------- Straight light streak (a cut through the air) ----------
// A bright core line inside a soft wide glow, from a to b, fading out over `life`.
export function spawnSlashLine(a, b, { color = 0xffffff, width = 0.09, life = 0.5, delay = 0 } = {}) {
  const len = a.distanceTo(b);
  if (len < 0.01) return;
  const g = new THREE.Group();
  const core = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(width * 0.35, width * 0.35, len), core);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(width * 2.2, width * 0.25, len * 1.04), glow);
  g.add(c1, c2);
  g.position.copy(a).lerp(b, 0.5);
  g.lookAt(b);
  g.rotateZ(Math.random() * Math.PI);
  scene.add(g);
  effects.push({
    t: -delay, life,
    update(t) {
      if (t < 0) return;
      const k = t / this.life;
      core.opacity = 1 - k;
      glow.opacity = 0.7 * (1 - k);
      g.scale.set(1 - k * 0.6, 1 - k * 0.6, 1 + k * 0.08);
    },
    dispose() { scene.remove(g); c1.geometry.dispose(); c2.geometry.dispose(); core.dispose(); glow.dispose(); },
  });
}
