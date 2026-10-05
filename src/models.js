// Procedural low-poly models. Every character is a "rig": a root group with a body
// pivot (at hip height), two legs and two arms that the game animates. Models face +Z.
import * as THREE from 'three';

function builder() {
  const mats = [];
  const M = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });
    mats.push(m);
    return m;
  };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  return { mats, M, add };
}

export function makeKatana(o = {}) {
  const { color = 0xdfe6ee, glow = 0x000000, len = 1, style = 'katana' } = o;
  const g = new THREE.Group();
  const handle = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb8902f, metalness: 0.7, roughness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({
    color, metalness: 0.85, roughness: 0.22, emissive: glow, emissiveIntensity: glow ? 2.2 : 0,
  });
  const bl = 1.25 * len;
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, style === 'nodachi' ? 0.55 : 0.34, 0.07), handle);
  h.position.y = style === 'nodachi' ? 0.12 : 0.02;
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, style === 'jagged' ? 4 : 10), gold);
  tsuba.position.y = -0.17;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, bl, 0.1), steel);
  blade.position.y = -0.19 - bl / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), steel);
  tip.position.y = -0.19 - bl - 0.08; tip.rotation.x = Math.PI;
  for (const m of [h, tsuba, blade, tip]) { m.castShadow = true; g.add(m); }
  if (style === 'jagged') {
    const tooth = new THREE.ConeGeometry(0.035, 0.14, 3);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(tooth, steel);
      t.position.set(0, -0.35 - i * (bl / 6.5), -0.07);
      t.rotation.x = -Math.PI / 2 - 0.5;
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
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), wood);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.85, 0.12), steel); b.position.y = -0.55;
  for (const m of [h, b]) { m.castShadow = true; g.add(m); }
  return g;
}

function makeClub(scaleLen = 1) {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x3b3936, metalness: 0.5, roughness: 0.6, flatShading: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.09, 1.6 * scaleLen, 7), iron);
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

  const cloth = M(o.cloth ?? 0x445566), cloth2 = M(o.cloth2 ?? o.cloth ?? 0x334455);
  const skin = M(o.skin ?? 0xe0b48a), dark = M(0x1d1a18);

  add(body, new THREE.BoxGeometry(0.74, 0.85, 0.42), cloth, 0, 0.45, 0);
  add(body, new THREE.BoxGeometry(0.78, 0.12, 0.46), dark, 0, 0.06, 0);
  add(body, new THREE.CylinderGeometry(0.38, 0.5, 0.38, 8), cloth2, 0, -0.12, 0);
  add(body, new THREE.BoxGeometry(0.2, 0.15, 0.2), skin, 0, 0.92, 0);
  const head = add(body, new THREE.SphereGeometry(0.27, 10, 8), skin, 0, 1.13, 0);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x111111 });
  add(head, new THREE.BoxGeometry(0.06, 0.04, 0.02), eyeM, -0.09, 0.03, 0.25);
  add(head, new THREE.BoxGeometry(0.06, 0.04, 0.02), eyeM, 0.09, 0.03, 0.25);

  if (o.armor) {
    const arm = M(o.armor);
    add(body, new THREE.BoxGeometry(0.8, 0.5, 0.5), arm, 0, 0.55, 0);
    for (const sx of [-1, 1]) {
      const pad = add(body, new THREE.BoxGeometry(0.34, 0.08, 0.42), arm, sx * 0.5, 0.86, 0);
      pad.rotation.z = sx * -0.35;
    }
    for (let i = 0; i < 3; i++) add(body, new THREE.BoxGeometry(0.82 + i * 0.04, 0.1, 0.5), arm, 0, -0.05 - i * 0.12, 0);
  }
  if (o.hat === 'kasa') {
    const straw = M(0xc9a86a);
    add(body, new THREE.ConeGeometry(0.62, 0.32, 14), straw, 0, 1.42, 0);
  } else if (o.hat === 'band') {
    add(head, new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10), M(o.bandColor ?? 0x7a1b1b), 0, 0.1, 0);
    add(head, new THREE.SphereGeometry(0.2, 8, 6), dark, 0, 0.18, -0.08);
  } else if (o.hat === 'bun') {
    add(head, new THREE.SphereGeometry(0.11, 8, 6), M(o.hair ?? 0x1a1410), 0, 0.27, -0.06);
    add(head, new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(o.hair ?? 0x1a1410), 0, 0.03, -0.02);
  } else if (o.hat === 'kabuto') {
    const helm = M(o.armor ?? 0x2a2420, { metalness: 0.4, roughness: 0.5 });
    const gold = M(0xd4a72c, { metalness: 0.8, roughness: 0.3 });
    add(head, new THREE.SphereGeometry(0.31, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), helm, 0, 0.02, 0);
    const neck = add(head, new THREE.CylinderGeometry(0.33, 0.48, 0.25, 10, 1, true), helm, 0, -0.08, -0.04);
    neck.material.side = THREE.DoubleSide;
    for (const sx of [-1, 1]) {
      const horn = add(head, new THREE.BoxGeometry(0.05, 0.42, 0.03), gold, sx * 0.13, 0.4, 0.2);
      horn.rotation.z = sx * -0.45;
    }
    add(head, new THREE.SphereGeometry(0.05, 6, 4), gold, 0, 0.2, 0.28);
  } else if (o.hat === 'ninja') {
    const hood = M(o.cloth ?? 0x1b1b21);
    add(head, new THREE.SphereGeometry(0.295, 10, 8), hood, 0, 0.0, -0.01);
    add(head, new THREE.BoxGeometry(0.4, 0.07, 0.05), M(0xc99a72), 0, 0.03, 0.26);
    const tail = add(head, new THREE.BoxGeometry(0.06, 0.35, 0.03), M(o.scarf ?? 0x8a1010), 0.08, 0.0, -0.3);
    tail.rotation.x = 0.4;
  } else if (o.hat === 'onimask') {
    const red = M(0xb0201a), bone = M(0xeee3c8), hair = M(0xe8e8e8);
    add(head, new THREE.BoxGeometry(0.42, 0.42, 0.08), red, 0, 0, 0.25);
    for (const sx of [-1, 1]) {
      const horn = add(head, new THREE.ConeGeometry(0.05, 0.3, 5), bone, sx * 0.16, 0.32, 0.18);
      horn.rotation.z = sx * -0.3;
      add(head, new THREE.BoxGeometry(0.09, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd23a }), sx * 0.1, 0.05, 0.3);
    }
    add(head, new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 0.05, -0.05);
  } else if (o.hat === 'elder') {
    add(head, new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(0xdddddd), 0, 0.04, -0.03);
    add(head, new THREE.ConeGeometry(0.12, 0.35, 6), M(0xe8e8e8), 0, -0.3, 0.2).rotation.x = Math.PI;
  }
  if (o.scarf) {
    const s = add(body, new THREE.BoxGeometry(0.18, 0.6, 0.04), M(o.scarf), 0.15, 0.6, -0.24);
    s.rotation.x = 0.25;
  }

  const legL = new THREE.Group(); legL.position.set(-0.19, -0.15, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.19, -0.15, 0); body.add(legR);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.BoxGeometry(0.27, 0.78, 0.3), cloth2, 0, -0.39, 0);
    add(leg, new THREE.BoxGeometry(0.25, 0.1, 0.38), dark, 0, -0.8, 0.04);
  }
  const armL = new THREE.Group(); armL.position.set(-0.48, 0.8, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.48, 0.8, 0); body.add(armR);
  armR.rotation.order = 'YXZ';
  for (const arm of [armL, armR]) {
    add(arm, new THREE.BoxGeometry(0.2, 0.62, 0.22), cloth, 0, -0.3, 0);
    add(arm, new THREE.SphereGeometry(0.09, 6, 5), skin, 0, -0.66, 0);
  }

  const weapon = new THREE.Group(); weapon.position.y = -0.68; armR.add(weapon);
  if (o.weapon === 'katana') weapon.add(makeKatana(o.blade));
  else if (o.weapon === 'blade') weapon.add(makeShortBlade());
  else if (o.weapon === 'staff') weapon.add(makeStaff());

  root.scale.setScalar(o.scale ?? 1);
  return { root, body, head, legL, legR, armL, armR, weapon, mats, walk: 0 };
}

// Oni / demon king.
export function makeOni(o = {}) {
  const { mats, M, add } = builder();
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 1.0; root.add(body);

  const skin = M(o.skin ?? 0xb83a2a);
  const hair = M(o.hair ?? 0x1b1311);
  const tiger = M(0xd9a520);
  const bone = M(o.horn ?? 0xeee3c8);

  add(body, new THREE.BoxGeometry(1.15, 1.0, 0.72), skin, 0, 0.55, 0);
  add(body, new THREE.SphereGeometry(0.46, 10, 8), skin, 0, 0.3, 0.12).scale.set(1, 0.9, 0.8);
  add(body, new THREE.BoxGeometry(1.1, 0.42, 0.82), tiger, 0, -0.05, 0);
  const stripe = M(0x221a10);
  for (let i = -2; i <= 2; i++) add(body, new THREE.BoxGeometry(0.06, 0.44, 0.84), stripe, i * 0.22, -0.05, 0);

  const head = new THREE.Group(); head.position.set(0, 1.35, 0.05); body.add(head);
  add(head, new THREE.BoxGeometry(0.62, 0.58, 0.56), skin, 0, 0, 0);
  add(head, new THREE.BoxGeometry(0.68, 0.32, 0.5), hair, 0, 0.26, -0.1);
  add(head, new THREE.BoxGeometry(0.66, 0.5, 0.2), hair, 0, -0.05, -0.28);
  const eyeM = new THREE.MeshBasicMaterial({ color: o.eyes ?? 0xffe14a });
  add(head, new THREE.BoxGeometry(0.13, 0.07, 0.02), eyeM, -0.14, 0.06, 0.285);
  add(head, new THREE.BoxGeometry(0.13, 0.07, 0.02), eyeM, 0.14, 0.06, 0.285);
  const brow = add(head, new THREE.BoxGeometry(0.5, 0.07, 0.05), hair, 0, 0.14, 0.29);
  brow.rotation.x = 0.2;
  const fangM = M(0xffffff);
  for (const sx of [-1, 1]) {
    const f = add(head, new THREE.ConeGeometry(0.04, 0.13, 4), fangM, sx * 0.17, -0.17, 0.27);
    f.rotation.x = Math.PI * 0.95;
    const horn = add(head, new THREE.ConeGeometry(0.08, 0.42, 6), bone, sx * 0.21, 0.5, 0);
    horn.rotation.z = sx * -0.35;
  }
  if (o.single) { add(head, new THREE.ConeGeometry(0.1, 0.55, 6), bone, 0, 0.55, 0.05); }

  const legL = new THREE.Group(); legL.position.set(-0.3, -0.18, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.3, -0.18, 0); body.add(legR);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.BoxGeometry(0.38, 0.74, 0.42), skin, 0, -0.37, 0);
    add(leg, new THREE.BoxGeometry(0.4, 0.1, 0.5), hair, 0, -0.77, 0.05);
  }
  const armL = new THREE.Group(); armL.position.set(-0.74, 0.92, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.74, 0.92, 0); body.add(armR);
  armR.rotation.order = 'YXZ';
  for (const arm of [armL, armR]) {
    add(arm, new THREE.BoxGeometry(0.32, 0.78, 0.34), skin, 0, -0.36, 0);
    add(arm, new THREE.BoxGeometry(0.34, 0.12, 0.36), M(0xb8902f, { metalness: 0.6 }), 0, -0.62, 0);
    add(arm, new THREE.SphereGeometry(0.16, 7, 6), skin, 0, -0.8, 0);
  }
  const weapon = new THREE.Group(); weapon.position.y = -0.82; armR.add(weapon);
  weapon.add(makeClub(o.clubLen ?? 1));

  if (o.cape) {
    const cape = add(body, new THREE.BoxGeometry(1.2, 1.5, 0.06), M(o.cape), 0, 0.2, -0.42);
    cape.rotation.x = 0.12;
  }
  if (o.glow) {
    for (const m of mats) { m.emissive = new THREE.Color(o.glow); m.emissiveIntensity = 0.0; }
  }

  root.scale.setScalar(o.scale ?? 1);
  return { root, body, head, legL, legR, armL, armR, weapon, mats, walk: 0 };
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
export function smat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!sharedMats.has(key)) sharedMats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra }));
  return sharedMats.get(key);
}

function mesh(geo, mat, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function makeHouse(wall, roof, w = 5, d = 4) {
  const g = new THREE.Group();
  const wood = smat(0x3a2618);
  mesh(new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6), wood, 0, 0.2, 0, g);
  mesh(new THREE.BoxGeometry(w, 2.4, d), smat(wall), 0, 1.6, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.22, 2.5, 0.22), wood, sx * w / 2, 1.6, sz * d / 2, g);
  }
  mesh(new THREE.BoxGeometry(w + 0.05, 0.18, d + 0.05), wood, 0, 2.75, 0, g);
  mesh(new THREE.BoxGeometry(w + 0.05, 0.14, d + 0.05), wood, 0, 1.3, 0, g);
  // door + windows on the front (+z)
  mesh(new THREE.BoxGeometry(1.1, 1.8, 0.05), wood, 0, 1.3, d / 2 + 0.01, g, false);
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.9, 0.6, 0.05), smat(0xf6efd8, { emissive: 0x6a4a1a, emissiveIntensity: 0.25 }), sx * w * 0.3, 1.95, d / 2 + 0.01, g, false);
  const r = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.88, 1.9, 4), smat(roof), 0, 3.8, 0, g);
  r.rotation.y = Math.PI / 4;
  r.scale.set(w / Math.max(w, d) * 1.05, 1, d / Math.max(w, d) * 1.05);
  mesh(new THREE.BoxGeometry(0.25, 0.25, d * 0.9), smat(roof), 0, 4.75, 0, g);
  return g;
}

export function makeTorii(scale = 1, color = 0xc0392b) {
  const g = new THREE.Group();
  const red = smat(color), black = smat(0x1a1514);
  for (const sx of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.4, 10), red, sx * 2.6, 2.2, 0, g);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 10), black, sx * 2.6, 0.2, 0, g);
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
  const stone = smat(0x8a8780);
  mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 6), stone, 0, 0.15, 0, g);
  mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.0, 6), stone, 0, 0.8, 0, g);
  mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), lit ? smat(0xffc46a, { emissive: 0xff9a2a, emissiveIntensity: 1.2 }) : stone, 0, 1.55, 0, g);
  mesh(new THREE.ConeGeometry(0.6, 0.45, 4), stone, 0, 2.0, 0, g).rotation.y = Math.PI / 4;
  return g;
}

export function makeShopStall(clothColor = 0x24467a) {
  const g = new THREE.Group();
  const wood = smat(0x5b3b22), dark = smat(0x2e1d12);
  mesh(new THREE.BoxGeometry(4.2, 1.1, 1.2), wood, 0, 0.55, 0.8, g);
  mesh(new THREE.BoxGeometry(4.4, 0.1, 1.4), dark, 0, 1.15, 0.8, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(new THREE.BoxGeometry(0.18, 3.0, 0.18), dark, sx * 2.1, 1.5, sz * 1.3 + 0.2, g);
  const roof = mesh(new THREE.BoxGeometry(5.0, 0.18, 3.6), smat(0x6e2a1e), 0, 3.15, 0.2, g);
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
  const stone = smat(0x8a8780), wood = smat(0x3a2618), red = smat(0xb0301f);
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
