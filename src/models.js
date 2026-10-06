// Procedural models. Every character is a "rig": a root group with a body pivot
// (at hip height), two legs and two arms that the game animates. Models face +Z.
import * as THREE from 'three';
import {
  grainTex, clothTex, plasterTex, woodTex, roofTex, stoneTex, shojiTex, tigerTex, tiled,
} from './textures.js';

// Low-sided cones and cylinders read as faceted shapes, so give them flat normals.
function facet(geo) {
  const p = geo.parameters || {};
  const lowPoly = (p.radialSegments !== undefined && p.radialSegments <= 6) || p.detail === 0;
  if (!lowPoly) return geo;
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

function builder() {
  const mats = [];
  const M = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
    mats.push(m);
    return m;
  };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(facet(geo), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  return { mats, M, add };
}
// Merge a group's direct child meshes that share a material into one mesh, so a detailed
// character costs a handful of draw calls instead of dozens.
function mergeByMaterial(group) {
  const byMat = new Map();
  for (const c of group.children) {
    if (!c.isMesh) continue;
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(c);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      group.remove(m);
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const merged = new THREE.Mesh(geo, mat);
    merged.castShadow = true;
    merged.receiveShadow = true;
    group.add(merged);
  }
}
// Bake a static object's meshes into one mesh per material (relative to the root).
// Subtrees marked userData.noMerge (animated parts) are left alone.
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const walk = o => {
    for (const c of o.children) {
      if (c.userData.noMerge) continue;
      if (c.isMesh && !c.isInstancedMesh && c.children.length === 0) {
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(c);
      } else walk(c);
    }
  };
  walk(root);
  const rel = new THREE.Matrix4();
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const merged = new THREE.Mesh(geo, mat);
    merged.castShadow = list.some(m => m.castShadow);
    merged.receiveShadow = true;
    for (const m of list) m.parent.remove(m);
    root.add(merged);
  }
  return root;
}
function mergeRig(r) {
  for (const g of [r.body, r.head, r.legL, r.legR, r.armL, r.armR, r.weapon]) mergeByMaterial(g);
  addContactShadow(r);
  buildLod(r);
}

// Soft dark blob under the feet: grounds characters even where the shadow map is coarse.
let blobTex = null;
function addContactShadow(r) {
  if (!blobTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.6 }));
  blob.position.y = 0.04;
  blob.renderOrder = 1;
  r.root.add(blob);
  r.blob = blob;
}

// A single-mesh, vertex-colored copy of the whole character for when it is far away:
// one draw call instead of thirty. Built from the rest pose.
const lodMat = new THREE.MeshLambertMaterial({ vertexColors: true });
function buildLod(r) {
  const root = r.root;
  const saved = root.scale.clone();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  r.body.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    parts.push([g, o.material.color ?? new THREE.Color(0x888888)]);
  });
  const total = parts.reduce((n, [g]) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const [g, c] of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const lod = new THREE.Mesh(geo, lodMat);
  lod.castShadow = true;
  lod.visible = false;
  root.add(lod);
  root.scale.copy(saved);
  r.lod = lod;
}
// Show the sword in the hand (drawn) or resting in the scabbard (sheathed).
export function setSheathed(r, sheathed) {
  if (!r.sheathedHilt || !r.blade) return;
  r.blade.visible = !sheathed;
  r.sheathedHilt.visible = sheathed;
}
// Switch between the full animated model and its single-mesh stand-in.
export function setLod(r, far) {
  if (!r.lod || r.lod.visible === far) return;
  r.lod.visible = far;
  r.body.visible = !far;
}
const fabric = () => ({ map: clothTex(), bumpMap: grainTex(), bumpScale: 0.5, roughness: 0.92 });

export function makeKatana(o = {}) {
  const { color = 0xdfe6ee, glow = 0x000000, len = 1, style = 'katana' } = o;
  const g = new THREE.Group();
  const handle = new THREE.MeshStandardMaterial({ color: 0x1e1612, roughness: 0.75, bumpMap: grainTex(), bumpScale: 3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb8902f, metalness: 0.7, roughness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({
    color, metalness: 0.95, roughness: 0.12, emissive: glow, emissiveIntensity: glow ? 2.2 : 0,
  });
  const bl = 1.25 * len;
  // The hand grips at y=0; the wrapped handle (tsuka) runs through the fist to a gold pommel.
  const hl = style === 'nodachi' ? 0.55 : 0.36;
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, hl, 12), handle);
  h.position.y = hl / 2 - 0.15;
  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.04, 12), gold);
  pommel.position.y = hl - 0.13;
  g.add(pommel);
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, style === 'jagged' ? 4 : 24), gold);
  tsuba.position.y = -0.17;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, bl, 0.1), steel);
  blade.position.y = -0.19 - bl / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), steel);
  tip.position.y = -0.19 - bl - 0.08; tip.rotation.x = Math.PI;
  for (const m of [h, tsuba, blade, tip]) { m.castShadow = true; g.add(m); }
  blade.userData.steel = tip.userData.steel = true;
  if (style === 'jagged') {
    const tooth = new THREE.ConeGeometry(0.035, 0.14, 3);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(tooth, steel);
      t.position.set(0, -0.35 - i * (bl / 6.5), -0.07);
      t.rotation.x = -Math.PI / 2 - 0.5;
      t.userData.steel = true;
      g.add(t);
    }
  }
  g.userData.tipY = -0.19 - bl - 0.1;
  return g;
}

export function makeShuriken() {
  const m = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25, emissive: 0x555a60, emissiveIntensity: 0.6 });
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.1), m);
    b.rotation.y = i * Math.PI / 2;
    g.add(b);
  }
  return g;
}

function makeShortBlade() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9fa5, metalness: 0.7, roughness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3b2a1a });
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.28, 10), wood); h.position.y = 0.04;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.06), steel); guard.position.y = -0.11;
  g.add(guard);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.85, 0.11), steel); b.position.y = -0.55;
  for (const m of [h, b]) { m.castShadow = true; g.add(m); }
  return g;
}

function makeClub(scaleLen = 1) {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x4a4744, metalness: 0.8, roughness: 0.45, bumpMap: grainTex(), bumpScale: 2 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.09, 1.6 * scaleLen, 16), iron);
  shaft.position.y = -0.8 * scaleLen;
  shaft.castShadow = true;
  g.add(shaft);
  const stud = new THREE.ConeGeometry(0.06, 0.14, 4);
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(stud, iron);
    const a = (i / 10) * Math.PI * 4;
    const y = -0.8 - (i / 10) * 0.75;
    s.position.set(Math.cos(a) * 0.18, y * scaleLen, Math.sin(a) * 0.18);
    s.rotation.z = -Math.PI / 2;
    s.rotation.y = -a;
    g.add(s);
  }
  return g;
}

function makeStaff() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b4027 });
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 6), wood);
  s.position.y = -0.3;
  g.add(s);
  return g;
}

// Human: samurai, bandit, villager.
export function makeHumanoid(o = {}) {
  const { mats, M, add } = builder();
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 1.0; root.add(body);

  const cloth = M(o.cloth ?? 0x445566, fabric()), cloth2 = M(o.cloth2 ?? o.cloth ?? 0x334455, fabric());
  const skin = M(o.skin ?? 0xe0b48a, { roughness: 0.55, bumpMap: grainTex(), bumpScale: 0.15 });
  const dark = M(0x1d1a18, { roughness: 0.7 });
  const under = M(0xe9e2d4, fabric());
  const hairM = M(o.hair ?? 0x14100c, { roughness: 0.5 });

  // Kimono torso, rounded shoulders, white under-collar and an obi sash.
  add(body, new THREE.CylinderGeometry(0.34, 0.29, 0.86, 15), cloth, 0, 0.47, 0).scale.z = 0.66;
  add(body, new THREE.SphereGeometry(0.34, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), cloth, 0, 0.89, 0).scale.set(1, 0.35, 0.66);
  for (const sx of [-1, 1]) {
    const c = add(body, new THREE.BoxGeometry(0.07, 0.5, 0.02), under, sx * 0.075, 0.68, 0.215);
    c.rotation.z = sx * 0.38;
  }
  add(body, new THREE.CylinderGeometry(0.315, 0.315, 0.16, 15), M(o.obi ?? 0x2a1a14, fabric()), 0, 0.08, 0).scale.z = 0.72;
  add(body, new THREE.CylinderGeometry(0.31, 0.5, 0.44, 15), cloth2, 0, -0.13, 0).scale.z = 0.8;
  add(body, new THREE.CylinderGeometry(0.075, 0.09, 0.16, 9), skin, 0, 0.96, 0);

  // Head with a face.
  const head = new THREE.Group(); head.position.set(0, 1.16, 0); body.add(head);
  add(head, new THREE.SphereGeometry(0.235, 19, 14), skin, 0, 0, 0).scale.set(0.92, 1.08, 1);
  add(head, new THREE.SphereGeometry(0.15, 14, 9), skin, 0, -0.1, 0.07).scale.set(1, 0.8, 1);
  add(head, new THREE.ConeGeometry(0.035, 0.09, 12), skin, 0, -0.02, 0.235).rotation.x = Math.PI / 2;
  const eyeWhite = M(0xf0ece4, { roughness: 0.25 }), pupil = M(0x140c08, { roughness: 0.15 });
  for (const sx of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.05, 8, 6), skin, sx * 0.215, -0.01, 0).scale.set(0.45, 1, 0.8);
    add(head, new THREE.SphereGeometry(0.03, 8, 6), eyeWhite, sx * 0.083, 0.03, 0.197).scale.z = 0.5;
    add(head, new THREE.SphereGeometry(0.017, 8, 6), pupil, sx * 0.083, 0.03, 0.211);
    add(head, new THREE.BoxGeometry(0.085, 0.018, 0.02), hairM, sx * 0.085, 0.085, 0.208).rotation.z = sx * -0.15;
  }
  const hair = () => {
    add(head, new THREE.SphereGeometry(0.245, 17, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, 0.02, -0.02).scale.set(0.95, 1.08, 1.02);
    add(head, new THREE.CapsuleGeometry(0.045, 0.14, 6, 10), hairM, 0, 0.26, -0.04).rotation.x = Math.PI / 2 - 0.3;
  };

  if (o.armor) {
    const lac = M(o.armor, { roughness: 0.32, metalness: 0.2, bumpMap: grainTex(), bumpScale: 0.3 });
    const cord = M(0xc9a24a, { roughness: 0.6 });
    add(body, new THREE.CylinderGeometry(0.37, 0.33, 0.52, 15), lac, 0, 0.56, 0).scale.z = 0.72;
    for (let i = 0; i < 4; i++) add(body, new THREE.CylinderGeometry(0.372, 0.372, 0.015, 15), cord, 0, 0.36 + i * 0.13, 0).scale.z = 0.725;
    for (const sx of [-1, 1]) {
      const sode = add(body, new THREE.BoxGeometry(0.3, 0.34, 0.36), lac, sx * 0.5, 0.72, 0);
      sode.rotation.z = sx * 0.28;
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const plate = add(body, new THREE.BoxGeometry(0.32, 0.36, 0.04), lac, Math.sin(a) * 0.36, -0.12, Math.cos(a) * 0.3);
      plate.rotation.y = a; plate.rotation.x = 0.18;
    }
  }
  if (o.hat === 'kasa') {
    hair();
    const straw = M(0xc9a86a, { roughness: 0.95, bumpMap: grainTex(), bumpScale: 1.5 });
    add(body, new THREE.ConeGeometry(0.64, 0.3, 40), straw, 0, 1.43, 0);
    add(body, new THREE.TorusGeometry(0.62, 0.015, 6, 40), dark, 0, 1.29, 0).rotation.x = Math.PI / 2;
  } else if (o.hat === 'band') {
    hair();
    add(head, new THREE.TorusGeometry(0.235, 0.03, 8, 28), M(o.bandColor ?? 0x7a1b1b, fabric()), 0, 0.1, 0).rotation.x = Math.PI / 2;
  } else if (o.hat === 'bun') {
    hair();
    add(head, new THREE.SphereGeometry(0.1, 8, 6), hairM, 0, 0.2, -0.16);
  } else if (o.hat === 'kabuto') {
    const helm = M(o.armor ?? 0x2a2420, { metalness: 0.45, roughness: 0.35 });
    const gold = M(0xd4a72c, { metalness: 0.9, roughness: 0.25 });
    add(head, new THREE.SphereGeometry(0.29, 17, 7, 0, Math.PI * 2, 0, Math.PI / 2), helm, 0, 0.04, 0);
    for (let i = 0; i < 3; i++) {
      const ring = add(head, new THREE.CylinderGeometry(0.31 + i * 0.05, 0.35 + i * 0.05, 0.08, 18, 1, true), helm, 0, -0.02 - i * 0.07, -0.05);
      ring.material.side = THREE.DoubleSide;
    }
    for (const sx of [-1, 1]) {
      const horn = add(head, new THREE.BoxGeometry(0.04, 0.44, 0.02), gold, sx * 0.14, 0.42, 0.2);
      horn.rotation.z = sx * -0.45;
    }
    add(head, new THREE.SphereGeometry(0.05, 8, 6), gold, 0, 0.2, 0.27);
  } else if (o.hat === 'ninja') {
    const hood = M(o.cloth ?? 0x1b1b21, fabric());
    add(head, new THREE.SphereGeometry(0.255, 17, 12), hood, 0, 0.0, -0.01).scale.set(0.95, 1.1, 1.02);
    add(head, new THREE.CylinderGeometry(0.2, 0.17, 0.2, 13), hood, 0, -0.14, 0.03);
    const tail = add(head, new THREE.BoxGeometry(0.06, 0.38, 0.02), M(o.scarf ?? 0x8a1010, fabric()), 0.08, 0.0, -0.28);
    tail.rotation.x = 0.45;
  } else if (o.hat === 'onimask') {
    hair();
    const red = M(0xb0201a, { roughness: 0.3, metalness: 0.1 }), bone = M(0xeee3c8, { roughness: 0.4 });
    add(head, new THREE.SphereGeometry(0.22, 14, 9, -Math.PI / 2, Math.PI, 0, Math.PI), red, 0, -0.01, 0.06).scale.set(1, 1.08, 0.9);
    for (const sx of [-1, 1]) {
      const horn = add(head, new THREE.ConeGeometry(0.045, 0.32, 12), bone, sx * 0.15, 0.3, 0.12);
      horn.rotation.z = sx * -0.35;
      add(head, new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a }), sx * 0.083, 0.03, 0.25);
    }
    add(head, new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(0xe8e8e8, { roughness: 0.9 }), 0, 0.06, -0.06);
  } else if (o.hat === 'elder') {
    const white = M(0xdddddd, { roughness: 0.9 });
    add(head, new THREE.SphereGeometry(0.245, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), white, 0, 0.02, -0.03);
    add(head, new THREE.ConeGeometry(0.1, 0.32, 12), white, 0, -0.28, 0.18).rotation.x = Math.PI;
  } else hair();
  if (o.scarf) {
    const s = add(body, new THREE.BoxGeometry(0.16, 0.62, 0.02), M(o.scarf, fabric()), 0.15, 0.6, -0.24);
    s.rotation.x = 0.25;
  }

  // Hakama legs with white tabi socks and sandals.
  const tabi = M(0xe8e4dc, fabric());
  const legL = new THREE.Group(); legL.position.set(-0.19, -0.15, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.19, -0.15, 0); body.add(legR);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.CylinderGeometry(0.17, 0.23, 0.74, 11), cloth2, 0, -0.37, 0);
    add(leg, new THREE.CapsuleGeometry(0.075, 0.14, 6, 12), tabi, 0, -0.8, 0.05).rotation.x = Math.PI / 2;
    add(leg, new THREE.BoxGeometry(0.15, 0.03, 0.32), dark, 0, -0.865, 0.05);
  }
  // Wide kimono sleeves, forearms and hands.
  const armL = new THREE.Group(); armL.position.set(-0.46, 0.82, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.46, 0.82, 0); body.add(armR);
  armR.rotation.order = 'YXZ';
  for (const arm of [armL, armR]) {
    add(arm, new THREE.SphereGeometry(0.13, 9, 7), cloth, 0, 0, 0);
    add(arm, new THREE.CylinderGeometry(0.12, 0.2, 0.5, 11), cloth, 0, -0.26, 0);
    add(arm, new THREE.CylinderGeometry(0.055, 0.048, 0.2, 12), skin, 0, -0.56, 0);
    if (arm === armL || !o.weapon) add(arm, new THREE.SphereGeometry(0.068, 8, 6), skin, 0, -0.68, 0).scale.set(0.9, 1.1, 1.1);
  }

  // The wrist: the weapon pivots here, so the blade can point away from the forearm
  // instead of continuing it. The fist rides on the wrist, wrapped around the handle.
  const weapon = new THREE.Group(); weapon.position.y = -0.68; armR.add(weapon);
  if (o.weapon) {
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.072, 8, 6), skin);
    fist.scale.set(1.15, 0.9, 1.25);
    fist.position.set(0, 0.0, 0);
    fist.castShadow = true;
    weapon.add(fist);
    for (let k = 0; k < 4; k++) {
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), skin);
      knuckle.position.set(0.055, 0.045 - k * 0.03, 0.035);
      weapon.add(knuckle);
    }
  }
  let blade = null, sheathedHilt = null;
  if (o.weapon === 'katana') { blade = makeKatana(o.blade); weapon.add(blade); }
  if (o.sheath && o.weapon === 'katana') {
    // Saya (scabbard) worn through the obi on the off-hand hip: mouth forward and up,
    // tip trailing down behind. When the sword is sheathed its handle shows at the mouth.
    const len = 1.25 * (o.blade?.len ?? 1) + 0.08;
    const lac = new THREE.MeshStandardMaterial({ color: 0x141012, roughness: 0.22, metalness: 0.1 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xb8902f, metalness: 0.8, roughness: 0.3 });
    const sheath = new THREE.Group();
    sheath.position.set(-0.27, 0.12, 0.2);
    sheath.rotation.set(-0.38, -0.12, 0);
    body.add(sheath);
    const saya = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, len, 12).rotateX(Math.PI / 2).scale(0.8, 1.25, 1), lac);
    saya.position.z = -len / 2;
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.05, 12).rotateX(Math.PI / 2), gold);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), gold);
    cap.position.z = -len;
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), new THREE.MeshStandardMaterial({ color: o.scarf ?? 0x2a3a7a, roughness: 0.8 }));
    cord.position.z = -0.12;
    for (const m of [saya, mouth, cap, cord]) { m.castShadow = true; sheath.add(m); }
    // The sheathed sword's handle, pointing forward out of the scabbard mouth.
    sheathedHilt = makeKatana(o.blade);
    sheathedHilt.rotation.x = Math.PI / 2;
    sheathedHilt.position.z = 0.2;
    sheathedHilt.traverse(m => { if (m.userData.steel) m.visible = false; });
    sheath.add(sheathedHilt);
  }
  else if (o.weapon === 'blade') weapon.add(makeShortBlade());
  else if (o.weapon === 'staff') weapon.add(makeStaff());
  // Guard stance: blade angled up and forward from the fist.
  const wristRest = o.weapon === 'katana' || o.weapon === 'blade' ? -1.3 : 0;
  weapon.rotation.x = wristRest;

  root.scale.setScalar(o.scale ?? 1);
  const rig = { root, body, head, legL, legR, armL, armR, weapon, mats, walk: 0, wristRest, twoHanded: o.weapon === 'katana', blade, sheathedHilt };
  mergeRig(rig);
  return rig;
}

// Oni / demon king: heavy, muscular, with a tiger-skin loincloth and an iron kanabo.
export function makeOni(o = {}) {
  const { mats, M, add } = builder();
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 1.0; root.add(body);

  const skin = M(o.skin ?? 0xb83a2a, { roughness: 0.6, bumpMap: grainTex(), bumpScale: 1.2 });
  const hair = M(o.hair ?? 0x1b1311, { roughness: 0.75 });
  const tiger = M(0xffffff, { map: tigerTex(), roughness: 0.85, bumpMap: grainTex(), bumpScale: 0.8 });
  const bone = M(o.horn ?? 0xeee3c8, { roughness: 0.35 });
  const gold = M(0xb8902f, { metalness: 0.85, roughness: 0.3 });

  add(body, new THREE.SphereGeometry(0.62, 19, 14), skin, 0, 0.62, 0).scale.set(1, 0.95, 0.68);
  for (const sx of [-1, 1]) add(body, new THREE.SphereGeometry(0.3, 14, 9), skin, sx * 0.23, 0.8, 0.22).scale.set(1, 0.75, 0.55);
  add(body, new THREE.SphereGeometry(0.44, 17, 12), skin, 0, 0.28, 0.14).scale.set(1, 0.9, 0.85);
  add(body, new THREE.CylinderGeometry(0.56, 0.64, 0.44, 20), tiger, 0, -0.05, 0).scale.z = 0.8;
  add(body, new THREE.TorusGeometry(0.57, 0.05, 10, 32), M(0x3a2618, fabric()), 0, 0.17, 0).rotation.x = Math.PI / 2;
  add(body, new THREE.CylinderGeometry(0.24, 0.32, 0.3, 13), skin, 0, 1.12, 0.02);

  const head = new THREE.Group(); head.position.set(0, 1.36, 0.08); body.add(head);
  add(head, new THREE.SphereGeometry(0.32, 19, 14), skin, 0, 0.02, 0).scale.set(1, 1.04, 0.95);
  add(head, new THREE.SphereGeometry(0.25, 17, 11), skin, 0, -0.15, 0.08).scale.set(1.15, 0.75, 1);
  add(head, new THREE.CapsuleGeometry(0.06, 0.4, 6, 12), skin, 0, 0.11, 0.25).rotation.z = Math.PI / 2;
  add(head, new THREE.SphereGeometry(0.075, 8, 6), skin, 0, -0.01, 0.31).scale.set(1.2, 0.9, 1);
  add(head, new THREE.BoxGeometry(0.3, 0.05, 0.05), M(0x200808, { roughness: 0.4 }), 0, -0.19, 0.29);
  const eyeM = new THREE.MeshBasicMaterial({ color: o.eyes ?? 0xffe14a });
  for (const sx of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.05, 8, 6), eyeM, sx * 0.13, 0.04, 0.27).scale.set(1.3, 0.8, 0.6);
    const f = add(head, new THREE.ConeGeometry(0.035, 0.13, 10), bone, sx * 0.12, -0.13, 0.3);
    f.rotation.x = Math.PI * 0.95;
    const horn = add(head, new THREE.ConeGeometry(0.075, 0.48, 16, 4), bone, sx * 0.2, 0.42, -0.02);
    horn.rotation.z = sx * -0.4;
  }
  if (o.single) add(head, new THREE.ConeGeometry(0.09, 0.6, 16, 4), bone, 0, 0.52, 0.04);
  // Wild mane of spiky hair.
  for (let i = 0; i < 11; i++) {
    const a = (i / 10 - 0.5) * 2.6;
    const spike = add(head, new THREE.ConeGeometry(0.09, 0.42, 10), hair, Math.sin(a) * 0.26, 0.12 + Math.cos(a) * 0.08, -0.2 - Math.cos(a) * 0.06);
    spike.rotation.x = -1.9; spike.rotation.z = -a * 0.5;
  }

  const legL = new THREE.Group(); legL.position.set(-0.3, -0.18, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.3, -0.18, 0); body.add(legR);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.CapsuleGeometry(0.2, 0.32, 8, 16), skin, 0, -0.25, 0);
    add(leg, new THREE.CapsuleGeometry(0.16, 0.28, 8, 16), skin, 0, -0.56, 0.02);
    add(leg, new THREE.CylinderGeometry(0.18, 0.18, 0.08, 11), gold, 0, -0.66, 0.02);
    add(leg, new THREE.SphereGeometry(0.17, 11, 7), skin, 0, -0.78, 0.1).scale.set(1, 0.45, 1.5);
  }
  const armL = new THREE.Group(); armL.position.set(-0.74, 0.92, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.74, 0.92, 0); body.add(armR);
  armR.rotation.order = 'YXZ';
  for (const arm of [armL, armR]) {
    add(arm, new THREE.SphereGeometry(0.25, 13, 9), skin, 0, 0, 0);
    add(arm, new THREE.CapsuleGeometry(0.16, 0.34, 8, 16), skin, 0, -0.3, 0);
    add(arm, new THREE.CylinderGeometry(0.16, 0.15, 0.16, 13), gold, 0, -0.6, 0);
    if (arm === armL) add(arm, new THREE.SphereGeometry(0.17, 11, 8), skin, 0, -0.8, 0);
  }
  const weapon = new THREE.Group(); weapon.position.y = -0.8; armR.add(weapon);
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.17, 11, 8), skin);
  fist.scale.set(1.1, 0.95, 1.2);
  fist.castShadow = true;
  weapon.add(fist);
  const club = makeClub(o.clubLen ?? 1);
  club.position.y = 0.12;
  weapon.add(club);
  const wristRest = -0.75;
  weapon.rotation.x = wristRest;

  if (o.cape) {
    const cape = add(body, new THREE.CylinderGeometry(0.62, 0.9, 1.5, 15, 1, true, Math.PI * 0.6, Math.PI * 0.8), M(o.cape, { ...fabric(), side: THREE.DoubleSide }), 0, 0.3, -0.05);
    cape.rotation.y = Math.PI;
  }

  root.scale.setScalar(o.scale ?? 1);
  const rig = { root, body, head, legL, legR, armL, armR, weapon, mats, walk: 0, wristRest };
  mergeRig(rig);
  return rig;
}

export function makeEnemyModel(type, scale) {
  switch (type) {
    case 'ninja': return makeHumanoid({ cloth: 0x1b1b21, cloth2: 0x121216, hat: 'ninja', scarf: 0x8a1010, weapon: 'blade', scale, skin: 0xc99a72 });
    case 'ninjaMaster': return makeHumanoid({ cloth: 0x3a0d10, cloth2: 0x140608, hat: 'ninja', scarf: 0xe8c15a, armor: 0x222226, weapon: 'katana', blade: { color: 0x9aa0ff, glow: 0x3a20a0 }, scale, skin: 0xc99a72 });
    case 'warlord': return makeOni({ skin: 0x4a1a4a, scale, hair: 0x0c0606, eyes: 0x6affd0, horn: 0x9a9aa8, cape: 0x3a0a3a, clubLen: 1.3, glow: 0x000000 });
    case 'bandit': return makeHumanoid({ cloth: 0x4b4640, cloth2: 0x2f2b27, hat: 'band', bandColor: 0x7a1b1b, weapon: 'blade', scale, skin: 0xc99a72 });
    case 'oni': return makeOni({ skin: 0xb83a2a, scale });
    case 'blueOni': return makeOni({ skin: 0x2f5fa8, scale, horn: 0xd8c27a, single: true });
    case 'captain': return makeOni({ skin: 0x2a2526, scale, hair: 0x5a0d0d, eyes: 0xff3322, horn: 0xc9a227, cape: 0x5a0d0d, clubLen: 1.2 });
    case 'boss': return makeOni({ skin: 0x6a1010, scale, hair: 0x0c0606, eyes: 0xfff2a0, horn: 0xd4af37, cape: 0x111111, clubLen: 1.35, single: true });
  }
  throw new Error('unknown enemy ' + type);
}

// ---------- Scenery ----------
const sharedMats = new Map();
const keyOf = extra => Object.entries(extra).map(([k, v]) => k + '=' + (v && v.isTexture ? v.uuid : v)).join(',');
export function smat(color, extra = {}) {
  const key = color + keyOf(extra);
  if (!sharedMats.has(key)) sharedMats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }));
  return sharedMats.get(key);
}
// Textured scenery material, cached by texture name, tint and tiling.
const texMats = new Map();
const TEX = { plaster: plasterTex, wood: woodTex, roof: roofTex, stone: stoneTex, shoji: shojiTex, grain: grainTex };
export function tmat(name, color = 0xffffff, rx = 1, ry = 1, extra = {}) {
  const key = [name, color, rx, ry, keyOf(extra)].join('|');
  if (!texMats.has(key)) {
    const map = tiled(TEX[name](), rx, ry);
    texMats.set(key, new THREE.MeshStandardMaterial({ color, map, bumpMap: map, bumpScale: name === 'roof' ? 3 : 1.2, roughness: 0.85, ...extra }));
  }
  return texMats.get(key);
}

function mesh(geo, mat, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(facet(geo), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// A gabled roof of kawara tiles over a w x d footprint, eaves at height y.
function gableRoof(g, w, d, y, color, overhang = 0.75, pitch = 0.52) {
  const run = d / 2 + overhang, rise = run * Math.tan(pitch), len = run / Math.cos(pitch);
  const tile = tmat('roof', color, Math.round(w * 0.9), Math.round(len * 0.9));
  for (const sz of [-1, 1]) {
    const slab = mesh(new THREE.BoxGeometry(w + overhang * 2, 0.16, len), tile, 0, y + rise / 2 + 0.08, sz * run / 2, g);
    slab.rotation.x = sz * pitch;
  }
  const ridge = mesh(new THREE.CylinderGeometry(0.16, 0.16, w + overhang * 2 + 0.2, 16), smat(new THREE.Color(color).multiplyScalar(0.55).getHex(), { roughness: 0.6 }), 0, y + rise + 0.12, 0, g);
  ridge.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.2, 0.34, 0.34), smat(0x2a2a2e, { roughness: 0.5 }), sx * (w / 2 + overhang + 0.1), y + rise + 0.2, 0, g);
  // Plaster gable ends.
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, (d / 2) * Math.tan(pitch))]);
  for (const sx of [-1, 1]) {
    const gable = mesh(new THREE.ShapeGeometry(tri), tmat('plaster', 0xf0e8d8, 1, 0.5, { side: THREE.DoubleSide }), sx * (w / 2), y, 0, g, false);
    gable.rotation.y = Math.PI / 2;
  }
}

export function makeHouse(wall, roof, w = 5, d = 4) {
  const g = new THREE.Group();
  const wood = tmat('wood', 0x9a7a5a, 1, 2), beam = tmat('wood', 0x7a5a40, 4, 1);
  mesh(new THREE.BoxGeometry(w + 0.9, 0.5, d + 0.9), tmat('stone', 0xb0aca4, w / 2, 0.4), 0, 0.25, 0, g);
  mesh(new THREE.BoxGeometry(w + 0.6, 0.1, d + 0.6), tmat('wood', 0x8a6a4a, 3, 3), 0, 0.55, 0, g);
  mesh(new THREE.BoxGeometry(w, 2.35, d), tmat('plaster', wall, w / 3, 1), 0, 1.78, 0, g);
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.2, 2.45, 0.2), wood, sx * w / 2, 1.78, sz * d / 2, g);
  }
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.2, 2.45, 0.2), wood, sx * w / 2, 1.78, 0, g);
  for (const y of [0.7, 1.55, 2.95]) mesh(new THREE.BoxGeometry(w + 0.08, 0.13, d + 0.08), beam, 0, y, 0, g);
  // Sliding shoji doors on the front, windows on the sides.
  mesh(new THREE.BoxGeometry(1.5, 1.75, 0.05), tmat('shoji', 0xfff6e8, 1.5, 1.75, { emissive: 0x5a3a10, emissiveIntensity: 0.15 }), 0, 1.5, d / 2 + 0.03, g, false);
  for (const sx of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.9, 0.7, 0.05), tmat('shoji', 0xfff6e8, 1, 0.75, { emissive: 0x5a3a10, emissiveIntensity: 0.15 }), sx * w * 0.32, 1.95, d / 2 + 0.03, g, false);
    const side = mesh(new THREE.BoxGeometry(0.9, 0.7, 0.05), tmat('shoji', 0xfff6e8, 1, 0.75), sx * (w / 2 + 0.03), 1.95, 0, g, false);
    side.rotation.y = Math.PI / 2;
  }
  const roofTint = new THREE.Color(roof).lerp(new THREE.Color(0xffffff), 0.45).getHex();
  gableRoof(g, w, d, 2.98, roofTint);
  return g;
}

export function makeTorii(scale = 1, color = 0xc0392b) {
  const g = new THREE.Group();
  const red = smat(color, { roughness: 0.45, bumpMap: grainTex(), bumpScale: 0.4 }), black = smat(0x1a1514, { roughness: 0.4 });
  for (const sx of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.4, 24), red, sx * 2.6, 2.2, 0, g);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 24), black, sx * 2.6, 0.2, 0, g);
  }
  mesh(new THREE.BoxGeometry(7.2, 0.35, 0.5), black, 0, 4.55, 0, g);
  mesh(new THREE.BoxGeometry(6.6, 0.28, 0.42), red, 0, 4.25, 0, g);
  mesh(new THREE.BoxGeometry(6.0, 0.25, 0.3), red, 0, 3.5, 0, g);
  mesh(new THREE.BoxGeometry(0.3, 0.8, 0.32), black, 0, 3.9, 0, g);
  g.scale.setScalar(scale);
  return g;
}

export function makeStoneLantern(lit = true) {
  const g = new THREE.Group();
  const stone = tmat('stone', 0xc8c4bc, 0.5, 0.5);
  mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 6), stone, 0, 0.15, 0, g);
  mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.0, 6), stone, 0, 0.8, 0, g);
  mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), lit ? smat(0xffc46a, { emissive: 0xff9a2a, emissiveIntensity: 1.2 }) : stone, 0, 1.55, 0, g);
  mesh(new THREE.ConeGeometry(0.6, 0.45, 4), stone, 0, 2.0, 0, g).rotation.y = Math.PI / 4;
  return g;
}

export function makeShopStall(clothColor = 0x24467a) {
  const g = new THREE.Group();
  const wood = tmat('wood', 0xa07850, 2, 1), dark = tmat('wood', 0x5a3a24, 1, 2);
  mesh(new THREE.BoxGeometry(4.2, 1.1, 1.2), wood, 0, 0.55, 0.8, g);
  mesh(new THREE.BoxGeometry(4.4, 0.1, 1.4), dark, 0, 1.15, 0.8, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(new THREE.BoxGeometry(0.18, 3.0, 0.18), dark, sx * 2.1, 1.5, sz * 1.3 + 0.2, g);
  const roof = mesh(new THREE.BoxGeometry(5.0, 0.18, 3.6), tmat('roof', 0xc06a5a, 4, 3), 0, 3.15, 0.2, g);
  roof.rotation.x = -0.18;
  for (let i = -1; i <= 1; i++) mesh(new THREE.BoxGeometry(1.3, 0.8, 0.04), smat(clothColor), i * 1.4, 2.6, 1.55, g, false);
  // goods on the counter
  const jar = new THREE.CylinderGeometry(0.15, 0.12, 0.3, 8);
  const colors = [0xd04a3a, 0x3aa04a, 0x3a7ad0, 0xd0b03a];
  for (let i = 0; i < 6; i++) mesh(jar, smat(colors[i % 4], { emissive: colors[i % 4], emissiveIntensity: 0.25 }), -1.6 + i * 0.6, 1.35, 0.8, g);
  // hanging paper lanterns
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.25, 8, 6), smat(0xff5a3a, { emissive: 0xff3a1a, emissiveIntensity: 0.9 }), sx * 2.1, 2.5, 1.7, g, false).scale.y = 1.3;
  return g;
}

export function makeShrine() {
  const g = new THREE.Group();
  const stone = tmat('stone', 0xc8c4bc, 1.5, 0.4), wood = tmat('wood', 0x8a6040, 1, 1), red = smat(0xb0301f);
  mesh(new THREE.BoxGeometry(3.4, 0.5, 3.0), stone, 0, 0.25, 0, g);
  mesh(new THREE.BoxGeometry(2.2, 1.8, 1.8), wood, 0, 1.4, -0.2, g);
  mesh(new THREE.BoxGeometry(1.0, 1.2, 0.05), smat(0xffe6a8, { emissive: 0xffb84a, emissiveIntensity: 0.9 }), 0, 1.2, 0.71, g, false);
  const r = mesh(new THREE.ConeGeometry(2.1, 1.3, 4), red, 0, 2.9, -0.2, g);
  r.rotation.y = Math.PI / 4;
  r.scale.set(1.15, 1, 1);
  for (const sx of [-1, 1]) {
    const l = makeStoneLantern(true);
    l.position.set(sx * 2.4, 0, 1.4);
    g.add(l);
  }
  // a hanging rope + bell
  mesh(new THREE.SphereGeometry(0.18, 8, 6), smat(0xc9a227, { metalness: 0.7, roughness: 0.3 }), 0, 2.1, 0.9, g);
  return g;
}

// ---------- Ninja base & demon fortress pieces ----------
export function makeTent(color = 0x2a2a30) {
  const g = new THREE.Group();
  const t = mesh(new THREE.ConeGeometry(2.6, 3.0, 4), smat(color), 0, 1.5, 0, g);
  t.rotation.y = Math.PI / 4;
  mesh(new THREE.BoxGeometry(0.9, 1.4, 0.05), smat(0x0c0c0e), 0, 0.7, 1.55, g, false);
  return g;
}

export function makeWatchtower() {
  const g = new THREE.Group();
  const wood = smat(0x4a3424), dark = smat(0x2a1d14);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = mesh(new THREE.CylinderGeometry(0.15, 0.2, 7, 6), wood, sx * 1.2, 3.5, sz * 1.2, g);
    p.rotation.z = sx * 0.05; p.rotation.x = sz * -0.05;
  }
  mesh(new THREE.BoxGeometry(3.2, 0.2, 3.2), dark, 0, 6.2, 0, g);
  for (const [x, z, w, d] of [[0, 1.5, 3.2, 0.1], [0, -1.5, 3.2, 0.1], [1.5, 0, 0.1, 3.2], [-1.5, 0, 0.1, 3.2]]) {
    mesh(new THREE.BoxGeometry(w, 0.8, d), wood, x, 6.7, z, g);
  }
  const r = mesh(new THREE.ConeGeometry(2.6, 1.4, 4), smat(0x1a1416), 0, 8.4, 0, g);
  r.rotation.y = Math.PI / 4;
  return g;
}

export function makeBanner(cloth = 0x111114, mark = 0xc0201a) {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.5, 6), smat(0x2a1d14), 0, 2.75, 0, g);
  mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), smat(0x2a1d14), 0.45, 5.3, 0, g);
  const flag = mesh(new THREE.BoxGeometry(0.85, 2.6, 0.03), smat(cloth), 0.45, 3.95, 0, g);
  flag.castShadow = false;
  mesh(new THREE.CircleGeometry(0.28, 16), smat(mark, { emissive: mark, emissiveIntensity: 0.4 }), 0.45, 4.4, 0.02, g, false);
  return g;
}

export function makeCampfire() {
  const g = new THREE.Group();
  const logM = smat(0x3a2618);
  for (let i = 0; i < 4; i++) {
    const l = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 5), logM, 0, 0.15, 0, g);
    l.rotation.z = Math.PI / 2; l.rotation.y = i * Math.PI / 4;
  }
  const fire = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff5a10, emissiveIntensity: 3 });
  mesh(new THREE.ConeGeometry(0.45, 1.1, 6), fire, 0, 0.7, 0, g, false);
  mesh(new THREE.ConeGeometry(0.25, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0xffe080, emissive: 0xffc040, emissiveIntensity: 3 }), 0.1, 0.6, 0.1, g, false);
  return g;
}

export function makeDummy() {
  const g = new THREE.Group();
  const straw = smat(0xb89a5a);
  mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 5), smat(0x4a3424), 0, 0.9, 0, g);
  mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 8), straw, 0, 1.4, 0, g);
  mesh(new THREE.BoxGeometry(1.2, 0.12, 0.12), smat(0x4a3424), 0, 1.6, 0, g);
  mesh(new THREE.SphereGeometry(0.2, 8, 6), straw, 0, 2.05, 0, g);
  return g;
}

// A portal: a stone ring around a swirling disc. Returns { group, disc, setOpen(bool) }.
export function makePortal(color = 0x9a3aff) {
  const g = new THREE.Group();
  const stone = smat(0x2e2a2c);
  const ring = mesh(new THREE.TorusGeometry(2.2, 0.32, 8, 24), stone, 0, 2.6, 0, g);
  ring.castShadow = true;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rune = mesh(new THREE.BoxGeometry(0.25, 0.25, 0.7), smat(color, { emissive: color, emissiveIntensity: 2 }), Math.cos(a) * 2.2, 2.6 + Math.sin(a) * 2.2, 0, g, false);
    rune.rotation.z = a;
  }
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.7, 0.8, 1.1), stone, sx * 1.7, 0.4, 0, g);
  const tex = swirlTexture();
  const discMat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.0, 32), discMat);
  disc.position.y = 2.6;
  g.add(disc);
  const runeMats = g.children.filter(c => c.material && c.material.emissiveIntensity === 2).map(c => c.material);
  return {
    group: g, disc,
    setOpen(open) {
      disc.visible = open;
      for (const m of runeMats) m.emissiveIntensity = open ? 2.2 : 0.15;
    },
  };
}

let _swirl = null;
function swirlTexture() {
  if (_swirl) return _swirl;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const a = arm * Math.PI / 2 + t * 5, r = t * 60;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  _swirl = new THREE.CanvasTexture(c);
  _swirl.colorSpace = THREE.SRGBColorSpace;
  return _swirl;
}

export function makeChest() {
  const g = new THREE.Group();
  const wood = smat(0x5a2e14), gold = smat(0xd4a72c, { metalness: 0.8, roughness: 0.3, emissive: 0x4a3000, emissiveIntensity: 0.6 });
  mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), wood, 0, 0.4, 0, g);
  const lid = new THREE.Group(); lid.position.set(0, 0.8, -0.45); g.add(lid);
  mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 10, 1, false, 0, Math.PI), wood, 0, 0, 0.45, lid).rotation.z = Math.PI / 2;
  for (const sx of [-0.5, 0.5]) mesh(new THREE.BoxGeometry(0.1, 0.85, 0.95), gold, sx, 0.42, 0, g);
  mesh(new THREE.BoxGeometry(0.22, 0.25, 0.06), gold, 0, 0.7, 0.47, g);
  g.userData.lid = lid;
  return g;
}

export function makeKeep() {
  const g = new THREE.Group();
  const stone = smat(0x26201f), roof = smat(0x5a0d0d), glow = smat(0xff6a2a, { emissive: 0xff4a10, emissiveIntensity: 2 });
  const tiers = [[14, 5, 10], [10, 4, 7], [6.5, 3.5, 4.5]];
  let y = 0;
  for (const [w, h, d] of tiers) {
    mesh(new THREE.BoxGeometry(w, h, d), stone, 0, y + h / 2, 0, g);
    const r = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.8, 2.2, 4), roof, 0, y + h + 0.9, 0, g);
    r.rotation.y = Math.PI / 4; r.scale.set(w / Math.max(w, d) * 1.1, 1, d / Math.max(w, d) * 1.1);
    for (let i = -1; i <= 1; i++) mesh(new THREE.BoxGeometry(0.8, 1.0, 0.05), glow, i * w * 0.28, y + h * 0.55, d / 2 + 0.02, g, false);
    y += h + 1.4;
  }
  mesh(new THREE.BoxGeometry(2.6, 3.2, 0.1), smat(0x0a0606), 0, 1.6, 5.02, g, false);
  return g;
}
