// World building: terrain, vegetation, towns, ninja bases, demon fortresses and sky.
import * as THREE from 'three';
import {
  PATH, TOWN_R, ARENA, BOUNDS, TOWNS, TOWN_IDX, NINJA_BASES, NINJA_R, DEMON_BASES, DEMON_R, REALM_X,
  LAKES, WATER_Y,
} from './data.js';
import {
  makeHumanoid, makeHouse, makeTorii, makeStoneLantern, makeShopStall, makeShrine, smat,
  makeTent, makeWatchtower, makeBanner, makeCampfire, makeDummy, makePortal, makeChest, makeKeep, tmat,
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
function height(x, z) {
  if (x > REALM_X) return 0;
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
  const f = smooth(5, 24, roadDist(x, z)) * smooth(TOWN_R, TOWN_R + 22, townDist(x, z))
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
  const minX = -440, maxX = 440, minZ = -1100, maxZ = 210;
  const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 220, 328);
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const g1 = new THREE.Color(0x3d5a26), g2 = new THREE.Color(0x5e7a36), dirt = new THREE.Color(0x8a7050);
  const plaza = new THREE.Color(0xb5a07a), ash = new THREE.Color(0x4a3a35), arenaC = new THREE.Color(0x341915), campC = new THREE.Color(0x6a5a44);
  const rock = new THREE.Color(0x7a756c), snow = new THREE.Color(0xeeeef4), c = new THREE.Color();
  const sand = new THREE.Color(0xa8946a), mud = new THREE.Color(0x3a3424);
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

  // Side trails from the road to each ninja base gate.
  for (const nb of NINJA_BASES) {
    let best = null, bd = Infinity;
    for (let i = 0; i < PATH.length - 1; i++) {
      const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((nb.x - ax) * dx + (nb.z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - nb.x, pz - nb.z);
      if (d < bd) { bd = d; best = [px, pz]; }
    }
    const ux = (best[0] - nb.x) / bd, uz = (best[1] - nb.z) / bd;
    nb.gate = [nb.x + ux * NINJA_R, nb.z + uz * NINJA_R];
    nb.gateDir = Math.atan2(ux, uz);
    const steps = Math.ceil(bd / 4);
    const trailMat = new THREE.MeshLambertMaterial({ color: 0x9c8462, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps, t1 = (k + 1) / steps;
      const x0 = lerp(nb.x, best[0], t0), z0 = lerp(nb.z, best[1], t0), x1 = lerp(nb.x, best[0], t1), z1 = lerp(nb.z, best[1], t1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, Math.hypot(x1 - x0, z1 - z0) + 0.3).rotateX(-Math.PI / 2), trailMat);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      m.position.set(mx, height(mx, mz) + 0.08, mz);
      m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
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
  const okSpot = (x, z, margin = 0) => roadDist(x, z) > 7 + margin && townDist(x, z) > TOWN_R + 3
    && arenaDist(x, z) > ARENA.r + 6 && ninjaDist(x, z) > NINJA_R + 5 && lakeDist(x, z) > 3 && height(x, z) < 40;

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

  const inst = (geo, mat, list, shadow = true, tint = null) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const col = new THREE.Color();
    list.forEach((m, i) => {
      im.setMatrixAt(i, m);
      if (tint) { tint(col, i); im.setColorAt(i, col); }
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    scene.add(im);
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
  inst(mergeGeos(pineTiers), leaves(0.18, 0.08), sets.pine, true, vary(0x2c5228, 0.12));
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
  // Arrive on the road just south of the plaza, looking north along it.
  t.spawn = new THREE.Vector3(t.x - dx * 5, 0, t.z - dz * 5);
  t.spawnFacing = Math.atan2(dx, dz);

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
  for (let i = 0; i < 200000 && mats.length < 60000; i++) {
    const x = wr(BOUNDS.minX, BOUNDS.maxX), z = wr(-760, BOUNDS.maxZ);
    if (roadDist(x, z) < 3.5 || townDist(x, z) < TOWN_R - 3 || ninjaDist(x, z) < NINJA_R || arenaDist(x, z) < ARENA.r + 4 || lakeDist(x, z) < 0) continue;
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
  const im = new THREE.InstancedMesh(blade, grassMat, mats.length);
  const gc = new THREE.Color();
  mats.forEach((m, i) => {
    im.setMatrixAt(i, m);
    gc.setHSL(0.2 + Math.random() * 0.07, 0.35 + Math.random() * 0.2, 0.5 + Math.random() * 0.15);
    im.setColorAt(i, gc);
  });
  im.receiveShadow = true;
  im.name = 'grass';
  scene.add(im);
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
      m.position.set(Math.cos(a) * radius, h / 2 - 20, -450 + Math.sin(a) * radius * 1.15);
      m.rotation.y = wr(0, 6);
      ranges.add(m);
    }
  }
  scene.add(ranges);
  overworldOnly.push(ranges);

  // Oni Mountain looms over the far north, visible from anywhere.
  const mountain = new THREE.Mesh(new THREE.CylinderGeometry(45, 280, 320, 28, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x2b2120, fog: false, flatShading: true }));
  mountain.position.set(0, 140, -1250);
  scene.add(mountain);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(44, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff5a1a, fog: false }));
  crater.position.set(0, 300.5, -1250);
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
  placeObj(portal.group, ptx, ptz, gateA);
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
  g.traverse(o => { if (o.isMesh) o.updateMatrixWorld(); });
}

function buildWorld(sc) {
  scene = sc;
  buildSky();
  buildTerrain();
  buildVegetation();
  buildGrass();
  buildLakes();
  TOWNS.forEach(buildTown);
  buildArena();
  NINJA_BASES.forEach(buildNinjaBase);
  DEMON_BASES.forEach(buildDemonBase);
}

export {
  buildWorld, updateSky, makeEnvScene, SUN_DIR, lakeAt, height, roadDist, nearestSeg, townDist, townAt, arenaDist, ninjaDist, ninjaBaseAt,
  demonBaseAt, collideStatic, clampBounds, interactables, villagers, staticNPCs, ninjaPortals, segDist,
};
