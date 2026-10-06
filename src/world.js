// World building: terrain, vegetation, towns, ninja bases, demon fortresses and sky.
import * as THREE from 'three';
import {
  PATH, ARENA, BOUNDS, TOWNS, TOWN_IDX, NINJA_BASES, NINJA_R, DEMON_BASES, DEMON_R, REALM_X, ASH_Z,
  LAKES, WATER_Y, FROST, MAIN_TOWNS, NEW_X, NW, ELEMENTS, NW_TOWNS,
} from './data.js';
import {
  makeHumanoid, makeHouse, makeTorii, makeStoneLantern, makeShopStall, makeShrine, smat,
  makeTent, makeWatchtower, makeBanner, makeCampfire, makeDummy, makePortal, makeChest, makeKeep, tmat, mergeStatic,
  makeCastle, makePagoda, makeCityWall, makeGatehouse, makeKura, makeWell, makeFence, makeTempleHall, makeArchBridge,
} from './models.js';
import { barkTex, waterNormalTex } from './textures.js';
import { clamp, lerp, smooth, wr, wrand } from './util.js';

let scene = null;
// Shared clock for wind sway in grass, trees and water.
const windTime = { value: 0 };
// Late-afternoon sun: low and warm, for long shadows.
const SUN_DIR = new THREE.Vector3(0.55, 0.42, 0.45).normalize();

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
// Side trails from the main road to the hamlets and ninja bases. They count as road
// for flattening the ground and keeping trees off them.
const TRAILS = [];
function nearestPathPoint(x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}
for (const nb of NINJA_BASES) {
  const p = nearestPathPoint(nb.x, nb.z), d = Math.hypot(p[0] - nb.x, p[1] - nb.z);
  const ux = (p[0] - nb.x) / d, uz = (p[1] - nb.z) / d;
  nb.gate = [nb.x + ux * NINJA_R, nb.z + uz * NINJA_R];
  nb.gateDir = Math.atan2(ux, uz);
  nb.attach = p;
  TRAILS.push([nb.x, nb.z, p[0], p[1]]);
}
for (const t of TOWNS) {
  if (!t.hamlet) continue;
  t.attach = nearestPathPoint(t.x, t.z);
  TRAILS.push([t.x, t.z, t.attach[0], t.attach[1]]);
}
// The new world: paths from the Crossroads to each village, and between neighbors.
const HUB_R = 26;
NW_TOWNS.forEach((t, k) => {
  const ux = (t.x - NW.x) / NW.ring, uz = (t.z - NW.z) / NW.ring;
  t.attach = [NW.x + ux * HUB_R, NW.z + uz * HUB_R];
  TRAILS.push([t.attach[0], t.attach[1], t.x, t.z]);
  const n = NW_TOWNS[(k + 1) % NW_TOWNS.length];
  TRAILS.push([t.x, t.z, n.x, n.z]);
});
{
  const w = ELEMENTS.find(e => e.key === 'water').town;
  const ux = (w.x - NW.x) / NW.ring, uz = (w.z - NW.z) / NW.ring;
  // Shifted sideways off the outward path so the lake sits beside it.
  LAKES.push({ x: w.x + ux * 66 - uz * 30, z: w.z + uz * 66 + ux * 30, r: 26, nw: true });
}
const inNewWorld = x => x < NEW_X;
// Which element's lands a point lies in, by its bearing from the Crossroads.
function nwSector(x, z) {
  const a = Math.atan2(z - NW.z, x - NW.x);
  let best = 0, bd = Infinity;
  for (const el of ELEMENTS) {
    const d = Math.abs(Math.atan2(Math.sin(a - el.angle), Math.cos(a - el.angle)));
    if (d < bd) { bd = d; best = el.index; }
  }
  return best;
}
// Smooth weights of each element at a point (they sum to 1).
function nwWeights(x, z, out = []) {
  const a = Math.atan2(z - NW.z, x - NW.x);
  let sum = 0;
  for (const el of ELEMENTS) {
    const w = Math.pow(Math.max(0, Math.cos(a - el.angle)), 6) + 1e-4;
    out[el.index] = w; sum += w;
  }
  for (let k = 0; k < out.length; k++) out[k] /= sum;
  return out;
}

function roadDist(x, z) {
  let m = nearestSeg(x, z).dist;
  for (const [ax, az, bx, bz] of TRAILS) m = Math.min(m, segDist(x, z, ax, az, bx, bz) + 1.5);
  return m;
}
// 0 outside the Frost Pass, 1 in deep snow.
function frostAmt(z) {
  return smooth(FROST.start + 40, FROST.start - 40, z) * (1 - smooth(FROST.end + 40, FROST.end - 40, z));
}
// Distance to the edge of the nearest town or city (negative inside it).
function townDist(x, z) {
  let m = Infinity;
  for (const t of TOWNS) m = Math.min(m, Math.hypot(x - t.x, z - t.z) - t.r);
  return m;
}
function townAt(x, z) {
  for (const t of TOWNS) if (Math.hypot(x - t.x, z - t.z) < t.r) return t;
  return null;
}
const arenaDist = (x, z) => Math.hypot(x - ARENA.x, z - ARENA.z);
function ninjaDist(x, z) {
  let m = Infinity;
  for (const b of NINJA_BASES) m = Math.min(m, Math.hypot(x - b.x, z - b.z));
  return m;
}
function ninjaBaseAt(x, z) {
  for (const b of NINJA_BASES) if (Math.hypot(x - b.x, z - b.z) < NINJA_R + 2) return b;
  return null;
}
// Which demon fortress island a point is on (they all sit beyond REALM_X).
function demonBaseAt(x, z) {
  if (x < REALM_X) return null;
  let best = DEMON_BASES[0], bd = Infinity;
  for (const b of DEMON_BASES) { const d = Math.hypot(x - b.x, z - b.z); if (d < bd) { bd = d; best = b; } }
  return best;
}
function lakeAt(x, z, pad = 0) {
  for (const l of LAKES) if (Math.hypot(x - l.x, z - l.z) < l.r + pad) return l;
  return null;
}
function lakeDist(x, z) {
  let m = Infinity;
  for (const l of LAKES) m = Math.min(m, Math.hypot(x - l.x, z - l.z) - l.r);
  return m;
}
function nwHeight(x, z) {
  const d = Math.hypot(x - NW.x, z - NW.z);
  let carve = 0, lakeFlat = 1;
  for (const l of LAKES) {
    if (!l.nw) continue;
    const ld = Math.hypot(x - l.x, z - l.z);
    carve = Math.max(carve, 1 - smooth(l.r * 0.5, l.r + 3, ld));
    lakeFlat = Math.min(lakeFlat, smooth(l.r, l.r + 18, ld));
  }
  const sec = ELEMENTS[nwSector(x, z)].key;
  const amp = sec === 'ice' ? 9 : sec === 'fire' ? 7 : sec === 'shadow' ? 6 : 3.5;
  const n = (Math.sin(x * 0.027 + 2) * Math.cos(z * 0.021) + Math.sin(x * 0.061) * Math.sin(z * 0.057 + 1) * 0.45) * amp;
  const f = smooth(4, 22, roadDist(x, z)) * smooth(0, 22, townDist(x, z)) * smooth(HUB_R + 4, HUB_R + 26, d) * lakeFlat;
  // The island's edge slopes down into the sea.
  const shore = smooth(NW.r - 40, NW.r + 10, d);
  let h = Math.max(-1, n) * f;
  h = lerp(h, -5, shore);
  return lerp(h, -2.6, carve);
}
function height(x, z) {
  if (x > REALM_X) return 0;
  if (x < NEW_X) return nwHeight(x, z);
  let carve = 0, lakeFlat = 1, shore = 0;
  for (const l of LAKES) {
    const d = Math.hypot(x - l.x, z - l.z);
    carve = Math.max(carve, 1 - smooth(l.r * 0.5, l.r + 3, d));
    lakeFlat = Math.min(lakeFlat, smooth(l.r, l.r + 18, d));
    shore = Math.max(shore, 1 - smooth(l.r + 6, l.r + 30, d));
  }
  const n = Math.sin(x * 0.021) * Math.cos(z * 0.017) * 5
    + Math.sin(x * 0.053 + 1.3) * Math.sin(z * 0.047 + 0.7) * 2.2
    + Math.sin((x + z) * 0.11) * 0.5;
  const f = smooth(5, 24, roadDist(x, z)) * smooth(0, 22, townDist(x, z))
    * smooth(ARENA.r + 2, ARENA.r + 22, arenaDist(x, z)) * smooth(NINJA_R + 2, NINJA_R + 22, ninjaDist(x, z)) * lakeFlat;
  const edge = Math.max(0, Math.abs(x) - BOUNDS.maxX + 15) + Math.max(0, BOUNDS.minZ + 15 - z, z - BOUNDS.maxZ + 15);
  let h = n * f + Math.pow(edge, 1.3) * 0.9;
  // Banks stay above the waterline so the lake has one clean shore.
  h = lerp(h, Math.max(h, 0.15), shore);
  return lerp(h, -2.6, carve);
}

// GLSL value noise shared by the terrain and water shaders.
const NOISE_GLSL = `
varying vec3 vWPos;
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm3(vec2 p){ return vnoise(p) * 0.5 + vnoise(p * 2.03) * 0.3 + vnoise(p * 4.1) * 0.2; }
`;
function withWorldPos(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + NOISE_GLSL);
}
// Breaks up the vertex colors with world-space noise and blends rock onto steep slopes.
function detailTerrain(mat) {
  mat.onBeforeCompile = sh => {
    withWorldPos(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 fn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        float slope = 1.0 - abs(fn.y);
        float big = fbm3(vWPos.xz * 0.035);
        float mid = fbm3(vWPos.xz * 0.3);
        float fine = vnoise(vWPos.xz * 2.7);
        diffuseColor.rgb *= 0.6 + big * 0.42 + mid * 0.28 + fine * 0.16;
        // Dry, yellowed patches in the grass.
        float dry = smoothstep(0.55, 0.75, fbm3(vWPos.xz * 0.06 + 13.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.35, 1.15, 0.7), dry * 0.6);
        float rockAmt = smoothstep(0.3, 0.55, slope + (mid - 0.5) * 0.25);
        vec3 rockCol = vec3(0.36, 0.34, 0.31) * (0.7 + fbm3(vWPos.xz * 0.7 + vWPos.y * 0.5) * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, rockAmt);
      }`);
  };
}
// Sways vertices by height above the instance origin, like wind through grass and leaves.
function addWind(mat, strength, heightScale) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = windTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 ip = instanceMatrix[3];
          float k = max(position.y, 0.0) * ${heightScale.toFixed(3)};
          float w = sin(uTime * 1.6 + ip.x * 0.31 + ip.z * 0.23) * 0.6 + sin(uTime * 3.7 + ip.x * 1.1) * 0.25;
          transformed.x += w * k * ${strength.toFixed(3)};
          transformed.z += w * k * ${(strength * 0.5).toFixed(3)};
        }`);
  };
}

function buildTerrain() {
  const minX = -440, maxX = 440, minZ = BOUNDS.minZ - 110, maxZ = 210;
  const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 220, Math.round((maxZ - minZ) / 4));
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const g1 = new THREE.Color(0x3d5a26), g2 = new THREE.Color(0x5e7a36), dirt = new THREE.Color(0x8a7050);
  const plaza = new THREE.Color(0xb5a07a), ash = new THREE.Color(0x4a3a35), arenaC = new THREE.Color(0x341915), campC = new THREE.Color(0x6a5a44);
  const rock = new THREE.Color(0x7a756c), snow = new THREE.Color(0xeeeef4), c = new THREE.Color();
  const sand = new THREE.Color(0xa8946a), mud = new THREE.Color(0x3a3424), paving = new THREE.Color(0x8e887c);
  const snowGround = new THREE.Color(0xdfe6ec);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.5 + 0.5 + (wrand() - 0.5) * 0.25;
    c.copy(g1).lerp(g2, clamp(n, 0, 1));
    c.lerp(ash, smooth(ASH_Z + 40, ASH_Z - 70, z) * 0.85);
    c.lerp(snowGround, frostAmt(z) * 0.85);
    c.lerp(dirt, (1 - smooth(2.5, 5, roadDist(x, z))) * 0.85);
    const td = townDist(x, z);
    c.lerp(plaza, (1 - smooth(-4, 2, td)) * 0.7);
    if (td < 0) { const t = townAt(x, z); if (t && t.city) c.lerp(paving, 0.45 * smooth(0, -6, td)); }
    c.lerp(arenaC, (1 - smooth(ARENA.r - 1, ARENA.r + 4, arenaDist(x, z))) * 0.9);
    c.lerp(campC, (1 - smooth(NINJA_R - 2, NINJA_R + 3, ninjaDist(x, z))) * 0.75);
    const ld = lakeDist(x, z);
    if (ld < 6) {
      c.lerp(sand, (1 - smooth(1, 6, ld)) * 0.75);
      c.lerp(mud, 1 - smooth(WATER_Y - 0.5, WATER_Y + 0.1, h));
    }
    c.lerp(rock, smooth(9, 24, h));
    c.lerp(snow, smooth(48, 75, h));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  detailTerrain(terrainMat);
  const terrain = new THREE.Mesh(geo, terrainMat);
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

  // Side trails to the hamlets and ninja bases, merged into one mesh.
  const trailGroup = new THREE.Group();
  const trailMat = new THREE.MeshLambertMaterial({ color: 0x9c8462, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const [ax, az, bx, bz] of TRAILS) {
    const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / 4);
    for (let k = 0; k < steps; k++) {
      const x0 = lerp(ax, bx, k / steps), z0 = lerp(az, bz, k / steps), x1 = lerp(ax, bx, (k + 1) / steps), z1 = lerp(az, bz, (k + 1) / steps);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, Math.hypot(x1 - x0, z1 - z0) + 0.3).rotateX(-Math.PI / 2), trailMat);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      m.position.set(mx, height(mx, mz) + 0.08, mz);
      m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
      m.receiveShadow = true;
      m.castShadow = false;
      trailGroup.add(m);
    }
  }
  scene.add(trailGroup);
  mergeStatic(trailGroup);
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
  if (inNewWorld(pos.x)) {
    const dx = pos.x - NW.x, dz = pos.z - NW.z, d = Math.hypot(dx, dz), max = NW.r - 22;
    if (d > max) { pos.x = NW.x + dx / d * max; pos.z = NW.z + dz / d * max; }
    return;
  }
  const db = demonBaseAt(pos.x, pos.z);
  if (db) {
    const dx = pos.x - db.x, dz = pos.z - db.z, d = Math.hypot(dx, dz), max = DEMON_R - 3;
    if (d > max) { pos.x = db.x + dx / d * max; pos.z = db.z + dz / d * max; }
    return;
  }
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
  const okSpot = (x, z, margin = 0) => roadDist(x, z) > 7 + margin && townDist(x, z) > 3
    && arenaDist(x, z) > ARENA.r + 6 && ninjaDist(x, z) > NINJA_R + 5 && lakeDist(x, z) > 3 && height(x, z) < 40;

  const attempts = Math.round(9000 * (BOUNDS.maxZ - BOUNDS.minZ) / 1090);
  for (let i = 0; i < attempts; i++) {
    const x = wr(BOUNDS.minX - 50, BOUNDS.maxX + 50), z = wr(BOUNDS.minZ - 50, BOUNDS.maxZ + 60);
    if (!okSpot(x, z)) continue;
    const inBounds = x > BOUNDS.minX && x < BOUNDS.maxX && z > BOUNDS.minZ && z < BOUNDS.maxZ;
    const r = wrand();
    if (z < ASH_Z + 20) {
      if (r < 0.12) { place(sets.dead, x, z, wr(0.8, 1.4)); if (inBounds) addCollider(x, z, 0.5); }
      else if (r < 0.2) { place(sets.rock, x, z, wr(0.6, 2.2)); if (inBounds) addCollider(x, z, 1.0); }
    } else if (townDist(x, z) < 50 && r < 0.12 && frostAmt(z) < 0.3) {
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

  const inst = (geo, mat, list, shadow = true, tint = null) => {
    if (list.length) chunkedInstances(geo, mat, list, { cell: 96, range: 240, shadow, tint });
  };

  const vary = (base, amt) => (c, i) => {
    const r = Math.sin(i * 12.9898) * 43758.5453;
    const f = r - Math.floor(r);
    c.setHex(base).offsetHSL((f - 0.5) * 0.04, (f - 0.5) * 0.15, (f - 0.5) * amt);
  };
  const bark = (color, rx, ry) => {
    const t = barkTex().clone(); t.repeat.set(rx, ry); t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 2, roughness: 0.95 });
  };
  const leaves = (strength, scale) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    addWind(m, strength, scale);
    return m;
  };
  // Pine: tapered trunk and five tiers of ragged needles.
  inst(new THREE.CylinderGeometry(0.2, 0.42, 3.2, 12).translate(0, 1.6, 0), bark(0x8a6a50, 2, 3), sets.pine);
  const pineTiers = [];
  for (let k = 0; k < 5; k++) {
    const r = 2.3 - k * 0.38, h = 2.4 - k * 0.2;
    pineTiers.push(lumpy(new THREE.ConeGeometry(r, h, 14, 3, true), 0.22, 7 + k).translate(0, 2.6 + k * 1.05, 0));
  }
  // Pines in the Frost Pass carry snow.
  const pineTint = vary(0x2c5228, 0.12), snowWhite = new THREE.Color(0xeef2f6);
  inst(mergeGeos(pineTiers), leaves(0.18, 0.08), sets.pine, true, (c, i) => { pineTint(c, i); c.lerp(snowWhite, frostAmt(sets.pine[i].elements[14]) * 0.6); });
  // Cherry blossom: twisted trunk, crown of pink clusters.
  inst(new THREE.CylinderGeometry(0.2, 0.36, 3.2, 12).translate(0, 1.6, 0), bark(0x6a4a42, 1, 2), sets.sakura);
  const blossoms = [];
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4, rr = k === 0 ? 0 : 1.5;
    blossoms.push(lumpy(new THREE.SphereGeometry(k === 0 ? 2.0 : 1.4, 14, 10), 0.35, 20 + k).translate(Math.cos(a) * rr, 4.0 + (k % 3) * 0.5, Math.sin(a) * rr));
  }
  inst(mergeGeos(blossoms), leaves(0.12, 0.05), sets.sakura, true, vary(0xf0a6c2, 0.1));
  inst(new THREE.CylinderGeometry(0.12, 0.34, 4.8, 8).translate(0, 2.4, 0), bark(0x4a3a34, 1, 3), sets.dead);
  inst(mergeGeos([
    new THREE.CylinderGeometry(0.05, 0.13, 2.2, 6).rotateZ(0.9).translate(0.8, 3.2, 0),
    new THREE.CylinderGeometry(0.04, 0.1, 1.6, 6).rotateZ(-0.8).translate(-0.6, 3.9, 0.2),
  ]), bark(0x3a2e2a, 1, 1), sets.dead);
  const bambooMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
  addWind(bambooMat, 0.35, 0.06);
  inst(new THREE.CylinderGeometry(0.07, 0.09, 7.5, 10, 6).translate(0, 3.75, 0), bambooMat, sets.bamboo, true, vary(0x8aae52, 0.12));
  const sprays = [];
  for (let k = 0; k < 9; k++) {
    const a = k * 2.2, y = 5.2 + (k % 4) * 0.6;
    sprays.push(new THREE.ConeGeometry(0.09, 1.1, 4).rotateZ(-1.2).rotateY(a).translate(Math.cos(a) * 0.45, y, -Math.sin(a) * 0.45));
  }
  inst(mergeGeos(sprays), leaves(0.35, 0.06), sets.bamboo, false, vary(0x4a7a2a, 0.1));
  inst(lumpy(new THREE.SphereGeometry(1, 16, 12), 0.28, 5).scale(1, 0.7, 1).translate(0, 0.3, 0), tmat('stone', 0xb0aca4, 1, 1), sets.rock, true, vary(0x9a958c, 0.15));
}

// Merge geometries (position, normal, uv) into one non-indexed geometry.
function mergeGeos(list) {
  const geos = list.map(g0 => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  });
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
// Push vertices in and out with smooth noise so shapes look organic, then re-smooth normals.
function lumpy(geo, amount, seed) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.1 + seed) * Math.sin(v.y * 1.7 + seed * 1.3) * Math.sin(v.z * 2.3 + seed * 0.7)
      + 0.5 * Math.sin(v.x * 4.3 - seed) * Math.sin(v.z * 3.9 + v.y * 2.2);
    const len = Math.hypot(v.x, v.z) || 1;
    v.x += (v.x / len) * n * amount; v.z += (v.z / len) * n * amount; v.y += n * amount * 0.4;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ============================================================ Chunked instancing
// Vegetation is split into map tiles. Each tile is its own InstancedMesh with a tight
// bounding sphere, so off-screen tiles are culled and far tiles are hidden entirely.
const chunks = [];
let grassEnabled = true;
function chunkedInstances(geo, mat, list, { cell, range, shadow = true, tint = null, grass = false }) {
  const groups = new Map();
  list.forEach((m, i) => {
    const k = Math.floor(m.elements[12] / cell) + ',' + Math.floor(m.elements[14] / cell);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([m, i]);
  });
  const col = new THREE.Color();
  for (const [k, arr] of groups) {
    const im = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach(([m, i], j) => {
      im.setMatrixAt(j, m);
      if (tint) { tint(col, i); im.setColorAt(j, col); }
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    const [cx, cz] = k.split(',').map(Number);
    chunks.push({ mesh: im, x: (cx + 0.5) * cell, z: (cz + 0.5) * cell, range: range + cell * 0.71, grass });
    scene.add(im);
  }
}
function updateChunks(px, pz) {
  for (const c of chunks) {
    c.mesh.visible = (!c.grass || grassEnabled) && Math.hypot(c.x - px, c.z - pz) < c.range;
  }
}
function setGrassEnabled(on) { grassEnabled = on; }

// ============================================================ Lakes
const waterMats = [];
function buildLakes() {
  const normal = waterNormalTex();
  for (const l of LAKES) {
    const n2 = normal.clone(); n2.repeat.set(l.r / 4, l.r / 4); n2.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x173238, roughness: 0.05, metalness: 0.0, normalMap: n2, normalScale: new THREE.Vector2(0.3, 0.3),
      transparent: true, opacity: 0.93,
    });
    waterMats.push(mat);
    const water = new THREE.Mesh(new THREE.CircleGeometry(l.r + 2.5, 64).rotateX(-Math.PI / 2), mat);
    water.position.set(l.x, WATER_Y, l.z);
    water.receiveShadow = true;
    scene.add(water);
    addCollider(l.x, l.z, l.r - 3);
    // Reeds along the shore, lily pads on the water.
    const reeds = [], pads = [];
    const dummy = new THREE.Object3D();
    for (let k = 0; k < 160; k++) {
      const a = wr(0, Math.PI * 2), r = l.r + wr(-3.5, 1.5);
      const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r;
      if (roadDist(x, z) < 6) continue;
      dummy.position.set(x, Math.max(height(x, z), WATER_Y) - 0.1, z);
      dummy.rotation.set(wr(-0.15, 0.15), wr(0, 6), wr(-0.15, 0.15));
      dummy.scale.set(1, wr(0.7, 1.4), 1);
      dummy.updateMatrix();
      reeds.push(dummy.matrix.clone());
    }
    for (let k = 0; k < 24; k++) {
      const a = wr(0, Math.PI * 2), r = wr(l.r * 0.3, l.r - 2);
      dummy.position.set(l.x + Math.cos(a) * r, WATER_Y + 0.03, l.z + Math.sin(a) * r);
      dummy.rotation.set(0, wr(0, 6), 0);
      dummy.scale.setScalar(wr(0.6, 1.3));
      dummy.updateMatrix();
      pads.push(dummy.matrix.clone());
    }
    const reedMat = new THREE.MeshStandardMaterial({ color: 0x6a8a3a, roughness: 0.8 });
    addWind(reedMat, 0.4, 0.2);
    const reedGeo = mergeGeos([0, 1, 2].map(k => new THREE.ConeGeometry(0.04, 1.8, 4).translate(Math.cos(k * 2.1) * 0.15, 0.9, Math.sin(k * 2.1) * 0.15)));
    const ri = new THREE.InstancedMesh(reedGeo, reedMat, reeds.length);
    reeds.forEach((m, i) => ri.setMatrixAt(i, m));
    const pi = new THREE.InstancedMesh(new THREE.CircleGeometry(0.45, 12, 0.3, Math.PI * 1.85).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a6a2a, roughness: 0.4, side: THREE.DoubleSide }), pads.length);
    pads.forEach((m, i) => pi.setMatrixAt(i, m));
    ri.castShadow = true;
    scene.add(ri, pi);
  }
}

// ============================================================ Towns
const interactables = [];
const villagers = [];
const staticNPCs = [];

const VILLAGER_COLORS = [0x8a3b3b, 0x3b6a8a, 0x6a8a3b, 0x8a6a3b, 0x5b3b8a, 0x9a7a5a, 0x3b8a7a];

function placeObj(obj, x, z, ry, merge = true) {
  obj.position.set(x, height(x, z), z);
  obj.rotation.y = ry;
  scene.add(obj);
  obj.updateMatrixWorld(true);
  if (merge && !obj.userData.noMerge) mergeStatic(obj);
  return obj;
}
const facing = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);

function buildTown(t) {
  let prev, next;
  if (t.nw) {
    // New-world villages face the Crossroads at the island's center.
    prev = [NW.x, NW.z];
    next = [t.x * 2 - NW.x, t.z * 2 - NW.z];
  } else if (t.hamlet) {
    // Hamlets face down their trail toward the main road.
    prev = t.attach;
    next = [t.x * 2 - t.attach[0], t.z * 2 - t.attach[1]];
  } else {
    const i = TOWN_IDX[t.index];
    prev = PATH[i - 1]; next = PATH[i + 1];
  }
  let dx = next[0] - prev[0], dz = next[1] - prev[1];
  const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
  const px = -dz, pz = dx;
  const at = (f, sd) => [t.x + dx * f + px * sd, t.z + dz * f + pz * sd];

  // Shop stalls with their merchants. Cities have two: a market and a master forge.
  const shopSpots = t.city ? [at(6, 12), at(-9, 12)] : [at(0, 12)];
  const clothColors = [0x24467a, 0x2a6a4a, 0x6a2a5a, 0x222222, 0x7a4a1a, 0x3a1a1a];
  t.shops.forEach((shop, k) => {
    const [sx, sz] = shopSpots[k];
    const stall = placeObj(makeShopStall(clothColors[(t.index + k * 3) % clothColors.length]), sx, sz, facing(sx, sz, t.x + dx * (k ? -9 : 6), t.z + dz * (k ? -9 : 6)));
    const merchant = makeHumanoid({ cloth: VILLAGER_COLORS[(t.index + 2 + k) % VILLAGER_COLORS.length], cloth2: 0x3a3028, hat: k ? 'band' : 'bun' });
    merchant.root.position.set(0, 0, -0.3);
    stall.add(merchant.root);
    staticNPCs.push(merchant);
    addCollider(sx, sz, 2.4);
    const front = new THREE.Vector3(0, 0, 2.6).applyMatrix4(stall.matrixWorld);
    interactables.push({ kind: 'shop', town: t, shop, x: front.x, z: front.z });
  });

  // Shrine (rest, save & travel).
  const [hx, hz] = at(0, -12);
  const shrine = placeObj(makeShrine(), hx, hz, facing(hx, hz, t.x, t.z));
  addCollider(hx, hz, 2.0);
  const sf = new THREE.Vector3(0, 0, 2.9).applyMatrix4(shrine.matrixWorld);
  interactables.push({ kind: 'shrine', town: t, x: sf.x, z: sf.z });
  // Arrive on the road just south of the plaza, looking north along it.
  t.spawn = new THREE.Vector3(t.x - dx * 5, 0, t.z - dz * 5);
  t.spawnFacing = Math.atan2(dx, dz);

  // Village elder (a magistrate or lord in the cities).
  const [ex, ez] = at(6, -5);
  const elder = makeHumanoid(t.city
    ? { cloth: 0x2a2a4a, cloth2: 0x1a1a2a, hat: 'kabuto', armor: 0x5a1a1a, weapon: 'staff', skin: 0xd6a37e }
    : { cloth: 0x6b5a7a, cloth2: 0x4a3f55, hat: 'elder', weapon: 'staff', skin: 0xd6a37e });
  placeObj(elder.root, ex, ez, facing(ex, ez, t.x, t.z), false);
  elder.armR.rotation.x = -0.4;
  staticNPCs.push(elder);
  addCollider(ex, ez, 0.5);
  interactables.push({ kind: 'elder', town: t, x: ex, z: ez });

  const keepClear = [[...at(0, 12), 8], [...at(-9, 12), 8], [hx, hz, 8], [ex, ez, 4]];
  if (t.nw) buildHomeAndDojo(t, at, keepClear);
  if (t.city) buildCity(t, dx, dz, px, pz, at, keepClear);
  else buildVillage(t, prev, next, keepClear, at);

  // Townsfolk wandering the streets.
  const crowd = t.city ? 18 : t.hamlet ? 3 : t.nw ? 8 : 5;
  for (let k = 0; k < crowd; k++) {
    // New-world villages have children playing among the grown-ups.
    const child = t.nw && k % 3 === 1;
    const rig = makeHumanoid({
      cloth: t.nw && k % 2 ? ELEMENTS[t.element].color : VILLAGER_COLORS[(k + t.index * 2) % VILLAGER_COLORS.length], cloth2: 0x3a3430,
      hat: child ? null : k % 3 === 0 ? 'kasa' : k % 2 ? 'bun' : null, skin: [0xe0b48a, 0xc99a72, 0xd8a880][k % 3],
      scale: child ? wr(0.55, 0.7) : wr(0.85, 1.0),
    });
    const a = wr(0, Math.PI * 2), rr = wr(0, t.r * 0.4);
    const v = { rig, town: t, pos: new THREE.Vector3(t.x + Math.cos(a) * rr, 0, t.z + Math.sin(a) * rr), target: null, wait: wr(0, 3), facing: 0 };
    scene.add(rig.root);
    villagers.push(v);
  }
}

// Houses in one merged block: dozens of houses cost a handful of draw calls.
// Each spot is [x, z, variant, tall, facingAngle?]. Roughly one in five is a white kura.
function houseBlock(t, spots) {
  const block = new THREE.Group();
  const sizes = [[5, 4], [6, 4.5], [4.5, 4]];
  const roof = t.snow ? 0xdfe6ee : t.roof;
  for (const [x, z, k, tall, ang] of spots) {
    const kura = k % 5 === 2;
    const [w, d] = kura ? [4, 3.2] : sizes[k % sizes.length];
    const h = kura ? makeKura(roof) : makeHouse(k % 4 === 3 ? 0xf4eee0 : t.wall, roof, w, d);
    h.position.set(x, height(x, z), z);
    h.rotation.y = ang ?? facing(x, z, t.x, t.z);
    if (tall && !kura) h.scale.y = 1.3;
    block.add(h);
    addCollider(x, z, Math.max(w, d) * 0.62);
  }
  scene.add(block);
  mergeStatic(block);
}

// Rice paddies: flooded fields with earthen banks and rows of rice, collected for
// instancing once every village has placed its fields.
const riceSpots = [];
const paddyWater = new THREE.MeshStandardMaterial({ color: 0x4e5e3c, roughness: 0.12, metalness: 0.0 });
function paddies(t, count) {
  const g = new THREE.Group();
  const bank = smat(0x6a5a3e, { roughness: 1 });
  let placed = 0;
  for (let k = 0; k < 40 && placed < count; k++) {
    const a = wr(0, Math.PI * 2), d = t.r + wr(8, 22);
    const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
    if (roadDist(x, z) < 10 || lakeDist(x, z) < 8 || ninjaDist(x, z) < NINJA_R + 10 || townDist(x, z) < 5) continue;
    if (Math.abs(height(x, z)) > 0.8 || Math.abs(height(x + 5, z) - height(x - 5, z)) > 0.6) continue;
    const y = height(x, z);
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.rotation.y = a;
    const W = 10, D = 7;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), paddyWater);
    water.position.y = 0.14; water.receiveShadow = true;
    p.add(water);
    for (const [bx, bz, bw, bd] of [[0, D / 2, W + 0.5, 0.5], [0, -D / 2, W + 0.5, 0.5], [W / 2, 0, 0.5, D], [-W / 2, 0, 0.5, D]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.4, bd), bank);
      m.position.set(bx, 0.1, bz); m.receiveShadow = true;
      p.add(m);
    }
    g.add(p);
    p.updateMatrixWorld(true);
    for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) {
      const v = new THREE.Vector3(-W / 2 + 0.9 + i * 1.03, 0.1, -D / 2 + 0.8 + j * 1.08).applyMatrix4(p.matrixWorld);
      riceSpots.push(v);
    }
    placed++;
  }
  scene.add(g);
  mergeStatic(g);
}
function plantRice() {
  const dummy = new THREE.Object3D(), mats = [];
  for (const v of riceSpots) {
    dummy.position.copy(v);
    dummy.rotation.set(0, wr(0, 6), 0);
    dummy.scale.setScalar(wr(0.8, 1.15));
    dummy.updateMatrix();
    mats.push(dummy.matrix.clone());
  }
  const tuft = mergeGeos([0, 1, 2, 3].map(k => new THREE.ConeGeometry(0.03, 0.75, 3).translate(Math.cos(k * 1.6) * 0.06, 0.37, Math.sin(k * 1.6) * 0.06).rotateZ((k - 1.5) * 0.12)));
  const mat = new THREE.MeshLambertMaterial({ color: 0x8aa848 });
  addWind(mat, 0.25, 0.4);
  chunkedInstances(tuft, mat, mats, { cell: 96, range: 150, shadow: false });
}

function buildVillage(t, prev, next, keepClear, at) {
  // A well in the plaza.
  const [wx, wz] = at(-8, 5);
  placeObj(makeWell(), wx, wz, 0);
  addCollider(wx, wz, 1.1);
  keepClear.push([wx, wz, 5]);
  // Two rings of houses and storehouses.
  const spots = [];
  const rings = t.hamlet ? [[16, 9]] : [[18, 12], [25.5, 16]];
  let k = 0;
  for (const [rr, n] of rings) {
    for (let j = 0; j < n; j++, k++) {
      const a = (j / n) * Math.PI * 2 + rr * 0.21 + wr(-0.06, 0.06);
      const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
      if (roadDist(x, z) < 7.5 || keepClear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
      spots.push([x, z, k, rr < 20 && wrand() < 0.25]);
    }
  }
  houseBlock(t, spots);

  // Bamboo fence around the edge, open where roads and trails come in.
  const fence = new THREE.Group();
  const N = Math.round((2 * Math.PI * t.r) / 5);
  const seg = (2 * Math.PI * t.r) / N;
  for (let j = 0; j < N; j++) {
    const a = (j / N) * Math.PI * 2;
    const x = t.x + Math.cos(a) * (t.r - 1), z = t.z + Math.sin(a) * (t.r - 1);
    if (roadDist(x, z) < 6) continue;
    const f = makeFence(seg * 0.95);
    f.position.set(x, height(x, z), z);
    f.rotation.y = -a + Math.PI / 2;
    fence.add(f);
    const tx = -Math.sin(a), tz = Math.cos(a);
    addCollider(x + tx * seg / 4, z + tz * seg / 4, seg / 4);
    addCollider(x - tx * seg / 4, z - tz * seg / 4, seg / 4);
  }
  scene.add(fence);
  mergeStatic(fence);

  // Torii gates where the road enters and leaves the village.
  for (const p of [prev, next]) {
    let ox = p[0] - t.x, oz = p[1] - t.z;
    const ol = Math.hypot(ox, oz); ox /= ol; oz /= ol;
    const gx = t.x + ox * (t.r - 2), gz = t.z + oz * (t.r - 2);
    placeObj(makeTorii(1, t.nw ? ELEMENTS[t.element].torii : 0xc0392b), gx, gz, Math.atan2(ox, oz));
    addCollider(gx - oz * 2.6, gz + ox * 2.6, 0.4);
    addCollider(gx + oz * 2.6, gz - ox * 2.6, 0.4);
    for (const s of [-1, 1]) {
      const lx = t.x + ox * (t.r - 8) - oz * 4 * s, lz = t.z + oz * (t.r - 8) + ox * 4 * s;
      placeObj(makeStoneLantern(true), lx, lz, 0);
      addCollider(lx, lz, 0.5);
    }
  }
  if (t.nw) interactables.push({ kind: 'well', town: t, x: wx, z: wz });
  if (!t.snow && !t.nw) paddies(t, t.hamlet ? 3 : 6);
  if (t.nw && ELEMENTS[t.element].key === 'water') paddies(t, 4);
}

// A walled city laid out on a grid of paved streets. In the city's own frame, u runs
// along the main road and v across it; streets lie every 24 m in both directions.
// Special quarters replace some blocks: the castle compound behind its moat, the
// temple quarter, and a garden with a pond and arched bridge.
function buildCity(t, dx, dz, px, pz, at, keepClear) {
  const R = t.r, STEP = 24, LINES = [-48, -24, 0, 24, 48];
  const toWorld = (u, v) => at(u, v);
  const ang = (fu, fv) => Math.atan2(dx * fu + px * fv, dz * fu + pz * fv);
  const zones = [
    { name: 'castle', u0: -24, u1: 24, v0: 24, v1: 72 },
    { name: 'temple', u0: 0, u1: 48, v0: -72, v1: -24 },
    { name: 'garden', u0: -48, u1: -24, v0: -48, v1: -24 },
  ];
  const inZone = (u, v) => zones.find(z => u > z.u0 + 0.1 && u < z.u1 - 0.1 && v > z.v0 + 0.1 && v < z.v1 - 0.1);
  const inside = (u, v, m) => Math.hypot(u, v) < R - m;
  for (const z of zones) { const [x, zz] = toWorld((z.u0 + z.u1) / 2, (z.v0 + z.v1) / 2); keepClear.push([x, zz, 12]); }

  // ---- City wall and gatehouses.
  const wall = new THREE.Group();
  const N = 50, segLen = (2 * Math.PI * R) / N;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const x = t.x + Math.cos(a) * R, z = t.z + Math.sin(a) * R;
    if (roadDist(x, z) < 8) continue;
    const w = makeCityWall(segLen, t.roof);
    w.position.set(x, height(x, z), z);
    w.rotation.y = -a + Math.PI / 2;
    wall.add(w);
    const tx = -Math.sin(a), tz = Math.cos(a);
    addCollider(x + tx * segLen / 4, z + tz * segLen / 4, 2.7);
    addCollider(x - tx * segLen / 4, z - tz * segLen / 4, 2.7);
  }
  scene.add(wall);
  mergeStatic(wall);
  const i = TOWN_IDX[t.index];
  for (const p of [PATH[i - 1], PATH[i + 1]]) {
    let ox = p[0] - t.x, oz = p[1] - t.z;
    const ol = Math.hypot(ox, oz); ox /= ol; oz /= ol;
    const gx = t.x + ox * R, gz = t.z + oz * R;
    placeObj(makeGatehouse(t.roof), gx, gz, Math.atan2(ox, oz));
    addCollider(gx - oz * 6.8, gz + ox * 6.8, 3.2);
    addCollider(gx + oz * 6.8, gz - ox * 6.8, 3.2);
  }

  // ---- Paved streets (the main avenue is the road itself) and lanterns at crossings.
  const streets = new THREE.Group();
  const paveTex = tmat('stone', 0xa8a296, 1, 1);
  const addStreet = (u0, v0, u1, v1, w) => {
    const [x0, z0] = toWorld(u0, v0), [x1, z1] = toWorld(u1, v1);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const geo = new THREE.PlaneGeometry(w, len + w).rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 3, uv.getY(k) * (len + w) / 3);
    const m = new THREE.Mesh(geo, paveTex);
    m.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    m.receiveShadow = true;
    streets.add(m);
  };
  for (const c of LINES) {
    for (let s0 = -72; s0 < 72; s0 += STEP) {
      // Avenue along u at v = c, and cross street along v at u = c.
      for (const [u0, v0, u1, v1] of [[s0, c, s0 + STEP, c], [c, s0, c, s0 + STEP]]) {
        if (c === 0 && v0 === v1) continue;
        const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
        if (!inside(mu, mv, 8) || inZone(mu, mv)) continue;
        addStreet(u0, v0, u1, v1, 5);
      }
    }
  }
  scene.add(streets);
  mergeStatic(streets);
  const lamps = new THREE.Group();
  for (const u of LINES) for (const v of LINES) {
    if (!inside(u, v, 10) || (u === 0 && Math.abs(v) < 12)) continue;
    const [x, z] = toWorld(u + 3.3, v + 3.3);
    if (keepClear.some(([qx, qz, r]) => Math.hypot(x - qx, z - qz) < r * 0.6)) continue;
    const l = makeStoneLantern(true);
    l.position.set(x, 0, z);
    lamps.add(l);
    addCollider(x, z, 0.5);
  }
  scene.add(lamps);
  mergeStatic(lamps);

  // ---- Market stalls along the main avenue.
  const street = new THREE.Group();
  const stallColors = [0x7a2a1a, 0x24467a, 0x2a6a4a, 0x6a2a5a, 0x8a6a1a];
  for (let f = -R + 14, k = 0; f < R - 12; f += 10, k++) {
    if (Math.abs(f) < 16 || LINES.some(l => Math.abs(f - l) < 4)) continue;
    for (const sd of [-1, 1]) {
      const [x, z] = at(f, sd * 7.5);
      if (keepClear.some(([qx, qz, r]) => Math.hypot(x - qx, z - qz) < r) || inZone(f, sd * 7.5)) continue;
      const st = makeShopStall(stallColors[(k + sd + 5) % stallColors.length]);
      st.position.set(x, height(x, z), z);
      st.rotation.y = Math.atan2(-px * sd, -pz * sd);
      street.add(st);
      addCollider(x, z, 2.3);
    }
  }
  scene.add(street);
  mergeStatic(street);

  // ---- City blocks: four lots per block, each house facing a street.
  const spots = [];
  let k = 0;
  for (let u0 = -72; u0 < 72; u0 += STEP) for (let v0 = -72; v0 < 72; v0 += STEP) {
    const cu = u0 + STEP / 2, cv = v0 + STEP / 2;
    if (inZone(cu, cv) || !inside(cu, cv, 10)) continue;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const lu = cu + su * 5.6, lv = cv + sv * 5.6;
      k++;
      if (Math.abs(lv) < 10.5 || !inside(lu, lv, 8)) continue;
      const [x, z] = toWorld(lu, lv);
      if (keepClear.some(([qx, qz, r]) => Math.hypot(x - qx, z - qz) < r)) continue;
      const faceU = (k % 2 === 0);
      spots.push([x, z, k, wrand() < 0.35, faceU ? ang(su, 0) : ang(0, sv)]);
    }
  }
  houseBlock(t, spots);

  // ---- Castle compound: keep, inner wall, moat ring and a bridge toward the avenue.
  const [cx, cz] = toWorld(0, 48);
  placeObj(makeCastle(t.roof), cx, cz, ang(0, -1));
  addCollider(cx, cz, 12.5);
  const compound = new THREE.Group();
  const moatMat = new THREE.MeshStandardMaterial({ color: 0x1e3a40, roughness: 0.06, metalness: 0 });
  const moat = new THREE.Mesh(new THREE.RingGeometry(19, 23, 48).rotateX(-Math.PI / 2), moatMat);
  moat.position.set(cx, 0.07, cz);
  compound.add(moat);
  const edgeMat = tmat('stone', 0xb0aa9e, 8, 0.3);
  for (const r of [18.8, 23.2]) {
    const edge = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35, 6, 48).rotateX(Math.PI / 2), edgeMat);
    edge.position.set(cx, 0.15, cz);
    compound.add(edge);
  }
  const bridgeAng = ang(0, -1);
  const NI = 30;
  for (let j = 0; j < NI; j++) {
    const a = (j / NI) * Math.PI * 2;
    // Leave a gap in the inner wall and the moat where the bridge crosses.
    const wx = Math.sin(a), wz = Math.cos(a);
    const gapDot = wx * Math.sin(bridgeAng) + wz * Math.cos(bridgeAng);
    const x = cx + wx * 17, z = cz + wz * 17;
    if (gapDot < 0.94) {
      const w = makeCityWall((2 * Math.PI * 17) / NI, t.roof);
      w.scale.set(1, 0.65, 0.7);
      w.position.set(x, 0, z);
      w.rotation.y = a;
      compound.add(w);
      addCollider(x, z, 2);
    }
    if (gapDot < 0.97) addCollider(cx + wx * 21, cz + wz * 21, 2.2);
  }
  const bridge = makeArchBridge(9, 3);
  bridge.position.set(cx + Math.sin(bridgeAng) * 21, 0, cz + Math.cos(bridgeAng) * 21);
  bridge.rotation.y = bridgeAng;
  compound.add(bridge);
  scene.add(compound);
  mergeStatic(compound);

  // ---- Temple quarter: torii, lantern path, temple hall and pagoda.
  const temple = new THREE.Group();
  const [hx, hz] = toWorld(24, -46);
  const hall = makeTempleHall(t.roof);
  hall.position.set(hx, 0, hz);
  hall.rotation.y = ang(0, 1);
  temple.add(hall);
  addCollider(hx, hz, 8);
  const [gx, gz] = toWorld(24, -27);
  const torii = makeTorii(1.2, 0xc0392b);
  torii.position.set(gx, 0, gz);
  torii.rotation.y = ang(0, 1);
  temple.add(torii);
  for (const [lu, lv] of [[19, -31], [29, -31], [19, -35], [29, -35]]) {
    const [x, z] = toWorld(lu, lv);
    const l = makeStoneLantern(true); l.position.set(x, 0, z); temple.add(l);
    addCollider(x, z, 0.5);
  }
  scene.add(temple);
  mergeStatic(temple);
  const [ptx, ptz] = toWorld(42, -36);
  placeObj(makePagoda(t.roof), ptx, ptz, 0.3);
  addCollider(ptx, ptz, 5);

  // ---- Garden: a pond with an arched bridge, cherry trees and stones.
  const garden = new THREE.Group();
  const [ox, oz] = toWorld(-36, -36);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(7, 32).rotateX(-Math.PI / 2), moatMat);
  pond.position.set(ox, 0.08, oz);
  garden.add(pond);
  const pondEdge = new THREE.Mesh(new THREE.TorusGeometry(7.1, 0.4, 6, 32).rotateX(Math.PI / 2), edgeMat);
  pondEdge.position.set(ox, 0.15, oz);
  garden.add(pondEdge);
  const gb = makeArchBridge(13, 2.4);
  gb.position.set(ox, 0, oz);
  gb.rotation.y = ang(1, 0);
  garden.add(gb);
  const bark = smat(0x4a3028), bloom = smat(0xf2a7c3);
  for (const [tu, tv] of [[-45, -28], [-27, -45], [-44, -44], [-28, -28]]) {
    const [x, z] = toWorld(tu, tv);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 2.8, 8), bark); tr.position.set(x, 1.4, z); tr.castShadow = true;
    const bl = new THREE.Mesh(lumpy(new THREE.SphereGeometry(1.9, 12, 9), 0.3, x), bloom); bl.position.set(x, 3.6, z); bl.castShadow = true;
    garden.add(tr, bl);
    addCollider(x, z, 0.5);
  }
  scene.add(garden);
  mergeStatic(garden);
  // Pond banks: walk around it or over the bridge.
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * Math.PI * 2;
    const bx = Math.sin(a), bz = Math.cos(a);
    if (Math.abs(bx * Math.sin(ang(1, 0)) + bz * Math.cos(ang(1, 0))) > 0.9) continue;
    addCollider(ox + bx * 4.5, oz + bz * 4.5, 2.6);
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

// ============================================================ Grass
function buildGrass() {
  // A clump of thin, bent blades with dark roots and sunlit tips.
  const blade = new THREE.BufferGeometry();
  const pos = [], col = [];
  const base = new THREE.Color(0x3a5220), tip = new THREE.Color(0xb4c868);
  for (let k = 0; k < 9; k++) {
    const a = k * 2.399, r = 0.05 + (k % 3) * 0.1, w = 0.035, h = 0.32 + ((k * 7) % 5) * 0.07;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const cx = Math.cos(a + 1.57) * w, cz = Math.sin(a + 1.57) * w;
    const lx = Math.cos(a) * 0.14, lz = Math.sin(a) * 0.14;
    pos.push(ox - cx, 0, oz - cz, ox + cx, 0, oz + cz, ox + lx, h, oz + lz);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  blade.computeVertexNormals();
  // Point normals up so blades shade like the ground beneath them.
  const nrm = blade.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  const mats = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 900000 && mats.length < 260000; i++) {
    const x = wr(BOUNDS.minX, BOUNDS.maxX), z = wr(ASH_Z + 30, BOUNDS.maxZ);
    if (roadDist(x, z) < 3.5 || townDist(x, z) < -3 || ninjaDist(x, z) < NINJA_R || arenaDist(x, z) < ARENA.r + 4 || lakeDist(x, z) < 0) continue;
    if (frostAmt(z) > 0.25) continue;
    const h = height(x, z);
    if (h > 9) continue;
    dummy.position.set(x, h - 0.05, z);
    dummy.rotation.set(0, wr(0, Math.PI), 0);
    const s = wr(0.8, 1.6);
    dummy.scale.set(s, s * wr(0.7, 1.3), s);
    dummy.updateMatrix();
    mats.push(dummy.matrix.clone());
  }
  const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  addWind(grassMat, 0.5, 0.6);
  chunkedInstances(blade, grassMat, mats, {
    cell: 32, range: 60, shadow: false, grass: true,
    tint: c => c.setHSL(0.2 + Math.random() * 0.07, 0.35 + Math.random() * 0.2, 0.5 + Math.random() * 0.15),
  });
  // New-world grass, tinted by each element's lands: violet, rust, gold, sea-green.
  const nwMats = [], nwSec = [];
  for (let i = 0; i < 260000 && nwMats.length < 70000; i++) {
    const a = wr(0, Math.PI * 2), r = Math.sqrt(wrand()) * (NW.r - 40);
    const x = NW.x + Math.cos(a) * r, z = NW.z + Math.sin(a) * r;
    const sec = nwSector(x, z), key = ELEMENTS[sec].key;
    if (key === 'ice' || (key === 'fire' && wrand() < 0.7)) continue;
    if (roadDist(x, z) < 3.5 || townDist(x, z) < -3 || r < HUB_R + 2 || lakeDist(x, z) < 0) continue;
    dummy.position.set(x, height(x, z) - 0.05, z);
    dummy.rotation.set(0, wr(0, Math.PI), 0);
    const s = key === 'golden' ? wr(1.3, 2.2) : wr(0.8, 1.6);
    dummy.scale.set(s, s * wr(0.7, 1.3), s);
    dummy.updateMatrix();
    nwMats.push(dummy.matrix.clone());
    nwSec.push(sec);
  }
  const HUE = { shadow: [0.75, 0.35, 0.42], fire: [0.06, 0.5, 0.42], golden: [0.13, 0.75, 0.62], water: [0.32, 0.45, 0.48] };
  chunkedInstances(blade, grassMat, nwMats, {
    cell: 32, range: 60, shadow: false, grass: true,
    tint: (c, i) => { const [h, sat, l] = HUE[ELEMENTS[nwSec[i]].key]; c.setHSL(h + (Math.random() - 0.5) * 0.04, sat, l + Math.random() * 0.12); },
  });
}

// ============================================================ Sky, clouds, mountain
const skyUniforms = {
  top: { value: new THREE.Color(0x4f8ed0) },
  horizon: { value: new THREE.Color(0xc9e2f2) },
  sunColor: { value: new THREE.Color(0xfff2c8) },
  sunDir: { value: SUN_DIR },
  ground: { value: new THREE.Color(0x4a5a3a) },
};
let skyMesh = null, skyMat = null;
// A small scene holding only the sky, rendered into an environment map for reflections.
function makeEnvScene() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  return s;
}
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir; uniform vec3 ground; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.5));
        c = mix(c, ground, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, sunDir), 0.0);
        // Sun disc, glow, and warm haze near the horizon on the sun's side.
        c += sunColor * (pow(s, 1500.0) * 6.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.18 * (1.0 - abs(h)));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  skyMat = mat;
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), mat);
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);

  // Soft billboard clouds.
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = 30 + Math.random() * 68, y = 50 + Math.random() * 28, r = 22 + Math.random() * 20;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 45; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    s.position.set(wr(-700, 700), wr(150, 230), wr(-1300, 300));
    const k = wr(120, 260);
    s.scale.set(k, k * 0.45, 1);
    s.userData.speed = wr(1, 3);
    scene.add(s);
    clouds.push(s);
  }

  // Hazy mountain ranges on every horizon.
  const ranges = new THREE.Group();
  for (const [radius, color, count, hMin, hMax] of [[1250, 0x8494a8, 26, 160, 320], [950, 0x5e6e66, 22, 90, 200]]) {
    const mat = new THREE.MeshLambertMaterial({ color, fog: false });
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + wr(-0.08, 0.08);
      const h = wr(hMin, hMax), r = wr(h * 0.9, h * 1.5);
      const m = new THREE.Mesh(lumpy(new THREE.ConeGeometry(r, h, 24, 6), r * 0.08, k), mat);
      m.position.set(Math.cos(a) * radius, h / 2 - 20, (BOUNDS.minZ + BOUNDS.maxZ) / 2 + Math.sin(a) * radius * 1.6);
      m.rotation.y = wr(0, 6);
      ranges.add(m);
    }
  }
  scene.add(ranges);
  overworldOnly.push(ranges);

  // Oni Mountain looms over the far north, visible from anywhere.
  const mountain = new THREE.Mesh(new THREE.CylinderGeometry(45, 280, 320, 28, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x2b2120, fog: false, flatShading: true }));
  mountain.position.set(0, 140, ARENA.z - 330);
  scene.add(mountain);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(44, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff5a1a, fog: false }));
  crater.position.set(0, 300.5, ARENA.z - 330);
  scene.add(crater);
  overworldOnly.push(mountain, crater);
}
const clouds = [];
const overworldOnly = [];
function updateSky(camPos, dt, top, horizon, sunColor, inRealm = false) {
  windTime.value += dt;
  for (const m of waterMats) { m.normalMap.offset.x += dt * 0.012; m.normalMap.offset.y += dt * 0.007; }
  for (const o of overworldOnly) o.visible = !inRealm;
  skyUniforms.ground.value.copy(horizon).multiplyScalar(0.45);
  skyMesh.position.copy(camPos);
  skyUniforms.top.value.copy(top);
  skyUniforms.horizon.value.copy(horizon);
  skyUniforms.sunColor.value.copy(sunColor);
  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 800) c.position.x = -800;
  }
}

// ============================================================ Ninja bases
const ninjaPortals = [];
function buildNinjaBase(nb, tier) {
  nb.tier = tier;
  const gateA = nb.gateDir;
  // Palisade ring with a gap at the gate.
  const stakes = [];
  const dummy = new THREE.Object3D();
  const N = 110;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const dirA = Math.atan2(Math.sin(a), Math.cos(a));
    const gx = Math.sin(gateA), gz = Math.cos(gateA);
    if (Math.cos(a) * gx + Math.sin(a) * gz > 0.985) continue;
    const x = nb.x + Math.cos(a) * NINJA_R, z = nb.z + Math.sin(a) * NINJA_R;
    dummy.position.set(x, height(x, z) - 0.2, z);
    dummy.rotation.set(wr(-0.06, 0.06), dirA, wr(-0.06, 0.06));
    dummy.scale.set(1, wr(0.85, 1.15), 1);
    dummy.updateMatrix();
    stakes.push(dummy.matrix.clone());
    addCollider(x, z, 0.75);
  }
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.38, 4.6, 6).translate(0, 2.3, 0), smat(0x3a2a1c), stakes.length);
  const tips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 0.7, 6).translate(0, 4.95, 0), smat(0x2a1d14), stakes.length);
  stakes.forEach((m, k) => { im.setMatrixAt(k, m); tips.setMatrixAt(k, m); });
  im.castShadow = true; tips.castShadow = true;
  scene.add(im, tips);

  const ux = Math.sin(gateA), uz = Math.cos(gateA), px = -uz, pz = ux;
  const at = (f, s) => [nb.x + ux * f + px * s, nb.z + uz * f + pz * s];
  // Gate towers and banners.
  for (const s of [-1, 1]) {
    const [tx, tz] = at(NINJA_R - 1, s * 5);
    placeObj(makeWatchtower(), tx, tz, gateA);
    addCollider(tx, tz, 1.8);
    const [bx, bz] = at(NINJA_R + 2, s * 3);
    placeObj(makeBanner(0x141418, [0xc0201a, 0x3a8ad0, 0xd0a020, 0x9a3aff][tier]), bx, bz, gateA);
  }
  const [rx, rz] = at(-NINJA_R + 3, 0);
  placeObj(makeWatchtower(), rx, rz, gateA);
  addCollider(rx, rz, 1.8);
  // Tents, fire, training dummies.
  for (const [f, s] of [[6, -13], [-4, -15], [6, 13], [-4, 15], [-12, 8]]) {
    const [x, z] = at(f, s);
    placeObj(makeTent([0x24242a, 0x2a2420, 0x1f2a24][Math.abs(f + s) % 3]), x, z, Math.atan2(nb.x - x, nb.z - z));
    addCollider(x, z, 2.2);
  }
  placeObj(makeCampfire(), ...at(7, 0), 0);
  addCollider(...at(7, 0), 0.8);
  for (let k = 0; k < 3; k++) {
    const [x, z] = at(13, -4 + k * 4);
    placeObj(makeDummy(), x, z, gateA);
    addCollider(x, z, 0.4);
  }
  // The sealed portal at the back of the camp.
  const portal = makePortal([0x9a3aff, 0xff3a3a, 0xff8a1a, 0x3affc0][tier]);
  const [ptx, ptz] = at(-9, 0);
  placeObj(portal.group, ptx, ptz, gateA, false);
  addCollider(...at(-9, 2.6), 0.8);
  addCollider(...at(-9, -2.6), 0.8);
  portal.setOpen(false);
  nb.portal = portal;
  nb.portalPos = { x: ptx, z: ptz };
  const [ex, ez] = at(2, 0);
  nb.portalExit = { x: ex, z: ez, facing: gateA };
  ninjaPortals.push(nb);
  // Enemy spots.
  nb.masterSpot = at(-2, 0);
  nb.spots = [at(4, -6), at(4, 6), at(-6, -8), at(-6, 8), at(12, 0), at(16, -8), at(16, 8)];
}

// ============================================================ Demon fortresses
let lavaMat = null;
function buildDemonBase(db, tier) {
  db.tier = tier;
  const g = new THREE.Group();
  g.position.set(db.x, 0, db.z);
  scene.add(g);
  // Basalt island with glowing cracks, ringed by lava.
  const rock = new THREE.MeshStandardMaterial({ color: 0x2a2224, roughness: 0.95, flatShading: true });
  const island = new THREE.Mesh(new THREE.CylinderGeometry(DEMON_R, DEMON_R - 6, 14, 36, 1), rock);
  island.position.y = -7;
  island.receiveShadow = true;
  g.add(island);
  const crackMat = new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 2.2 });
  for (let k = 0; k < 26; k++) {
    const a = wr(0, Math.PI * 2), r = wr(6, DEMON_R - 4);
    const crack = new THREE.Mesh(new THREE.BoxGeometry(wr(0.15, 0.3), 0.04, wr(3, 8)), crackMat);
    crack.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    crack.rotation.y = wr(0, Math.PI);
    g.add(crack);
  }
  if (!lavaMat) lavaMat = new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff3000, emissiveIntensity: 1.6, roughness: 0.6 });
  const lava = new THREE.Mesh(new THREE.CircleGeometry(260, 48).rotateX(-Math.PI / 2), lavaMat);
  lava.position.y = -2.5;
  g.add(lava);
  // Spiked outer wall with a gap at the south (arrival) side.
  const wallM = smat(0x1e191a), spikeM = smat(0x6a6060);
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2;
    if (Math.sin(a) > 0.96) continue;
    const r = DEMON_R - 4.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = new THREE.Mesh(new THREE.BoxGeometry(9.6, 5, 1.6), wallM);
    w.position.set(x, 2.5, z);
    w.rotation.y = -a + Math.PI / 2;
    w.castShadow = true; w.receiveShadow = true;
    g.add(w);
    for (const off of [-3, 0, 3]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 5), spikeM);
      sp.position.set(x + Math.cos(-a + Math.PI / 2) * off, 5.8, z - Math.sin(-a + Math.PI / 2) * off);
      g.add(sp);
    }
    addCollider(db.x + x, db.z + z, 3.4);
  }
  // Keep at the back, braziers, banners.
  const keep = makeKeep();
  keep.position.set(0, 0, -30);
  g.add(keep);
  addCollider(db.x - 4, db.z - 30, 5.5); addCollider(db.x + 4, db.z - 30, 5.5);
  const fire = smat(0xffa040, { emissive: 0xff5a10, emissiveIntensity: 2.5 });
  for (const [x, z] of [[-10, -16], [10, -16], [-16, 4], [16, 4], [-8, 22], [8, 22]]) {
    const b = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3.2, 6), wallM); p.position.y = 1.6; b.add(p);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 6), fire); f.position.y = 3.9; b.add(f);
    b.position.set(x, 0, z);
    g.add(b);
    addCollider(db.x + x, db.z + z, 0.8);
  }
  for (const x of [-14, 14]) {
    const ban = makeBanner(0x2a0606, 0xff3a10);
    ban.position.set(x, 0, -22);
    g.add(ban);
  }
  const torii = makeTorii(1.3, 0x3a0a0a);
  torii.position.set(0, 0, 22);
  g.add(torii);
  addCollider(db.x - 3.4, db.z + 22, 0.5); addCollider(db.x + 3.4, db.z + 22, 0.5);
  // Treasure chest guarded by the warlord.
  const chest = makeChest();
  chest.position.set(0, 0, -21);
  g.add(chest);
  addCollider(db.x, db.z - 21, 0.9);
  db.chest = chest;
  db.chestPos = { x: db.x, z: db.z - 19.6 };
  // Return portal at the arrival point.
  const portal = makePortal(0x7affc8);
  portal.group.position.set(0, 0, 42);
  g.add(portal.group);
  portal.setOpen(true);
  db.portal = portal;
  db.portalPos = { x: db.x, z: db.z + 42 };
  db.arrival = { x: db.x, z: db.z + 31, facing: Math.PI };
  db.warlordSpot = [db.x, db.z - 12];
  db.spots = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3, r = k % 2 ? 14 : 24;
    db.spots.push([db.x + Math.cos(a) * r, db.z + Math.sin(a) * r * 0.8 - 2]);
  }
  portal.group.userData.noMerge = true;
  chest.userData.noMerge = true;
  mergeStatic(g);
}

// ============================================================ The new world
// Positions the game logic needs: the Crossroads, the echo's lair, each home and dojo.
const nwSite = { hub: { x: NW.x, z: NW.z }, homes: [], dummies: [], herbs: [] };

// The player's family home and the village dojo, in every new-world village.
function buildHomeAndDojo(t, at, keepClear) {
  const el = ELEMENTS[t.element];
  const [hx, hz] = at(-15, -7);
  const home = makeHouse(el.wall, el.key === 'ice' ? 0xdfe6ee : el.roof, 7, 5.5);
  home.scale.y = 1.15;
  const face = facing(hx, hz, t.x, t.z);
  placeObj(home, hx, hz, face);
  addCollider(hx, hz, 4.4);
  const door = [hx + Math.sin(face) * 5, hz + Math.cos(face) * 5];
  // Mother and father wait by the door.
  const parents = [];
  [[0x8a4a6a, 'bun', -1.3], [0x3a4a5a, null, 1.3]].forEach(([cloth, hat, side]) => {
    const p = makeHumanoid({ cloth, cloth2: 0x2a2420, hat, skin: 0xe0b48a });
    const px = door[0] + Math.cos(face) * side, pz = door[1] - Math.sin(face) * side;
    placeObj(p.root, px, pz, face, false);
    staticNPCs.push(p);
    addCollider(px, pz, 0.45);
    parents.push(p);
  });
  interactables.push({ kind: 'home', town: t, x: door[0] + Math.sin(face) * 1.4, z: door[1] + Math.cos(face) * 1.4 });
  nwSite.homes[t.element] = { x: door[0] + Math.sin(face) * 2, z: door[1] + Math.cos(face) * 2, facing: face };
  keepClear.push([hx, hz, 8]);

  // Dojo yard: two straw dummies, a sensei and a weapon rack of bokken.
  const [dx, dz] = at(14, 2);
  const dojo = new THREE.Group();
  const yard = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24).rotateX(-Math.PI / 2), smat(0xb8a27a, { roughness: 1 }));
  yard.position.set(dx, height(dx, dz) + 0.05, dz);
  yard.receiveShadow = true;
  dojo.add(yard);
  const spots = [];
  for (const [u, v] of [[-2, 1.5], [2, 1.5]]) {
    const [x, z] = at(14 + u, 2 + v);
    const d = makeDummy();
    d.position.set(x, height(x, z), z);
    dojo.add(d);
    addCollider(x, z, 0.4);
    spots.push({ x, z });
  }
  scene.add(dojo);
  mergeStatic(dojo);
  nwSite.dummies[t.element] = spots;
  const [sx, sz] = at(14, -2.5);
  const sensei = makeHumanoid({ cloth: el.color, cloth2: 0x1a1a1a, hat: 'band', bandColor: el.color, weapon: 'katana', skin: 0xd6a37e });
  placeObj(sensei.root, sx, sz, facing(sx, sz, dx, dz), false);
  staticNPCs.push(sensei);
  addCollider(sx, sz, 0.5);
  interactables.push({ kind: 'sensei', town: t, x: sx, z: sz });
  keepClear.push([dx, dz, 7]);
}

function buildNewWorld() {
  const W = [0, 0, 0, 0, 0];
  // ---- Terrain disc, colored by element.
  const size = NW.r * 2 + 60, seg = Math.round(size / 4);
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2).translate(NW.x, 0, NW.z);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), tmp = new THREE.Color(), tmp2 = new THREE.Color();
  const dirt = new THREE.Color(0x8a7050), plaza = new THREE.Color(0xb5a07a), sand = new THREE.Color(0xc8b88a), stone = new THREE.Color(0x9a948a);
  const grounds = ELEMENTS.map(el => el.ground.map(g => new THREE.Color(g)));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);
    nwWeights(x, z, W);
    const n = clamp(Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.5 + 0.5 + (wrand() - 0.5) * 0.25, 0, 1);
    c.setRGB(0, 0, 0);
    for (let k = 0; k < 5; k++) { tmp.copy(grounds[k][0]).lerp(grounds[k][1], n); c.r += tmp.r * W[k]; c.g += tmp.g * W[k]; c.b += tmp.b * W[k]; }
    const d = Math.hypot(x - NW.x, z - NW.z);
    c.lerp(dirt, (1 - smooth(2.5, 5, roadDist(x, z))) * 0.8);
    c.lerp(plaza, (1 - smooth(-4, 2, townDist(x, z))) * 0.6);
    c.lerp(stone, 1 - smooth(HUB_R - 2, HUB_R + 1, d));
    c.lerp(sand, smooth(NW.r - 45, NW.r - 25, d) * 0.9);
    if (lakeDist(x, z) < 5) c.lerp(sand, (1 - smooth(1, 5, lakeDist(x, z))) * 0.7);
    tmp2.copy(c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  detailTerrain(mat);
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- The sea around the island.
  const seaNormal = waterNormalTex().clone(); seaNormal.repeat.set(60, 60); seaNormal.needsUpdate = true;
  const sea = new THREE.MeshStandardMaterial({ color: 0x1a3e52, roughness: 0.08, metalness: 0, normalMap: seaNormal, normalScale: new THREE.Vector2(0.3, 0.3) });
  waterMats.push(sea);
  const seaMesh = new THREE.Mesh(new THREE.RingGeometry(NW.r - 60, NW.r + 900, 64, 1).rotateX(-Math.PI / 2), sea);
  seaMesh.position.set(NW.x, -1.6, NW.z);
  scene.add(seaMesh);

  // ---- The Crossroads: a sacred tree in a stone circle, where the echo waits.
  const hub = new THREE.Group();
  hub.position.set(NW.x, 0, NW.z);
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a4030, map: barkTex(), bumpMap: barkTex(), bumpScale: 2, roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 3.2, 16, 14), bark);
  trunk.position.y = 8; trunk.castShadow = true;
  hub.add(trunk);
  for (let k = 0; k < 5; k++) {
    const a = ELEMENTS[k].angle;
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 6, 8), bark);
    root.position.set(Math.cos(a) * 3, 1, Math.sin(a) * 3);
    root.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
    hub.add(root);
  }
  const bloom = smat(0xf6d8ec, { emissive: 0x4a1a3a, emissiveIntensity: 0.4 });
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4, r = k ? 5.5 : 0;
    const crown = new THREE.Mesh(lumpy(new THREE.SphereGeometry(k ? 4.5 : 6.5, 14, 10), 0.3, k + 3), bloom);
    crown.position.set(Math.cos(a) * r, 17 + (k % 3) * 1.6, Math.sin(a) * r);
    crown.castShadow = true;
    hub.add(crown);
  }
  // Sacred rope around the trunk, and five element stones around the circle.
  const rope = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.22, 8, 28).rotateX(Math.PI / 2), smat(0xe8dcb0));
  rope.position.y = 5;
  hub.add(rope);
  for (const el of ELEMENTS) {
    const a = el.angle + Math.PI / ELEMENTS.length;
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 1), smat(0x6a665e, { flatShading: true }));
    st.position.set(Math.cos(a) * (HUB_R - 3), 1.6, Math.sin(a) * (HUB_R - 3));
    st.rotation.y = -a;
    st.castShadow = true;
    hub.add(st);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), smat(el.color, { emissive: el.color, emissiveIntensity: 1.6 }));
    gem.position.set(Math.cos(a) * (HUB_R - 3), 3.8, Math.sin(a) * (HUB_R - 3));
    hub.add(gem);
    addCollider(NW.x + Math.cos(a) * (HUB_R - 3), NW.z + Math.sin(a) * (HUB_R - 3), 0.9);
  }
  scene.add(hub);
  mergeStatic(hub);
  addCollider(NW.x, NW.z, 3.4);
  nwSite.echo = { x: NW.x, z: NW.z + 14 };

  // ---- Landmarks around each village.
  for (const el of ELEMENTS) buildElementLands(el);
  buildNwTrees();
}

// Scenery that gives each element's lands their own character.
function buildElementLands(el) {
  const t = el.town, g = new THREE.Group();
  const ux = Math.cos(el.angle), uz = Math.sin(el.angle);
  const spot = (minR, maxR, tries = 30) => {
    for (let k = 0; k < tries; k++) {
      const a = el.angle + wr(-0.55, 0.55), r = wr(minR, maxR);
      const x = NW.x + Math.cos(a) * r, z = NW.z + Math.sin(a) * r;
      if (roadDist(x, z) > 7 && townDist(x, z) > 6 && lakeDist(x, z) > 4) return [x, z];
    }
    return null;
  };
  const add = (m, x, z, rad, y = 0) => { m.position.set(x, height(x, z) + y, z); g.add(m); if (rad) addCollider(x, z, rad); };
  if (el.key === 'shadow') {
    const obs = smat(0x1a1622, { roughness: 0.4, flatShading: true }), glow = smat(0xa070ff, { emissive: 0x8a4aff, emissiveIntensity: 2.2 });
    for (let k = 0; k < 16; k++) {
      const p = spot(60, 250); if (!p) continue;
      const h = wr(3, 7);
      const o = new THREE.Mesh(new THREE.ConeGeometry(wr(0.7, 1.3), h, 5), obs);
      o.castShadow = true;
      add(o, p[0], p[1], 1.1, h / 2 - 0.3);
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), glow);
      add(cr, p[0] + 0.9, p[1], 0, 0.5);
    }
  } else if (el.key === 'fire') {
    const lava = smat(0xff6a1a, { emissive: 0xff4000, emissiveIntensity: 2.4 }), rock = smat(0x2a201c, { flatShading: true });
    for (let k = 0; k < 14; k++) {
      const p = spot(60, 250); if (!p) continue;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 1, 9, 1, true), rock);
      add(ring, p[0], p[1], 2, 0.3);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(2.1, 12).rotateX(-Math.PI / 2), lava);
      add(pool, p[0], p[1], 0, 0.5);
    }
    // A great forge chimney outside the village.
    const fx = t.x + ux * 48, fz = t.z + uz * 48 + 14;
    const chim = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 12, 10), tmat('stone', 0x8a6a5a, 2, 3));
    chim.castShadow = true;
    add(chim, fx, fz, 2.4, 6);
  } else if (el.key === 'golden') {
    placeObj(makePagoda(0xb8901a), t.x + ux * 54 + uz * 18, t.z + uz * 54 - ux * 18, el.angle);
    addCollider(t.x + ux * 54 + uz * 18, t.z + uz * 54 - ux * 18, 5);
    // Wheat fields: rows of tall golden stalks.
    const stalks = [], dummy = new THREE.Object3D();
    for (let f = 0; f < 6; f++) {
      const p = spot(90, 240); if (!p) continue;
      const rot = wr(0, Math.PI);
      for (let i = 0; i < 14; i++) for (let j = 0; j < 10; j++) {
        const lx = (i - 7) * 0.8, lz = (j - 5) * 0.9;
        const x = p[0] + Math.cos(rot) * lx - Math.sin(rot) * lz, z = p[1] + Math.sin(rot) * lx + Math.cos(rot) * lz;
        dummy.position.set(x, height(x, z), z);
        dummy.rotation.set(0, wr(0, 6), 0);
        dummy.scale.setScalar(wr(0.85, 1.15));
        dummy.updateMatrix();
        stalks.push(dummy.matrix.clone());
      }
    }
    const wheat = mergeGeos([0, 1, 2, 3, 4].map(k => new THREE.ConeGeometry(0.035, 1.2, 3).translate(Math.cos(k * 1.3) * 0.1, 0.6, Math.sin(k * 1.3) * 0.1)));
    const wm = new THREE.MeshLambertMaterial({ color: 0xe8c050 });
    addWind(wm, 0.3, 0.5);
    chunkedInstances(wheat, wm, stalks, { cell: 96, range: 150, shadow: false });
  } else if (el.key === 'ice') {
    const ice = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x2a7ab0, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true });
    for (let k = 0; k < 22; k++) {
      const p = spot(50, 260); if (!p) continue;
      const cl = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const h = wr(1.5, 4.5);
        const cr = new THREE.Mesh(new THREE.ConeGeometry(wr(0.3, 0.6), h, 5), ice);
        cr.position.set(wr(-0.8, 0.8), h / 2 - 0.2, wr(-0.8, 0.8));
        cr.rotation.set(wr(-0.3, 0.3), wr(0, 6), wr(-0.3, 0.3));
        cl.add(cr);
      }
      add(cl, p[0], p[1], 1);
    }
  } else if (el.key === 'water') {
    const lake = LAKES.find(l => l.nw);
    const pad = smat(0x3a7a3a), flower = smat(0xffb8d8, { emissive: 0x401020, emissiveIntensity: 0.4 });
    for (let k = 0; k < 26; k++) {
      const a = wr(0, Math.PI * 2), r = wr(3, lake.r - 3);
      const x = lake.x + Math.cos(a) * r, z = lake.z + Math.sin(a) * r;
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(wr(0.5, 0.9), wr(0.5, 0.9), 0.04, 10), pad);
      lp.position.set(x, WATER_Y + 0.03, z);
      g.add(lp);
      if (k % 3 === 0) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), flower); fl.position.set(x, WATER_Y + 0.18, z); g.add(fl); }
    }
    // A wooden pier out into the lake.
    const dx = t.x - lake.x, dz = t.z - lake.z, dl = Math.hypot(dx, dz);
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 14), tmat('wood', 0x8a6a4a, 1, 4));
    const px = lake.x + dx / dl * (lake.r - 4), pz = lake.z + dz / dl * (lake.r - 4);
    pier.position.set(px, 0.25, pz);
    pier.rotation.y = Math.atan2(dx, dz);
    pier.castShadow = true; pier.receiveShadow = true;
    g.add(pier);
  }
  scene.add(g);
  mergeStatic(g);
}

// Trees of the new world, shaped and colored by element.
function buildNwTrees() {
  const dummy = new THREE.Object3D();
  const round = [], pines = [], dead = [];
  const roundSec = [], pineSec = [];
  for (let i = 0; i < 9000; i++) {
    const a = wr(0, Math.PI * 2), r = Math.sqrt(wrand()) * (NW.r - 45);
    const x = NW.x + Math.cos(a) * r, z = NW.z + Math.sin(a) * r;
    if (r < HUB_R + 10 || roadDist(x, z) < 7 || townDist(x, z) < 6 || lakeDist(x, z) < 3) continue;
    const sec = nwSector(x, z), key = ELEMENTS[sec].key;
    const dens = { shadow: 0.55, fire: 0.25, golden: 0.3, ice: 0.6, water: 0.45 }[key];
    if (wrand() > dens) continue;
    const s = wr(0.8, 1.35);
    dummy.position.set(x, height(x, z) - 0.1, z);
    dummy.rotation.set(0, wr(0, Math.PI * 2), 0);
    dummy.scale.set(s, s * wr(0.9, 1.2), s);
    dummy.updateMatrix();
    const m = dummy.matrix.clone();
    if (key === 'ice' || (key === 'shadow' && wrand() < 0.4)) { pines.push(m); pineSec.push(sec); }
    else if (key === 'fire') dead.push(m);
    else { round.push(m); roundSec.push(sec); }
    addCollider(x, z, 0.5 * s);
  }
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, map: barkTex(), roughness: 0.95 });
  const trunk = new THREE.CylinderGeometry(0.22, 0.4, 4, 7).translate(0, 2, 0);
  const crown = mergeGeos([
    lumpy(new THREE.SphereGeometry(2.1, 12, 9), 0.3, 1).translate(0, 4.8, 0),
    lumpy(new THREE.SphereGeometry(1.5, 10, 8), 0.3, 2).translate(1.1, 4.0, 0.4),
    lumpy(new THREE.SphereGeometry(1.4, 10, 8), 0.3, 3).translate(-0.9, 4.2, -0.6),
  ]);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  addWind(leafMat, 0.12, 0.05);
  const LEAF = ELEMENTS.map(el => new THREE.Color(el.leaf));
  const tint = sec => (col, i) => { col.copy(LEAF[sec[i]]).offsetHSL((Math.sin(i * 7.1) * 0.5) * 0.04, 0, (Math.sin(i * 3.3)) * 0.06); };
  const all = [...round, ...pines, ...dead];
  if (all.length) chunkedInstances(trunk, barkMat, all, { cell: 96, range: 240 });
  if (round.length) chunkedInstances(crown, leafMat, round, { cell: 96, range: 240, tint: tint(roundSec) });
  const pineGeo = mergeGeos([0, 1, 2, 3].map(k => new THREE.ConeGeometry(2.2 - k * 0.45, 2.2, 8).translate(0, 2.4 + k * 1.3, 0)));
  const snowTint = (col, i) => { col.copy(LEAF[pineSec[i]]); if (ELEMENTS[pineSec[i]].key === 'ice') col.lerp(new THREE.Color(0xeef4fa), 0.55); };
  if (pines.length) chunkedInstances(pineGeo, leafMat, pines, { cell: 96, range: 240, tint: snowTint });
  const branches = mergeGeos([0, 1, 2].map(k => new THREE.CylinderGeometry(0.06, 0.14, 2.2, 5).translate(0, 1.1, 0).rotateZ(0.7).rotateY(k * 2.1).translate(0, 3, 0)));
  if (dead.length) chunkedInstances(branches, new THREE.MeshStandardMaterial({ color: 0x1e1612, roughness: 1 }), dead, { cell: 96, range: 240 });
}

function buildWorld(sc) {
  scene = sc;
  buildSky();
  buildTerrain();
  buildVegetation();
  buildGrass();
  buildLakes();
  TOWNS.forEach(buildTown);
  plantRice();
  buildArena();
  NINJA_BASES.forEach(buildNinjaBase);
  DEMON_BASES.forEach(buildDemonBase);
  buildNewWorld();
}

export {
  buildWorld, updateSky, updateChunks, setGrassEnabled, frostAmt, inNewWorld, nwSector, nwWeights, nwSite, makeEnvScene, SUN_DIR, lakeAt, height, roadDist, nearestSeg, townDist, townAt, arenaDist, ninjaDist, ninjaBaseAt,
  demonBaseAt, collideStatic, clampBounds, interactables, villagers, staticNPCs, ninjaPortals, segDist,
};
