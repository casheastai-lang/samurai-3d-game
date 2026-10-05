import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  PATH, TOWN_IDX, TOWN_R, ARENA, BOUNDS, REGIONS, TOWNS, WEAPONS, ARMORS, CHARMS, SKINS,
  CONSUMABLES, ENEMIES, DEMON_TYPES, TIER_MIX, tierScale, xpNeeded,
  NINJA_BASES, NINJA_R, DEMON_BASES, DEMON_R,
} from './data.js';
import { makeHumanoid, makeEnemyModel, makeShuriken } from './models.js';
import { $, clamp, lerp, smooth, rand, randInt, angleLerp, wr, wrand } from './util.js';
import {
  buildWorld, updateSky, height, nearestSeg, townAt, townDist, arenaDist, ninjaDist, ninjaBaseAt,
  demonBaseAt, collideStatic, clampBounds, interactables, villagers, staticNPCs, segDist,
} from './world.js';
import {
  initFx, burst, updateParticles, spawnSlash, spawnRing, updateEffects, floatText, updateFloaters,
  updateTrail, spawnBolt, updateAmbient,
} from './fx.js';

// ============================================================ Renderer, scene, post-processing
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9e2f2, 70, 260);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
const hemi = new THREE.HemisphereLight(0xe2efff, 0x5a4a35, 1.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 3.0);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.5, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let gfxHigh = true;
try { gfxHigh = localStorage.getItem('roninsroad.gfx') !== 'low'; } catch { /* default high */ }
function applyGfx() {
  const pr = gfxHigh ? Math.min(window.devicePixelRatio, 2) : 1;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  const ms = gfxHigh ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== ms) {
    sun.shadow.mapSize.set(ms, ms);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
}
applyGfx();
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyGfx();
});

// Sky palettes for the road, the ashen north, and the demon realm.
const PAL = {
  day:   { top: new THREE.Color(0x4a88cc), hor: new THREE.Color(0xcfe4f0), sun: new THREE.Color(0xfff0d2), hemi: 1.7 },
  ash:   { top: new THREE.Color(0x3a1c18), hor: new THREE.Color(0x9a5a44), sun: new THREE.Color(0xff9a6a), hemi: 1.1 },
  realm: { top: new THREE.Color(0x120202), hor: new THREE.Color(0x6a1a0a), sun: new THREE.Color(0xff5a2a), hemi: 0.9 },
};
const skyTop = new THREE.Color(), skyHor = new THREE.Color(), sunCol = new THREE.Color();

buildWorld(scene);
initFx(scene, camera, height);

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
  rig.armL.rotation.z = lerp(rig.armL.rotation.z, 0, k);
  rig.body.rotation.x = lerp(rig.body.rotation.x, 0, k);
  rig.body.rotation.y = lerp(rig.body.rotation.y, 0, k);
}
function poseAttack(rig, anim, t, A) {
  const s = smooth(A.hitAt - 0.09, A.hitAt + 0.05, t);
  const arm = rig.armR, body = rig.body;
  if (anim === 'slashA') { arm.rotation.set(-1.45, lerp(1.4, -1.5, s), 0); body.rotation.y = lerp(0.45, -0.5, s); }
  else if (anim === 'slashB') { arm.rotation.set(-1.45, lerp(-1.5, 1.4, s), 0); body.rotation.y = lerp(-0.5, 0.45, s); }
  else if (anim === 'spin') { arm.rotation.set(-1.5, -1.2, 0); body.rotation.y = lerp(0, -Math.PI * 2, s); }
  else { arm.rotation.set(lerp(-3.0, -0.5, s), 0, 0); body.rotation.x = lerp(-0.18, 0.25, s); }
  const r = smooth(A.hitAt + 0.1, A.dur, t);
  if (r > 0) {
    arm.rotation.x = lerp(arm.rotation.x, REST_ARM, r);
    arm.rotation.y = lerp(arm.rotation.y, 0, r);
    body.rotation.x = lerp(body.rotation.x, 0, r);
    body.rotation.y = lerp(body.rotation.y, 0, r);
  }
}
function poseBlock(rig, k) {
  rig.armR.rotation.x = lerp(rig.armR.rotation.x, -1.55, k);
  rig.armR.rotation.y = lerp(rig.armR.rotation.y, -1.15, k);
  rig.armR.rotation.z = lerp(rig.armR.rotation.z, 0.5, k);
  rig.armL.rotation.x = lerp(rig.armL.rotation.x, -1.3, k);
  rig.body.rotation.x = lerp(rig.body.rotation.x, 0.08, k);
}

// ============================================================ Player
const COMBO = [
  { anim: 'slashA', dur: 0.42, hitAt: 0.13, mult: 1.0, range: 2.9, dot: 0.1, cost: 8, lunge: 3, arc: 'h' },
  { anim: 'slashB', dur: 0.42, hitAt: 0.13, mult: 1.1, range: 2.9, dot: 0.1, cost: 8, lunge: 3, arc: 'h' },
  { anim: 'chop', dur: 0.6, hitAt: 0.24, mult: 1.7, range: 3.2, dot: 0.3, cost: 10, lunge: 5, arc: 'v', finisher: true },
];
const HEAVY = { anim: 'heavy', dur: 0.85, hitAt: 0.45, mult: 2.4, range: 3.9, dot: -0.25, cost: 26, lunge: 6, arc: 'wide', heavy: true };
const SPIRIT = { anim: 'spin', dur: 0.62, hitAt: 0.26, mult: 3.6, range: 6.5, dot: -2, cost: 0, lunge: 0, arc: 'wide', heavy: true, spirit: true };
const DODGE_TIME = 0.45;
const PARRY_WINDOW = 0.25;

const P = {
  pos: new THREE.Vector3(), y: 0, vy: 0, grounded: true, facing: Math.PI, kb: new THREE.Vector3(),
  hp: 100, st: 100, ki: 0, lvl: 1, xp: 0, gold: 0, potions: 2, elixirs: 0,
  weapon: 'worn', ownedWeapons: ['worn'], armor: 'cloth', charms: [], skin: 'ronin', ownedSkins: ['ronin'],
  discovered: [0], lastTown: 0, bossDead: false, kills: 0, mastersDead: [], warlordsDead: [], chestsLooted: [],
  state: 'idle', stateT: 0, atk: null, combo: 0, queued: false, hitDone: false,
  invul: 0, hitInvul: 0, stDelay: 0, dead: false, dodgeDir: new THREE.Vector3(),
  blocking: false, blockPressT: -10, comboCount: 0, comboTimer: 0, lock: null,
};
const hasCharm = c => P.charms.includes(c);
const W = () => WEAPONS[P.weapon];
const maxHp = () => 100 + (P.lvl - 1) * 12 + (hasCharm('vitality') ? 50 : 0);
const maxSt = () => 100 + (hasCharm('stamina') ? 40 : 0);
const atkPower = () => 6 + (P.lvl - 1) * 2 + W().atk;
const defense = () => ARMORS[P.armor].def;

const ARMOR_COLORS = { cloth: null, leather: 0x5a2e1c, iron: 0x4d535c, oyoroi: 0x8e1b1b, dragon: 0x1f6a5a };
let rig = null;
function rebuildPlayerRig() {
  if (rig) scene.remove(rig.root);
  const w = W(), sk = SKINS[P.skin];
  rig = makeHumanoid({
    cloth: sk.cloth, cloth2: sk.cloth2, hat: sk.hat, scarf: sk.scarf, weapon: 'katana',
    armor: sk.armor ?? ARMOR_COLORS[P.armor],
    blade: { color: w.color, glow: w.glow, len: w.len ?? 1, style: w.style },
  });
  rig.armR.rotation.x = REST_ARM;
  rig.root.position.set(P.pos.x, P.y, P.pos.z);
  rig.root.rotation.y = P.facing;
  scene.add(rig.root);
}
const slashColor = () => {
  const w = W();
  if (w.glow) return new THREE.Color(w.glow).lerp(new THREE.Color(0xffffff), 0.35).getHex();
  return 0xfff4e0;
};

// ============================================================ Input
const keys = {};
let camYaw = 0, camPitch = 0.38, camDist = 9;
let lockFailed = false;
let ui = 'title';
let started = false;
let time = 0;
let shakeAmt = 0, hitstop = 0, hurtFlash = 0, slowmo = 0;
const shake = a => { shakeAmt = Math.max(shakeAmt, a); };

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
    else if (['shop', 'shrine', 'dialog', 'help', 'inventory', 'victory'].includes(ui)) closeModal();
    return;
  }
  if (ui === 'map' && e.code === 'KeyM') { toggleMap(); return; }
  if (ui === 'help' && e.code === 'KeyH') { closeModal(); return; }
  if (ui === 'inventory' && e.code === 'KeyI') { closeModal(); return; }
  if (['shop', 'shrine', 'dialog'].includes(ui)) {
    if (e.code === 'KeyE') closeModal();
    return;
  }
  if (e.code === 'KeyG' && ui !== 'title') { toggleGfx(); return; }
  if (ui || !started || P.dead) return;
  switch (e.code) {
    case 'KeyE': interact(); break;
    case 'Digit1': drink('potion'); break;
    case 'Digit2': case 'KeyR': drink('elixir'); break;
    case 'KeyQ': P.blockPressT = time; break;
    case 'KeyX': trySpirit(); break;
    case 'Tab': toggleLock(); break;
    case 'KeyM': toggleMap(); break;
    case 'KeyH': showHelp(); break;
    case 'KeyI': openInventory(); break;
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

function toggleGfx() {
  gfxHigh = !gfxHigh;
  try { localStorage.setItem('roninsroad.gfx', gfxHigh ? 'high' : 'low'); } catch { /* ignore */ }
  applyGfx();
  banner('', gfxHigh ? 'Graphics: High (glow, sharp shadows)' : 'Graphics: Fast (no glow, lower resolution)', 1.6);
}

// ============================================================ Player actions
const headPos = () => new THREE.Vector3(P.pos.x, P.y + 2.5, P.pos.z);
const distTo = e => Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);

function nearestEnemy(range) {
  let best = null, bd = range;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = distTo(e) - e.def.radius;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function toggleLock() {
  if (P.lock) { P.lock = null; return; }
  // Prefer the enemy closest to where the camera looks.
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  let best = null, bs = -Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = distTo(e);
    if (d > 28) continue;
    const dot = ((e.pos.x - P.pos.x) * fx + (e.pos.z - P.pos.z) * fz) / (d || 1);
    const score = dot * 2 - d / 14;
    if (score > bs) { bs = score; best = e; }
  }
  P.lock = best;
  if (!best) banner('', 'No enemy nearby to lock on to', 1);
}

function faceTarget() {
  const t = (P.lock && P.lock.alive) ? P.lock : nearestEnemy(5.5);
  const dir = inputDir();
  if (t) P.facing = Math.atan2(t.pos.x - P.pos.x, t.pos.z - P.pos.z);
  else if (dir.len > 0) P.facing = Math.atan2(dir.x, dir.z);
}

function tryAttack(heavy) {
  if (P.dead || ['dodge', 'stunned', 'spirit'].includes(P.state)) return;
  if (P.state === 'attack') {
    if (!heavy && !P.atk.heavy && P.stateT > P.atk.hitAt * 0.5) P.queued = true;
    return;
  }
  startAttack(heavy ? HEAVY : COMBO[0], 0);
}
function startAttack(base, combo) {
  if (P.st < base.cost * 0.5) { floatText(headPos(), 'Exhausted', 'hurt', 0.7); P.state = 'idle'; return; }
  const sp = W().speed ?? 1;
  const A = { ...base, dur: base.dur / sp, hitAt: base.hitAt / sp, range: base.range + (W().reach ?? 0) };
  P.st = Math.max(0, P.st - A.cost);
  P.stDelay = 0.9;
  P.state = 'attack'; P.atk = A; P.combo = combo; P.stateT = 0; P.hitDone = false; P.queued = false;
  P.blocking = false;
  faceTarget();
  if (A.heavy) spawnSlash(A.arc, slashColor(), A.hitAt - 0.06, playerFollow, 0.24, (A.range / 3.9));
  // Ninjas read your attack and may leap away.
  for (const e of enemies) {
    if (!e.alive || !e.def.evade || e.evadeCd > 0 || ['windup', 'strike', 'throw'].includes(e.state)) continue;
    if (distTo(e) < A.range + 2 && Math.random() < e.def.evade) {
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
      e.kb.set(dx / d, 0, dz / d).multiplyScalar(13);
      e.evadeT = 0.4; e.evadeCd = 2.5;
      burst(e.pos.x, height(e.pos.x, e.pos.z) + 1, e.pos.z, 14, 0x777777, 2, 2, 0.6, 1);
    }
  }
}
const playerFollow = () => ({ x: P.pos.x, y: P.y, z: P.pos.z, facing: P.facing });

function trySpirit() {
  if (P.dead || ['dodge', 'stunned', 'spirit'].includes(P.state)) return;
  if (P.ki < 100) { banner('', 'Ki is not full yet. Land hits and parries to fill it.', 1.3); return; }
  P.ki = 0;
  faceTarget();
  const sp = W().speed ?? 1;
  P.atk = { ...SPIRIT, range: SPIRIT.range + (W().reach ?? 0), dur: SPIRIT.dur, hitAt: SPIRIT.hitAt * Math.min(1, 1 / sp) };
  P.state = 'spirit'; P.stateT = 0; P.hitDone = false; P.invul = 0.6; P.blocking = false;
  floatText(headPos(), 'SPIRIT SLASH', 'crit', 1.2);
  burst(P.pos.x, P.y + 1, P.pos.z, 40, slashColor(), 3, 3, 0.6, 2);
}

function tryJump() {
  if (['dodge', 'attack', 'stunned', 'spirit'].includes(P.state)) return;
  if (P.y - height(P.pos.x, P.pos.z) < 0.2) { P.vy = 9.5; P.grounded = false; }
}
function tryDodge() {
  if (['dodge', 'stunned', 'spirit'].includes(P.state) || P.st < 15) return;
  if (P.state === 'attack' && P.stateT < P.atk.hitAt) return;
  const d = inputDir();
  if (d.len > 0) P.dodgeDir.set(d.x, 0, d.z);
  else P.dodgeDir.set(-Math.sin(P.facing), 0, -Math.cos(P.facing));
  P.facing = Math.atan2(P.dodgeDir.x, P.dodgeDir.z);
  P.st -= 20; P.stDelay = 0.8;
  P.state = 'dodge'; P.stateT = 0; P.invul = 0.34; P.blocking = false;
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

function hitDamage(e, A) {
  const crit = e.parried || Math.random() < 0.12;
  let dmg = atkPower() * A.mult * rand(0.9, 1.1) * (crit ? 1.6 : 1);
  dmg *= 1 + Math.min(0.3, P.comboCount * 0.02);
  if (W().effect === 'demonbane' && DEMON_TYPES.has(e.type)) dmg *= 1.5;
  e.parried = false;
  return { dmg: Math.round(dmg), crit };
}
function doPlayerHit(A) {
  const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
  let hit = false;
  for (const e of enemies) {
    if (!e.alive || e.evadeT > 0) continue;
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > A.range + e.def.radius) continue;
    if (Math.abs(height(e.pos.x, e.pos.z) - P.y) > 3) continue;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < A.dot) continue;
    const { dmg, crit } = hitDamage(e, A);
    damageEnemy(e, dmg, crit, A, dx / (d || 1), dz / (d || 1));
    applyWeaponEffect(e, dmg);
    P.ki = Math.min(100, P.ki + (A.spirit ? 0 : 6));
    P.comboCount++;
    P.comboTimer = 2.5;
    hit = true;
  }
  // A well-timed swing knocks shurikens back at their thrower.
  for (const pr of projectiles) {
    if (!pr.hostile) continue;
    const dx = pr.pos.x - P.pos.x, dz = pr.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d < A.range + 0.8 && (dx * fx + dz * fz) / (d || 1) > -0.2) deflect(pr);
  }
  if (hit) { hitstop = A.heavy ? 0.09 : 0.05; shake(A.heavy ? 0.35 : 0.15); }
  if (A.spirit) {
    shake(0.7); hitstop = 0.12;
    burst(P.pos.x, P.y + 0.6, P.pos.z, 90, slashColor(), 12, 4, 0.8, 3);
    spawnRing(P.pos.x, P.pos.z, A.range, 0.3, slashColor());
  }
}
function applyWeaponEffect(e, dmg) {
  const fxType = W().effect;
  if (!fxType || !e.alive) return;
  const y = height(e.pos.x, e.pos.z) + e.def.scale * 1.4;
  if (fxType === 'burn') { e.burnT = 3; e.burnDmg = Math.max(2, Math.round(dmg * 0.12)); burst(e.pos.x, y, e.pos.z, 10, 0xff7a1a, 2, 4, 0.6, -2); }
  else if (fxType === 'frost') { e.slowT = 2.5; burst(e.pos.x, y, e.pos.z, 10, 0x9ad8ff, 2, 2, 0.7, 2); }
  else if (fxType === 'leech') { const heal = Math.max(1, Math.round(dmg * 0.1)); P.hp = Math.min(maxHp(), P.hp + heal); }
  else if (fxType === 'shock') {
    let chained = 0;
    for (const o of enemies) {
      if (o === e || !o.alive || chained >= 2) continue;
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > 7) continue;
      const a = new THREE.Vector3(e.pos.x, y, e.pos.z), b = new THREE.Vector3(o.pos.x, height(o.pos.x, o.pos.z) + o.def.scale * 1.4, o.pos.z);
      spawnBolt(a, b, W().glow || 0xfff6a0);
      damageEnemy(o, Math.round(dmg * 0.35), false, COMBO[0], 0, 0);
      chained++;
    }
  }
}

function damagePlayer(amount, src, opts = {}) {
  if (P.dead || P.invul > 0 || P.hitInvul > 0) return false;
  // Blocking: facing the attacker and not an unblockable move.
  if (P.blocking && !opts.unblockable && src) {
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    const dx = src.pos.x - P.pos.x, dz = src.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    if ((dx * fx + dz * fz) / d > 0.2) {
      if (time - P.blockPressT < PARRY_WINDOW) { parry(src); return false; }
      P.st -= amount * 1.3; P.stDelay = 0.8;
      burst(P.pos.x + fx, P.y + 1.4, P.pos.z + fz, 10, 0xffd890, 4, 2, 0.35, 6);
      shake(0.15);
      if (P.st <= 0) {
        P.st = 0; P.blocking = false; P.state = 'stunned'; P.stateT = 0;
        floatText(headPos(), 'Guard broken!', 'hurt');
        amount *= 0.6;
      } else {
        const chip = Math.max(0, Math.round(amount * 0.12 - defense() * 0.3));
        P.hp -= chip;
        P.hitInvul = 0.2;
        floatText(headPos(), chip ? 'Blocked -' + chip : 'Blocked', 'dmg', 0.7);
        if (P.hp <= 0) { P.hp = 0; playerDie(); }
        return true;
      }
    }
  }
  const dmg = Math.max(1, Math.round(amount * rand(0.9, 1.1) - defense()));
  P.hp -= dmg;
  P.hitInvul = 0.5;
  P.comboCount = 0;
  P.ki = Math.min(100, P.ki + 3);
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
function parry(src) {
  P.ki = Math.min(100, P.ki + 30);
  hitstop = 0.14; slowmo = 0.45;
  shake(0.25);
  const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
  burst(P.pos.x + fx * 1.2, P.y + 1.5, P.pos.z + fz * 1.2, 40, 0xffe080, 7, 4, 0.5, 8);
  floatText(headPos(), 'PARRY!', 'crit', 1);
  src.state = 'hurt';
  src.t = src === boss ? -0.2 : -0.9;
  src.glow = 0;
  src.parried = true;
  src.kb.set(fx, 0, fz).multiplyScalar(6 / src.def.scale);
}

function playerDie() {
  P.dead = true; P.state = 'dead'; P.stateT = 0; P.lock = null; P.blocking = false;
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
  P.dead = false; P.state = 'idle'; P.hp = maxHp(); P.st = maxSt(); P.kb.set(0, 0, 0); P.ki = 0;
  rig.body.rotation.set(0, 0, 0);
  for (const e of enemies) if (e.alive && e.state !== 'idle') e.state = 'return';
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

const _base = new THREE.Vector3(), _tip = new THREE.Vector3();
function updatePlayer(dt) {
  P.stateT += dt;
  P.invul = Math.max(0, P.invul - dt);
  P.hitInvul = Math.max(0, P.hitInvul - dt);
  P.stDelay -= dt;
  P.comboTimer -= dt;
  if (P.comboTimer <= 0) P.comboCount = 0;
  if (P.stDelay <= 0 && !P.blocking) P.st = Math.min(maxSt(), P.st + 32 * dt);
  if (hasCharm('regen') && !P.dead) P.hp = Math.min(maxHp(), P.hp + 2 * dt);
  if (P.lock && (!P.lock.alive || distTo(P.lock) > 32)) P.lock = null;

  const ground = height(P.pos.x, P.pos.z);
  if (P.dead) {
    rig.body.rotation.x = lerp(rig.body.rotation.x, -1.45, 0.08);
    rig.body.position.y = lerp(rig.body.position.y, 0.35, 0.08);
    rig.root.position.set(P.pos.x, ground, P.pos.z);
    updateTrail(_base, _tip, false, slashColor());
    return;
  }

  const dir = inputDir();
  let speedFrac = 0;
  let swinging = false;
  P.blocking = !!keys.KeyQ && P.state === 'idle' && P.st > 0;

  if (P.state === 'dodge') {
    const p = P.stateT / DODGE_TIME;
    const sp = 15 * (1 - p * 0.75);
    P.pos.x += P.dodgeDir.x * sp * dt;
    P.pos.z += P.dodgeDir.z * sp * dt;
    rig.body.rotation.x = p * Math.PI * 2;
    rig.body.position.y = 1.0 - Math.sin(p * Math.PI) * 0.45;
    if (P.stateT >= DODGE_TIME) { P.state = 'idle'; rig.body.rotation.x = 0; }
  } else if (P.state === 'stunned') {
    rig.body.rotation.x = lerp(rig.body.rotation.x, -0.35, 0.2);
    if (Math.random() < 0.3) burst(P.pos.x, P.y + 2.6, P.pos.z, 1, 0xffe060, 1, 1, 0.4, 0);
    if (P.stateT > 0.9) P.state = 'idle';
  } else if (P.state === 'attack' || P.state === 'spirit') {
    const A = P.atk;
    if (P.state === 'spirit' && P.stateT < A.hitAt) {
      // Dash forward before the spinning cut.
      P.pos.x += Math.sin(P.facing) * 30 * dt;
      P.pos.z += Math.cos(P.facing) * 30 * dt;
      if (Math.random() < 0.8) burst(P.pos.x, P.y + 1, P.pos.z, 3, slashColor(), 1, 1, 0.5, 0);
    } else if (P.stateT < A.hitAt) {
      P.pos.x += Math.sin(P.facing) * A.lunge * dt;
      P.pos.z += Math.cos(P.facing) * A.lunge * dt;
    }
    if (!P.hitDone && P.stateT >= A.hitAt) {
      P.hitDone = true;
      doPlayerHit(A);
      if (A.spirit) spawnSlash('wide', slashColor(), 0, playerFollow, 0.35, 1.8);
    }
    poseAttack(rig, A.anim, P.stateT, A);
    swinging = P.stateT > A.hitAt - 0.12 && P.stateT < A.hitAt + 0.1;
    if (P.stateT >= A.dur) {
      if (P.state === 'attack' && P.queued && P.combo < 2) startAttack(COMBO[P.combo + 1], P.combo + 1);
      else { P.state = 'idle'; P.combo = 0; }
    }
  } else {
    const sprint = (keys.ShiftLeft || keys.ShiftRight) && P.st > 1 && dir.len > 0 && !P.blocking;
    const speed = dir.len > 0 ? (P.blocking ? 2.6 : sprint ? 10.5 : 6.5) : 0;
    if (sprint) { P.st -= 20 * dt; P.stDelay = 0.4; }
    P.pos.x += dir.x * speed * dt;
    P.pos.z += dir.z * speed * dt;
    const lockOn = P.lock && P.lock.alive;
    if (lockOn && (P.blocking || !sprint)) P.facing = angleLerp(P.facing, Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z), 1 - Math.exp(-12 * dt));
    else if (dir.len > 0 && !P.blocking) P.facing = angleLerp(P.facing, Math.atan2(dir.x, dir.z), 1 - Math.exp(-14 * dt));
    speedFrac = speed / 6.5;
    if (P.blocking) poseBlock(rig, 0.35);
    else restArm(rig);
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
  if (P.grounded && P.y < g + 0.6) P.y = g;

  rig.root.position.set(P.pos.x, P.y, P.pos.z);
  rig.root.rotation.y = P.facing;
  if (P.state !== 'dodge') animateWalk(rig, dt, P.grounded ? speedFrac : 0);
  if (!P.grounded && P.state === 'idle') { rig.legL.rotation.x = -0.5; rig.legR.rotation.x = 0.3; }
  rig.root.visible = !(P.hitInvul > 0.2 && Math.floor(P.hitInvul * 20) % 2 === 0);

  // Sword trail from the blade's base to its tip.
  rig.root.updateMatrixWorld(true);
  const blade = rig.weapon.children[0];
  _base.set(0, -0.3, 0); _tip.set(0, blade.userData.tipY ?? -1.5, 0);
  blade.localToWorld(_base); blade.localToWorld(_tip);
  updateTrail(_base, _tip, swinging, slashColor());
}

// ============================================================ Projectiles (shurikens)
const projectiles = [];
const _prev = new THREE.Vector3();
const shurikenProto = makeShuriken();
function throwShuriken(e, spread) {
  const sx = e.pos.x, sy = height(e.pos.x, e.pos.z) + 1.6 * e.def.scale, sz = e.pos.z;
  const dir = new THREE.Vector3(P.pos.x - sx, P.y + 1.3 - sy, P.pos.z - sz).normalize();
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
  const mesh = shurikenProto.clone();
  mesh.position.set(sx, sy, sz);
  scene.add(mesh);
  projectiles.push({ mesh, pos: mesh.position, vel: dir.multiplyScalar(22), life: 2.2, hostile: true, dmg: e.rangedDmg, owner: e });
}
function deflect(pr) {
  pr.hostile = false;
  pr.life = 2;
  const o = pr.owner;
  if (o && o.alive) pr.vel.copy(new THREE.Vector3(o.pos.x, height(o.pos.x, o.pos.z) + 1.4, o.pos.z).sub(pr.pos).normalize().multiplyScalar(30));
  else pr.vel.multiplyScalar(-1.3);
  burst(pr.pos.x, pr.pos.y, pr.pos.z, 12, 0xffe080, 4, 2, 0.35, 4);
  P.ki = Math.min(100, P.ki + 8);
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.life -= dt;
    _prev.copy(pr.pos);
    pr.pos.addScaledVector(pr.vel, dt);
    pr.mesh.rotation.y += 25 * dt;
    let remove = pr.life <= 0 || pr.pos.y < height(pr.pos.x, pr.pos.z);
    if (!remove && pr.hostile) {
      // Swept test so fast shurikens can't skip past the player between frames.
      const d = segDist(P.pos.x, P.pos.z, _prev.x, _prev.z, pr.pos.x, pr.pos.z);
      if (d < 0.75 && pr.pos.y > P.y && pr.pos.y < P.y + 2.3 && !P.dead) {
        const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
        const facingIt = (-pr.vel.x * fx - pr.vel.z * fz) / (Math.hypot(pr.vel.x, pr.vel.z) || 1) > 0.2;
        if (P.blocking && facingIt) {
          if (time - P.blockPressT < PARRY_WINDOW + 0.1) { deflect(pr); floatText(headPos(), 'Deflect!', 'crit', 0.8); continue; }
          P.st -= 8; P.stDelay = 0.6;
          burst(pr.pos.x, pr.pos.y, pr.pos.z, 8, 0xffd890, 3, 2, 0.3, 6);
          remove = true;
        } else if (P.invul <= 0) {
          damagePlayer(pr.dmg, null);
          remove = true;
        }
      }
    } else if (!remove) {
      for (const e of enemies) {
        if (!e.alive) continue;
        const ey = height(e.pos.x, e.pos.z);
        if (segDist(e.pos.x, e.pos.z, _prev.x, _prev.z, pr.pos.x, pr.pos.z) < e.def.radius + 0.5 && pr.pos.y > ey && pr.pos.y < ey + e.def.scale * 2.4) {
          damageEnemy(e, Math.round(atkPower() * 0.9), true, COMBO[2], pr.vel.x / 30, pr.vel.z / 30);
          remove = true;
          break;
        }
      }
    }
    if (remove) { scene.remove(pr.mesh); projectiles.splice(i, 1); }
  }
}

// ============================================================ Enemies
const enemies = [];
let boss = null;
const barGeoBg = new THREE.PlaneGeometry(1.3, 0.14);
const barGeoFg = new THREE.PlaneGeometry(1.3, 0.14).translate(0.65, 0, 0);
const barMatBg = new THREE.MeshBasicMaterial({ color: 0x1a0505, transparent: true, opacity: 0.75, depthTest: false });
const barMatFg = new THREE.MeshBasicMaterial({ color: 0xd8382a, depthTest: false });
const lockMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xff4030, depthTest: false }));
lockMarker.renderOrder = 1000;
scene.add(lockMarker);

function createEnemy(type, x, z, opts = {}) {
  const def = ENEMIES[type];
  const sc = tierScale(opts.tier ?? 0);
  const r = makeEnemyModel(type, def.scale);
  r.root.position.set(x, height(x, z), z);
  r.root.rotation.y = opts.facing ?? 0;
  scene.add(r.root);
  const e = {
    type, def, rig: r, pos: new THREE.Vector3(x, 0, z), home: new THREE.Vector3(x, 0, z),
    maxHp: Math.round(def.hp * sc.hp), dmg: def.dmg * sc.dmg, rangedDmg: (def.ranged?.dmg ?? 0) * sc.dmg,
    xp: Math.round(def.xp * sc.reward), goldMul: sc.reward,
    alive: true, state: 'idle', t: 0, cd: 0, facing: opts.facing ?? Math.random() * Math.PI * 2,
    flash: 0, glow: 0, kb: new THREE.Vector3(), wanderT: rand(0, 4), target: null, deadT: 0,
    summoned: !!opts.summoned, role: opts.role ?? null, base: opts.base ?? null, title: opts.title ?? def.name,
    phase: 1, struck: false, bar: null, moveFrac: 0, chargeDir: new THREE.Vector3(), slamR: 7,
    slowT: 0, burnT: 0, burnDmg: 0, burnTick: 0, evadeT: 0, evadeCd: 0, rangedCd: rand(0.5, 2), parried: false,
  };
  e.hp = e.maxHp;
  if (!e.role) {
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

function pickType(mix) {
  let pick = wrand(), type = mix[0][0];
  for (const [t, p] of mix) { if (pick < p) { type = t; break; } pick -= p; }
  return type;
}
function spawnWorldEnemies() {
  for (let tier = 0; tier < 4; tier++) {
    const a = TOWN_IDX[tier], b = tier < 3 ? TOWN_IDX[tier + 1] : PATH.length - 1;
    let groups = 0, tries = 0;
    while (groups < 12 && tries++ < 400) {
      const k = a + Math.floor(wrand() * (b - a));
      const u = wrand();
      const [ax, az] = PATH[k], [bx, bz] = PATH[k + 1];
      let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const side = wrand() < 0.5 ? -1 : 1, off = wr(5, 42);
      const cx = ax + (bx - ax) * u - dz * off * side, cz = az + (bz - az) * u + dx * off * side;
      if (townDist(cx, cz) < TOWN_R + 16 || arenaDist(cx, cz) < ARENA.r + 14 || ninjaDist(cx, cz) < NINJA_R + 18) continue;
      if (cx < BOUNDS.minX + 10 || cx > BOUNDS.maxX - 10) continue;
      const type = pickType(TIER_MIX[tier]);
      const size = type === 'captain' ? 1 : 2 + Math.floor(wrand() * 2);
      for (let s = 0; s < size; s++) createEnemy(s > 0 && type === 'captain' ? 'oni' : type, cx + wr(-4, 4), cz + wr(-4, 4));
      groups++;
    }
  }
  // Ninja bases: a squad of ninjas and their master.
  NINJA_BASES.forEach((nb, i) => {
    for (let k = 0; k < 4 + i; k++) {
      const [x, z] = nb.spots[k % nb.spots.length];
      createEnemy('ninja', x + wr(-1, 1), z + wr(-1, 1), { tier: i });
    }
    nb.masterEnemy = createEnemy('ninjaMaster', nb.masterSpot[0], nb.masterSpot[1], { tier: i, role: 'master', base: nb, title: nb.master, facing: nb.gateDir });
  });
  // Demon fortresses: one tier tougher than the region whose portal leads there.
  DEMON_BASES.forEach((db, i) => {
    const mix = TIER_MIX[Math.min(3, i + 1)];
    db.spots.forEach(([x, z]) => createEnemy(pickType(mix), x, z, { tier: i }));
    db.warlordEnemy = createEnemy('warlord', db.warlordSpot[0], db.warlordSpot[1], { tier: i, role: 'warlord', base: db, title: db.warlord, facing: 0 });
  });
  boss = createEnemy('boss', ARENA.x, ARENA.z - 10, { facing: 0, role: 'boss' });
}

function damageEnemy(e, dmg, crit, A, nx, nz) {
  if (!e.alive) return;
  e.hp -= dmg;
  e.flash = 0.12;
  const top = e.def.scale * 2.4 + 0.3;
  floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + top, e.pos.z), String(dmg), crit ? 'crit' : 'dmg', 0.9);
  burst(e.pos.x, height(e.pos.x, e.pos.z) + e.def.scale * 1.4, e.pos.z, crit ? 22 : 12, DEMON_TYPES.has(e.type) ? 0xb04aff : 0xff3020, 5, 4, 0.55);
  if (e.state === 'idle' || e.state === 'return') e.state = 'chase';
  const p = e.def.poise;
  const stagger = A.spirit || p === 0 || (p === 1 && (A.heavy || A.finisher)) || (p === 2 && A.heavy);
  e.kb.set(nx, 0, nz).multiplyScalar(stagger ? (A.heavy ? 10 : 6) / e.def.scale : 1);
  if (e.hp <= 0) { killEnemy(e); return; }
  if (stagger && e !== boss) { e.state = 'hurt'; e.t = 0; e.glow = 0; }
  if (e === boss && e.phase === 1 && e.hp < e.maxHp * 0.5) enrageBoss(e);
}

function killEnemy(e) {
  e.alive = false; e.deadT = 0; e.state = 'dead'; e.hp = 0;
  e.burnT = 0; e.slowT = 0;
  if (e.bar) e.bar.visible = false;
  if (P.lock === e) P.lock = null;
  const [g0, g1] = e.def.gold;
  const gold = Math.round(randInt(g0, g1) * e.goldMul);
  P.gold += gold; P.kills++;
  const y = height(e.pos.x, e.pos.z) + e.def.scale * 2;
  floatText(new THREE.Vector3(e.pos.x, y + 0.6, e.pos.z), '+' + gold + ' gold', 'gold', 1.3);
  floatText(new THREE.Vector3(e.pos.x, y, e.pos.z), '+' + e.xp + ' xp', 'xp', 1.3);
  burst(e.pos.x, y - e.def.scale, e.pos.z, 40, DEMON_TYPES.has(e.type) ? 0x9a3aff : 0xffb347, 4, 6, 1.1, 3);
  gainXP(e.xp);
  if (e === boss) victory();
  else if (e.role === 'master') {
    const i = NINJA_BASES.indexOf(e.base);
    if (!P.mastersDead.includes(i)) P.mastersDead.push(i);
    e.base.portal.setOpen(true);
    banner('The seal is broken', `The portal in ${e.base.name} now leads to the ${DEMON_BASES[i].name}`, 3.5);
    shake(0.4);
    save();
  } else if (e.role === 'warlord') {
    const i = DEMON_BASES.indexOf(e.base);
    if (!P.warlordsDead.includes(i)) P.warlordsDead.push(i);
    banner('Warlord slain', 'Claim the treasure chest before the keep', 3.5);
    save();
  }
}

function respawnEnemy(e) {
  e.alive = true; e.hp = e.maxHp; e.state = 'idle'; e.deadT = 0; e.t = 0; e.cd = 0;
  e.pos.copy(e.home); e.kb.set(0, 0, 0); e.phase = 1;
  e.rig.root.visible = true;
  e.rig.body.rotation.set(0, 0, 0);
  e.rig.body.position.y = 1.0;
  e.rig.root.position.set(e.pos.x, height(e.pos.x, e.pos.z), e.pos.z);
}
function markDead(e) {
  e.alive = false; e.deadT = 999; e.state = 'dead'; e.rig.root.visible = false;
  if (e.bar) e.bar.visible = false;
}

function enrageBoss(e) {
  e.phase = 2;
  banner('The Demon King is enraged!', 'His lesser oni answer the call', 2.5);
  shake(0.6);
  burst(e.pos.x, height(e.pos.x, e.pos.z) + 5, e.pos.z, 80, 0xff3a10, 8, 8, 1.4, 6);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const m = createEnemy('oni', ARENA.x + Math.cos(a) * 14, ARENA.z + Math.sin(a) * 14, { summoned: true, tier: 2 });
    m.state = 'chase';
    burst(m.pos.x, 1, m.pos.z, 30, 0x9a3aff, 3, 6, 1, 3);
  }
}

const _glow = new THREE.Color();
function setEmissive(e) {
  const f = Math.max(0, e.flash) / 0.12;
  const g = e.glow;
  const frost = e.slowT > 0 ? 0.35 : 0, burn = e.burnT > 0 ? 0.25 + 0.15 * Math.sin(time * 20) : 0;
  _glow.setRGB(f + g * 0.9 + burn, f + g * 0.08 + frost * 0.6 + burn * 0.3, f + g * 0.02 + frost);
  for (const m of e.rig.mats) {
    if (!m.emissive) continue;
    m.emissive.copy(_glow);
    m.emissiveIntensity = 1;
  }
}

function specialMove(e, dist) {
  const r = Math.random();
  if (e === boss && dist > 13 && r < 0.55) { e.state = 'chargeWind'; e.t = 0; return true; }
  const slamR = e === boss ? 9 : 7;
  if (dist < slamR + 2 && r < (e.phase === 2 ? 0.5 : 0.3)) {
    e.state = 'slamWind'; e.t = 0;
    e.slamR = slamR;
    spawnRing(e.pos.x, e.pos.z, slamR, e.phase === 2 ? 0.8 : 1.05);
    return true;
  }
  return false;
}

const activeList = [];
let engaged = null;
function updateEnemies(dt, playerSafe) {
  activeList.length = 0;
  engaged = null;
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
      else if (!e.role && !e.summoned && e.deadT > 75 && dist > 80) respawnEnemy(e);
      continue;
    }
    e.rig.root.visible = dist < 170;
    if (dist > 120 && e.state === 'idle') { if (e.bar) e.bar.visible = false; continue; }
    activeList.push(e);
    if (e.role && !['idle', 'return'].includes(e.state)) engaged = e;

    e.t += dt; e.cd -= dt; e.flash -= dt; e.rangedCd -= dt;
    e.evadeT -= dt; e.evadeCd -= dt; e.slowT -= dt;
    if (e.burnT > 0) {
      e.burnT -= dt; e.burnTick -= dt;
      if (Math.random() < 0.4) burst(e.pos.x, height(e.pos.x, e.pos.z) + d.scale * 1.2, e.pos.z, 1, 0xff7a1a, 1, 2, 0.6, -2);
      if (e.burnTick <= 0) {
        e.burnTick = 0.5;
        e.hp -= e.burnDmg;
        floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + d.scale * 2.4, e.pos.z), String(e.burnDmg), 'burn', 0.6);
        if (e.hp <= 0) { killEnemy(e); continue; }
      }
    }
    const slow = e.slowT > 0 ? 0.5 : 1;
    const sp = d.speed * (e.phase === 2 ? 1.3 : 1) * slow;
    const wind = d.windup * (e.phase === 2 ? 0.75 : 1) / slow;
    let moveSpeed = 0, mvx = 0, mvz = 0;
    const toPlayer = Math.atan2(dx, dz);
    const turnTo = (ang, k) => { e.facing = angleLerp(e.facing, ang, 1 - Math.exp(-k * dt)); };
    const homeDist = Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z);
    const leash = e === boss ? 55 : e.role ? 45 : 75;
    const special = e === boss || e.role === 'warlord';

    switch (e.state) {
      case 'idle': {
        e.glow = 0;
        e.wanderT -= dt;
        if (e.wanderT <= 0) {
          e.target = e.role ? null : { x: e.home.x + rand(-8, 8), z: e.home.z + rand(-8, 8) };
          e.wanderT = rand(3, 7);
        }
        if (e.target) {
          const tx = e.target.x - e.pos.x, tz = e.target.z - e.pos.z, tl = Math.hypot(tx, tz);
          if (tl < 0.6) e.target = null;
          else { mvx = tx / tl; mvz = tz / tl; moveSpeed = sp * 0.3; turnTo(Math.atan2(tx, tz), 4); }
        }
        if (!playerSafe && dist < d.aggro && Math.abs(P.y - height(e.pos.x, e.pos.z)) < 8) {
          e.state = 'chase';
          floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + d.scale * 2.4 + 0.6, e.pos.z), '!', 'alert', 0.8);
          if (e === boss) { banner('Shuten-doji', 'The Demon King rises to face you', 3); shake(0.5); }
          else if (e.role) banner(e.title, e.role === 'master' ? 'Master of ' + e.base.name : 'Lord of the ' + e.base.name, 2.5);
        }
        break;
      }
      case 'chase': {
        e.glow = 0;
        if (playerSafe || dist > d.aggro * 2.6 || homeDist > leash) { e.state = 'return'; break; }
        turnTo(toPlayer, 8);
        if (special && e.cd <= 0 && specialMove(e, dist)) break;
        if (d.ranged && e.rangedCd <= 0 && dist > d.ranged.min && dist < d.ranged.max) { e.state = 'throw'; e.t = 0; break; }
        if (dist < d.range + 0.3 && e.cd <= 0) { e.state = 'windup'; e.t = 0; }
        else if (dist > d.range * 0.75) {
          mvx = dx / dist; mvz = dz / dist; moveSpeed = sp;
          // Ninjas weave side to side as they close in.
          if (d.ranged) { const s = Math.sin(time * 3 + e.home.x); mvx += -dz / dist * s * 0.8; mvz += dx / dist * s * 0.8; }
        }
        break;
      }
      case 'throw': {
        turnTo(toPlayer, 10);
        if (e.t >= 0.32) {
          const fan = d.ranged.fan ?? 1;
          for (let k = 0; k < fan; k++) throwShuriken(e, fan > 1 ? (k - (fan - 1) / 2) * 0.22 : 0);
          e.rangedCd = d.ranged.cd * rand(0.8, 1.3);
          e.state = 'recover'; e.t = d.recover * 0.5;
        }
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
          if (dist < d.range + 0.9 && dot > 0.1 && Math.abs(P.y - height(P.pos.x, P.pos.z)) < 1.6) damagePlayer(e.dmg, e);
          if (special) shake(0.25);
        }
        if (e.t >= 0.28 && e.state === 'strike') { e.state = 'recover'; e.t = 0; }
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
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.25 * dt);
        if (tl < 1.5) { e.state = 'idle'; e.hp = e.maxHp; if (e === boss) e.phase = 1; }
        else { mvx = tx / tl; mvz = tz / tl; moveSpeed = sp; turnTo(Math.atan2(tx, tz), 6); }
        if (!playerSafe && dist < d.aggro * 0.6) e.state = 'chase';
        break;
      }
      case 'slamWind': {
        turnTo(toPlayer, 2);
        if (e.t >= (e.phase === 2 ? 0.8 : 1.05)) {
          e.state = 'recover'; e.t = -0.3;
          shake(0.8);
          burst(e.pos.x, height(e.pos.x, e.pos.z) + 0.5, e.pos.z, 90, 0xff6a2a, 12, 5, 0.9, 10);
          const airborne = P.y - height(P.pos.x, P.pos.z) > 0.7;
          if (dist < e.slamR + 0.3 && !airborne) damagePlayer(e.dmg * 1.35, e, { unblockable: true });
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
        if (!e.struck && dist < d.radius + 1.4) { e.struck = true; damagePlayer(e.dmg, e, { unblockable: true }); }
        if (Math.random() < 0.5) burst(e.pos.x, height(e.pos.x, e.pos.z) + 0.3, e.pos.z, 2, 0x8a6a4a, 2, 1, 0.5, 3);
        if (e.t >= 0.75 || arenaDist(e.pos.x, e.pos.z) > ARENA.r + 6) { e.state = 'recover'; e.t = 0; }
        break;
      }
    }

    e.pos.x += mvx * moveSpeed * dt;
    e.pos.z += mvz * moveSpeed * dt;
    e.pos.addScaledVector(e.kb, dt);
    e.kb.multiplyScalar(Math.exp(-8 * dt));

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
    } else if (e.state === 'throw') {
      arm.rotation.set(lerp(REST_ARM, -2.6, Math.min(1, e.t / 0.25)), 0.5, 0);
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
      const show = e.hp < e.maxHp && dist < 45;
      e.bar.visible = show;
      if (show) {
        e.bar.position.set(e.pos.x, gy + d.scale * 2.45 + 0.35, e.pos.z);
        e.bar.quaternion.copy(camera.quaternion);
        e.bar.fg.scale.x = Math.max(0.001, e.hp / e.maxHp);
      }
    }
  }

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

  const L = P.lock;
  lockMarker.visible = !!(L && L.alive);
  if (lockMarker.visible) {
    lockMarker.position.set(L.pos.x, height(L.pos.x, L.pos.z) + L.def.scale * 2.5 + 0.9 + Math.sin(time * 5) * 0.1, L.pos.z);
    lockMarker.rotation.y += dt * 3;
  }
}

// ============================================================ NPCs
function updateNPCs(dt) {
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

// ============================================================ Portals & chests
let portalCooldown = 0;
function updatePortals(dt) {
  portalCooldown -= dt;
  NINJA_BASES.forEach((nb, i) => {
    nb.portal.disc.rotation.z -= dt * 1.5;
    if (portalCooldown > 0 || ui) return;
    if (P.mastersDead.includes(i) && Math.hypot(P.pos.x - nb.portalPos.x, P.pos.z - nb.portalPos.z) < 1.8) {
      const db = DEMON_BASES[i];
      teleport(db.arrival.x, db.arrival.z, db.arrival.facing, db.name, 'Slay ' + db.warlord);
    }
  });
  DEMON_BASES.forEach((db, i) => {
    db.portal.disc.rotation.z -= dt * 1.5;
    const lid = db.chest.userData.lid;
    lid.rotation.x = lerp(lid.rotation.x, P.chestsLooted.includes(i) ? -1.9 : 0, 0.1);
    if (portalCooldown > 0 || ui) return;
    if (Math.hypot(P.pos.x - db.portalPos.x, P.pos.z - db.portalPos.z) < 1.8) {
      const nb = NINJA_BASES[i];
      teleport(nb.portalExit.x, nb.portalExit.z, nb.portalExit.facing, nb.name, 'Back on the Tokaido road');
    }
  });
}
function teleport(x, z, facingA, title, sub) {
  portalCooldown = 2;
  ui = 'travel';
  P.lock = null;
  const fade = $('fade');
  fade.style.opacity = '1';
  burst(P.pos.x, P.y + 1.5, P.pos.z, 60, 0xc080ff, 3, 4, 1, 0);
  setTimeout(() => {
    P.pos.set(x, 0, z);
    P.y = height(x, z); P.vy = 0; P.kb.set(0, 0, 0);
    P.facing = facingA; camYaw = facingA + Math.PI;
    for (const e of enemies) if (e.alive && e.state !== 'idle') { e.state = 'idle'; e.pos.copy(e.home); e.hp = e.maxHp; e.rig.root.position.set(e.pos.x, height(e.pos.x, e.pos.z), e.pos.z); }
    fade.style.opacity = '0';
    ui = null;
    banner(title, sub, 2.6);
    burst(x, P.y + 1.5, z, 60, 0xc080ff, 3, 4, 1, 0);
  }, 550);
}
function lootChest(i) {
  const db = DEMON_BASES[i];
  if (P.chestsLooted.includes(i)) return;
  if (!P.warlordsDead.includes(i)) { banner('', `The chest is sealed. Defeat ${db.warlord} first.`, 1.8); return; }
  P.chestsLooted.push(i);
  const gold = 300 * (i + 1);
  P.gold += gold;
  const w = WEAPONS[db.reward];
  if (!P.ownedWeapons.includes(db.reward)) P.ownedWeapons.push(db.reward);
  burst(db.chestPos.x, 1.5, db.chestPos.z - 1.4, 80, 0xffd860, 4, 7, 1.4, 4);
  banner(w.name, `+${gold} gold. Equip your new sword from the inventory (I).`, 4);
  save();
}

// ============================================================ UI: HUD, modal, map
const hud = {
  hpFill: $('hpFill'), hpText: $('hpText'), stFill: $('stFill'), kiFill: $('kiFill'), kiRow: $('kiRow'), xpFill: $('xpFill'),
  lvl: $('lvl'), gold: $('gold'), pots: $('pots'), elx: $('elx'), gear: $('gear'), locName: $('locName'), locSub: $('locSub'),
  prompt: $('prompt'), bossbar: $('bossbar'), bossFill: $('bossFill'), bossName: $('bossName'), lockHint: $('lockHint'),
  combo: $('combo'), comboN: $('comboN'),
};
function updateHUD() {
  const mh = maxHp();
  hud.hpFill.style.width = (P.hp / mh * 100) + '%';
  hud.hpText.textContent = Math.ceil(P.hp) + ' / ' + mh;
  hud.stFill.style.width = (P.st / maxSt() * 100) + '%';
  hud.kiFill.style.width = P.ki + '%';
  hud.kiRow.classList.toggle('full', P.ki >= 100);
  hud.xpFill.style.width = (P.xp / xpNeeded(P.lvl) * 100) + '%';
  hud.lvl.textContent = P.lvl;
  hud.gold.textContent = P.gold;
  hud.pots.textContent = P.potions;
  hud.elx.textContent = P.elixirs;
  hud.gear.textContent = `${W().name} (atk ${atkPower()}) · ${ARMORS[P.armor].name} (def ${defense()}) · Kills ${P.kills}`;
  const show = engaged && engaged.alive;
  hud.bossbar.classList.toggle('hidden', !show);
  if (show) { hud.bossName.textContent = engaged.title; hud.bossFill.style.width = (engaged.hp / engaged.maxHp * 100) + '%'; }
  hud.lockHint.style.display = (!lockFailed && document.pointerLockElement !== canvas && !ui) ? '' : 'none';
  hud.combo.style.opacity = P.comboCount >= 3 ? '1' : '0';
  hud.comboN.textContent = P.comboCount;
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
    case 'tab': shopTab = arg; openShop(shopTown); break;
    case 'equipW': equipWeapon(arg); break;
    case 'wear': wearSkin(arg); break;
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
    <kbd>Q (hold)</kbd><span>Block. Press just before a hit lands to <b>parry</b> and deflect shurikens</span>
    <kbd>X</kbd><span>Spirit Slash when your Ki bar is full</span>
    <kbd>Tab</kbd><span>Lock on to an enemy</span>
    <kbd>Space</kbd><span>Jump &mdash; leaps over ground slams</span>
    <kbd>F</kbd><span>Dodge roll (brief invulnerability)</span>
    <kbd>Shift</kbd><span>Sprint</span>
    <kbd>E</kbd><span>Talk, trade, pray at shrines, open chests</span>
    <kbd>1 / 2</kbd><span>Drink a healing potion / elixir</span>
    <kbd>I</kbd><span>Inventory: swap swords and outfits</span>
    <kbd>M / H / G</kbd><span>World map / this help / graphics quality</span>
  </div>`;

function showTitle() {
  const s = loadSave();
  openModal(`
    <div class="kanji">浪人の道</div>
    <h1>Ronin's Road</h1>
    <p class="sub center">A samurai's journey from town to town</p>
    <p>Demons have poured down from Oni Mountain. Walk the road north from <b>Sakura Village</b>
    to Kurogane Fort. Raid the <b>ninja bases</b> beside the road and defeat their masters to open
    <b>portals to demon fortresses</b>, where warlords guard legendary swords. Buy new blades and
    outfits in every town, then slay <b>Shuten-doji, the Demon King</b>.</p>
    ${CONTROLS_HTML}
    <div class="btns">
      ${s ? `<button data-act="continue">Continue (Lv ${s.lvl}, ${TOWNS[s.lastTown]?.name ?? ''})</button>` : ''}
      <button data-act="new" class="${s ? 'secondary' : ''}">New Journey</button>
    </div>`, 'title');
}
function showHelp() {
  openModal(`<h2>How to play</h2>${CONTROLS_HTML}
    <p class="sub">Towns are safe: demons will not follow you inside. Shrines restore health, save your progress and let you travel to any town you have found. Defeat a ninja master to open the portal in their base.</p>
    <div class="btns"><button data-act="close">Back to the road</button></div>`, 'help');
}

function nearInteract() {
  let best = null, bd = 3.4;
  for (const it of interactables) {
    const d = Math.hypot(it.x - P.pos.x, it.z - P.pos.z);
    if (d < bd) { bd = d; best = it; }
  }
  DEMON_BASES.forEach((db, i) => {
    const d = Math.hypot(db.chestPos.x - P.pos.x, db.chestPos.z - P.pos.z);
    if (d < bd && !P.chestsLooted.includes(i)) { bd = d; best = { kind: 'chest', index: i }; }
  });
  return best;
}
function interact() {
  const it = nearInteract();
  if (!it) return;
  if (it.kind === 'shop') openShop(it.town);
  else if (it.kind === 'shrine') openShrine(it.town);
  else if (it.kind === 'chest') lootChest(it.index);
  else openElder(it.town);
}

const EFFECT_NAMES = { burn: 'Burn', frost: 'Frost', shock: 'Shock', leech: 'Leech', demonbane: 'Demonbane' };
function weaponLine(w) {
  const bits = [`Attack ${w.atk}`];
  if (w.speed && w.speed !== 1) bits.push(w.speed > 1 ? 'Fast' : 'Slow');
  if (w.reach > 0) bits.push('Long reach');
  if (w.effect) bits.push(EFFECT_NAMES[w.effect]);
  return bits.join(' &middot; ');
}
function itemRow(name, desc, priceHtml, button) {
  return `<div class="item"><div class="meta"><div class="name">${name}</div><div class="desc">${desc}</div></div>${priceHtml}${button}</div>`;
}
const priceTag = p => `<div class="price">&#9672; ${p}</div>`;
const buyBtn = (id, price) => `<button data-act="buy|${id}" ${P.gold < price ? 'disabled' : ''}>${P.gold < price ? 'Need gold' : 'Buy'}</button>`;
const hex = c => '#' + c.toString(16).padStart(6, '0');

let shopTown = null, shopTab = 'swords';
function openShop(town) {
  shopTown = town;
  const tabs = [['swords', 'Swords'], ['armor', 'Armor & Charms'], ['skins', 'Outfits'], ['supplies', 'Supplies']];
  let rows = '';
  if (shopTab === 'swords') {
    rows = town.stock.filter(id => id.startsWith('w:')).map(id => {
      const key = id.slice(2), w = WEAPONS[key];
      const owned = P.ownedWeapons.includes(key);
      const btn = owned
        ? `<button class="secondary" data-act="equipW|${key}" ${P.weapon === key ? 'disabled' : ''}>${P.weapon === key ? 'Equipped' : 'Equip'}</button>`
        : buyBtn(id, w.price);
      const swatch = `<span class="swatch blade" style="background:linear-gradient(90deg,${hex(w.color)},${hex(w.glow || w.color)})"></span>`;
      return itemRow(swatch + w.name, `${weaponLine(w)}<br>${w.desc}`, owned ? '<div class="price">Owned</div>' : priceTag(w.price), btn);
    }).join('');
    rows += `<p class="sub">Your sword: <b>${W().name}</b> (${weaponLine(W())}). Swap anytime with I.</p>`;
  } else if (shopTab === 'armor') {
    rows = town.stock.filter(id => id.startsWith('a:') || id.startsWith('c:')).map(id => {
      const [kind, key] = id.split(':');
      if (kind === 'a') {
        const a = ARMORS[key], cur = ARMORS[P.armor];
        const blocked = P.armor === key ? 'Equipped' : cur.def >= a.def ? 'Weaker' : null;
        return itemRow(a.name, `Armor &middot; blocks ${a.def} damage per hit (yours: ${cur.def})`, priceTag(a.price),
          blocked ? `<button disabled>${blocked}</button>` : buyBtn(id, a.price));
      }
      const c = CHARMS[key];
      return itemRow(c.name, 'Charm &middot; ' + c.desc, priceTag(c.price), hasCharm(key) ? '<button disabled>Owned</button>' : buyBtn(id, c.price));
    }).join('');
  } else if (shopTab === 'skins') {
    rows = Object.entries(SKINS).map(([key, s]) => {
      const owned = P.ownedSkins.includes(key);
      const swatch = `<span class="swatch" style="background:linear-gradient(135deg,${hex(s.cloth)} 50%,${hex(s.armor ?? s.scarf)} 50%)"></span>`;
      const btn = owned
        ? `<button class="secondary" data-act="wear|${key}" ${P.skin === key ? 'disabled' : ''}>${P.skin === key ? 'Wearing' : 'Wear'}</button>`
        : buyBtn('s:' + key, s.price);
      return itemRow(swatch + s.name, s.desc, owned ? '<div class="price">Owned</div>' : priceTag(s.price), btn);
    }).join('');
  } else {
    rows = town.stock.filter(id => CONSUMABLES[id]).map(id => {
      const c = CONSUMABLES[id], have = id === 'potion' ? P.potions : P.elixirs;
      return itemRow(c.name, `${c.desc} &middot; carrying ${have}/9`, priceTag(c.price), have >= 9 ? '<button disabled>Full</button>' : buyBtn(id, c.price));
    }).join('');
  }
  const html = `<h2>${town.shopName}</h2><p class="sub">${town.merchant} &middot; ${town.name}</p>
    <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${shopTab === k ? 'on' : ''}" data-act="tab|${k}">${n}</button>`).join('')}</div>
    <div class="gold">Your purse: &#9672; <b>${P.gold}</b></div>
    <div class="items">${rows}</div>
    <div class="btns"><button class="secondary" data-act="close">Leave (E)</button></div>`;
  if (ui === 'shop') modalBox.innerHTML = html; else openModal(html, 'shop');
}
function priceOf(id) {
  if (CONSUMABLES[id]) return CONSUMABLES[id].price;
  const [kind, key] = id.split(':');
  return { w: WEAPONS, a: ARMORS, c: CHARMS, s: SKINS }[kind][key].price;
}
function buy(id) {
  const price = priceOf(id);
  if (P.gold < price) return;
  P.gold -= price;
  if (id === 'potion') P.potions++;
  else if (id === 'elixir') P.elixirs++;
  else {
    const [kind, key] = id.split(':');
    if (kind === 'w') { P.ownedWeapons.push(key); P.weapon = key; }
    else if (kind === 'a') P.armor = key;
    else if (kind === 's') { P.ownedSkins.push(key); P.skin = key; }
    else { P.charms.push(key); if (key === 'vitality') P.hp += 50; }
    rebuildPlayerRig();
  }
  save();
  openShop(shopTown);
}
function equipWeapon(key) {
  if (!P.ownedWeapons.includes(key)) return;
  P.weapon = key;
  rebuildPlayerRig();
  save();
  if (ui === 'shop') openShop(shopTown); else openInventory();
}
function wearSkin(key) {
  if (!P.ownedSkins.includes(key)) return;
  P.skin = key;
  rebuildPlayerRig();
  save();
  if (ui === 'shop') openShop(shopTown); else openInventory();
}
function openInventory() {
  const swords = P.ownedWeapons.map(key => {
    const w = WEAPONS[key];
    return itemRow(w.name, `${weaponLine(w)}<br>${w.desc}`, '',
      `<button class="secondary" data-act="equipW|${key}" ${P.weapon === key ? 'disabled' : ''}>${P.weapon === key ? 'Equipped' : 'Equip'}</button>`);
  }).join('');
  const skins = P.ownedSkins.map(key => {
    const s = SKINS[key];
    return itemRow(s.name, s.desc, '', `<button class="secondary" data-act="wear|${key}" ${P.skin === key ? 'disabled' : ''}>${P.skin === key ? 'Wearing' : 'Wear'}</button>`);
  }).join('');
  const charms = P.charms.length ? P.charms.map(c => CHARMS[c].name).join(', ') : 'none';
  const html = `<h2>Inventory</h2>
    <p class="sub">${ARMORS[P.armor].name} (def ${defense()}) &middot; Charms: ${charms} &middot; Potions ${P.potions} &middot; Elixirs ${P.elixirs}</p>
    <h3>Swords</h3><div class="items">${swords}</div>
    <h3>Outfits</h3><div class="items">${skins}</div>
    <div class="btns"><button class="secondary" data-act="close">Close (I)</button></div>`;
  if (ui === 'inventory') modalBox.innerHTML = html; else openModal(html, 'inventory');
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
    if (!e.alive && !e.role && !e.summoned && Math.hypot(e.home.x - P.pos.x, e.home.z - P.pos.z) > 50) respawnEnemy(e);
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
      <p class="center sub">Level ${P.lvl} &middot; ${P.kills} foes defeated &middot; &#9672; ${P.gold} gold &middot; ${P.ownedWeapons.length} swords</p>
      <div class="btns"><button data-act="close">Keep exploring</button></div>`, 'victory');
  }, 3000);
}

// Maps
const mini = $('minimap').getContext('2d');
const bigCanvas = $('bigmapCanvas'), big = bigCanvas.getContext('2d');
const CLAN_COLORS = ['#c0201a', '#3a8ad0', '#d0a020', '#9a3aff'];
function drawMap(ctx, Wd, H, cx, cz, scale, full) {
  ctx.save();
  ctx.clearRect(0, 0, Wd, H);
  if (!full) { ctx.beginPath(); ctx.arc(Wd / 2, H / 2, Wd / 2, 0, Math.PI * 2); ctx.clip(); }
  const realm = !full && demonBaseAt(P.pos.x, P.pos.z);
  ctx.fillStyle = realm ? '#3a0c06' : '#2b3a22'; ctx.fillRect(0, 0, Wd, H);
  const X = x => Wd / 2 + (x - cx) * scale, Z = z => H / 2 + (z - cz) * scale;
  ctx.font = `${full ? 15 : 10}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center';
  if (realm) {
    for (const db of DEMON_BASES) {
      ctx.fillStyle = '#2a2224';
      ctx.beginPath(); ctx.arc(X(db.x), Z(db.z), DEMON_R * scale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7affc8';
      ctx.beginPath(); ctx.arc(X(db.portalPos.x), Z(db.portalPos.z), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd860';
      ctx.fillRect(X(db.chestPos.x) - 3, Z(db.chestPos.z) - 3, 6, 6);
    }
  } else {
    ctx.fillStyle = 'rgba(70, 40, 35, 0.6)';
    ctx.fillRect(0, Z(-770), Wd, Math.max(0, Z(BOUNDS.minZ - 50) - Z(-770)));
    ctx.strokeStyle = '#c4a874'; ctx.lineWidth = full ? 4 : 3; ctx.lineJoin = 'round';
    ctx.beginPath();
    PATH.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    ctx.stroke();
    for (const t of TOWNS) {
      const known = P.discovered.includes(t.index);
      ctx.fillStyle = known ? 'rgba(232, 193, 90, 0.85)' : 'rgba(150, 150, 150, 0.6)';
      ctx.beginPath(); ctx.arc(X(t.x), Z(t.z), Math.max(5, TOWN_R * scale), 0, Math.PI * 2); ctx.fill();
      if (full || scale > 0.5) {
        ctx.fillStyle = '#fff';
        ctx.fillText(known ? t.name : '???', X(t.x), Z(t.z) - Math.max(8, TOWN_R * scale) - 4);
      }
    }
    NINJA_BASES.forEach((nb, i) => {
      const s = Math.max(6, NINJA_R * scale * 0.8);
      ctx.fillStyle = 'rgba(20,20,24,0.9)'; ctx.strokeStyle = CLAN_COLORS[i]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(nb.x), Z(nb.z) - s); ctx.lineTo(X(nb.x) + s, Z(nb.z)); ctx.lineTo(X(nb.x), Z(nb.z) + s); ctx.lineTo(X(nb.x) - s, Z(nb.z)); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (P.mastersDead.includes(i)) { ctx.fillStyle = '#c080ff'; ctx.beginPath(); ctx.arc(X(nb.x), Z(nb.z), 3, 0, Math.PI * 2); ctx.fill(); }
      if (full) { ctx.fillStyle = '#ddd'; ctx.fillText(nb.name, X(nb.x), Z(nb.z) - s - 5); }
    });
    ctx.fillStyle = P.bossDead ? 'rgba(120,120,120,0.8)' : 'rgba(220, 40, 30, 0.9)';
    ctx.beginPath(); ctx.arc(X(ARENA.x), Z(ARENA.z), Math.max(6, ARENA.r * scale), 0, Math.PI * 2); ctx.fill();
    if (full) { ctx.fillStyle = '#ffb3a8'; ctx.fillText('Oni Mountain Shrine', X(ARENA.x), Z(ARENA.z) - ARENA.r * scale - 6); }
  }
  if (!full) {
    for (const e of enemies) {
      if (!e.alive) continue;
      const x = X(e.pos.x), y = Z(e.pos.z);
      if (x < 0 || y < 0 || x > Wd || y > H) continue;
      const s = e.role ? 3 : 1.5;
      ctx.fillStyle = e.role ? '#ff2a10' : e.type === 'ninja' ? '#b0b0c0' : '#e65a4a';
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
    }
  }
  if (!full || !demonBaseAt(P.pos.x, P.pos.z)) {
    ctx.translate(X(P.pos.x), Z(P.pos.z));
    ctx.rotate(-P.facing);
    const s = full ? 1.6 : 1;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 8 * s); ctx.lineTo(-5 * s, -5 * s); ctx.lineTo(5 * s, -5 * s); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function toggleMap() {
  const el = $('bigmap');
  if (ui === 'map') { el.classList.add('hidden'); ui = null; return; }
  ui = 'map';
  if (document.pointerLockElement) document.exitPointerLock();
  el.classList.remove('hidden');
  const Wd = bigCanvas.width, H = bigCanvas.height;
  const scale = Math.min(Wd / (BOUNDS.maxX - BOUNDS.minX + 40), H / (BOUNDS.maxZ - BOUNDS.minZ + 40));
  drawMap(big, Wd, H, 0, (BOUNDS.minZ + BOUNDS.maxZ) / 2, scale, true);
}

// ============================================================ World state (location, sky, prompts)
let currentTown = null, arenaAnnounced = false, currentPlace = null;
const _center = new THREE.Vector3();
function updateWorldState(dt) {
  const t = townAt(P.pos.x, P.pos.z);
  const realm = demonBaseAt(P.pos.x, P.pos.z);
  const nb = realm ? null : ninjaBaseAt(P.pos.x, P.pos.z);
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
  if (nb !== currentPlace) {
    currentPlace = nb;
    if (nb) banner(nb.name, P.mastersDead.includes(NINJA_BASES.indexOf(nb)) ? 'The portal stands open' : 'Ninja base — ' + nb.master + ' guards a sealed portal', 2.5);
  }
  if (!arenaAnnounced && arenaDist(P.pos.x, P.pos.z) < ARENA.r + 12 && !P.bossDead) {
    arenaAnnounced = true;
    banner('Shrine of Oni Mountain', 'The Demon King awaits', 3);
  }
  if (realm) {
    const i = DEMON_BASES.indexOf(realm);
    hud.locName.textContent = realm.name;
    hud.locSub.textContent = P.warlordsDead.includes(i) ? (P.chestsLooted.includes(i) ? 'Conquered' : 'The treasure awaits') : 'Danger ' + '★'.repeat(Math.min(5, i + 2));
  } else if (t) { hud.locName.textContent = t.name; hud.locSub.textContent = 'Safe haven · shop · shrine'; }
  else if (nb) { const i = NINJA_BASES.indexOf(nb); hud.locName.textContent = nb.name; hud.locSub.textContent = 'Ninja base · Danger ' + '★'.repeat(i + 1); }
  else if (arenaDist(P.pos.x, P.pos.z) < ARENA.r + 30) { hud.locName.textContent = 'Shrine of Oni Mountain'; hud.locSub.textContent = P.bossDead ? 'Peaceful at last' : 'Danger ★★★★★'; }
  else {
    const seg = nearestSeg(P.pos.x, P.pos.z).index;
    let tier = 0;
    for (let k = 0; k < 4; k++) if (seg >= TOWN_IDX[k]) tier = k;
    hud.locName.textContent = REGIONS[tier].name;
    hud.locSub.textContent = 'Danger ' + '★'.repeat(REGIONS[tier].danger);
  }

  // Sky and light: blue road, ashen north, burning demon realm.
  const a = realm ? 0 : smooth(-720, -880, P.pos.z) * (P.bossDead ? 0.3 : 1);
  const base = realm ? PAL.realm : PAL.day;
  skyTop.copy(base.top).lerp(PAL.ash.top, a);
  skyHor.copy(base.hor).lerp(PAL.ash.hor, a);
  sunCol.copy(base.sun).lerp(PAL.ash.sun, a);
  scene.fog.color.copy(skyHor);
  scene.fog.near = realm ? 40 : 70;
  scene.fog.far = realm ? 170 : lerp(260, 180, a);
  sun.color.copy(sunCol);
  hemi.intensity = lerp(base.hemi, PAL.ash.hemi, a);
  hemi.groundColor.set(realm ? 0x8a2a10 : 0x5a4a35);
  updateSky(camera.position, dt, skyTop, skyHor, sunCol);
  const mode = realm || arenaDist(P.pos.x, P.pos.z) < 90 ? 'embers' : P.pos.z < -740 ? 'ash' : P.pos.z > -560 ? 'petals' : 'none';
  updateAmbient(dt, _center.set(P.pos.x, P.y, P.pos.z), mode, time);

  const it = P.dead ? null : nearInteract();
  if (it) {
    hud.prompt.style.display = 'block';
    const label = it.kind === 'shop' ? 'Trade at ' + it.town.shopName
      : it.kind === 'shrine' ? 'Pray at the shrine &mdash; rest, save &amp; travel'
      : it.kind === 'chest' ? (P.warlordsDead.includes(it.index) ? 'Open the treasure chest' : 'Sealed chest &mdash; defeat the warlord')
      : 'Talk to the elder';
    hud.prompt.innerHTML = '<b class="gold">[E]</b> ' + label;
  } else hud.prompt.style.display = 'none';
}

// ============================================================ Camera
function updateCamera(dt) {
  if (keys.Comma) camYaw += 2 * dt;
  if (keys.Period) camYaw -= 2 * dt;
  if (P.lock && P.lock.alive && !ui && started) {
    const want = Math.atan2(P.pos.x - P.lock.pos.x, P.pos.z - P.lock.pos.z);
    camYaw = angleLerp(camYaw, want, 1 - Math.exp(-5 * dt));
  }
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
const SAVE_KEY = 'roninsroad.save.v2', OLD_SAVE_KEY = 'roninsroad.save.v1';
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      lvl: P.lvl, xp: P.xp, gold: P.gold, potions: P.potions, elixirs: P.elixirs, weapon: P.weapon, armor: P.armor,
      charms: P.charms, discovered: P.discovered, lastTown: P.lastTown, bossDead: P.bossDead, kills: P.kills,
      ownedWeapons: P.ownedWeapons, skin: P.skin, ownedSkins: P.ownedSkins,
      mastersDead: P.mastersDead, warlordsDead: P.warlordsDead, chestsLooted: P.chestsLooted,
    }));
  } catch { /* storage unavailable: play on without saving */ }
}
function loadSave() {
  try {
    let s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s) s = JSON.parse(localStorage.getItem(OLD_SAVE_KEY));
    if (!s || !WEAPONS[s.weapon] || !ARMORS[s.armor] || !TOWNS[s.lastTown]) return null;
    s.ownedWeapons = [...new Set(['worn', s.weapon, ...(s.ownedWeapons ?? [])])].filter(k => WEAPONS[k]);
    s.ownedSkins = [...new Set(['ronin', ...(s.ownedSkins ?? [])])].filter(k => SKINS[k]);
    if (!SKINS[s.skin]) s.skin = 'ronin';
    return s;
  } catch { return null; }
}
function placeAtTown(i) {
  const t = TOWNS[i];
  P.pos.copy(t.spawn);
  P.y = height(P.pos.x, P.pos.z); P.vy = 0;
  P.facing = t.spawnFacing;
  camYaw = P.facing + Math.PI;
  currentTown = t;
}
function startGame(s) {
  Object.assign(P, {
    lvl: 1, xp: 0, gold: 0, potions: 2, elixirs: 0, weapon: 'worn', armor: 'cloth', charms: [],
    discovered: [0], lastTown: 0, bossDead: false, kills: 0, ownedWeapons: ['worn'], skin: 'ronin', ownedSkins: ['ronin'],
    mastersDead: [], warlordsDead: [], chestsLooted: [],
  }, s ?? {});
  for (const k of ['charms', 'discovered', 'ownedWeapons', 'ownedSkins', 'mastersDead', 'warlordsDead', 'chestsLooted']) P[k] = [...P[k]];
  P.dead = false; P.state = 'idle'; P.hp = maxHp(); P.st = maxSt(); P.ki = 0;
  if (P.bossDead && boss.alive) markDead(boss);
  NINJA_BASES.forEach((nb, i) => {
    const open = P.mastersDead.includes(i);
    nb.portal.setOpen(open);
    if (open && nb.masterEnemy.alive) markDead(nb.masterEnemy);
  });
  DEMON_BASES.forEach((db, i) => { if (P.warlordsDead.includes(i) && db.warlordEnemy.alive) markDead(db.warlordEnemy); });
  placeAtTown(P.lastTown);
  rebuildPlayerRig();
  closeModal();
  $('hud').classList.remove('hidden');
  started = true;
  banner(TOWNS[P.lastTown].name, s ? 'Your journey continues' : 'Talk to the elder, then head north', 3);
  save();
}

// ============================================================ Boot
spawnWorldEnemies();
rebuildPlayerRig();
placeAtTown(0);
window.__game = {
  renderer, P, enemies, TOWNS, interactables, NINJA_BASES, DEMON_BASES, projectiles,
  get boss() { return boss; }, get ui() { return ui; }, get gfxHigh() { return gfxHigh; },
};

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, clock.getDelta());
  if (started && !ui) {
    if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
    else if (slowmo > 0) { slowmo -= dt; dt *= 0.35; }
    time += dt;
    const playerSafe = P.dead || !!townAt(P.pos.x, P.pos.z);
    updatePlayer(dt);
    updateEnemies(dt, playerSafe);
    updateProjectiles(dt);
    updateNPCs(dt);
    updatePortals(dt);
    updateEffects(dt);
    updateParticles(dt);
    updateWorldState(dt);
    hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
  } else if (!started) {
    camYaw += dt * 0.08;
    updateSky(camera.position, dt, PAL.day.top, PAL.day.hor, PAL.day.sun);
  }
  updateCamera(dt);
  updateFloaters(dt);
  if (started) {
    updateHUD();
    drawMap(mini, 180, 180, P.pos.x, P.pos.z, 0.9, false);
  }
  if (gfxHigh) composer.render(); else renderer.render(scene, camera);
}
showTitle();
frame();
