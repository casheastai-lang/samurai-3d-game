import * as THREE from 'three';
import {
  PATH, TOWN_IDX, TOWN_R, ARENA, BOUNDS, REGIONS, TOWNS, WEAPONS, ARMORS, CHARMS,
  CONSUMABLES, ENEMIES, TIER_MIX, xpNeeded,
} from './data.js';
import {
  makeHumanoid, makeEnemyModel, makeKatana, makeHouse, makeTorii, makeStoneLantern,
  makeShopStall, makeShrine, smat,
} from './models.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
// Seeded RNG so the world is laid out the same on every visit.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrand = mulberry32(20261005);
const wr = (a, b) => a + wrand() * (b - a);

// ============================================================ Renderer & scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY_DAY = new THREE.Color(0xa9cfe8), SKY_ASH = new THREE.Color(0x5b3a33);
scene.background = SKY_DAY.clone();
scene.fog = new THREE.Fog(SKY_DAY.clone(), 70, 240);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1600);
const hemi = new THREE.HemisphereLight(0xe2efff, 0x5a4a35, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
const SUN_DAY = new THREE.Color(0xfff0d2), SUN_ASH = new THREE.Color(0xff8a5a);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================ Terrain
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
function nearestSeg(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const d = segDist(x, z, PATH[i][0], PATH[i][1], PATH[i + 1][0], PATH[i + 1][1]);
    if (d < bd) { bd = d; best = i; }
  }
  return { index: best, dist: bd };
}
const roadDist = (x, z) => nearestSeg(x, z).dist;
function townDist(x, z) {
  let m = Infinity;
  for (const t of TOWNS) m = Math.min(m, Math.hypot(x - t.x, z - t.z));
  return m;
}
function townAt(x, z) {
  for (const t of TOWNS) if (Math.hypot(x - t.x, z - t.z) < TOWN_R) return t;
  return null;
}
const arenaDist = (x, z) => Math.hypot(x - ARENA.x, z - ARENA.z);
function height(x, z) {
  const n = Math.sin(x * 0.021) * Math.cos(z * 0.017) * 5
    + Math.sin(x * 0.053 + 1.3) * Math.sin(z * 0.047 + 0.7) * 2.2
    + Math.sin((x + z) * 0.11) * 0.5;
  const f = smooth(5, 24, roadDist(x, z)) * smooth(TOWN_R, TOWN_R + 22, townDist(x, z))
    * smooth(ARENA.r + 2, ARENA.r + 22, arenaDist(x, z));
  const edge = Math.max(0, Math.abs(x) - BOUNDS.maxX + 15) + Math.max(0, BOUNDS.minZ + 15 - z, z - BOUNDS.maxZ + 15);
  return n * f + Math.pow(edge, 1.3) * 0.9;
}

function buildTerrain() {
  const minX = -440, maxX = 440, minZ = -1100, maxZ = 210;
  const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 220, 328);
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const g1 = new THREE.Color(0x587f36), g2 = new THREE.Color(0x7aa448), dirt = new THREE.Color(0x9c8158);
  const plaza = new THREE.Color(0xb5a07a), ash = new THREE.Color(0x4a3a35), arenaC = new THREE.Color(0x341915);
  const rock = new THREE.Color(0x7a756c), snow = new THREE.Color(0xeeeef4), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.5 + 0.5 + (wrand() - 0.5) * 0.25;
    c.copy(g1).lerp(g2, clamp(n, 0, 1));
    c.lerp(ash, smooth(-750, -860, z) * 0.85);
    c.lerp(dirt, (1 - smooth(2.5, 5, roadDist(x, z))) * 0.85);
    c.lerp(plaza, (1 - smooth(TOWN_R - 4, TOWN_R + 2, townDist(x, z))) * 0.7);
    c.lerp(arenaC, (1 - smooth(ARENA.r - 1, ARENA.r + 4, arenaDist(x, z))) * 0.9);
    c.lerp(rock, smooth(9, 24, h));
    c.lerp(snow, smooth(48, 75, h));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Dirt road ribbons on top of the terrain.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0xa48a62, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const joint = new THREE.CircleGeometry(2.4, 16).rotateX(-Math.PI / 2);
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(4.8, len).rotateX(-Math.PI / 2), roadMat);
    seg.position.set((ax + bx) / 2, 0.04, (az + bz) / 2);
    seg.rotation.y = Math.atan2(bx - ax, bz - az);
    seg.receiveShadow = true;
    scene.add(seg);
    const j = new THREE.Mesh(joint, roadMat);
    j.position.set(bx, 0.04, bz);
    j.receiveShadow = true;
    scene.add(j);
  }

  // Oni Mountain looms over the far north, visible from anywhere.
  const mountain = new THREE.Mesh(new THREE.CylinderGeometry(45, 280, 320, 28, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x2b2120, fog: false, flatShading: true }));
  mountain.position.set(0, 140, -1250);
  scene.add(mountain);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(44, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff5a1a, fog: false }));
  crater.position.set(0, 300.5, -1250);
  scene.add(crater);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(60, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0.25, fog: false, depthWrite: false }));
  glow.position.set(0, 300, -1250);
  scene.add(glow);
}

// ============================================================ Static colliders (grid)
const CELL = 8;
const grid = new Map();
function addCollider(x, z, r) {
  const c = { x, z, r };
  const m = r + 1.5;
  for (let gx = Math.floor((x - m) / CELL); gx <= Math.floor((x + m) / CELL); gx++) {
    for (let gz = Math.floor((z - m) / CELL); gz <= Math.floor((z + m) / CELL); gz++) {
      const k = gx + ',' + gz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
  }
}
function collideStatic(pos, r) {
  const list = grid.get(Math.floor(pos.x / CELL) + ',' + Math.floor(pos.z / CELL));
  if (!list) return;
  for (const c of list) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const d = Math.hypot(dx, dz), min = r + c.r;
    if (d < min && d > 1e-4) {
      pos.x += (dx / d) * (min - d);
      pos.z += (dz / d) * (min - d);
    }
  }
}
function clampBounds(pos) {
  pos.x = clamp(pos.x, BOUNDS.minX, BOUNDS.maxX);
  pos.z = clamp(pos.z, BOUNDS.minZ, BOUNDS.maxZ);
}

// ============================================================ Vegetation
function buildVegetation() {
  const dummy = new THREE.Object3D();
  const sets = { pine: [], sakura: [], dead: [], bamboo: [], rock: [] };
  const place = (list, x, z, s, ry = wr(0, Math.PI * 2), tilt = 0) => {
    dummy.position.set(x, height(x, z) - 0.1, z);
    dummy.rotation.set(tilt, ry, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  };
  const okSpot = (x, z, margin = 0) => roadDist(x, z) > 7 + margin && townDist(x, z) > TOWN_R + 3
    && arenaDist(x, z) > ARENA.r + 6 && height(x, z) < 40;

  for (let i = 0; i < 9000; i++) {
    const x = wr(BOUNDS.minX - 50, BOUNDS.maxX + 50), z = wr(BOUNDS.minZ - 50, BOUNDS.maxZ + 60);
    if (!okSpot(x, z)) continue;
    const inBounds = x > BOUNDS.minX && x < BOUNDS.maxX && z > BOUNDS.minZ && z < BOUNDS.maxZ;
    const r = wrand();
    if (z < -760) {
      if (r < 0.12) { place(sets.dead, x, z, wr(0.8, 1.4)); if (inBounds) addCollider(x, z, 0.5); }
      else if (r < 0.2) { place(sets.rock, x, z, wr(0.6, 2.2)); if (inBounds) addCollider(x, z, 1.0); }
    } else if (townDist(x, z) < 80 && r < 0.12) {
      place(sets.sakura, x, z, wr(0.8, 1.2)); if (inBounds) addCollider(x, z, 0.5);
    } else if (z < -20 && z > -240 && r < 0.05) {
      for (let k = 0; k < 9; k++) {
        const bx = x + wr(-2.5, 2.5), bz = z + wr(-2.5, 2.5);
        if (okSpot(bx, bz)) place(sets.bamboo, bx, bz, wr(0.7, 1.15), wr(0, 6), wr(-0.06, 0.06));
      }
      if (inBounds) addCollider(x, z, 1.8);
    } else if (r < 0.11) {
      place(sets.pine, x, z, wr(0.7, 1.5)); if (inBounds) addCollider(x, z, 0.5);
    } else if (r < 0.135) {
      place(sets.rock, x, z, wr(0.4, 1.6)); if (inBounds) addCollider(x, z, 0.8);
    }
  }

  const inst = (geo, mat, list, shadow = true) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadow;
    im.receiveShadow = true;
    scene.add(im);
  };
  const trunk = smat(0x5a3b24), darkTrunk = smat(0x2e2420);
  inst(new THREE.CylinderGeometry(0.25, 0.38, 2.2, 6).translate(0, 1.1, 0), trunk, sets.pine);
  inst(new THREE.ConeGeometry(2.0, 3.4, 7).translate(0, 3.4, 0), smat(0x2f5a2c), sets.pine);
  inst(new THREE.ConeGeometry(1.45, 2.8, 7).translate(0, 5.1, 0), smat(0x3a6b33), sets.pine);
  inst(new THREE.CylinderGeometry(0.22, 0.35, 3.0, 6).translate(0, 1.5, 0), smat(0x4a3028), sets.sakura);
  inst(new THREE.IcosahedronGeometry(2.3, 1).translate(0, 4.0, 0), smat(0xf2a7c3), sets.sakura);
  inst(new THREE.IcosahedronGeometry(1.5, 1).translate(1.2, 3.4, 0.6), smat(0xf7bfd3), sets.sakura);
  inst(new THREE.CylinderGeometry(0.12, 0.34, 4.8, 5).translate(0, 2.4, 0), darkTrunk, sets.dead);
  inst(new THREE.CylinderGeometry(0.06, 0.14, 2.2, 4).rotateZ(0.9).translate(0.8, 3.2, 0), darkTrunk, sets.dead);
  inst(new THREE.CylinderGeometry(0.07, 0.09, 7.5, 5).translate(0, 3.75, 0), smat(0x7fa64a), sets.bamboo);
  inst(new THREE.ConeGeometry(0.6, 1.6, 5).translate(0, 7.2, 0), smat(0x5d8c34), sets.bamboo, false);
  inst(new THREE.DodecahedronGeometry(1, 0).translate(0, 0.4, 0), smat(0x7b766d), sets.rock);
}

// ============================================================ Towns
const interactables = [];
const villagers = [];
const staticNPCs = [];

const VILLAGER_COLORS = [0x8a3b3b, 0x3b6a8a, 0x6a8a3b, 0x8a6a3b, 0x5b3b8a, 0x9a7a5a, 0x3b8a7a];

function placeObj(obj, x, z, ry) {
  obj.position.set(x, height(x, z), z);
  obj.rotation.y = ry;
  scene.add(obj);
  obj.updateMatrixWorld(true);
  return obj;
}
const facing = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);

function buildTown(t) {
  const i = TOWN_IDX[t.index];
  const prev = PATH[i - 1], next = PATH[i + 1];
  let dx = next[0] - prev[0], dz = next[1] - prev[1];
  const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
  const px = -dz, pz = dx;

  // Shop stall with its merchant.
  const sx = t.x + px * 12, sz = t.z + pz * 12;
  const stall = placeObj(makeShopStall([0x24467a, 0x2a6a4a, 0x6a2a5a, 0x222222][t.index]), sx, sz, facing(sx, sz, t.x, t.z));
  const merchant = makeHumanoid({ cloth: VILLAGER_COLORS[t.index + 2], cloth2: 0x3a3028, hat: 'bun' });
  merchant.root.position.set(0, 0, -0.3);
  stall.add(merchant.root);
  staticNPCs.push(merchant);
  addCollider(sx, sz, 2.4);
  const front = new THREE.Vector3(0, 0, 2.6).applyMatrix4(stall.matrixWorld);
  interactables.push({ kind: 'shop', town: t, x: front.x, z: front.z });

  // Shrine (rest, save & travel).
  const hx = t.x - px * 12, hz = t.z - pz * 12;
  const shrine = placeObj(makeShrine(), hx, hz, facing(hx, hz, t.x, t.z));
  addCollider(hx, hz, 2.0);
  const sf = new THREE.Vector3(0, 0, 2.9).applyMatrix4(shrine.matrixWorld);
  interactables.push({ kind: 'shrine', town: t, x: sf.x, z: sf.z });
  t.spawn = new THREE.Vector3(sf.x, 0, sf.z).lerp(new THREE.Vector3(t.x, 0, t.z), 0.2);

  // Village elder.
  const ex = t.x + dx * 6 + px * 4, ez = t.z + dz * 6 + pz * 4;
  const elder = makeHumanoid({ cloth: 0x6b5a7a, cloth2: 0x4a3f55, hat: 'elder', weapon: 'staff', skin: 0xd6a37e });
  placeObj(elder.root, ex, ez, facing(ex, ez, t.x, t.z));
  elder.armR.rotation.x = -0.4;
  staticNPCs.push(elder);
  addCollider(ex, ez, 0.5);
  interactables.push({ kind: 'elder', town: t, x: ex, z: ez });

  // Houses ring.
  const n = 14;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + wr(-0.1, 0.1);
    const rr = wr(19, 25);
    const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
    if (roadDist(x, z) < 7.5 || Math.hypot(x - sx, z - sz) < 8 || Math.hypot(x - hx, z - hz) < 8) continue;
    const w = wr(4.5, 6), d = wr(3.8, 4.6);
    placeObj(makeHouse(t.wall, t.roof, w, d), x, z, facing(x, z, t.x, t.z));
    addCollider(x, z, Math.max(w, d) * 0.62);
  }

  // Torii gates where the road enters and leaves the town.
  for (const p of [prev, next]) {
    let ox = p[0] - t.x, oz = p[1] - t.z;
    const ol = Math.hypot(ox, oz); ox /= ol; oz /= ol;
    const gx = t.x + ox * (TOWN_R - 2), gz = t.z + oz * (TOWN_R - 2);
    placeObj(makeTorii(1, t.index === 3 ? 0x3a3a3a : 0xc0392b), gx, gz, Math.atan2(ox, oz));
    addCollider(gx - oz * 2.6, gz + ox * 2.6, 0.4);
    addCollider(gx + oz * 2.6, gz - ox * 2.6, 0.4);
    for (const s of [-1, 1]) {
      const lx = t.x + ox * (TOWN_R - 8) - oz * 4 * s, lz = t.z + oz * (TOWN_R - 8) + ox * 4 * s;
      placeObj(makeStoneLantern(true), lx, lz, 0);
      addCollider(lx, lz, 0.5);
    }
  }

  // Kurogane Fort gets a wooden palisade.
  if (t.index === 3) {
    const stakes = [];
    const dummy = new THREE.Object3D();
    for (let k = 0; k < 140; k++) {
      const a = (k / 140) * Math.PI * 2;
      const x = t.x + Math.cos(a) * (TOWN_R + 1), z = t.z + Math.sin(a) * (TOWN_R + 1);
      if (roadDist(x, z) < 5) continue;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, a, 0); dummy.scale.set(1, wr(0.9, 1.15), 1);
      dummy.updateMatrix(); stakes.push(dummy.matrix.clone());
      addCollider(x, z, 0.8);
    }
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.4, 4.2, 6).translate(0, 2.1, 0), smat(0x4a3424), stakes.length);
    stakes.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = true;
    scene.add(im);
  }

  // Villagers who wander the plaza.
  for (let k = 0; k < 4; k++) {
    const rig = makeHumanoid({
      cloth: VILLAGER_COLORS[(k + t.index * 2) % VILLAGER_COLORS.length], cloth2: 0x3a3430,
      hat: k % 2 ? 'bun' : null, skin: [0xe0b48a, 0xc99a72, 0xd8a880][k % 3], scale: wr(0.85, 1.0),
    });
    const v = { rig, town: t, pos: new THREE.Vector3(t.x + wr(-10, 10), 0, t.z + wr(-10, 10)), target: null, wait: wr(0, 3), facing: 0 };
    scene.add(rig.root);
    villagers.push(v);
  }
}

function buildArena() {
  const dirX = PATH[8][0] - ARENA.x, dirZ = PATH[8][1] - ARENA.z;
  const entry = Math.atan2(dirZ, dirX);
  const stone = smat(0x3a3533), fire = smat(0xffa040, { emissive: 0xff5a10, emissiveIntensity: 1.6 });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    let da = Math.abs(a - entry) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
    if (da < 0.35) continue;
    const x = ARENA.x + Math.cos(a) * (ARENA.r - 1), z = ARENA.z + Math.sin(a) * (ARENA.r - 1);
    const g = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 7, 6), stone); p.position.y = 3.5; p.castShadow = true; g.add(p);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.6, 0.5, 8), stone); bowl.position.y = 7.2; g.add(bowl);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 6), fire); flame.position.y = 8.1; g.add(flame);
    placeObj(g, x, z, 0);
    addCollider(x, z, 1.1);
  }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA.r - 2, 40).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a1512, emissive: 0x3a0a04, emissiveIntensity: 0.6, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
  floor.position.set(ARENA.x, 0.03, ARENA.z);
  floor.receiveShadow = true;
  scene.add(floor);
  const ox = dirX / Math.hypot(dirX, dirZ), oz = dirZ / Math.hypot(dirX, dirZ);
  const gx = ARENA.x + ox * (ARENA.r + 3), gz = ARENA.z + oz * (ARENA.r + 3);
  placeObj(makeTorii(1.5, 0x7a0f0f), gx, gz, Math.atan2(ox, oz));
  addCollider(gx - oz * 3.9, gz + ox * 3.9, 0.5);
  addCollider(gx + oz * 3.9, gz - ox * 3.9, 0.5);
  // altar
  const altar = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 3), stone);
  altar.castShadow = true;
  placeObj(altar, ARENA.x, ARENA.z - 18, 0);
  altar.position.y += 0.6;
  addCollider(ARENA.x, ARENA.z - 18, 2.6);
}

// ============================================================ Particles & effects
const PMAX = 900;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pBase = new Float32Array(PMAX * 3);
const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pGrav = new Float32Array(PMAX);
for (let i = 0; i < PMAX; i++) pPos[i * 3 + 1] = -9999;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
points.frustumCulled = false;
scene.add(points);
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
function spawnSlash(kind, color, delay) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(arcGeo[kind], mat);
  scene.add(m);
  effects.push({
    t: -delay, life: 0.2,
    update(t) {
      m.position.set(P.pos.x, P.y + (kind === 'v' ? 1.3 : 1.2), P.pos.z);
      m.rotation.y = P.facing;
      if (t < 0) return;
      const k = t / this.life;
      mat.opacity = 0.85 * (1 - k);
      m.scale.setScalar(0.85 + k * 0.3);
    },
    dispose() { scene.remove(m); mat.dispose(); },
  });
}
function spawnRing(x, z, r, dur) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.3, depthWrite: false });
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

let shakeAmt = 0, hitstop = 0, hurtFlash = 0;
const shake = a => { shakeAmt = Math.max(shakeAmt, a); };

// ============================================================ Rig animation
function animateWalk(rig, dt, amt) {
  if (amt > 0.05) rig.walk += dt * (5 + 5 * amt);
  const a = Math.min(1, amt);
  const s = Math.sin(rig.walk) * 0.7 * a;
  rig.legL.rotation.x = lerp(rig.legL.rotation.x, s, 0.4);
  rig.legR.rotation.x = lerp(rig.legR.rotation.x, -s, 0.4);
  rig.armL.rotation.x = lerp(rig.armL.rotation.x, -s * 0.8, 0.4);
  rig.body.position.y = 1.0 + Math.abs(Math.cos(rig.walk)) * 0.06 * a;
}
const REST_ARM = -0.9;
function restArm(rig, k = 0.2) {
  rig.armR.rotation.x = lerp(rig.armR.rotation.x, REST_ARM, k);
  rig.armR.rotation.y = lerp(rig.armR.rotation.y, 0, k);
  rig.armR.rotation.z = lerp(rig.armR.rotation.z, 0, k);
  rig.body.rotation.x = lerp(rig.body.rotation.x, 0, k);
  rig.body.rotation.y = lerp(rig.body.rotation.y, 0, k);
}
function poseAttack(rig, anim, t, A) {
  const s = smooth(A.hitAt - 0.09, A.hitAt + 0.05, t);
  const arm = rig.armR, body = rig.body;
  if (anim === 'slashA') { arm.rotation.set(-1.45, lerp(1.4, -1.5, s), 0); body.rotation.y = lerp(0.45, -0.5, s); }
  else if (anim === 'slashB') { arm.rotation.set(-1.45, lerp(-1.5, 1.4, s), 0); body.rotation.y = lerp(-0.5, 0.45, s); }
  else { arm.rotation.set(lerp(-3.0, -0.5, s), 0, 0); body.rotation.x = lerp(-0.18, 0.25, s); }
  const r = smooth(A.hitAt + 0.1, A.dur, t);
  if (r > 0) {
    arm.rotation.x = lerp(arm.rotation.x, REST_ARM, r);
    arm.rotation.y = lerp(arm.rotation.y, 0, r);
    body.rotation.x = lerp(body.rotation.x, 0, r);
    body.rotation.y = lerp(body.rotation.y, 0, r);
  }
}

// ============================================================ Player
const COMBO = [
  { anim: 'slashA', dur: 0.42, hitAt: 0.13, mult: 1.0, range: 2.9, dot: 0.1, cost: 8, lunge: 3, arc: 'h' },
  { anim: 'slashB', dur: 0.42, hitAt: 0.13, mult: 1.1, range: 2.9, dot: 0.1, cost: 8, lunge: 3, arc: 'h' },
  { anim: 'chop', dur: 0.6, hitAt: 0.24, mult: 1.7, range: 3.2, dot: 0.3, cost: 10, lunge: 5, arc: 'v', finisher: true },
];
const HEAVY = { anim: 'heavy', dur: 0.85, hitAt: 0.45, mult: 2.4, range: 3.9, dot: -0.25, cost: 26, lunge: 6, arc: 'wide', heavy: true };
const DODGE_TIME = 0.45;

const P = {
  pos: new THREE.Vector3(), y: 0, vy: 0, grounded: true, facing: Math.PI, kb: new THREE.Vector3(),
  hp: 100, st: 100, lvl: 1, xp: 0, gold: 0, potions: 2, elixirs: 0,
  weapon: 'worn', armor: 'cloth', charms: [], discovered: [0], lastTown: 0, bossDead: false, kills: 0,
  state: 'idle', stateT: 0, atk: null, combo: 0, queued: false, hitDone: false,
  invul: 0, hitInvul: 0, stDelay: 0, dead: false, moveAmt: 0, dodgeDir: new THREE.Vector3(),
};
const hasCharm = c => P.charms.includes(c);
const maxHp = () => 100 + (P.lvl - 1) * 12 + (hasCharm('vitality') ? 50 : 0);
const maxSt = () => 100 + (hasCharm('stamina') ? 40 : 0);
const atkPower = () => 6 + (P.lvl - 1) * 2 + WEAPONS[P.weapon].atk;
const defense = () => ARMORS[P.armor].def;

const ARMOR_COLORS = { cloth: null, leather: 0x5a2e1c, iron: 0x4d535c, oyoroi: 0x8e1b1b, dragon: 0x1f6a5a };
let rig = null;
function rebuildPlayerRig() {
  if (rig) scene.remove(rig.root);
  const w = WEAPONS[P.weapon];
  rig = makeHumanoid({
    cloth: 0x1f2b4d, cloth2: 0x24242e, hat: 'kasa', weapon: 'katana', scarf: 0xa3231a,
    armor: ARMOR_COLORS[P.armor], bladeColor: w.color, bladeGlow: w.glow,
  });
  rig.armR.rotation.x = REST_ARM;
  scene.add(rig.root);
}
const slashColor = () => ({ mura: 0xff6a5a, onikiri: 0x8fe8ff, tama: 0xdfeeff })[P.weapon] ?? 0xfff4e0;

// ============================================================ Input
const keys = {};
let camYaw = 0, camPitch = 0.38, camDist = 9;
let lockFailed = false;
let ui = 'title';
let started = false;

function inputDir() {
  const ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
  const l = Math.hypot(mx, mz);
  if (l > 0) { mx /= l; mz /= l; }
  return { x: mx, z: mz, len: l };
}

window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Escape') {
    if (ui === 'map') toggleMap();
    else if (['shop', 'shrine', 'dialog', 'help'].includes(ui)) closeModal();
    return;
  }
  if (ui === 'map' && e.code === 'KeyM') { toggleMap(); return; }
  if (ui === 'help' && e.code === 'KeyH') { closeModal(); return; }
  if (ui === 'shop' || ui === 'shrine' || ui === 'dialog') {
    if (e.code === 'KeyE') closeModal();
    return;
  }
  if (ui || !started || P.dead) return;
  switch (e.code) {
    case 'KeyE': interact(); break;
    case 'KeyQ': drink('potion'); break;
    case 'KeyR': drink('elixir'); break;
    case 'KeyM': toggleMap(); break;
    case 'KeyH': showHelp(); break;
    case 'KeyJ': tryAttack(false); break;
    case 'KeyK': tryAttack(true); break;
    case 'Space': tryJump(); break;
    case 'KeyF': case 'KeyC': tryDodge(); break;
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (ui || !started) return;
  if (document.pointerLockElement !== canvas && !lockFailed) {
    try {
      const r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => { lockFailed = true; });
    } catch { lockFailed = true; }
    return;
  }
  if (P.dead) return;
  if (e.button === 0) tryAttack(false);
  else if (e.button === 2) tryAttack(true);
});
document.addEventListener('pointerlockerror', () => { lockFailed = true; });
document.addEventListener('mousemove', e => {
  if (ui) return;
  if (document.pointerLockElement === canvas || (lockFailed && e.buttons)) {
    camYaw -= e.movementX * 0.0025;
    camPitch = clamp(camPitch + e.movementY * 0.002, -0.15, 1.2);
  }
});
canvas.addEventListener('wheel', e => { camDist = clamp(camDist + Math.sign(e.deltaY) * 0.8, 4.5, 16); }, { passive: true });

// ============================================================ Player actions
function nearestEnemy(range) {
  let best = null, bd = range;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) - e.def.radius;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function tryAttack(heavy) {
  if (P.dead || P.state === 'dodge') return;
  if (P.state === 'attack') {
    if (!heavy && !P.atk.heavy && P.stateT > P.atk.hitAt * 0.5) P.queued = true;
    return;
  }
  startAttack(heavy, 0);
}
function startAttack(heavy, combo) {
  const A = heavy ? HEAVY : COMBO[combo];
  if (P.st < A.cost * 0.5) { floatText(headPos(), 'Exhausted', 'hurt', 0.7); P.state = 'idle'; return; }
  P.st = Math.max(0, P.st - A.cost);
  P.stDelay = 0.9;
  P.state = 'attack'; P.atk = A; P.combo = combo; P.stateT = 0; P.hitDone = false; P.queued = false;
  const target = nearestEnemy(5.5);
  const dir = inputDir();
  if (target) P.facing = Math.atan2(target.pos.x - P.pos.x, target.pos.z - P.pos.z);
  else if (dir.len > 0) P.facing = Math.atan2(dir.x, dir.z);
  spawnSlash(A.arc, slashColor(), A.hitAt - 0.06);
}
function tryJump() {
  if (P.state === 'dodge' || P.state === 'attack') return;
  if (P.y - height(P.pos.x, P.pos.z) < 0.2) { P.vy = 9.5; P.grounded = false; }
}
function tryDodge() {
  if (P.state === 'dodge' || P.st < 15) return;
  if (P.state === 'attack' && P.stateT < P.atk.hitAt) return;
  const d = inputDir();
  if (d.len > 0) P.dodgeDir.set(d.x, 0, d.z);
  else P.dodgeDir.set(Math.sin(P.facing), 0, Math.cos(P.facing));
  P.facing = Math.atan2(P.dodgeDir.x, P.dodgeDir.z);
  P.st -= 20; P.stDelay = 0.8;
  P.state = 'dodge'; P.stateT = 0; P.invul = 0.34;
  burst(P.pos.x, P.y + 0.2, P.pos.z, 8, 0x8a7a5a, 2, 1, 0.5, 4);
}
function drink(kind) {
  const key = kind === 'potion' ? 'potions' : 'elixirs';
  if (P[key] <= 0) { banner('', kind === 'potion' ? 'No healing potions left' : 'No elixirs left', 1.2); return; }
  if (P.hp >= maxHp()) { banner('', 'Already at full health', 1.0); return; }
  P[key]--;
  const before = P.hp;
  P.hp = kind === 'potion' ? Math.min(maxHp(), P.hp + 60) : maxHp();
  floatText(headPos(), '+' + Math.round(P.hp - before), 'heal');
  burst(P.pos.x, P.y + 1.2, P.pos.z, 30, 0x6aff8a, 2, 4, 0.9, 2);
}
function headPos() { return new THREE.Vector3(P.pos.x, P.y + 2.5, P.pos.z); }

function doPlayerHit(A) {
  const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
  let hit = false;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > A.range + e.def.radius) continue;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < A.dot) continue;
    const crit = Math.random() < 0.12;
    const dmg = Math.round(atkPower() * A.mult * rand(0.9, 1.1) * (crit ? 1.6 : 1));
    damageEnemy(e, dmg, crit, A, dx / (d || 1), dz / (d || 1));
    hit = true;
  }
  if (hit) { hitstop = A.heavy ? 0.09 : 0.05; shake(A.heavy ? 0.35 : 0.15); }
}

function damagePlayer(amount, src) {
  if (P.dead || P.invul > 0 || P.hitInvul > 0) return false;
  const dmg = Math.max(1, Math.round(amount * rand(0.9, 1.1) - defense()));
  P.hp -= dmg;
  P.hitInvul = 0.5;
  hurtFlash = 1;
  shake(0.4);
  floatText(headPos(), '-' + dmg, 'hurt');
  burst(P.pos.x, P.y + 1.3, P.pos.z, 14, 0xff2a1a, 4, 3, 0.5);
  if (src) {
    const dx = P.pos.x - src.pos.x, dz = P.pos.z - src.pos.z, d = Math.hypot(dx, dz) || 1;
    P.kb.set(dx / d, 0, dz / d).multiplyScalar(dmg > maxHp() * 0.15 ? 10 : 5);
  }
  if (dmg > maxHp() * 0.15 && P.state === 'attack') P.state = 'idle';
  if (P.hp <= 0) { P.hp = 0; playerDie(); }
  return true;
}

function playerDie() {
  P.dead = true; P.state = 'dead'; P.stateT = 0;
  banner('You have fallen', '', 2.5);
  setTimeout(() => {
    const lost = Math.floor(P.gold * 0.3);
    openModal(`
      <div class="kanji">死</div>
      <h2 class="center">You have fallen</h2>
      <p class="center">Your spirit returns to the shrine of <b>${TOWNS[P.lastTown].name}</b>.<br>
      Scavengers take <span class="gold">&#9672; ${lost}</span> of your gold.</p>
      <div class="btns"><button data-act="rise">Rise again</button></div>`, 'dead');
  }, 2000);
}
function rise() {
  P.gold -= Math.floor(P.gold * 0.3);
  P.dead = false; P.state = 'idle'; P.hp = maxHp(); P.st = maxSt(); P.kb.set(0, 0, 0);
  rig.body.rotation.set(0, 0, 0);
  for (const e of enemies) if (e.alive && e.state !== 'idle') { e.state = 'return'; }
  closeModal();
  placeAtTown(P.lastTown);
  save();
}

function gainXP(n) {
  P.xp += n;
  while (P.xp >= xpNeeded(P.lvl)) {
    P.xp -= xpNeeded(P.lvl);
    P.lvl++;
    P.hp = maxHp();
    banner('Level ' + P.lvl, 'Your strength and health grow', 2.2);
    burst(P.pos.x, P.y + 1, P.pos.z, 50, 0xffd860, 3, 6, 1.2, 3);
  }
}

function updatePlayer(dt) {
  P.stateT += dt;
  P.invul = Math.max(0, P.invul - dt);
  P.hitInvul = Math.max(0, P.hitInvul - dt);
  P.stDelay -= dt;
  if (P.stDelay <= 0) P.st = Math.min(maxSt(), P.st + 32 * dt);
  if (hasCharm('regen') && !P.dead) P.hp = Math.min(maxHp(), P.hp + 2 * dt);

  const ground = height(P.pos.x, P.pos.z);
  if (P.dead) {
    rig.body.rotation.x = lerp(rig.body.rotation.x, -1.45, 0.08);
    rig.body.position.y = lerp(rig.body.position.y, 0.35, 0.08);
    rig.root.position.set(P.pos.x, ground, P.pos.z);
    return;
  }

  const dir = inputDir();
  let speedFrac = 0;
  if (P.state === 'dodge') {
    const p = P.stateT / DODGE_TIME;
    const sp = 15 * (1 - p * 0.75);
    P.pos.x += P.dodgeDir.x * sp * dt;
    P.pos.z += P.dodgeDir.z * sp * dt;
    rig.body.rotation.x = p * Math.PI * 2;
    rig.body.position.y = 1.0 - Math.sin(p * Math.PI) * 0.45;
    if (P.stateT >= DODGE_TIME) { P.state = 'idle'; rig.body.rotation.x = 0; }
  } else if (P.state === 'attack') {
    const A = P.atk;
    if (P.stateT < A.hitAt) {
      P.pos.x += Math.sin(P.facing) * A.lunge * dt;
      P.pos.z += Math.cos(P.facing) * A.lunge * dt;
    }
    if (!P.hitDone && P.stateT >= A.hitAt) { P.hitDone = true; doPlayerHit(A); }
    poseAttack(rig, A.anim, P.stateT, A);
    if (P.stateT >= A.dur) {
      if (P.queued && P.combo < 2) startAttack(false, P.combo + 1);
      else { P.state = 'idle'; P.combo = 0; }
    }
  } else {
    const sprint = (keys.ShiftLeft || keys.ShiftRight) && P.st > 1 && dir.len > 0;
    const speed = dir.len > 0 ? (sprint ? 10.5 : 6.5) : 0;
    if (sprint) { P.st -= 20 * dt; P.stDelay = 0.4; }
    P.pos.x += dir.x * speed * dt;
    P.pos.z += dir.z * speed * dt;
    if (dir.len > 0) P.facing = angleLerp(P.facing, Math.atan2(dir.x, dir.z), 1 - Math.exp(-14 * dt));
    speedFrac = speed / 6.5;
    restArm(rig);
  }

  P.pos.addScaledVector(P.kb, dt);
  P.kb.multiplyScalar(Math.exp(-9 * dt));
  collideStatic(P.pos, 0.5);
  clampBounds(P.pos);

  const g = height(P.pos.x, P.pos.z);
  P.vy -= 26 * dt;
  P.y += P.vy * dt;
  if (P.y <= g) { P.y = g; P.vy = 0; P.grounded = true; }
  else if (P.y - g > 0.3) P.grounded = false;
  if (P.grounded && P.y < g + 0.6) P.y = g; // stick to slopes when walking downhill

  rig.root.position.set(P.pos.x, P.y, P.pos.z);
  rig.root.rotation.y = P.facing;
  if (P.state !== 'dodge') animateWalk(rig, dt, P.grounded ? speedFrac : 0);
  if (!P.grounded && P.state === 'idle') { rig.legL.rotation.x = -0.5; rig.legR.rotation.x = 0.3; }
  rig.root.visible = !(P.hitInvul > 0 && Math.floor(P.hitInvul * 20) % 2 === 0);
}

// ============================================================ Enemies
const enemies = [];
let boss = null;
const barGeoBg = new THREE.PlaneGeometry(1.3, 0.14);
const barGeoFg = new THREE.PlaneGeometry(1.3, 0.14).translate(0.65, 0, 0);
const barMatBg = new THREE.MeshBasicMaterial({ color: 0x1a0505, transparent: true, opacity: 0.75, depthTest: false });
const barMatFg = new THREE.MeshBasicMaterial({ color: 0xd8382a, depthTest: false });

function createEnemy(type, x, z, opts = {}) {
  const def = ENEMIES[type];
  const r = makeEnemyModel(type, def.scale);
  scene.add(r.root);
  const e = {
    type, def, rig: r, pos: new THREE.Vector3(x, 0, z), home: new THREE.Vector3(x, 0, z),
    hp: def.hp, alive: true, state: 'idle', t: 0, cd: 0, facing: opts.facing ?? Math.random() * Math.PI * 2,
    flash: 0, glow: 0, kb: new THREE.Vector3(), wanderT: rand(0, 4), target: null, deadT: 0,
    summoned: !!opts.summoned, phase: 1, struck: false, bar: null, moveFrac: 0, chargeDir: new THREE.Vector3(),
  };
  if (type !== 'boss') {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(barGeoBg, barMatBg), fg = new THREE.Mesh(barGeoFg, barMatFg);
    fg.position.set(-0.65, 0, 0.001);
    bg.renderOrder = 998; fg.renderOrder = 999;
    g.add(bg, fg); g.fg = fg; g.visible = false;
    scene.add(g);
    e.bar = g;
  }
  enemies.push(e);
  return e;
}

function spawnWorldEnemies() {
  for (let tier = 0; tier < 4; tier++) {
    const a = TOWN_IDX[tier], b = tier < 3 ? TOWN_IDX[tier + 1] : PATH.length - 1;
    let groups = 0, tries = 0;
    while (groups < 13 && tries++ < 400) {
      const k = a + Math.floor(wrand() * (b - a));
      const u = wrand();
      const [ax, az] = PATH[k], [bx, bz] = PATH[k + 1];
      let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const side = wrand() < 0.5 ? -1 : 1, off = wr(5, 42);
      const cx = ax + (bx - ax) * u - dz * off * side, cz = az + (bz - az) * u + dx * off * side;
      if (townDist(cx, cz) < TOWN_R + 16 || arenaDist(cx, cz) < ARENA.r + 14) continue;
      if (cx < BOUNDS.minX + 10 || cx > BOUNDS.maxX - 10) continue;
      let pick = wrand(), type = TIER_MIX[tier][0][0];
      for (const [t, p] of TIER_MIX[tier]) { if (pick < p) { type = t; break; } pick -= p; }
      const size = type === 'captain' ? 1 : 2 + Math.floor(wrand() * 2);
      for (let s = 0; s < size; s++) {
        const ex = cx + wr(-4, 4), ez = cz + wr(-4, 4);
        createEnemy(s > 0 && type === 'captain' ? 'oni' : type, ex, ez);
      }
      groups++;
    }
  }
  boss = createEnemy('boss', ARENA.x, ARENA.z - 10, { facing: 0 });
}

function damageEnemy(e, dmg, crit, A, nx, nz) {
  e.hp -= dmg;
  e.flash = 0.12;
  const top = e.def.scale * 2.4 + 0.3;
  floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + top, e.pos.z), String(dmg), crit ? 'crit' : 'dmg', 0.9);
  const isDemon = e.type !== 'bandit';
  burst(e.pos.x, height(e.pos.x, e.pos.z) + e.def.scale * 1.4, e.pos.z, crit ? 22 : 12, isDemon ? 0xb04aff : 0xff3020, 5, 4, 0.55);
  if (e.state === 'idle' || e.state === 'return') e.state = 'chase';
  const p = e.def.poise;
  const stagger = p === 0 || (p === 1 && (A.heavy || A.finisher)) || (p === 2 && A.heavy);
  e.kb.set(nx, 0, nz).multiplyScalar(stagger ? (A.heavy ? 10 : 6) / e.def.scale : 1);
  if (e.hp <= 0) { killEnemy(e); return; }
  if (stagger) { e.state = 'hurt'; e.t = 0; e.glow = 0; }
  if (e === boss && e.phase === 1 && e.hp < e.def.hp * 0.5) enrageBoss(e);
}

function killEnemy(e) {
  e.alive = false; e.deadT = 0; e.state = 'dead'; e.hp = 0;
  if (e.bar) e.bar.visible = false;
  const [g0, g1] = e.def.gold;
  const gold = randInt(g0, g1);
  P.gold += gold; P.kills++;
  const y = height(e.pos.x, e.pos.z) + e.def.scale * 2;
  floatText(new THREE.Vector3(e.pos.x, y + 0.6, e.pos.z), '+' + gold + ' gold', 'gold', 1.3);
  floatText(new THREE.Vector3(e.pos.x, y, e.pos.z), '+' + e.def.xp + ' xp', 'xp', 1.3);
  burst(e.pos.x, y - e.def.scale, e.pos.z, 40, e.type === 'bandit' ? 0xffb347 : 0x9a3aff, 4, 6, 1.1, 3);
  gainXP(e.def.xp);
  if (e === boss) victory();
}

function respawnEnemy(e) {
  e.alive = true; e.hp = e.def.hp; e.state = 'idle'; e.deadT = 0; e.t = 0; e.cd = 0;
  e.pos.copy(e.home); e.kb.set(0, 0, 0); e.phase = 1;
  e.rig.root.visible = true;
  e.rig.body.rotation.set(0, 0, 0);
  e.rig.body.position.y = 1.0;
}

function enrageBoss(e) {
  e.phase = 2;
  banner('The Demon King is enraged!', 'His lesser oni answer the call', 2.5);
  shake(0.6);
  burst(e.pos.x, height(e.pos.x, e.pos.z) + 5, e.pos.z, 80, 0xff3a10, 8, 8, 1.4, 6);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const m = createEnemy('oni', ARENA.x + Math.cos(a) * 14, ARENA.z + Math.sin(a) * 14, { summoned: true });
    m.state = 'chase';
    burst(m.pos.x, 1, m.pos.z, 30, 0x9a3aff, 3, 6, 1, 3);
  }
}

function setEmissive(e) {
  const f = Math.max(0, e.flash) / 0.12;
  const g = e.glow;
  for (const m of e.rig.mats) {
    if (!m.emissive) continue;
    m.emissive.setRGB(f + g * 0.9, f + g * 0.08, f + g * 0.02);
    m.emissiveIntensity = 1;
  }
}

function bossChoose(e, dist) {
  const r = Math.random();
  if (dist > 13 && r < 0.55) { e.state = 'chargeWind'; e.t = 0; return true; }
  if (dist < 11 && r < (e.phase === 2 ? 0.5 : 0.3)) {
    e.state = 'slamWind'; e.t = 0;
    spawnRing(e.pos.x, e.pos.z, 9, e.phase === 2 ? 0.8 : 1.05);
    return true;
  }
  return false;
}

const activeList = [];
function updateEnemies(dt, playerSafe) {
  activeList.length = 0;
  for (const e of enemies) {
    const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, dist = Math.hypot(dx, dz);
    const d = e.def;
    if (!e.alive) {
      e.deadT += dt;
      if (e.deadT < 1.3) {
        e.rig.body.rotation.x = Math.min(1.45, e.deadT * 3);
        e.rig.body.position.y = lerp(1.0, 0.4, Math.min(1, e.deadT * 2));
        if (e.deadT > 0.8) e.rig.root.position.y -= dt * 1.5 * d.scale;
      } else if (e.rig.root.visible) e.rig.root.visible = false;
      if (e.summoned && e.deadT > 2) e.remove = true;
      else if (e !== boss && !e.summoned && e.deadT > 75 && dist > 80) respawnEnemy(e);
      continue;
    }
    e.rig.root.visible = dist < 170;
    if (dist > 120 && e.state === 'idle') { if (e.bar) e.bar.visible = false; continue; }
    activeList.push(e);

    e.t += dt; e.cd -= dt; e.flash -= dt;
    const sp = d.speed * (e.phase === 2 ? 1.3 : 1);
    const wind = d.windup * (e.phase === 2 ? 0.75 : 1);
    let moveSpeed = 0, mvx = 0, mvz = 0;
    const toPlayer = Math.atan2(dx, dz);
    const turnTo = (ang, k) => { e.facing = angleLerp(e.facing, ang, 1 - Math.exp(-k * dt)); };
    const homeDist = Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z);
    const leash = e === boss ? 55 : 75;

    switch (e.state) {
      case 'idle': {
        e.glow = 0;
        e.wanderT -= dt;
        if (e.wanderT <= 0) {
          e.target = e === boss ? null : { x: e.home.x + rand(-8, 8), z: e.home.z + rand(-8, 8) };
          e.wanderT = rand(3, 7);
        }
        if (e.target) {
          const tx = e.target.x - e.pos.x, tz = e.target.z - e.pos.z, tl = Math.hypot(tx, tz);
          if (tl < 0.6) e.target = null;
          else { mvx = tx / tl; mvz = tz / tl; moveSpeed = sp * 0.3; turnTo(Math.atan2(tx, tz), 4); }
        }
        if (!playerSafe && dist < d.aggro) {
          e.state = 'chase';
          floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + d.scale * 2.4 + 0.6, e.pos.z), '!', 'alert', 0.8);
          if (e === boss) {
            banner('Shuten-doji', 'The Demon King rises to face you', 3);
            shake(0.5);
          }
        }
        break;
      }
      case 'chase': {
        e.glow = 0;
        if (playerSafe || dist > d.aggro * 2.6 || homeDist > leash) { e.state = 'return'; break; }
        turnTo(toPlayer, 8);
        if (e === boss && e.cd <= 0 && bossChoose(e, dist)) break;
        if (dist < d.range + 0.3 && e.cd <= 0) { e.state = 'windup'; e.t = 0; }
        else if (dist > d.range * 0.75) { mvx = dx / dist; mvz = dz / dist; moveSpeed = sp; }
        break;
      }
      case 'windup': {
        turnTo(toPlayer, 5);
        e.glow = Math.min(1, e.t / wind) * 0.8;
        if (e.t >= wind) { e.state = 'strike'; e.t = 0; e.struck = false; }
        break;
      }
      case 'strike': {
        e.glow = 0;
        if (e.t < 0.1) { mvx = Math.sin(e.facing); mvz = Math.cos(e.facing); moveSpeed = 4; }
        if (!e.struck && e.t >= 0.08) {
          e.struck = true;
          const fx = Math.sin(e.facing), fz = Math.cos(e.facing);
          const dot = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
          if (dist < d.range + 0.9 && dot > 0.1 && Math.abs(P.y - height(P.pos.x, P.pos.z)) < 1.6) damagePlayer(d.dmg, e);
          if (e === boss) shake(0.25);
        }
        if (e.t >= 0.28) { e.state = 'recover'; e.t = 0; }
        break;
      }
      case 'recover': {
        if (e.t >= d.recover * (e.phase === 2 ? 0.7 : 1)) { e.state = 'chase'; e.cd = rand(0.2, 0.9); }
        break;
      }
      case 'hurt': {
        if (e.t >= 0.35) e.state = 'chase';
        break;
      }
      case 'return': {
        e.glow = 0;
        const tx = e.home.x - e.pos.x, tz = e.home.z - e.pos.z, tl = Math.hypot(tx, tz);
        e.hp = Math.min(d.hp, e.hp + d.hp * 0.25 * dt);
        if (tl < 1.5) { e.state = 'idle'; e.hp = d.hp; if (e === boss) e.phase = 1; }
        else { mvx = tx / tl; mvz = tz / tl; moveSpeed = sp; turnTo(Math.atan2(tx, tz), 6); }
        if (!playerSafe && dist < d.aggro * 0.6) e.state = 'chase';
        break;
      }
      // ---- Boss-only moves
      case 'slamWind': {
        turnTo(toPlayer, 2);
        if (e.t >= (e.phase === 2 ? 0.8 : 1.05)) {
          e.state = 'recover'; e.t = -0.3;
          shake(0.8);
          burst(e.pos.x, height(e.pos.x, e.pos.z) + 0.5, e.pos.z, 90, 0xff6a2a, 12, 5, 0.9, 10);
          const airborne = P.y - height(P.pos.x, P.pos.z) > 0.7;
          if (dist < 9.3 && !airborne) damagePlayer(d.dmg * 1.35, e);
        }
        break;
      }
      case 'chargeWind': {
        turnTo(toPlayer, 6);
        e.glow = Math.min(1, e.t / 0.6);
        if (e.t >= 0.6) {
          e.state = 'charge'; e.t = 0; e.struck = false;
          e.chargeDir.set(Math.sin(e.facing), 0, Math.cos(e.facing));
          banner('', 'The Demon King charges!', 0.8);
        }
        break;
      }
      case 'charge': {
        e.glow = 0.6;
        mvx = e.chargeDir.x; mvz = e.chargeDir.z; moveSpeed = 22;
        if (!e.struck && dist < d.radius + 1.4) { e.struck = true; damagePlayer(d.dmg, e); }
        if (Math.random() < 0.5) burst(e.pos.x, height(e.pos.x, e.pos.z) + 0.3, e.pos.z, 2, 0x8a6a4a, 2, 1, 0.5, 3);
        if (e.t >= 0.75 || arenaDist(e.pos.x, e.pos.z) > ARENA.r + 6) { e.state = 'recover'; e.t = 0; }
        break;
      }
    }

    e.pos.x += mvx * moveSpeed * dt;
    e.pos.z += mvz * moveSpeed * dt;
    e.pos.addScaledVector(e.kb, dt);
    e.kb.multiplyScalar(Math.exp(-8 * dt));

    // Keep out of player and towns.
    if (dist < d.radius + 0.5 && dist > 0.01) {
      const push = d.radius + 0.5 - dist;
      e.pos.x -= (dx / dist) * push; e.pos.z -= (dz / dist) * push;
    }
    for (const t of TOWNS) {
      const tx = e.pos.x - t.x, tz = e.pos.z - t.z, tl = Math.hypot(tx, tz);
      if (tl < TOWN_R + 2) { e.pos.x = t.x + (tx / tl) * (TOWN_R + 2); e.pos.z = t.z + (tz / tl) * (TOWN_R + 2); }
    }
    if (e !== boss) collideStatic(e.pos, d.radius * 0.8);
    clampBounds(e.pos);

    const gy = height(e.pos.x, e.pos.z);
    e.rig.root.position.set(e.pos.x, gy, e.pos.z);
    e.rig.root.rotation.y = e.facing;
    e.moveFrac = lerp(e.moveFrac, moveSpeed / d.speed, 0.2);
    animateWalk(e.rig, dt, Math.min(1.6, e.moveFrac));

    const arm = e.rig.armR;
    if (e.state === 'windup' || e.state === 'chargeWind') {
      const k = smooth(0, wind * 0.7, e.t);
      arm.rotation.set(lerp(REST_ARM, -2.9, k), 0, 0);
      e.rig.body.rotation.x = lerp(0, -0.15, k);
    } else if (e.state === 'strike') {
      const k = smooth(0, 0.1, e.t);
      arm.rotation.set(lerp(-2.9, -0.4, k), 0, 0);
      e.rig.body.rotation.x = lerp(-0.15, 0.25, k);
    } else if (e.state === 'slamWind') {
      const k = smooth(0, 0.5, e.t);
      arm.rotation.set(lerp(REST_ARM, -3.0, k), 0, 0);
      e.rig.armL.rotation.x = lerp(0, -3.0, k);
      e.rig.body.rotation.x = -0.2 * k;
    } else if (e.state === 'hurt') {
      e.rig.body.rotation.x = lerp(e.rig.body.rotation.x, -0.3, 0.3);
    } else if (e.state === 'charge') {
      e.rig.body.rotation.x = 0.35;
      arm.rotation.set(-1.2, 0, 0);
    } else {
      restArm(e.rig, 0.12);
    }
    setEmissive(e);

    if (e.bar) {
      const show = e.hp < d.hp && dist < 45;
      e.bar.visible = show;
      if (show) {
        e.bar.position.set(e.pos.x, gy + d.scale * 2.45 + 0.35, e.pos.z);
        e.bar.quaternion.copy(camera.quaternion);
        e.bar.fg.scale.x = Math.max(0.001, e.hp / d.hp);
      }
    }
  }

  // Separation between active enemies.
  for (let i = 0; i < activeList.length; i++) {
    const a = activeList[i];
    for (let j = i + 1; j < activeList.length; j++) {
      const b = activeList[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = a.def.radius + b.def.radius;
      if (d < min && d > 0.001) {
        const push = (min - d) / 2;
        a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
        b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
      }
    }
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].remove) { scene.remove(enemies[i].rig.root); if (enemies[i].bar) scene.remove(enemies[i].bar); enemies.splice(i, 1); }
  }
}

// ============================================================ NPCs
function updateNPCs(dt, time) {
  for (const v of villagers) {
    const dist = Math.hypot(v.pos.x - P.pos.x, v.pos.z - P.pos.z);
    v.rig.root.visible = dist < 150;
    if (dist > 120) continue;
    let moving = 0;
    if (v.wait > 0) v.wait -= dt;
    else if (!v.target) {
      const a = Math.random() * Math.PI * 2, r = rand(3, 17);
      v.target = { x: v.town.x + Math.cos(a) * r, z: v.town.z + Math.sin(a) * r };
    } else {
      const tx = v.target.x - v.pos.x, tz = v.target.z - v.pos.z, tl = Math.hypot(tx, tz);
      if (tl < 0.5) { v.target = null; v.wait = rand(2, 6); }
      else {
        v.pos.x += (tx / tl) * 1.6 * dt; v.pos.z += (tz / tl) * 1.6 * dt;
        v.facing = angleLerp(v.facing, Math.atan2(tx, tz), 1 - Math.exp(-6 * dt));
        moving = 0.4;
      }
    }
    collideStatic(v.pos, 0.4);
    const pd = Math.hypot(v.pos.x - P.pos.x, v.pos.z - P.pos.z);
    if (pd < 0.9 && pd > 0.01) { v.pos.x += (v.pos.x - P.pos.x) / pd * (0.9 - pd); v.pos.z += (v.pos.z - P.pos.z) / pd * (0.9 - pd); }
    v.rig.root.position.set(v.pos.x, height(v.pos.x, v.pos.z), v.pos.z);
    v.rig.root.rotation.y = v.facing;
    animateWalk(v.rig, dt, moving);
  }
  for (const n of staticNPCs) n.body.position.y = 1.0 + Math.sin(time * 2 + n.root.id) * 0.015;
}

// ============================================================ UI: HUD, modal, map
const hud = {
  hpFill: $('hpFill'), hpText: $('hpText'), stFill: $('stFill'), xpFill: $('xpFill'), lvl: $('lvl'), gold: $('gold'),
  pots: $('pots'), elx: $('elx'), gear: $('gear'), locName: $('locName'), locSub: $('locSub'), prompt: $('prompt'),
  bossbar: $('bossbar'), bossFill: $('bossFill'), bossName: $('bossName'), lockHint: $('lockHint'),
};
function updateHUD() {
  const mh = maxHp();
  hud.hpFill.style.width = (P.hp / mh * 100) + '%';
  hud.hpText.textContent = Math.ceil(P.hp) + ' / ' + mh;
  hud.stFill.style.width = (P.st / maxSt() * 100) + '%';
  hud.xpFill.style.width = (P.xp / xpNeeded(P.lvl) * 100) + '%';
  hud.lvl.textContent = P.lvl;
  hud.gold.textContent = P.gold;
  hud.pots.textContent = P.potions;
  hud.elx.textContent = P.elixirs;
  hud.gear.textContent = `${WEAPONS[P.weapon].name} (atk ${atkPower()}) · ${ARMORS[P.armor].name} (def ${defense()}) · Kills ${P.kills}`;
  const fighting = boss && boss.alive && !['idle', 'return'].includes(boss.state);
  hud.bossbar.classList.toggle('hidden', !fighting);
  if (fighting) { hud.bossName.textContent = boss.def.name; hud.bossFill.style.width = (boss.hp / boss.def.hp * 100) + '%'; }
  hud.lockHint.style.display = (!lockFailed && document.pointerLockElement !== canvas && !ui) ? '' : 'none';
  $('vignette').style.boxShadow = `inset 0 0 ${120 + hurtFlash * 80}px rgba(170, 0, 0, ${Math.max(hurtFlash * 0.7, P.hp < mh * 0.25 ? 0.35 : 0)})`;
}

let bannerTimer = null;
function banner(title, sub, dur = 2.5) {
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;
  const b = $('banner');
  b.style.opacity = '1';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.style.opacity = '0'; }, dur * 1000);
}

const modal = $('modal'), modalBox = $('modalBox');
function openModal(html, kind) {
  ui = kind;
  modalBox.innerHTML = html;
  modal.classList.remove('hidden');
  hud.prompt.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  for (const k in keys) keys[k] = false;
}
function closeModal() {
  ui = null;
  modal.classList.add('hidden');
}
modalBox.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const [act, arg] = el.dataset.act.split('|');
  switch (act) {
    case 'close': closeModal(); break;
    case 'new': startGame(null); break;
    case 'continue': startGame(loadSave()); break;
    case 'buy': buy(arg); break;
    case 'rest': rest(); break;
    case 'travel': travel(Number(arg)); break;
    case 'rise': rise(); break;
  }
});

const CONTROLS_HTML = `
  <div class="controls">
    <kbd>W A S D</kbd><span>Move (relative to camera)</span>
    <kbd>Mouse</kbd><span>Look around (click the game first) &middot; wheel to zoom</span>
    <kbd>Left click / J</kbd><span>Slash &mdash; press again for a 3-hit combo</span>
    <kbd>Right click / K</kbd><span>Heavy strike &mdash; breaks a big demon's guard</span>
    <kbd>Space</kbd><span>Jump &mdash; leaps over the Demon King's ground slam</span>
    <kbd>F</kbd><span>Dodge roll (brief invulnerability)</span>
    <kbd>Shift</kbd><span>Sprint</span>
    <kbd>E</kbd><span>Talk, trade at shops, pray at shrines (rest, save, travel)</span>
    <kbd>Q / R</kbd><span>Drink a healing potion / elixir</span>
    <kbd>M / H</kbd><span>World map / this help</span>
  </div>`;

function showTitle() {
  const s = loadSave();
  openModal(`
    <div class="kanji">浪人の道</div>
    <h1>Ronin's Road</h1>
    <p class="sub center">A samurai's journey from town to town</p>
    <p>Demons have poured down from Oni Mountain. Walk the road north from <b>Sakura Village</b>,
    through Kawaguchi, Ishiyama and Kurogane Fort. Cut down bandits and oni, spend their gold on
    better swords and armor at each town's shop, and slay <b>Shuten-doji, the Demon King</b>.</p>
    ${CONTROLS_HTML}
    <div class="btns">
      ${s ? `<button data-act="continue">Continue (Lv ${s.lvl}, ${TOWNS[s.lastTown]?.name ?? ''})</button>` : ''}
      <button data-act="new" class="${s ? 'secondary' : ''}">New Journey</button>
    </div>`, 'title');
}
function showHelp() { openModal(`<h2>How to play</h2>${CONTROLS_HTML}<p class="sub">Towns are safe: demons will not follow you inside. Shrines restore health, save your progress and let you travel to any town you have already found.</p><div class="btns"><button data-act="close">Back to the road</button></div>`, 'help'); }

function nearInteract() {
  let best = null, bd = 3.4;
  for (const it of interactables) {
    const d = Math.hypot(it.x - P.pos.x, it.z - P.pos.z);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
function interact() {
  const it = nearInteract();
  if (!it) return;
  if (it.kind === 'shop') openShop(it.town);
  else if (it.kind === 'shrine') openShrine(it.town);
  else openElder(it.town);
}

function itemInfo(id) {
  if (id === 'potion' || id === 'elixir') {
    const c = CONSUMABLES[id], have = id === 'potion' ? P.potions : P.elixirs;
    return { ...c, desc: `${c.desc} &middot; carrying ${have}/9`, blocked: have >= 9 ? 'Full' : null };
  }
  const [kind, key] = id.split(':');
  if (kind === 'w') {
    const w = WEAPONS[key], cur = WEAPONS[P.weapon];
    return { name: w.name, price: w.price, desc: `Katana &middot; attack ${w.atk} (yours: ${cur.atk})`, blocked: P.weapon === key ? 'Equipped' : cur.atk >= w.atk ? 'Weaker' : null };
  }
  if (kind === 'a') {
    const a = ARMORS[key], cur = ARMORS[P.armor];
    return { name: a.name, price: a.price, desc: `Armor &middot; blocks ${a.def} damage per hit (yours: ${cur.def})`, blocked: P.armor === key ? 'Equipped' : cur.def >= a.def ? 'Weaker' : null };
  }
  const c = CHARMS[key];
  return { name: c.name, price: c.price, desc: 'Charm &middot; ' + c.desc, blocked: hasCharm(key) ? 'Owned' : null };
}
let shopTown = null;
function openShop(town) {
  shopTown = town;
  const rows = town.stock.map(id => {
    const it = itemInfo(id);
    const label = it.blocked ?? (P.gold < it.price ? 'Need gold' : 'Buy');
    const disabled = it.blocked || P.gold < it.price;
    return `<div class="item"><div class="meta"><div class="name">${it.name}</div><div class="desc">${it.desc}</div></div>
      <div class="price">&#9672; ${it.price}</div><button data-act="buy|${id}" ${disabled ? 'disabled' : ''}>${label}</button></div>`;
  }).join('');
  const html = `<h2>${town.shopName}</h2><p class="sub">${town.merchant} &middot; ${town.name}</p>
    <div class="gold">Your purse: &#9672; <b>${P.gold}</b></div>
    <div class="items">${rows}</div>
    <div class="btns"><button class="secondary" data-act="close">Leave (E)</button></div>`;
  if (ui === 'shop') modalBox.innerHTML = html; else openModal(html, 'shop');
}
function buy(id) {
  const it = itemInfo(id);
  if (it.blocked || P.gold < it.price) return;
  P.gold -= it.price;
  if (id === 'potion') P.potions++;
  else if (id === 'elixir') P.elixirs++;
  else {
    const [kind, key] = id.split(':');
    if (kind === 'w') P.weapon = key;
    else if (kind === 'a') P.armor = key;
    else { P.charms.push(key); if (key === 'vitality') P.hp += 50; }
    rebuildPlayerRig();
    rig.root.position.set(P.pos.x, P.y, P.pos.z);
    rig.root.rotation.y = P.facing;
  }
  save();
  openShop(shopTown);
}

function openShrine(town) {
  P.lastTown = town.index;
  save();
  const dests = TOWNS.map(t => {
    if (t === town) return '';
    const known = P.discovered.includes(t.index);
    return `<button class="secondary" data-act="travel|${t.index}" ${known ? '' : 'disabled'}>${known ? 'Travel to ' + t.name : '??? (undiscovered)'}</button>`;
  }).join('');
  openModal(`<div class="kanji">⛩</div><h2 class="center">Shrine of ${town.name}</h2>
    <p class="sub center">Your journey is saved. If you fall, you will wake here.</p>
    <p>Resting restores your health, but the wilds stir again: slain bandits and demons return to the road.</p>
    <div class="btns" style="margin-bottom:14px"><button data-act="rest">Rest (restore health)</button></div>
    <p class="sub center">Travel by shrine to any town you have found:</p>
    <div class="btns">${dests}</div>
    <div class="btns" style="margin-top:14px"><button class="secondary" data-act="close">Leave (E)</button></div>`, 'shrine');
}
function rest() {
  P.hp = maxHp(); P.st = maxSt();
  for (const e of enemies) {
    if (!e.alive && e !== boss && !e.summoned && Math.hypot(e.home.x - P.pos.x, e.home.z - P.pos.z) > 50) respawnEnemy(e);
  }
  save();
  closeModal();
  burst(P.pos.x, P.y + 1, P.pos.z, 40, 0xffe08a, 2, 4, 1.2, 1);
  banner('Rested', 'Health restored. Progress saved.', 1.8);
}
function travel(i) {
  closeModal();
  ui = 'travel';
  const fade = $('fade');
  fade.style.opacity = '1';
  setTimeout(() => {
    P.lastTown = i;
    placeAtTown(i);
    save();
    fade.style.opacity = '0';
    ui = null;
    banner(TOWNS[i].name, 'You arrive by the shrine road', 2.2);
  }, 500);
}
function openElder(town) {
  openModal(`<h2>Elder of ${town.name}</h2><p class="sub">An old villager leans on a staff.</p>
    ${town.elder.map(l => `<p>&ldquo;${l}&rdquo;</p>`).join('')}
    <div class="btns"><button class="secondary" data-act="close">Farewell (E)</button></div>`, 'dialog');
}

function victory() {
  P.bossDead = true;
  save();
  banner('Victory', 'Shuten-doji is slain', 4);
  setTimeout(() => {
    openModal(`<div class="kanji">勝</div><h1>Victory</h1>
      <p class="center">The Demon King falls, and the darkness over Oni Mountain lifts.<br>
      The towns of the Tokaido road are safe once more.</p>
      <p class="center sub">Level ${P.lvl} &middot; ${P.kills} foes defeated &middot; &#9672; ${P.gold} gold</p>
      <div class="btns"><button data-act="close">Keep exploring</button></div>`, 'victory');
  }, 3000);
}

// Maps
const mini = $('minimap').getContext('2d');
const bigCanvas = $('bigmapCanvas'), big = bigCanvas.getContext('2d');
function drawMap(ctx, W, H, cx, cz, scale, full) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (!full) { ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.clip(); }
  ctx.fillStyle = '#2b3a22'; ctx.fillRect(0, 0, W, H);
  const X = x => W / 2 + (x - cx) * scale, Z = z => H / 2 + (z - cz) * scale;
  ctx.fillStyle = 'rgba(70, 40, 35, 0.6)';
  ctx.fillRect(0, Z(-770), W, Math.max(0, Z(BOUNDS.minZ - 50) - Z(-770)));
  ctx.strokeStyle = '#c4a874'; ctx.lineWidth = full ? 4 : 3; ctx.lineJoin = 'round';
  ctx.beginPath();
  PATH.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
  ctx.stroke();
  ctx.font = `${full ? 15 : 10}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center';
  for (const t of TOWNS) {
    const known = P.discovered.includes(t.index);
    ctx.fillStyle = known ? 'rgba(232, 193, 90, 0.85)' : 'rgba(150, 150, 150, 0.6)';
    ctx.beginPath(); ctx.arc(X(t.x), Z(t.z), Math.max(5, TOWN_R * scale), 0, Math.PI * 2); ctx.fill();
    if (full || scale > 0.5) {
      ctx.fillStyle = '#fff';
      ctx.fillText(known ? t.name : '???', X(t.x), Z(t.z) - Math.max(8, TOWN_R * scale) - 4);
    }
  }
  ctx.fillStyle = P.bossDead ? 'rgba(120,120,120,0.8)' : 'rgba(220, 40, 30, 0.9)';
  ctx.beginPath(); ctx.arc(X(ARENA.x), Z(ARENA.z), Math.max(6, ARENA.r * scale), 0, Math.PI * 2); ctx.fill();
  if (full) { ctx.fillStyle = '#ffb3a8'; ctx.fillText('Oni Mountain Shrine', X(ARENA.x), Z(ARENA.z) - ARENA.r * scale - 6); }
  if (!full) {
    for (const e of enemies) {
      if (!e.alive) continue;
      const x = X(e.pos.x), y = Z(e.pos.z);
      if (x < 0 || y < 0 || x > W || y > H) continue;
      ctx.fillStyle = e === boss ? '#ff2a10' : '#e65a4a';
      ctx.fillRect(x - (e === boss ? 3 : 1.5), y - (e === boss ? 3 : 1.5), e === boss ? 6 : 3, e === boss ? 6 : 3);
    }
  }
  ctx.translate(X(P.pos.x), Z(P.pos.z));
  ctx.rotate(-P.facing);
  const s = full ? 1.6 : 1;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 8 * s); ctx.lineTo(-5 * s, -5 * s); ctx.lineTo(5 * s, -5 * s); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
function toggleMap() {
  const el = $('bigmap');
  if (ui === 'map') { el.classList.add('hidden'); ui = null; return; }
  ui = 'map';
  if (document.pointerLockElement) document.exitPointerLock();
  el.classList.remove('hidden');
  const W = bigCanvas.width, H = bigCanvas.height;
  const scale = Math.min(W / (BOUNDS.maxX - BOUNDS.minX + 40), H / (BOUNDS.maxZ - BOUNDS.minZ + 40));
  drawMap(big, W, H, 0, (BOUNDS.minZ + BOUNDS.maxZ) / 2, scale, true);
}

// ============================================================ World state (location, sky, prompts)
let currentTown = null, arenaAnnounced = false;
function updateWorldState() {
  const t = townAt(P.pos.x, P.pos.z);
  if (t !== currentTown) {
    currentTown = t;
    if (t) {
      if (!P.discovered.includes(t.index)) {
        P.discovered.push(t.index);
        banner(t.name, 'Town discovered — visit the shop and the shrine', 3);
        save();
      } else banner(t.name, 'Safe haven', 1.8);
    }
  }
  if (!arenaAnnounced && arenaDist(P.pos.x, P.pos.z) < ARENA.r + 12 && !P.bossDead) {
    arenaAnnounced = true;
    banner('Shrine of Oni Mountain', 'The Demon King awaits', 3);
  }
  if (t) { hud.locName.textContent = t.name; hud.locSub.textContent = 'Safe haven · shop · shrine'; }
  else if (arenaDist(P.pos.x, P.pos.z) < ARENA.r + 30) { hud.locName.textContent = 'Shrine of Oni Mountain'; hud.locSub.textContent = P.bossDead ? 'Peaceful at last' : 'Danger ★★★★★'; }
  else {
    const seg = nearestSeg(P.pos.x, P.pos.z).index;
    let tier = 0;
    for (let k = 0; k < 4; k++) if (seg >= TOWN_IDX[k]) tier = k;
    hud.locName.textContent = REGIONS[tier].name;
    hud.locSub.textContent = 'Danger ' + '★'.repeat(REGIONS[tier].danger);
  }

  // Sky turns ashen towards Oni Mountain.
  const a = smooth(-720, -880, P.pos.z) * (P.bossDead ? 0.3 : 1);
  scene.background.copy(SKY_DAY).lerp(SKY_ASH, a);
  scene.fog.color.copy(scene.background);
  scene.fog.far = lerp(240, 170, a);
  sun.color.copy(SUN_DAY).lerp(SUN_ASH, a);
  hemi.intensity = lerp(1.6, 1.0, a);

  const it = P.dead ? null : nearInteract();
  if (it) {
    hud.prompt.style.display = 'block';
    hud.prompt.innerHTML = '<b class="gold">[E]</b> ' + (it.kind === 'shop' ? 'Trade at ' + it.town.shopName : it.kind === 'shrine' ? 'Pray at the shrine &mdash; rest, save &amp; travel' : 'Talk to the elder');
  } else hud.prompt.style.display = 'none';
}

// ============================================================ Camera
function updateCamera(dt) {
  if (keys.Comma) camYaw += 2 * dt;
  if (keys.Period) camYaw -= 2 * dt;
  const tx = P.pos.x, ty = P.y + 1.8, tz = P.pos.z;
  const cp = Math.cos(camPitch);
  let cx = tx + Math.sin(camYaw) * cp * camDist, cy = ty + Math.sin(camPitch) * camDist + 0.6, cz = tz + Math.cos(camYaw) * cp * camDist;
  cy = Math.max(cy, height(cx, cz) + 0.7);
  if (shakeAmt > 0) {
    cx += rand(-1, 1) * shakeAmt * 0.4; cy += rand(-1, 1) * shakeAmt * 0.4; cz += rand(-1, 1) * shakeAmt * 0.4;
    shakeAmt = Math.max(0, shakeAmt - dt * 1.8);
  }
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty, tz);
  sun.position.set(tx + 50, ty + 90, tz + 35);
  sun.target.position.set(tx, ty, tz);
}

// ============================================================ Save / load / start
const SAVE_KEY = 'roninsroad.save.v1';
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      lvl: P.lvl, xp: P.xp, gold: P.gold, potions: P.potions, elixirs: P.elixirs, weapon: P.weapon, armor: P.armor,
      charms: P.charms, discovered: P.discovered, lastTown: P.lastTown, bossDead: P.bossDead, kills: P.kills,
    }));
  } catch { /* storage unavailable: play on without saving */ }
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && WEAPONS[s.weapon] && ARMORS[s.armor] && TOWNS[s.lastTown]) return s;
  } catch { /* ignore */ }
  return null;
}
function placeAtTown(i) {
  const t = TOWNS[i];
  P.pos.copy(t.spawn);
  P.y = height(P.pos.x, P.pos.z); P.vy = 0;
  P.facing = Math.atan2(t.x - P.pos.x, t.z - P.pos.z);
  camYaw = P.facing + Math.PI;
  currentTown = t;
}
function startGame(s) {
  Object.assign(P, {
    lvl: 1, xp: 0, gold: 0, potions: 2, elixirs: 0, weapon: 'worn', armor: 'cloth', charms: [],
    discovered: [0], lastTown: 0, bossDead: false, kills: 0,
  }, s ?? {});
  P.charms = [...P.charms]; P.discovered = [...P.discovered];
  P.dead = false; P.state = 'idle'; P.hp = maxHp(); P.st = maxSt();
  rebuildPlayerRig();
  if (P.bossDead && boss.alive) { boss.alive = false; boss.deadT = 99; boss.rig.root.visible = false; }
  placeAtTown(P.lastTown);
  closeModal();
  $('hud').classList.remove('hidden');
  started = true;
  banner(TOWNS[P.lastTown].name, s ? 'Your journey continues' : 'Talk to the elder, then head north', 3);
  save();
}

// ============================================================ Boot
buildTerrain();
buildVegetation();
TOWNS.forEach(buildTown);
buildArena();
spawnWorldEnemies();
rebuildPlayerRig();
placeAtTown(0);

window.__game = { renderer, P, enemies, TOWNS, interactables, get boss() { return boss; }, get ui() { return ui; } };

const clock = new THREE.Clock();
let time = 0;
function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, clock.getDelta());
  if (started && !ui) {
    if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
    time += dt;
    const playerSafe = P.dead || !!townAt(P.pos.x, P.pos.z);
    updatePlayer(dt);
    updateEnemies(dt, playerSafe);
    updateNPCs(dt, time);
    updateEffects(dt);
    updateParticles(dt);
    updateWorldState();
    hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
  } else if (!started) {
    // Slow orbit behind the title screen.
    camYaw += dt * 0.08;
  }
  updateCamera(dt);
  updateFloaters(dt);
  if (started) {
    updateHUD();
    drawMap(mini, 180, 180, P.pos.x, P.pos.z, 0.9, false);
  }
  renderer.render(scene, camera);
}
showTitle();
frame();
