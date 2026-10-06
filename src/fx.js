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
export function updateTrail(base, tip, active, color) {
  trail.color.set(color);
  if (active) trail.samples.unshift({ b: base.clone(), t: tip.clone(), a: 1 });
  for (const s of trail.samples) s.a -= active ? 0.07 : 0.25;
  while (trail.samples.length > TRAIL_N || (trail.samples.length && trail.samples[trail.samples.length - 1].a <= 0)) trail.samples.pop();
  const n = trail.samples.length;
  for (let i = 0; i < TRAIL_N; i++) {
    const s = trail.samples[Math.min(i, n - 1)];
    const k = i * 6;
    if (!s) { trail.pos.fill(0, k, k + 6); trail.col.fill(0, k, k + 6); continue; }
    trail.pos[k] = s.b.x; trail.pos[k + 1] = s.b.y; trail.pos[k + 2] = s.b.z;
    trail.pos[k + 3] = s.t.x; trail.pos[k + 4] = s.t.y; trail.pos[k + 5] = s.t.z;
    const f = i < n ? Math.max(0, s.a) * (1 - i / TRAIL_N) : 0;
    trail.col[k] = trail.color.r * f * 0.25; trail.col[k + 1] = trail.color.g * f * 0.25; trail.col[k + 2] = trail.color.b * f * 0.25;
    trail.col[k + 3] = trail.color.r * f; trail.col[k + 4] = trail.color.g * f; trail.col[k + 5] = trail.color.b * f;
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
