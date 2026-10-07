import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  PATH, TOWN_IDX, ARENA, BOUNDS, REGIONS, TOWNS, WEAPONS, ARMORS, CHARMS, SKINS, ASH_Z, OLD_TOWN_ORDER, BOWS, STYLES,
  CONSUMABLES, ENEMIES, DEMON_TYPES, TIER_MIX, tierScale, xpNeeded,
  NINJA_BASES, NINJA_R, DEMON_BASES, DEMON_R, BOSS_TALK, LOOK_OPTIONS, HAT_NAMES, DEFAULT_LOOK, FROST,
  ELEMENTS, NW, NW_TOWNS, NEW_X,
} from './data.js';
import { makeHumanoid, makeEnemyModel, makeShuriken, setLod, setSheathed, makeArrowMesh, setBowDraw } from './models.js';
import { $, clamp, lerp, smooth, rand, randInt, angleLerp, wr, wrand } from './util.js';
import {
  buildWorld, updateSky, updateChunks, setGrassEnabled, frostAmt, inNewWorld, inInterior, roomAt, rooms, nwSector, nwWeights, nwSite, makeEnvScene, SUN_DIR, height, nearestSeg, townAt, townDist, arenaDist, ninjaDist, ninjaBaseAt,
  demonBaseAt, collideStatic, clampBounds, interactables, villagers, staticNPCs, segDist,
} from './world.js';
import {
  initFx, burst, updateParticles, spawnRing, updateEffects, floatText, updateFloaters,
  updateTrail, spawnBolt, updateAmbient, spawnSwing, spawnImpact, spawnSlashLine,
} from './fx.js';

// ============================================================ Renderer, scene, post-processing
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9e2f2, 70, 260);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x5a4a35, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b8, 3.6);
// Warm lantern light for whichever house interior the player is in.
const roomLight = new THREE.PointLight(0xffb070, 0, 22, 1.4);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 260 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// Post-processing renders into a multisampled HDR target so edges stay smooth.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.55, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Final grade: a touch more saturation and contrast, warm highlights, soft vignette.
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.12);
      col = (col - 0.5) * 1.05 + 0.5;
      col *= mix(vec3(0.97, 0.99, 1.03), vec3(1.04, 1.0, 0.95), smoothstep(0.2, 0.8, l));
      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * 0.55;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
}));

// Image-based lighting: the sky is rendered into an environment map, so metal, water
// and lacquer reflect it. Rebuilt whenever the sky palette changes.
scene.add(roomLight);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null, envKey = '';
scene.environmentIntensity = 0.8;
function refreshEnvironment(key) {
  if (key === envKey) return;
  envKey = key;
  const rt = pmrem.fromScene(makeEnvScene(), 0, 0.1, 200);
  scene.environment = rt.texture;
  if (envRT) envRT.dispose();
  envRT = rt;
}

let gfxHigh = true;
try { gfxHigh = localStorage.getItem('roninsroad.gfx') !== 'low'; } catch { /* default high */ }
// Dynamic resolution: the render scale drops when frames take too long and climbs back
// when there is headroom. If it bottoms out on High, the game switches itself to Fast.
let resScale = 1, frameAvg = 1 / 60, slowFor = 0, tuneTimer = 0;
const basePixelRatio = () => Math.min(window.devicePixelRatio, gfxHigh ? 1.5 : 1);
function applyResolution() {
  const pr = basePixelRatio() * resScale;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}
function applyGfx() {
  applyResolution();
  setGrassEnabled(gfxHigh);
  const ms = gfxHigh ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== ms) {
    sun.shadow.mapSize.set(ms, ms);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
}
function tuneResolution(rawDt) {
  if (rawDt > 0.25) return; // tab was hidden or a long hitch: ignore
  frameAvg = lerp(frameAvg, rawDt, 0.05);
  tuneTimer += rawDt;
  if (tuneTimer < 1) return;
  tuneTimer = 0;
  if (frameAvg > 1 / 45 && resScale > 0.55) { resScale = Math.max(0.55, resScale - 0.1); applyResolution(); }
  else if (frameAvg < 1 / 58 && resScale < 1) { resScale = Math.min(1, resScale + 0.05); applyResolution(); }
  slowFor = frameAvg > 1 / 30 && resScale <= 0.55 ? slowFor + 1 : 0;
  if (slowFor >= 4 && gfxHigh && started) {
    gfxHigh = false;
    slowFor = 0;
    applyGfx();
    banner('', 'Switched to Fast graphics to keep the game smooth (press G to change)', 3);
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
  day:   { top: new THREE.Color(0x2f6bb8), hor: new THREE.Color(0xc4d8e6), sun: new THREE.Color(0xffe2b8), hemi: 0.55 },
  ash:   { top: new THREE.Color(0x3a1c18), hor: new THREE.Color(0x9a5a44), sun: new THREE.Color(0xff9a6a), hemi: 0.45 },
  realm: { top: new THREE.Color(0x120202), hor: new THREE.Color(0x6a1a0a), sun: new THREE.Color(0xff5a2a), hemi: 0.5 },
};
for (const el of ELEMENTS) PAL[el.key] = { top: new THREE.Color(el.sky.top), hor: new THREE.Color(el.sky.hor), sun: new THREE.Color(el.sky.sun), hemi: el.sky.hemi };
const skyTop = new THREE.Color(), skyHor = new THREE.Color(), sunCol = new THREE.Color();

buildWorld(scene);
initFx(scene, camera, height);
applyGfx();

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
// The wrist (rig.weapon) angles the blade. At rest it holds a guard: blade up and
// forward from the fist. In a cut it straightens so the blade follows the swing.
const wrist = (rig, target, k) => { rig.weapon.rotation.x = lerp(rig.weapon.rotation.x, target, k); };
function restArm(rig, k = 0.2) {
  wrist(rig, rig.wristRest ?? 0, k);
  if (rig.forearmR) { rig.forearmR.quaternion.slerp(_qId, k); rig.forearmL.quaternion.slerp(_qId, k); }
  rig.armR.rotation.x = lerp(rig.armR.rotation.x, REST_ARM, k);
  rig.armR.rotation.y = lerp(rig.armR.rotation.y, 0, k);
  rig.armR.rotation.z = lerp(rig.armR.rotation.z, 0, k);
  rig.armL.rotation.z = lerp(rig.armL.rotation.z, 0, k);
  rig.body.rotation.x = lerp(rig.body.rotation.x, 0, k);
  rig.body.rotation.y = lerp(rig.body.rotation.y, 0, k);
  rig.body.rotation.z = lerp(rig.body.rotation.z, 0, k);
}
// Left hand reaches for the katana handle, so the sword is held two-handed.
const _grip = new THREE.Vector3(), _sh = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);
// Two-bone arm IK: put the hand on a world-space target by turning the shoulder and
// bending the elbow. poleX pushes the elbow outward (negative for the left arm).
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _u = new THREE.Vector3(), _pole = new THREE.Vector3(), _fd = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _qId = new THREE.Quaternion();
const UPPER = 0.32, LOWER = 0.36;
function armIK(rig, arm, fore, target, poleX) {
  if (!fore) return;
  rig.root.updateMatrixWorld(true);
  rig.body.worldToLocal(_T.copy(target));
  _S.copy(arm.position);
  _u.subVectors(_T, _S);
  const d = clamp(_u.length(), 0.1, UPPER + LOWER - 0.002);
  _u.normalize();
  const cosA = clamp((UPPER * UPPER + d * d - LOWER * LOWER) / (2 * UPPER * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.set(poleX, -1, -0.4);
  _pole.addScaledVector(_u, -_pole.dot(_u)).normalize();
  _E.copy(_S).addScaledVector(_u, cosA * UPPER).addScaledVector(_pole, sinA * UPPER);
  arm.quaternion.setFromUnitVectors(_down, _fd.subVectors(_E, _S).normalize());
  _qi.copy(arm.quaternion).invert();
  fore.quaternion.setFromUnitVectors(_down, _fd.subVectors(_T, _E).normalize().applyQuaternion(_qi));
}
// While sheathed, the sword hand rests on the handle at the hip.
function handOnHilt(rig) {
  if (!rig.sheathedHilt) return;
  rig.root.updateMatrixWorld(true);
  rig.sheathedHilt.localToWorld(_grip.set(0, 0.06, 0));
  armIK(rig, rig.armR, rig.forearmR, _grip, 0.8);
}
// Left hand closes on the katana handle just below the right: a true two-handed grip.
function twoHandGrip(rig) {
  if (!rig.twoHanded) return;
  const blade = rig.weapon.children.find(c => c.userData.tipY !== undefined);
  if (!blade) return;
  rig.root.updateMatrixWorld(true);
  blade.localToWorld(_grip.set(0, 0.15, 0));
  armIK(rig, rig.armL, rig.forearmL, _grip, -0.8);
}
// Archer stance: bow arm out toward the target, string hand pulled back to the cheek.
const _gp = new THREE.Vector3(), _nock = new THREE.Vector3();
function poseBow(armX, draw) {
  const b = rig.bow;
  if (!b) return;
  rig.armL.rotation.set(armX, 0.15, 0);
  rig.body.rotation.y = lerp(rig.body.rotation.y, 0.25 * draw, 0.3);
  rig.root.updateMatrixWorld(true);
  b.group.getWorldPosition(_gp);
  // Right hand: from the string at rest to full draw beside the face.
  const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
  _hand.set(_gp.x - fx * (0.12 + 0.62 * draw), _gp.y + 0.04 + (armX < -2 ? 0.5 : 0), _gp.z - fz * (0.12 + 0.62 * draw));
  armIK(rig, rig.armR, rig.forearmR, _hand, 1.0);
  rig.root.updateMatrixWorld(true);
  rig.forearmR.localToWorld(_nock.set(0, -0.36, 0));
  if (draw > 0.05) {
    setBowDraw(b, b.group.worldToLocal(_nock.clone()));
    b.arrow.visible = true;
    b.arrow.position.copy(b.nock);
    b.arrow.lookAt(_gp);
  } else {
    setBowDraw(b, null);
    b.arrow.visible = false;
  }
}
// Step into the cut: front foot forward, back leg pushing, hips dropping.
function poseFeet(rig, s) {
  rig.legL.rotation.x = lerp(0, -0.6, s);
  rig.legR.rotation.x = lerp(0, 0.45, s);
  rig.body.position.y = 1.0 - 0.09 * s;
}
function poseAttack(rig, anim, t, A) {
  const s = smooth(A.hitAt - 0.09, A.hitAt + 0.05, t);
  const arm = rig.armR, body = rig.body;
  if (rig.forearmR) rig.forearmR.quaternion.slerp(_qId, 0.5);
  const w = rig.weapon.rotation;
  if (anim === 'draw') { arm.rotation.set(lerp(-0.55, -1.5, s), lerp(-1.25, 1.45, s), 0); body.rotation.y = lerp(-0.6, 0.55, s); w.x = lerp(-1.4, -0.1, s); }
  else if (anim === 'slashA') { arm.rotation.set(-1.45, lerp(1.4, -1.5, s), 0); body.rotation.y = lerp(0.45, -0.5, s); w.x = lerp(-1.1, -0.15, s); }
  else if (anim === 'slashB') { arm.rotation.set(-1.45, lerp(-1.5, 1.4, s), 0); body.rotation.y = lerp(-0.5, 0.45, s); w.x = lerp(-1.1, -0.15, s); }
  else if (anim === 'spin') { arm.rotation.set(-1.5, -1.2, 0); body.rotation.y = lerp(0, -Math.PI * 2, s); w.x = -0.1; }
  else { arm.rotation.set(lerp(-3.0, -0.5, s), 0, 0); body.rotation.x = lerp(-0.18, 0.25, s); w.x = lerp(-0.7, -0.2, s); }
  poseFeet(rig, smooth(0, A.hitAt + 0.05, t) * (1 - smooth(A.hitAt + 0.15, A.dur, t)));
  const r = smooth(A.hitAt + 0.1, A.dur, t);
  if (r > 0) {
    w.x = lerp(w.x, rig.wristRest ?? 0, r);
    arm.rotation.x = lerp(arm.rotation.x, REST_ARM, r);
    arm.rotation.y = lerp(arm.rotation.y, 0, r);
    body.rotation.x = lerp(body.rotation.x, 0, r);
    body.rotation.y = lerp(body.rotation.y, 0, r);
  }
}
function poseBlock(rig, k) {
  if (rig.forearmR) rig.forearmR.quaternion.slerp(_qId, k);
  wrist(rig, -0.2, k);
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
// One-handed: four quick cuts.
const COMBO_ONE = [COMBO[0], COMBO[1], { ...COMBO[0], mult: 1.05 }, { ...COMBO[2], mult: 1.5 }];
const comboList = () => (P.style === 'one' ? COMBO_ONE : COMBO);
const HEAVY = { anim: 'heavy', dur: 0.85, hitAt: 0.45, mult: 2.4, range: 3.9, dot: -0.25, cost: 26, lunge: 6, arc: 'wide', heavy: true };
const SPIRIT = { anim: 'spin', dur: 0.62, hitAt: 0.26, mult: 3.6, range: 6.5, dot: -2, cost: 0, lunge: 0, arc: 'wide', heavy: true, spirit: true };
// Iai: the first cut comes straight out of the scabbard as a fast rising slash.
const DRAW = { anim: 'draw', dur: 0.4, hitAt: 0.1, mult: 1.6, range: 3.3, dot: 0.0, cost: 6, lunge: 8, arc: 'h', finisher: true };
const DODGE_TIME = 0.45;
const PARRY_WINDOW = 0.25;

const P = {
  pos: new THREE.Vector3(), y: 0, vy: 0, grounded: true, facing: Math.PI, kb: new THREE.Vector3(),
  hp: 100, st: 100, ki: 0, lvl: 1, xp: 0, gold: 0, potions: 2, elixirs: 0,
  weapon: 'worn', ownedWeapons: ['worn'], armor: 'cloth', charms: [], skin: 'ronin', ownedSkins: ['ronin', 'custom'],
  look: { ...DEFAULT_LOOK },
  discovered: [0], lastTown: 0, bossDead: false, kills: 0, mastersDead: [], warlordsDead: [], chestsLooted: [],
  state: 'idle', stateT: 0, atk: null, combo: 0, queued: false, hitDone: false,
  invul: 0, hitInvul: 0, stDelay: 0, dead: false, dodgeDir: new THREE.Vector3(),
  blocking: false, blockPressT: -10, comboCount: 0, comboTimer: 0, lock: null,
  sheathed: true, combatT: 0, sheathT: 0,
  style: 'two', bow: 'hankyu', ownedBows: ['hankyu'],
  life: null, looted: [], outside: null, houseId: null, artCd: 0, hiddenT: 0,
};
// Rival villages: from this age on, the other villages treat you as a warrior of yours.
const RIVAL_AGE = 14;
const relOf = k => (P.life ? P.life.rel[k] : 0);
const isAlly = k => !!P.life && (k === P.life.village || relOf(k) >= 60);
function hostileTo(k) {
  const L = P.life;
  if (!L || k === L.village || L.age < RIVAL_AGE || L.rel[k] >= 0) return false;
  // Messengers carrying letters pass safely.
  if (L.task?.type === 'deliver' && TOWNS[L.task.target].element === k) return false;
  if (L.lesson?.type === 'deliver' && TOWNS[L.lesson.target].element === k) return false;
  return true;
}
const relName = k => (k === P.life?.village ? 'Home' : relOf(k) >= 60 ? 'Ally' : relOf(k) >= 0 ? 'At peace' : 'Rival');
// Village perks in the new life.
const perk = key => !!P.life && ELEMENTS[P.life.village].key === key;
// A child grows from 58% of adult height at six to full height at sixteen.
const growth = () => (P.life ? clamp((P.life.age - 6) / 10, 0, 1) : 1);
const ageScale = () => 0.58 + 0.42 * growth();
const hasCharm = c => P.charms.includes(c);
const W = () => WEAPONS[P.weapon];
const maxHp = () => 100 + (P.lvl - 1) * 12 + (hasCharm('vitality') ? 50 : 0) + (P.life?.badges?.length ?? 0) * 3;
const maxSt = () => 100 + (hasCharm('stamina') ? 40 : 0);
const isArcher = () => P.style === 'archer';
const B = () => BOWS[P.bow];
// The equipped weapon: the bow for archers, the sword otherwise.
const gear = () => (isArcher() ? B() : W());
const atkPower = () => Math.round((6 + (P.lvl - 1) * 2 + gear().atk) * (perk('fire') ? 1.15 : 1));
// How each fighting style changes melee: attack speed, damage and stamina cost.
const STYLE_MOD = { two: { speed: 0.95, mult: 1.12, cost: 1 }, one: { speed: 1.28, mult: 0.85, cost: 0.75 }, archer: { speed: 1, mult: 1, cost: 1 } };
const defense = () => ARMORS[P.armor].def;

const ARMOR_COLORS = { cloth: null, leather: 0x5a2e1c, iron: 0x4d535c, oyoroi: 0x8e1b1b, dragon: 0x1f6a5a };
let rig = null;
function rebuildPlayerRig() {
  if (rig) scene.remove(rig.root);
  const w = W(), L = P.look, sk = SKINS[P.skin].custom
    ? { cloth: L.cloth, cloth2: L.cloth2, hat: L.hat === 'none' ? null : L.hat, scarf: L.scarf }
    : SKINS[P.skin];
  const archer = isArcher();
  if (archer) P.sheathed = false;
  rig = makeHumanoid({
    cloth: sk.cloth, cloth2: sk.cloth2, hat: sk.hat, scarf: sk.scarf,
    weapon: archer ? null : 'katana', sheath: !archer, grip: P.style === 'one' ? 'one' : 'two',
    bow: archer ? { color: B().color, glow: B().glow } : null,
    skin: L.skin, hair: P.life && P.life.age >= 45 ? 0x9a9a9a : L.hair,
    armor: sk.armor ?? ARMOR_COLORS[P.armor],
    blade: { color: w.color, glow: w.glow, len: w.len ?? 1, style: w.style },
  });
  rig.armR.rotation.x = REST_ARM;
  // Children are smaller, with bigger heads for their size.
  rig.root.scale.setScalar(ageScale());
  rig.head.scale.setScalar(1 + 0.22 * (1 - growth()));
  setSheathed(rig, P.sheathed);
  updateHint();
  rig.root.position.set(P.pos.x, P.y, P.pos.z);
  rig.root.rotation.y = P.facing;
  scene.add(rig.root);
}
const slashColor = () => {
  const w = gear();
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
let shakeAmt = 0, hitstop = 0, hurtFlash = 0, slowmo = 0, fovKick = 0;
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
    case 'KeyX': if (isArcher()) tryRain(); else if (P.style === 'one') tryWhirl(); else tryIai(); break;
    case 'Tab': toggleLock(); break;
    case 'KeyM': toggleMap(); break;
    case 'KeyH': showHelp(); break;
    case 'KeyI': openInventory(); break;
    case 'KeyJ': tryAttack(false); break;
    case 'KeyK': tryAttack(true); break;
    case 'Space': tryJump(); break;
    case 'KeyF': case 'KeyC': tryDodge(); break;
    case 'KeyV': useArt(); break;
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

function updateHint() {
  const el = $('hint');
  if (!el) return;
  const attack = isArcher() ? 'Click shoot &middot; Right-click power shot' : 'Click slash &middot; Right-click heavy';
  const art = P.life && P.life.age >= ART_AGE ? ` &middot; V ${ELEMENTS[P.life.village].art.name}` : '';
  el.innerHTML = `WASD move &middot; ${attack} &middot; Q block/parry &middot; X ${STYLES[P.style].special}${art} &middot; Tab lock-on &middot; Space jump &middot; F dodge &middot; E interact &middot; 1/2 heal &middot; I inventory &middot; M map &middot; H help`;
}
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
    if (!e.alive || (e.faction !== undefined && !hostileTo(e.faction))) continue;
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
  const t = isArcher() ? aimTarget() : (P.lock && P.lock.alive) ? P.lock : nearestEnemy(5.5);
  const dir = inputDir();
  if (t) P.facing = Math.atan2(t.pos.x - P.pos.x, t.pos.z - P.pos.z);
  else if (dir.len > 0) P.facing = Math.atan2(dir.x, dir.z);
}

function tryAttack(heavy) {
  if (P.dead || ['dodge', 'stunned', 'spirit', 'special', 'whirl'].includes(P.state)) return;
  if (isArcher()) { tryShoot(heavy); return; }
  if (P.state === 'attack') {
    if (!heavy && !P.atk.heavy && P.stateT > P.atk.hitAt * 0.5) P.queued = true;
    return;
  }
  startAttack(heavy ? HEAVY : COMBO[0], 0);
}
function unsheath() {
  if (!P.sheathed || isArcher()) return;
  P.sheathed = false;
  P.sheathT = 0;
  setSheathed(rig, false);
}
function sheathNow() {
  if (isArcher()) return;
  P.sheathed = true;
  P.sheathT = 0;
  setSheathed(rig, true);
}
function startAttack(base, combo) {
  if (P.st < base.cost * 0.5) { floatText(headPos(), 'Exhausted', 'hurt', 0.7); P.state = 'idle'; return; }
  P.combatT = 0;
  if (P.sheathed) {
    if (!base.heavy) base = DRAW;
    unsheath();
  }
  const M = STYLE_MOD[P.style];
  const sp = (W().speed ?? 1) * M.speed;
  const A = { ...base, dur: base.dur / sp, hitAt: base.hitAt / sp, range: base.range + (W().reach ?? 0), mult: base.mult * M.mult, cost: base.cost * M.cost };
  P.st = Math.max(0, P.st - A.cost);
  P.stDelay = 0.9;
  P.state = 'attack'; P.atk = A; P.combo = combo; P.stateT = 0; P.hitDone = false; P.queued = false;
  P.blocking = false;
  faceTarget();
  spawnSwing({ ...SWINGS[A.anim], follow: playerFollow, color: slashColor(), radius: A.range * 0.95, delay: Math.max(0, A.hitAt - 0.08) });
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
// Slash streak shapes for each attack: plane tilt, sweep direction, arc and timing.
const SWINGS = {
  slashA: { plane: 0.18, dir: -1, arc: 2.3, sweep: 1.5, life: 0.22 },
  slashB: { plane: -0.18, dir: 1, arc: 2.3, sweep: 1.5, life: 0.22 },
  chop: { plane: 'v', dir: -1, arc: 2.1, sweep: 1.4, life: 0.24, height: 1.4 },
  heavy: { plane: 0.6, dir: -1, arc: 3.4, sweep: 1.9, life: 0.32, intensity: 1.3 },
  draw: { plane: -0.35, dir: 1, arc: 2.8, sweep: 1.8, life: 0.26, intensity: 1.3, height: 1.1 },
};

function trySpirit() {
  if (P.dead || ['dodge', 'stunned', 'spirit'].includes(P.state)) return;
  if (P.ki < 100) { banner('', 'Ki is not full yet. Land hits and parries to fill it.', 1.3); return; }
  P.ki = 0;
  faceTarget();
  const sp = W().speed ?? 1;
  P.atk = { ...SPIRIT, range: SPIRIT.range + (W().reach ?? 0), dur: SPIRIT.dur, hitAt: SPIRIT.hitAt * Math.min(1, 1 / sp) };
  P.state = 'spirit'; P.stateT = 0; P.hitDone = false; P.invul = 0.6; P.blocking = false;
  unsheath(); P.combatT = 0;
  floatText(headPos(), 'SPIRIT SLASH', 'crit', 1.2);
  burst(P.pos.x, P.y + 1, P.pos.z, 40, slashColor(), 3, 3, 0.6, 2);
}

// ============================================================ Iaijutsu: Thousand Cuts
// Time nearly stops. The samurai flashes through every nearby foe, leaving streaks of
// light, then slowly returns the blade to its scabbard. On the click, every cut lands.
let special = null;
function tryIai() {
  if (P.dead || ['dodge', 'stunned', 'spirit', 'special'].includes(P.state)) return;
  if (P.ki < 100) { banner('', 'Ki is not full yet. Land hits and parries to fill it.', 1.3); return; }
  const targets = enemies
    .filter(e => e.alive && distTo(e) < 16 && Math.abs(height(e.pos.x, e.pos.z) - P.y) < 4)
    .sort((a, b) => distTo(a) - distTo(b)).slice(0, 8);
  if (!targets.length) { trySpirit(); return; }
  P.ki = 0;
  P.state = 'special'; P.stateT = 0; P.invul = 99; P.blocking = false; P.lock = null; P.combatT = 0;
  sheathNow();
  special = { phase: 'ready', t: 0, targets, idx: 0, next: 0, marked: [], clicked: false };
  floatText(headPos(), 'IAIJUTSU', 'crit', 1.4);
  canvas.style.filter = 'saturate(0.25) contrast(1.15) brightness(0.85)';
}
function screenFlash(strength = 0.85) {
  const f = $('flash');
  f.style.transition = 'none';
  f.style.opacity = String(strength);
  requestAnimationFrame(() => { f.style.transition = 'opacity 0.6s'; f.style.opacity = '0'; });
}
const _from = new THREE.Vector3(), _to = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
function updateSpecial(dt) {
  const S = special;
  S.t += dt;
  const R = rig;
  if (S.phase === 'ready') {
    // Low stance, hand on the hilt, eyes on the first target.
    const T = S.targets[0];
    P.facing = angleLerp(P.facing, Math.atan2(T.pos.x - P.pos.x, T.pos.z - P.pos.z), 0.3);
    R.body.position.y = lerp(R.body.position.y, 0.82, 0.2);
    R.legL.rotation.x = lerp(R.legL.rotation.x, -0.75, 0.2);
    R.legR.rotation.x = lerp(R.legR.rotation.x, 0.65, 0.2);
    R.body.rotation.x = lerp(R.body.rotation.x, 0.25, 0.2);
    if (Math.random() < 0.5) burst(P.pos.x, P.y + 0.1, P.pos.z, 2, 0xc8d8ff, 3, 0.4, 0.5, 0);
    if (S.t > 0.5) { S.phase = 'dash'; S.t = 0; unsheath(); }
  } else if (S.phase === 'dash') {
    S.next -= dt;
    if (S.next <= 0) {
      S.next = 0.085;
      if (S.idx >= S.targets.length) { S.phase = 'finish'; S.t = 0; }
      else {
        const e = S.targets[S.idx++];
        if (e.alive) {
          _from.set(P.pos.x, P.y + 1.2, P.pos.z);
          let dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
          const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
          const reach = e.def.radius + 1.8;
          P.pos.set(e.pos.x + dx * reach, 0, e.pos.z + dz * reach);
          collideStatic(P.pos, 0.5);
          clampBounds(P.pos);
          P.y = height(P.pos.x, P.pos.z);
          P.facing = Math.atan2(dx, dz);
          _to.set(P.pos.x, P.y + 1.2, P.pos.z);
          spawnSlashLine(_from, _to, { color: slashColor(), width: 0.14, life: 1.1 });
          // Crossing cuts through the target, left hanging in the air.
          const ey = height(e.pos.x, e.pos.z) + e.def.scale * 1.3, r = 0.9 + e.def.scale * 0.6;
          for (let k = 0; k < 2; k++) {
            const a = Math.random() * Math.PI, b = rand(-0.9, 0.9);
            _d.set(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).multiplyScalar(r);
            _c.set(e.pos.x, ey, e.pos.z);
            spawnSlashLine(_c.clone().sub(_d), _c.clone().add(_d), { color: 0xffffff, width: 0.07, life: 1.4 });
          }
          spawnImpact(e.pos.x, ey, e.pos.z, { color: slashColor(), size: 2 });
          e.kb.set(0, 0, 0);
          S.marked.push(e);
          shake(0.12);
        }
      }
    }
    // Blade extended after the cut, body turned through it, deep lunge.
    R.armR.rotation.set(-1.5, -1.3, 0);
    R.forearmR.quaternion.copy(_qId);
    R.weapon.rotation.x = -0.1;
    R.body.rotation.set(0.15, -0.5, 0);
    R.body.position.y = 0.88;
    R.legL.rotation.x = -0.8; R.legR.rotation.x = 0.6;
  } else {
    // Rise, turn the blade, and slowly slide it home. The click releases every cut.
    const k = smooth(0.1, 0.85, S.t);
    R.armR.rotation.set(lerp(-1.5, -0.6, k), lerp(-1.3, -1.2, k), 0);
    R.forearmR.quaternion.slerp(_qId, 0.3);
    R.weapon.rotation.x = lerp(-0.1, -1.5, k);
    R.body.rotation.set(lerp(0.15, 0, k), lerp(-0.5, 0, k), 0);
    R.body.position.y = lerp(0.88, 1.0, k);
    R.legL.rotation.x = lerp(-0.8, 0, k); R.legR.rotation.x = lerp(0.6, 0, k);
    if (!S.clicked && S.t > 0.9) {
      S.clicked = true;
      sheathNow();
      canvas.style.filter = '';
      screenFlash(0.75);
      shake(0.9); hitstop = 0.12; fovKick = 7;
      for (const e of S.marked) {
        if (!e.alive) continue;
        const { dmg } = hitDamage(e, { mult: 4.2 });
        const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
        const ey = height(e.pos.x, e.pos.z) + e.def.scale * 1.3;
        spawnImpact(e.pos.x, ey, e.pos.z, { color: 0xffffff, size: 3.2, blood: DEMON_TYPES.has(e.type) ? 0x6a1aa0 : 0xb81010, dx: dx / d, dz: dz / d });
        damageEnemy(e, dmg, true, SPIRIT, dx / d, dz / d);
        applyWeaponEffect(e, dmg);
      }
      floatText(headPos(), 'THOUSAND CUTS', 'crit', 1.6);
    }
    if (S.t > 1.45) {
      special = null;
      P.state = 'idle'; P.invul = 0.4;
      canvas.style.filter = '';
    }
  }
  R.root.position.set(P.pos.x, P.y, P.pos.z);
  R.root.rotation.y = P.facing;
  if (P.sheathed) handOnHilt(R);
  R.root.updateMatrixWorld(true);
  const blade = R.weapon.children.find(c => c.userData.tipY !== undefined) ?? R.weapon;
  _base.set(0, -0.3, 0); _tip.set(0, blade.userData.tipY ?? -1.5, 0);
  blade.localToWorld(_base); blade.localToWorld(_tip);
  updateTrail(_base, _tip, S.phase === 'dash', slashColor(), dt);
}

// ============================================================ Archer
// Picks what an arrow should fly at: the locked target, else the enemy closest to
// where the camera is looking.
function aimTarget(range = 42) {
  if (P.lock && P.lock.alive && distTo(P.lock) < range) return P.lock;
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  let best = null, bs = -Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = distTo(e);
    if (d > range) continue;
    const dot = ((e.pos.x - P.pos.x) * fx + (e.pos.z - P.pos.z) * fz) / (d || 1);
    if (dot < 0.55) continue;
    const sc = dot * 2 - d / 25;
    if (sc > bs) { bs = sc; best = e; }
  }
  return best;
}
function tryShoot(heavy) {
  if (P.state === 'attack') { if (!P.atk.heavy && P.stateT > P.atk.releaseAt) P.queued = true; return; }
  const cost = heavy ? 18 : 5;
  if (P.st < cost * 0.5) { floatText(headPos(), 'Exhausted', 'hurt', 0.7); return; }
  P.st = Math.max(0, P.st - cost); P.stDelay = 0.8; P.combatT = 0;
  P.state = 'attack'; P.stateT = 0; P.queued = false; P.blocking = false;
  P.atk = heavy ? { bow: true, heavy: true, dur: 1.0, releaseAt: 0.72 } : { bow: true, dur: 0.46, releaseAt: 0.26 };
  faceTarget();
}
const _aim = new THREE.Vector3(), _bowPos = new THREE.Vector3(), _hand = new THREE.Vector3();
function fireArrow(heavy) {
  trainHit(25, Math.sin(P.facing), Math.cos(P.facing));
  const t = aimTarget();
  const from = new THREE.Vector3(P.pos.x + Math.sin(P.facing) * 0.7, P.y + 1.55, P.pos.z + Math.cos(P.facing) * 0.7);
  if (t) _aim.set(t.pos.x, height(t.pos.x, t.pos.z) + t.def.scale * 1.3, t.pos.z).sub(from).normalize();
  else _aim.set(Math.sin(P.facing), 0.02, Math.cos(P.facing)).normalize();
  P.facing = Math.atan2(_aim.x, _aim.z);
  spawnArrow(from, _aim.clone().multiplyScalar(heavy ? 72 : 56), {
    dmg: atkPower() * (heavy ? 2.4 : 1.0), pierce: heavy, heavy, life: 1.1,
  });
  if (heavy) { shake(0.2); spawnImpact(from.x, from.y, from.z, { color: slashColor(), size: 1.2 }); }
}
// A flying arrow with a faint glowing streak behind it.
function spawnArrow(from, vel, opts) {
  const mesh = makeArrowMesh(0.95, gear().glow);
  const streak = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, opts.heavy ? 3.2 : 1.8),
    new THREE.MeshBasicMaterial({ color: slashColor(), transparent: true, opacity: opts.heavy ? 0.9 : 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  streak.position.z = opts.heavy ? -1.2 : -0.6;
  mesh.add(streak);
  mesh.position.copy(from);
  mesh.lookAt(_hand.copy(from).add(vel));
  scene.add(mesh);
  projectiles.push({ mesh, pos: mesh.position, vel, life: opts.life ?? 1.2, hostile: false, arrow: true, hit: new Set(), ...opts });
}
function arrowHit(pr, e) {
  const crit = e.parried || Math.random() < 0.15;
  let dmg = pr.dmg * rand(0.9, 1.1) * (crit ? 1.6 : 1) * (1 + Math.min(0.3, P.comboCount * 0.02));
  if (gear().effect === 'demonbane' && DEMON_TYPES.has(e.type)) dmg *= 1.5;
  if (e.enraged) dmg *= 1.25;
  dmg = Math.round(dmg);
  const sp = Math.hypot(pr.vel.x, pr.vel.z) || 1;
  const ey = height(e.pos.x, e.pos.z) + e.def.scale * 1.3;
  spawnImpact(e.pos.x, ey, e.pos.z, { color: crit ? 0xffe070 : slashColor(), size: pr.heavy ? 2 : 1.2, blood: DEMON_TYPES.has(e.type) ? 0x6a1aa0 : 0xb81010, dx: pr.vel.x / sp, dz: pr.vel.z / sp });
  damageEnemy(e, dmg, crit, { heavy: !!pr.heavy, finisher: !!pr.heavy }, pr.vel.x / sp, pr.vel.z / sp);
  applyWeaponEffect(e, dmg);
  if (!pr.rain) { P.ki = Math.min(100, P.ki + 5); P.comboCount++; P.comboTimer = 2.5; }
}
// Rain of Arrows: loose a volley skyward, then it falls over a whole area.
const rains = [];
function tryRain() {
  if (P.dead || ['dodge', 'stunned', 'special', 'whirl'].includes(P.state)) return;
  if (P.ki < 100) { banner('', 'Ki is not full yet. Land hits and parries to fill it.', 1.3); return; }
  P.ki = 0;
  const t = aimTarget(45);
  const cx = t ? t.pos.x : P.pos.x + Math.sin(P.facing) * 14, cz = t ? t.pos.z : P.pos.z + Math.cos(P.facing) * 14;
  if (t) P.facing = Math.atan2(cx - P.pos.x, cz - P.pos.z);
  P.state = 'attack'; P.stateT = 0; P.queued = false; P.combatT = 0;
  P.atk = { bow: true, cast: true, heavy: true, dur: 0.8, releaseAt: 0.45, cx, cz };
  floatText(headPos(), 'RAIN OF ARROWS', 'crit', 1.4);
}
function startRain(cx, cz) {
  spawnRing(cx, cz, 7.5, 2.2, 0xffd860);
  for (let k = 0; k < 8; k++) {
    const from = new THREE.Vector3(P.pos.x, P.y + 1.8, P.pos.z);
    spawnArrow(from, new THREE.Vector3(rand(-4, 4), 60, rand(-4, 4)), { dmg: 0, life: 0.5, sky: true });
  }
  rains.push({ cx, cz, t: -0.55, next: 0 });
}
function updateRains(dt) {
  for (let i = rains.length - 1; i >= 0; i--) {
    const r = rains[i];
    r.t += dt;
    if (r.t < 0) continue;
    r.next -= dt;
    while (r.next <= 0 && r.t < 1.7) {
      r.next += 0.035;
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 7.5;
      const x = r.cx + Math.cos(a) * d, z = r.cz + Math.sin(a) * d;
      const from = new THREE.Vector3(x + rand(-3, 3), height(x, z) + 26, z + rand(-3, 3));
      const vel = new THREE.Vector3(x, height(x, z), z).sub(from).normalize().multiplyScalar(60);
      spawnArrow(from, vel, { dmg: atkPower() * 1.1, rain: true, life: 0.8 });
    }
    if (r.t >= 1.7) rains.splice(i, 1);
  }
}

// ============================================================ One-handed: Whirlwind Dance
function tryWhirl() {
  if (P.dead || ['dodge', 'stunned', 'special', 'whirl'].includes(P.state)) return;
  if (P.ki < 100) { banner('', 'Ki is not full yet. Land hits and parries to fill it.', 1.3); return; }
  P.ki = 0;
  unsheath();
  P.state = 'whirl'; P.stateT = 0; P.invul = 1.9; P.combatT = 0; P.blocking = false;
  P.whirlNext = 0;
  floatText(headPos(), 'WHIRLWIND DANCE', 'crit', 1.4);
}
function whirlHits(mult, radius, heavy) {
  for (const e of enemies) {
    if (!e.alive || e.evadeT > 0) continue;
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > radius + e.def.radius) continue;
    const { dmg, crit } = hitDamage(e, { mult });
    const ey = height(e.pos.x, e.pos.z) + e.def.scale * 1.3;
    spawnImpact(e.pos.x - dx / (d || 1) * 0.4, ey, e.pos.z - dz / (d || 1) * 0.4, { color: crit ? 0xffe070 : slashColor(), size: heavy ? 2.4 : 1.2, blood: DEMON_TYPES.has(e.type) ? 0x6a1aa0 : 0xb81010, dx: dx / (d || 1), dz: dz / (d || 1) });
    damageEnemy(e, dmg, crit, { heavy, finisher: true }, dx / (d || 1), dz / (d || 1));
    applyWeaponEffect(e, dmg);
  }
}

function tryJump() {
  if (['dodge', 'attack', 'stunned', 'spirit', 'special'].includes(P.state)) return;
  if (P.y - height(P.pos.x, P.pos.z) < 0.2) { P.vy = 9.5; P.grounded = false; }
}
function tryDodge() {
  if (['dodge', 'stunned', 'spirit', 'special', 'whirl'].includes(P.state) || P.st < 13) return;
  if (P.state === 'attack' && P.stateT < P.atk.hitAt) return;
  const d = inputDir();
  if (d.len > 0) P.dodgeDir.set(d.x, 0, d.z);
  else P.dodgeDir.set(-Math.sin(P.facing), 0, -Math.cos(P.facing));
  P.facing = Math.atan2(P.dodgeDir.x, P.dodgeDir.z);
  P.st -= P.style === 'one' ? 13 : 20; P.stDelay = 0.8;
  P.state = 'dodge'; P.stateT = 0; P.invul = perk('shadow') ? 0.46 : 0.34; P.blocking = false;
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
  if (gear().effect === 'demonbane' && DEMON_TYPES.has(e.type)) dmg *= 1.5;
  if (e.enraged) dmg *= 1.25;
  e.parried = false;
  return { dmg: Math.round(dmg), crit };
}
function doPlayerHit(A) {
  const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
  let hit = false;
  trainHit(A.range + 0.8, fx, fz);
  for (const e of enemies) {
    if (!e.alive || e.evadeT > 0) continue;
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > A.range + e.def.radius) continue;
    if (Math.abs(height(e.pos.x, e.pos.z) - P.y) > 3) continue;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < A.dot) continue;
    const { dmg, crit } = hitDamage(e, A);
    const nx = dx / (d || 1), nz = dz / (d || 1);
    const hx = e.pos.x - nx * e.def.radius * 0.8, hz = e.pos.z - nz * e.def.radius * 0.8;
    spawnImpact(hx, height(e.pos.x, e.pos.z) + e.def.scale * 1.3, hz, {
      color: crit ? 0xffe070 : slashColor(), size: crit ? 2.2 : 1.5,
      blood: DEMON_TYPES.has(e.type) ? 0x6a1aa0 : 0xb81010, dx: nx, dz: nz,
    });
    damageEnemy(e, dmg, crit, A, nx, nz);
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
  if (hit) { hitstop = A.heavy ? 0.09 : 0.05; shake(A.heavy ? 0.35 : 0.15); fovKick = A.heavy ? 4 : 1.5; }
  if (A.spirit) {
    shake(0.7); hitstop = 0.12;
    burst(P.pos.x, P.y + 0.6, P.pos.z, 90, slashColor(), 12, 4, 0.8, 3);
    spawnRing(P.pos.x, P.pos.z, A.range, 0.3, slashColor());
  }
}
function applyWeaponEffect(e, dmg) {
  const fxType = gear().effect;
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
      spawnBolt(a, b, gear().glow || 0xfff6a0);
      damageEnemy(o, Math.round(dmg * 0.35), false, COMBO[0], 0, 0);
      chained++;
    }
  }
}

function damagePlayer(amount, src, opts = {}) {
  if (src?.spar && P.invul > 0 && P.state === 'dodge') lessonCount('roll');
  if (P.dead || P.invul > 0 || P.hitInvul > 0) return false;
  if (perk('ice')) amount *= 0.85;
  // Blocking: facing the attacker and not an unblockable move.
  if (P.blocking && !opts.unblockable && src) {
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    const dx = src.pos.x - P.pos.x, dz = src.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    if ((dx * fx + dz * fz) / d > 0.2) {
      if (time - P.blockPressT < PARRY_WINDOW) { parry(src); if (src.spar) lessonCount('parry'); return false; }
      if (src.spar) lessonCount('guard');
      P.st -= amount * 1.3; P.stDelay = 0.8;
      spawnImpact(P.pos.x + fx * 0.9, P.y + 1.45, P.pos.z + fz * 0.9, { color: 0xffd890, size: 1.6 });
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
        if (src.spar) P.hp = Math.max(1, P.hp);
        if (P.hp <= 0) { P.hp = 0; playerDie(); }
        return true;
      }
    }
  }
  const dmg = Math.max(1, Math.round(amount * rand(0.9, 1.1) - defense()));
  P.combatT = 0;
  P.hp -= dmg;
  P.hitInvul = 0.5;
  P.comboCount = 0;
  P.ki = Math.min(100, P.ki + 3);
  hurtFlash = 1;
  shake(0.4);
  floatText(headPos(), '-' + dmg, 'hurt');
  if (src) {
    const dx = P.pos.x - src.pos.x, dz = P.pos.z - src.pos.z, d = Math.hypot(dx, dz) || 1;
    spawnImpact(P.pos.x - dx / d * 0.4, P.y + 1.3, P.pos.z - dz / d * 0.4, { color: 0xff8060, size: 1.2, blood: 0xb81010, dx: dx / d, dz: dz / d });
  } else burst(P.pos.x, P.y + 1.3, P.pos.z, 14, 0xff2a1a, 4, 3, 0.5);
  if (src) {
    const dx = P.pos.x - src.pos.x, dz = P.pos.z - src.pos.z, d = Math.hypot(dx, dz) || 1;
    P.kb.set(dx / d, 0, dz / d).multiplyScalar(dmg > maxHp() * 0.15 ? 10 : 5);
  }
  if (dmg > maxHp() * 0.15 && P.state === 'attack') P.state = 'idle';
  if (src?.spar) P.hp = Math.max(1, P.hp);
  if (P.hp <= 0) { P.hp = 0; playerDie(); }
  return true;
}
function parry(src) {
  P.ki = Math.min(100, P.ki + 30);
  hitstop = 0.14; slowmo = 0.45;
  shake(0.25);
  const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
  burst(P.pos.x + fx * 1.2, P.y + 1.5, P.pos.z + fz * 1.2, 40, 0xffe080, 7, 4, 0.5, 8);
  spawnImpact(P.pos.x + fx * 1.0, P.y + 1.5, P.pos.z + fz * 1.0, { color: 0xffe080, size: 2.6 });
  spawnSwing({ follow: playerFollow, plane: -0.5, dir: 1, color: 0xffe0a0, radius: 2.0, arc: 1.6, sweep: 1.0, life: 0.2 });
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
  P.artCd = Math.max(0, P.artCd - dt);
  P.hiddenT = Math.max(0, P.hiddenT - dt);
  if (perk('water') && !P.dead && P.hp > 0) P.hp = Math.min(maxHp(), P.hp + 1.5 * dt);
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
  if (P.blocking) { P.combatT = 0; if (!isArcher()) unsheath(); }
  P.combatT += dt;

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
  } else if (P.state === 'attack' && P.atk.bow) {
    // Draw, aim and loose. Archers can walk slowly while drawing.
    const A = P.atk;
    P.pos.x += dir.x * 2.8 * dt; P.pos.z += dir.z * 2.8 * dt;
    if (!A.cast) { const t = aimTarget(); if (t) P.facing = angleLerp(P.facing, Math.atan2(t.pos.x - P.pos.x, t.pos.z - P.pos.z), 0.3); }
    const k = smooth(0, A.releaseAt, P.stateT);
    const released = P.stateT >= A.releaseAt;
    if (released && !P.hitDone) {
      P.hitDone = true;
      if (A.cast) startRain(A.cx, A.cz); else fireArrow(A.heavy);
    }
    poseBow(A.cast ? -2.5 : -1.5, released ? 0 : k);
    speedFrac = dir.len > 0 ? 0.4 : 0;
    if (P.stateT >= A.dur) {
      P.hitDone = false;
      if (P.queued) { P.state = 'idle'; tryShoot(false); }
      else P.state = 'idle';
    }
  } else if (P.state === 'whirl') {
    // A storm of spinning cuts around the swordsman.
    P.pos.x += dir.x * 4 * dt; P.pos.z += dir.z * 4 * dt;
    P.facing += dt * 22;
    rig.armR.rotation.set(-1.55, -0.6, 0);
    rig.forearmR.quaternion.copy(_qId);
    rig.weapon.rotation.x = -0.1;
    rig.armL.rotation.set(-1.2, 0.8, 0);
    rig.body.rotation.x = 0.1;
    swinging = true;
    P.whirlNext -= dt;
    if (P.whirlNext <= 0 && P.stateT < 1.5) {
      P.whirlNext = 0.12;
      whirlHits(0.7, 4.8, false);
      spawnSwing({ follow: playerFollow, plane: rand(-0.35, 0.35), dir: -1, color: slashColor(), radius: 4.2, arc: 4.2, sweep: 2, life: 0.18, intensity: 0.9 });
    }
    if (P.stateT >= 1.5 && !P.hitDone) {
      P.hitDone = true;
      whirlHits(2.2, 5.6, true);
      spawnSwing({ follow: playerFollow, plane: 0.05, dir: -1, color: 0xffffff, radius: 5.6, arc: 6, sweep: 2.4, life: 0.35, intensity: 1.5 });
      shake(0.6); hitstop = 0.1; fovKick = 5;
    }
    if (P.stateT >= 1.75) { P.state = 'idle'; P.hitDone = false; }
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
      if (A.spirit) {
        spawnSwing({ follow: playerFollow, plane: 0.08, dir: -1, color: slashColor(), radius: A.range, arc: 5.8, sweep: 2.4, life: 0.4, intensity: 1.4 });
        spawnSwing({ follow: playerFollow, plane: -0.25, dir: -1, color: 0xffffff, radius: A.range * 0.75, arc: 5.0, sweep: 2.0, life: 0.32, delay: 0.05, height: 1.0 });
      }
    }
    poseAttack(rig, A.anim, P.stateT, A);
    swinging = P.stateT > A.hitAt - 0.12 && P.stateT < A.hitAt + 0.1;
    if (P.stateT >= A.dur) {
      if (P.state === 'attack' && P.queued && P.combo < comboList().length - 1) startAttack(comboList()[P.combo + 1], P.combo + 1);
      else { P.state = 'idle'; P.combo = 0; }
    }
  } else {
    const sprint = (keys.ShiftLeft || keys.ShiftRight) && P.st > 1 && dir.len > 0 && !P.blocking;
    const speed = (dir.len > 0 ? (P.blocking ? 2.6 : sprint ? 10.5 : 6.5) : 0) * (perk('shadow') ? 1.1 : 1);
    if (sprint) { P.st -= 20 * dt; P.stDelay = 0.4; }
    P.pos.x += dir.x * speed * dt;
    P.pos.z += dir.z * speed * dt;
    const lockOn = P.lock && P.lock.alive;
    if (lockOn && (P.blocking || !sprint)) P.facing = angleLerp(P.facing, Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z), 1 - Math.exp(-12 * dt));
    else if (dir.len > 0 && !P.blocking) P.facing = angleLerp(P.facing, Math.atan2(dir.x, dir.z), 1 - Math.exp(-14 * dt));
    speedFrac = speed / 6.5;
    if (P.blocking) poseBlock(rig, 0.35);
    else restArm(rig);
    // Out of combat for a while: slide the sword back into its scabbard.
    if (isArcher()) poseBow(-0.45, 0);
    else if (!P.sheathed && !P.blocking && P.sheathT === 0 && P.combatT > 5 && !enemies.some(e => e.alive && !['idle', 'return', 'dead'].includes(e.state) && distTo(e) < 25)) P.sheathT = 0.0001;
    if (P.sheathT > 0) {
      P.sheathT += dt;
      const k = smooth(0, 0.4, P.sheathT);
      rig.armR.rotation.x = lerp(rig.armR.rotation.x, -0.6, k * 0.5);
      rig.armR.rotation.y = lerp(rig.armR.rotation.y, -1.2, k * 0.5);
      wrist(rig, -1.5, 0.3);
      if (P.sheathT > 0.45 && !P.sheathed) {
        sheathNow();
        burst(P.pos.x - Math.cos(P.facing) * 0.3, P.y + 1.15, P.pos.z + Math.sin(P.facing) * 0.3, 6, 0xfff4c0, 1, 1, 0.3, 0);
      }
    }
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
  if (P.state !== 'dodge' && P.state !== 'attack' && P.state !== 'spirit' && P.state !== 'whirl') animateWalk(rig, dt, P.grounded ? speedFrac : 0);
  else if (P.state === 'attack' && P.atk.bow) {
    animateWalk(rig, dt, P.grounded ? speedFrac : 0);
    rig.armL.rotation.set(P.atk.cast ? -2.5 : -1.5, 0.15, 0); // keep the bow arm on target while walking
  }
  if (isArcher() && P.state === 'idle') { rig.armL.rotation.set(-0.45, 0.15, 0); }
  if (isArcher()) { /* bow pose is set above */ }
  else if (P.sheathed && P.state !== 'dodge') handOnHilt(rig);
  else if (P.state !== 'dodge') twoHandGrip(rig);
  if (!P.grounded && P.state === 'idle') { rig.legL.rotation.x = -0.5; rig.legR.rotation.x = 0.3; }
  rig.root.visible = !(P.hitInvul > 0.2 && Math.floor(P.hitInvul * 20) % 2 === 0);

  // Sword trail from the blade's base to its tip.
  rig.root.updateMatrixWorld(true);
  const blade = rig.weapon.children.find(c => c.userData.tipY !== undefined) ?? rig.weapon;
  _base.set(0, -0.3, 0); _tip.set(0, blade.userData.tipY ?? -1.5, 0);
  blade.localToWorld(_base); blade.localToWorld(_tip);
  updateTrail(_base, _tip, swinging && !isArcher(), slashColor(), dt);
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
    if (!pr.arrow) pr.mesh.rotation.y += 25 * dt;
    const groundHit = pr.pos.y < height(pr.pos.x, pr.pos.z);
    let remove = pr.life <= 0 || groundHit;
    if (pr.sky) { if (remove) { scene.remove(pr.mesh); projectiles.splice(i, 1); } continue; }
    if (pr.rain && groundHit) {
      // Rain arrows strike everything close to where they land.
      for (const e of enemies) {
        if (e.alive && !pr.hit.has(e) && Math.hypot(e.pos.x - pr.pos.x, e.pos.z - pr.pos.z) < e.def.radius + 1.3) { pr.hit.add(e); arrowHit(pr, e); }
      }
      burst(pr.pos.x, pr.pos.y + 0.1, pr.pos.z, 3, 0x9a8a6a, 2, 1.5, 0.4, 8);
    }
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
        if (pr.arrow && pr.hit.has(e)) continue;
        if (segDist(e.pos.x, e.pos.z, _prev.x, _prev.z, pr.pos.x, pr.pos.z) < e.def.radius + 0.5 && pr.pos.y > ey && pr.pos.y < ey + e.def.scale * 2.4) {
          if (pr.arrow) {
            pr.hit.add(e);
            arrowHit(pr, e);
            if (!pr.pierce) { remove = true; break; }
            continue;
          }
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
let boss = null, echo = null;
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

const isKing = e => e === boss || e.role === 'echo';
function pickType(mix) {
  let pick = wrand(), type = mix[0][0];
  for (const [t, p] of mix) { if (pick < p) { type = t; break; } pick -= p; }
  return type;
}
// Which stretch of road (and so which region) a point is nearest to.
function regionIndex(x, z) {
  const seg = nearestSeg(x, z).index;
  let r = 0;
  for (let k = 0; k < TOWN_IDX.length; k++) if (seg >= TOWN_IDX[k]) r = k;
  return r;
}

function spawnWorldEnemies() {
  for (let leg = 0; leg < REGIONS.length; leg++) {
    const tier = REGIONS[leg].tier, power = REGIONS[leg].power;
    const a = TOWN_IDX[leg], b = leg < TOWN_IDX.length - 1 ? TOWN_IDX[leg + 1] : PATH.length - 1;
    let groups = 0, tries = 0;
    // Longer legs get more roaming groups.
    let legLen = 0;
    for (let k = a; k < b; k++) legLen += Math.hypot(PATH[k + 1][0] - PATH[k][0], PATH[k + 1][1] - PATH[k][1]);
    const want = Math.round(clamp(legLen / 24, 8, 16));
    while (groups < want && tries++ < 500) {
      const k = a + Math.floor(wrand() * (b - a));
      const u = wrand();
      const [ax, az] = PATH[k], [bx, bz] = PATH[k + 1];
      let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const side = wrand() < 0.5 ? -1 : 1, off = wr(5, 42);
      const cx = ax + (bx - ax) * u - dz * off * side, cz = az + (bz - az) * u + dx * off * side;
      if (townDist(cx, cz) < 16 || arenaDist(cx, cz) < ARENA.r + 14 || ninjaDist(cx, cz) < NINJA_R + 18) continue;
      if (cx < BOUNDS.minX + 10 || cx > BOUNDS.maxX - 10) continue;
      const type = pickType(TIER_MIX[tier]);
      const size = type === 'captain' ? 1 : 2 + Math.floor(wrand() * 2);
      for (let s = 0; s < size; s++) createEnemy(s > 0 && type === 'captain' ? 'oni' : type, cx + wr(-4, 4), cz + wr(-4, 4), { tier: power });
      groups++;
    }
  }
  // Ninja bases: a squad of ninjas and their master.
  NINJA_BASES.forEach((nb, i) => {
    for (let k = 0; k < 4 + i; k++) {
      const [x, z] = nb.spots[k % nb.spots.length];
      createEnemy('ninja', x + wr(-1, 1), z + wr(-1, 1), { tier: nb.power });
    }
    nb.masterEnemy = createEnemy('ninjaMaster', nb.masterSpot[0], nb.masterSpot[1], { tier: nb.power, role: 'master', base: nb, title: nb.master, facing: nb.gateDir });
  });
  // Demon fortresses: one tier tougher than the region whose portal leads there.
  DEMON_BASES.forEach((db, i) => {
    const mix = TIER_MIX[Math.min(3, i + 1)];
    const pw = NINJA_BASES[i].power + 0.6;
    db.spots.forEach(([x, z]) => createEnemy(pickType(mix), x, z, { tier: pw }));
    db.warlordEnemy = createEnemy('warlord', db.warlordSpot[0], db.warlordSpot[1], { tier: pw, role: 'warlord', base: db, title: db.warlord, facing: 0 });
  });
  boss = createEnemy('boss', ARENA.x, ARENA.z - 10, { facing: 0, role: 'boss' });
  // The new world: imps near each village, oni out in the far wilds, the echo at the Crossroads.
  for (const el of ELEMENTS) {
    const t = el.town;
    for (let g = 0, tries = 0; g < 14 && tries < 400; tries++) {
      const b = wr(0, Math.PI * 2), d = wr(t.r + 25, t.r + 220);
      const x = t.x + Math.cos(b) * d, z = t.z + Math.sin(b) * d;
      if (townDist(x, z) < 14 || Math.hypot(x - NW.x, z - NW.z) > NW.r - 60 || Math.hypot(x - NW.x, z - NW.z) < 45) continue;
      for (let k = 0; k < 2; k++) createEnemy('imp_' + el.key, x + wr(-3, 3), z + wr(-3, 3));
      g++;
    }
    for (let g = 0, tries = 0; g < 10 && tries < 400; tries++) {
      const a = el.angle + wr(-0.6, 0.6), r = wr(160, NW.r - 60);
      const x = NW.x + Math.cos(a) * r, z = NW.z + Math.sin(a) * r;
      if (townDist(x, z) < 60) continue;
      createEnemy('beast_' + el.key, x, z);
      g++;
    }
  }
  echo = createEnemy('echo', nwSite.echo.x, nwSite.echo.z, { facing: 0, role: 'echo' });
  // Gate guards of every village. They only fight you if their village is your rival.
  for (const el of ELEMENTS) for (const g of nwSite.gates[el.index]) {
    const e = createEnemy('guard_' + el.key, g.x, g.z, { facing: g.facing });
    e.faction = el.index;
    e.guard = true;
  }
}

function damageEnemy(e, dmg, crit, A, nx, nz) {
  if (!e.alive) return;
  if (e.faction !== undefined && !hostileTo(e.faction)) return;
  if (e.spar && !e.realMatch) { floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + 2.2, e.pos.z), 'Practice!', 'xp', 0.6); return; }
  e.hp -= dmg;
  e.flash = 0.12;
  const top = e.def.scale * 2.4 + 0.3;
  floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + top, e.pos.z), String(dmg), crit ? 'crit' : 'dmg', 0.9);
  burst(e.pos.x, height(e.pos.x, e.pos.z) + e.def.scale * 1.4, e.pos.z, crit ? 22 : 12, DEMON_TYPES.has(e.type) ? 0xb04aff : 0xff3020, 5, 4, 0.55);
  if (e.state === 'idle' || e.state === 'return') e.state = 'chase';
  const p = e.def.poise;
  const stagger = A.spirit || p === 0 || (p === 1 && (A.heavy || A.finisher)) || (p === 2 && A.heavy);
  e.kb.set(nx, 0, nz).multiplyScalar(stagger ? (A.heavy ? 10 : 6) / e.def.scale : 1);
  // Remember where the blow came from (in the enemy's own frame) to flinch and fall away from it.
  const fx = Math.sin(e.facing), fz = Math.cos(e.facing);
  e.hitFront = -(nx * fx + nz * fz);
  e.hitSide = nx * fz - nz * fx;
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
  const gold = Math.round(randInt(g0, g1) * e.goldMul * (perk('golden') ? 1.5 : 1));
  P.gold += gold; P.kills++;
  const y = height(e.pos.x, e.pos.z) + e.def.scale * 2;
  floatText(new THREE.Vector3(e.pos.x, y + 0.6, e.pos.z), '+' + gold + ' gold', 'gold', 1.3);
  floatText(new THREE.Vector3(e.pos.x, y, e.pos.z), '+' + e.xp + ' xp', 'xp', 1.3);
  burst(e.pos.x, y - e.def.scale, e.pos.z, 40, DEMON_TYPES.has(e.type) ? 0x9a3aff : 0xffb347, 4, 6, 1.1, 3);
  gainXP(e.xp);
  lifeKill(e);
  hitstop = Math.max(hitstop, 0.08);
  if (e.role) { slowmo = 0.9; shake(0.6); fovKick = 6; }
  if (e === boss) victory();
  else if (e.role === 'echo') echoDefeated();
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
  if (isKing(e) && dist > 13 && r < 0.55) { e.state = 'chargeWind'; e.t = 0; return true; }
  const slamR = isKing(e) ? 9 : 7;
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
        e.rig.body.rotation.x = Math.min(1.45, e.deadT * 3) * ((e.hitFront ?? 1) > 0 ? -1 : 1);
        e.rig.body.position.y = lerp(1.0, 0.4, Math.min(1, e.deadT * 2));
        if (e.deadT > 0.8) e.rig.root.position.y -= dt * 1.5 * d.scale;
      } else if (e.rig.root.visible) e.rig.root.visible = false;
      if (e.summoned && e.deadT > 2) e.remove = true;
      else if (!e.role && !e.summoned && e.deadT > 75 && dist > 80) respawnEnemy(e);
      continue;
    }
    e.rig.root.visible = dist < 85 + 25 * d.scale;
    // Far enemies swap to a single-mesh stand-in and skip limb animation.
    e.far = dist > 38 + 6 * d.scale && !e.role;
    setLod(e.rig, e.far);
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
    const leash = isKing(e) ? 55 : e.role ? 45 : 75;
    const special = isKing(e) || e.role === 'warlord';

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
        const friendly = e.faction !== undefined && !hostileTo(e.faction);
        if ((!playerSafe || e.spar) && !friendly && P.hiddenT <= 0 && dist < d.aggro && Math.abs(P.y - height(e.pos.x, e.pos.z)) < 8) {
          if (e.role && !e.talked && !P.dead) { openBossTalk(e); break; }
          e.state = 'chase';
          floatText(new THREE.Vector3(e.pos.x, height(e.pos.x, e.pos.z) + d.scale * 2.4 + 0.6, e.pos.z), '!', 'alert', 0.8);
          if (e === boss) { banner('Shuten-doji', 'The Demon King rises to face you', 3); shake(0.5); }
          else if (e.role === 'echo') { banner(e.title, 'The Demon King\'s shadow', 3); shake(0.5); }
          else if (e.role === 'champion') banner(e.title, 'A duel of honor', 2.5);
          else if (e.role === 'spar') { /* a classmate, no fanfare */ }
          else if (e.role) banner(e.title, e.role === 'master' ? 'Master of ' + e.base.name : 'Lord of the ' + e.base.name, 2.5);
        }
        break;
      }
      case 'chase': {
        e.glow = 0;
        if ((playerSafe && !e.spar) || dist > d.aggro * 2.6 || homeDist > leash || (e.faction !== undefined && !hostileTo(e.faction))) { e.state = 'return'; break; }
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
        if (e.t >= wind) {
          e.state = 'strike'; e.t = 0; e.struck = false;
          if (!e.far) {
            const demon = DEMON_TYPES.has(e.type);
            spawnSwing({
              follow: () => ({ x: e.pos.x, y: height(e.pos.x, e.pos.z), z: e.pos.z, facing: e.facing }),
              plane: 'v', dir: -1, color: demon ? 0xff6a3a : 0xdfe8ff, radius: d.range + 0.3, arc: 2.0, sweep: 1.3,
              life: 0.22, height: 1.25 * d.scale, intensity: demon ? 0.8 : 0.6,
            });
          }
        }
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
      if (tl < t.r + 2) { e.pos.x = t.x + (tx / tl) * (t.r + 2); e.pos.z = t.z + (tz / tl) * (t.r + 2); }
    }
    if (e !== boss) collideStatic(e.pos, d.radius * 0.8);
    clampBounds(e.pos);

    const gy = height(e.pos.x, e.pos.z);
    e.rig.root.position.set(e.pos.x, gy, e.pos.z);
    e.rig.root.rotation.y = e.facing;
    if (e.far) { if (e.bar) e.bar.visible = false; continue; }
    e.moveFrac = lerp(e.moveFrac, moveSpeed / d.speed, 0.2);
    animateWalk(e.rig, dt, Math.min(1.6, e.moveFrac));

    const arm = e.rig.armR;
    if (e.state === 'windup' || e.state === 'chargeWind') {
      const k = smooth(0, wind * 0.7, e.t);
      arm.rotation.set(lerp(REST_ARM, -2.9, k), 0, 0);
      wrist(e.rig, lerp(e.rig.wristRest, -0.6, k), 0.5);
      e.rig.body.rotation.x = lerp(0, -0.15, k);
    } else if (e.state === 'throw') {
      arm.rotation.set(lerp(REST_ARM, -2.6, Math.min(1, e.t / 0.25)), 0.5, 0);
    } else if (e.state === 'strike') {
      const k = smooth(0, 0.1, e.t);
      arm.rotation.set(lerp(-2.9, -0.4, k), 0, 0);
      e.rig.weapon.rotation.x = lerp(-0.6, -0.25, k);
      e.rig.body.rotation.x = lerp(-0.15, 0.25, k);
    } else if (e.state === 'slamWind') {
      const k = smooth(0, 0.5, e.t);
      arm.rotation.set(lerp(REST_ARM, -3.0, k), 0, 0);
      wrist(e.rig, -0.5, 0.3);
      e.rig.armL.rotation.x = lerp(0, -3.0, k);
      e.rig.body.rotation.x = -0.2 * k;
    } else if (e.state === 'hurt') {
      e.rig.body.rotation.x = lerp(e.rig.body.rotation.x, -0.4 * (e.hitFront ?? 1), 0.35);
      e.rig.body.rotation.z = lerp(e.rig.body.rotation.z, 0.3 * (e.hitSide ?? 0), 0.35);
    } else if (e.state === 'charge') {
      e.rig.body.rotation.x = 0.35;
      arm.rotation.set(-1.2, 0, 0);
      wrist(e.rig, -0.3, 0.3);
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
      const a = Math.random() * Math.PI * 2, r = rand(3, v.town.r * 0.58);
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
    setLod(v.rig, dist > 40);
    if (dist <= 40) animateWalk(v.rig, dt, moving);
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
  combo: $('combo'), comboN: $('comboN'), artRow: $('artRow'), artFill: $('artFill'), artLbl: $('artLbl'),
};
function updateHUD() {
  const mh = maxHp();
  hud.hpFill.style.width = (P.hp / mh * 100) + '%';
  hud.hpText.textContent = Math.ceil(P.hp) + ' / ' + mh;
  hud.stFill.style.width = (P.st / maxSt() * 100) + '%';
  hud.kiFill.style.width = P.ki + '%';
  hud.kiRow.classList.toggle('full', P.ki >= 100);
  const hasArt = !!P.life && P.life.age >= ART_AGE;
  hud.artRow.classList.toggle('hidden', !hasArt);
  if (hasArt) {
    const art = ELEMENTS[P.life.village].art;
    hud.artFill.style.width = (100 - P.artCd / art.cd * 100) + '%';
    hud.artRow.classList.toggle('full', P.artCd <= 0);
    hud.artLbl.textContent = ELEMENTS[P.life.village].kanji;
    hud.artRow.style.setProperty('--el', ELEMENTS[P.life.village].css);
  }
  hud.xpFill.style.width = (P.xp / xpNeeded(P.lvl) * 100) + '%';
  hud.lvl.textContent = P.lvl;
  hud.gold.textContent = P.gold;
  hud.pots.textContent = P.potions;
  hud.elx.textContent = P.elixirs;
  hud.gear.textContent = `${P.life ? ELEMENTS[P.life.village].name + ' village · Age ' + P.life.age + ' · ' : ''}${STYLES[P.style].name} · ${gear().name} (atk ${atkPower()}) · ${ARMORS[P.armor].name} (def ${defense()}) · Kills ${P.kills}`;
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
  modal.classList.remove('talkmode', 'side');
}
modalBox.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const [act, arg] = el.dataset.act.split('|');
  switch (act) {
    case 'close': closeModal(); break;
    case 'new': startGame(null); openCreator(true); break;
    case 'continue': startGame(loadSave()); break;
    case 'buy': buy(arg); break;
    case 'tab': shopTab = arg; openShop(shopTown, shopDef); break;
    case 'equipW': equipWeapon(arg); break;
    case 'equipB': equipBow(arg); break;
    case 'style': setStyle(arg); break;
    case 'wear': wearSkin(arg); break;
    case 'rest': rest(); break;
    case 'travel': travel(Number(arg)); break;
    case 'rise': rise(); break;
    case 'curse': showCurse(); break;
    case 'villages': openVillageChoice(); break;
    case 'join': startNewLife(Number(arg)); break;
    case 'sleep': sleepAtHome(); break;
    case 'inside': goInsideHome(); break;
    case 'mission': startMission(Number(arg)); break;
    case 'lesson': startLesson(arg); break;
    case 'quitLesson': endLesson(false); closeModal(); break;
    case 'smission': startSquadMission(arg); break;
    case 'quitSquad': endSquadMission(false); closeModal(); break;
    case 'squadFollow': P.life.squadFollow = !P.life.squadFollow; rebuildCompanions(); openAcademy(ELEMENTS[P.life.village].town); save(); break;
    case 'recruit': recruitAlly(Number(arg)); break;
    case 'dismiss': dismissAlly(); break;
    case 'talk': talkChoice(arg); break;
    case 'look': setLook(arg); break;
    case 'creator': openCreator(false); break;
    case 'creatorDone':
      closeModal();
      save();
      if (creatorFromStart) banner(TOWNS[P.lastTown].name, 'Talk to the elder, then head north', 3);
      break;
  }
});

const CONTROLS_HTML = `
  <div class="controls">
    <kbd>W A S D</kbd><span>Move (relative to camera)</span>
    <kbd>Mouse</kbd><span>Look around (click the game first) &middot; wheel to zoom</span>
    <kbd>Left click / J</kbd><span>Slash &mdash; press again for a 3-hit combo</span>
    <kbd>Right click / K</kbd><span>Heavy strike &mdash; breaks a big demon's guard</span>
    <kbd>Q (hold)</kbd><span>Block. Press just before a hit lands to <b>parry</b> and deflect shurikens</span>
    <kbd>X</kbd><span>Special move when your Ki bar is full: Thousand Cuts (two-handed), Whirlwind Dance (one-handed) or Rain of Arrows (archer)</span>
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
      ${s ? `<button data-act="continue">Continue (${s.life ? 'Age ' + s.life.age : 'Lv ' + s.lvl}, ${TOWNS[s.lastTown]?.name ?? ''})</button>` : ''}
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
  if (it.kind === 'shop') openShop(it.town, it.shop);
  else if (it.kind === 'shrine') openShrine(it.town);
  else if (it.kind === 'chest') lootChest(it.index);
  else if (it.kind === 'home') openHome(it.town);
  else if (it.kind === 'sensei') openSensei(it.town);
  else if (it.kind === 'well') drawWater();
  else if (it.kind === 'house') enterHouse(it);
  else if (it.kind === 'exit') exitHouse();
  else if (it.kind === 'stash') searchStash();
  else if (it.kind === 'bed') useBed();
  else if (it.kind === 'envoy') openEnvoy(it.element);
  else if (it.kind === 'academy') openAcademy(it.town);
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

let shopTown = null, shopDef = null, shopTab = 'swords';
function openShop(town, shop) {
  if (town.nw && hostileTo(town.element)) { refuse(town); return; }
  if (P.life && !P.life.graduated && (shopTab === 'swords' || shopTab === 'bows')) shopTab = 'supplies';
  shopTown = town; shopDef = shop;
  const has = { bows: shop.stock.some(id => id.startsWith('b:')), swords: shop.stock.some(id => id.startsWith('w:')), armor: shop.stock.some(id => /^[ac]:/.test(id)), skins: true, supplies: shop.stock.some(id => CONSUMABLES[id]) };
  const order = isArcher() ? [['bows', 'Bows'], ['swords', 'Swords']] : [['swords', 'Swords'], ['bows', 'Bows']];
  const tabs = [...order, ['armor', 'Armor & Charms'], ['skins', 'Outfits'], ['supplies', 'Supplies']].filter(([k]) => has[k]);
  if (!has[shopTab]) shopTab = tabs[0][0];
  let rows = '';
  if (shopTab === 'swords') {
    rows = shop.stock.filter(id => id.startsWith('w:')).map(id => {
      const key = id.slice(2), w = WEAPONS[key];
      const owned = P.ownedWeapons.includes(key);
      const btn = owned
        ? `<button class="secondary" data-act="equipW|${key}" ${P.weapon === key ? 'disabled' : ''}>${P.weapon === key ? 'Equipped' : 'Equip'}</button>`
        : P.life && !P.life.graduated ? '<button disabled>Academy graduates only</button>' : buyBtn(id, priceOf(id));
      const swatch = `<span class="swatch blade" style="background:linear-gradient(90deg,${hex(w.color)},${hex(w.glow || w.color)})"></span>`;
      return itemRow(swatch + w.name, `${weaponLine(w)}<br>${w.desc}`, owned ? '<div class="price">Owned</div>' : priceTag(priceOf(id)), btn);
    }).join('');
    rows += `<p class="sub">Your sword: <b>${W().name}</b> (${weaponLine(W())}). Swap anytime with I.</p>`;
  } else if (shopTab === 'bows') {
    rows = shop.stock.filter(id => id.startsWith('b:')).map(id => {
      const key = id.slice(2), b = BOWS[key];
      const owned = P.ownedBows.includes(key);
      const btn = owned
        ? `<button class="secondary" data-act="equipB|${key}" ${P.bow === key ? 'disabled' : ''}>${P.bow === key ? 'Equipped' : 'Equip'}</button>`
        : P.life && !P.life.graduated ? '<button disabled>Academy graduates only</button>' : buyBtn(id, priceOf(id));
      const swatch = `<span class="swatch blade" style="background:linear-gradient(90deg,${hex(b.color)},${hex(b.glow || b.color)})"></span>`;
      return itemRow(swatch + b.name, `${weaponLine(b)}<br>${b.desc}`, owned ? '<div class="price">Owned</div>' : priceTag(priceOf(id)), btn);
    }).join('');
    rows += `<p class="sub">${isArcher() ? `Your bow: <b>${B().name}</b>.` : 'Bows are used by the Archer style. Change style from the inventory (I).'}</p>`;
  } else if (shopTab === 'armor') {
    rows = shop.stock.filter(id => id.startsWith('a:') || id.startsWith('c:')).map(id => {
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
      const sc = s.custom ? P.look : s;
      const swatch = `<span class="swatch" style="background:linear-gradient(135deg,${hex(sc.cloth)} 50%,${hex(sc.armor ?? sc.scarf)} 50%)"></span>`;
      const btn = owned
        ? `<button class="secondary" data-act="wear|${key}" ${P.skin === key ? 'disabled' : ''}>${P.skin === key ? 'Wearing' : 'Wear'}</button>`
        : buyBtn('s:' + key, s.price);
      return itemRow(swatch + s.name, s.desc, owned ? '<div class="price">Owned</div>' : priceTag(s.price), btn);
    }).join('');
  } else {
    rows = shop.stock.filter(id => CONSUMABLES[id]).map(id => {
      const c = CONSUMABLES[id], have = id === 'potion' ? P.potions : P.elixirs;
      return itemRow(c.name, `${c.desc} &middot; carrying ${have}/9`, priceTag(c.price), have >= 9 ? '<button disabled>Full</button>' : buyBtn(id, c.price));
    }).join('');
  }
  const html = `<h2>${shop.shopName}</h2><p class="sub">${shop.merchant} &middot; ${town.name}</p>
    <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${shopTab === k ? 'on' : ''}" data-act="tab|${k}">${n}</button>`).join('')}</div>
    <div class="gold">Your purse: &#9672; <b>${P.gold}</b></div>
    <div class="items">${rows}</div>
    <div class="btns"><button class="secondary" data-act="close">Leave (E)</button></div>`;
  if (ui === 'shop') modalBox.innerHTML = html; else openModal(html, 'shop');
}
function priceOf(id) {
  // Allied villages give a 20% discount.
  const off = shopTown?.nw && P.life && shopTown.element !== P.life.village && isAlly(shopTown.element) ? 0.8 : 1;
  if (CONSUMABLES[id]) return Math.round(CONSUMABLES[id].price * off);
  const [kind, key] = id.split(':');
  return Math.round({ w: WEAPONS, a: ARMORS, c: CHARMS, s: SKINS, b: BOWS }[kind][key].price * off);
}
function refuse(town) {
  const el = ELEMENTS[town.element], mine = ELEMENTS[P.life.village];
  openModal(`<h2>${el.village} turns you away</h2>
    <p>&ldquo;We don't serve ${mine.name} folk here. Go back to ${mine.village}, before the guards drag you out.&rdquo;</p>
    <p class="sub">${el.village} is your rival. Speak with its envoy under the sacred tree at the Crossroads to make peace.</p>
    <div class="btns"><button class="secondary" data-act="close">Leave (E)</button></div>`, 'dialog');
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
    else if (kind === 'b') { P.ownedBows.push(key); P.bow = key; }
    else if (kind === 'a') P.armor = key;
    else if (kind === 's') { P.ownedSkins.push(key); P.skin = key; }
    else { P.charms.push(key); if (key === 'vitality') P.hp += 50; }
    rebuildPlayerRig();
  }
  save();
  openShop(shopTown, shopDef);
}
function equipWeapon(key) {
  if (!P.ownedWeapons.includes(key)) return;
  P.weapon = key;
  rebuildPlayerRig();
  save();
  if (ui === 'shop') openShop(shopTown, shopDef); else openInventory();
}
function equipBow(key) {
  if (!P.ownedBows.includes(key)) return;
  P.bow = key;
  rebuildPlayerRig();
  save();
  if (ui === 'shop') openShop(shopTown, shopDef); else openInventory();
}
function wearSkin(key) {
  if (!P.ownedSkins.includes(key)) return;
  P.skin = key;
  rebuildPlayerRig();
  save();
  if (ui === 'shop') openShop(shopTown, shopDef); else openInventory();
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
  const bows = P.ownedBows.map(key => {
    const b = BOWS[key];
    return itemRow(b.name, `${weaponLine(b)}<br>${b.desc}`, '',
      `<button class="secondary" data-act="equipB|${key}" ${P.bow === key ? 'disabled' : ''}>${P.bow === key ? 'Equipped' : 'Equip'}</button>`);
  }).join('');
  const charms = P.charms.length ? P.charms.map(c => CHARMS[c].name).join(', ') : 'none';
  const html = `<h2>Inventory</h2>
    <p class="sub">Fighting style: <b>${STYLES[P.style].name}</b> &mdash; change it under Customize appearance.</p>`;
  const html2 = `
    <p class="sub">${ARMORS[P.armor].name} (def ${defense()}) &middot; Charms: ${charms} &middot; Potions ${P.potions} &middot; Elixirs ${P.elixirs}</p>
    ${isArcher() ? `<h3>Bows</h3><div class="items">${bows}</div><h3>Swords</h3>` : `<h3>Swords</h3>`}<div class="items">${swords}</div>
    ${isArcher() ? '' : `<h3>Bows</h3><div class="items">${bows}</div>`}
    <h3>Outfits</h3><div class="items">${skins}</div>
    <div class="btns"><button data-act="creator">Customize appearance</button><button class="secondary" data-act="close">Close (I)</button></div>`;
  const full = html + html2;
  if (ui === 'inventory') modalBox.innerHTML = full; else openModal(full, 'inventory');
}

function openShrine(town) {
  if (town.nw && hostileTo(town.element)) { refuse(town); return; }
  P.lastTown = town.index;
  save();
  const dests = TOWNS.map(t => {
    if (t === town || !!t.nw !== !!town.nw) return '';
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
  const L = P.life, task = L?.task;
  if (L?.lesson?.type === 'deliver' && L.lesson.target === town.index) {
    openModal(`<h2>${town.elderTitle}</h2><p>&ldquo;A letter from ${ACADEMY_MASTER[L.village]}? You walked all this way alone? Well done, little one.&rdquo;</p>
      <div class="btns"><button data-act="close">Bow</button></div>`, 'dialog');
    lessonCount('deliver', 1);
    return;
  }
  if (task?.type === 'deliver' && task.target === town.index) {
    openModal(`<h2>${town.elderTitle}</h2><p>&ldquo;A letter from ${ELEMENTS[L.village].village}? You came all this way alone? Here, take something for the road.&rdquo;</p>
      <div class="btns"><button data-act="close">Bow</button></div>`, 'dialog');
    P.potions++;
    finishTask();
    return;
  }
  if (task?.type === 'ceremony' && town.nw && town.element === L.village) {
    if (!L.graduated) {
      openModal(`<h2>${town.elderTitle}</h2><p>&ldquo;Sixteen already! But a samurai of ${town.name} must first graduate from the Academy. Finish your lessons with ${ACADEMY_MASTER[L.village]}, then come back to me.&rdquo;</p><div class="btns"><button data-act="close">Bow</button></div>`, 'dialog');
      return;
    }
    comingOfAge(); return;
  }
  const m = L?.mission;
  if (m?.type === 'gift' && town.nw && town.element === m.v) { deliverGift(); return; }
  if (town.nw && hostileTo(town.element)) { refuse(town); return; }
  openModal(`<h2>${town.elderTitle ?? 'Elder of ' + town.name}</h2><p class="sub">${town.city ? 'They receive you in the city square.' : 'An old villager leans on a staff.'}</p>
    ${town.elder.map(l => `<p>&ldquo;${l}&rdquo;</p>`).join('')}
    <div class="btns"><button class="secondary" data-act="close">Farewell (E)</button></div>`, 'dialog');
}

// ============================================================ Pre-battle talk
let talkTarget = null;
function talkKey(e) {
  if (e === boss) return 'boss';
  if (e.role === 'echo') return 'echo';
  if (e.role === 'champion') return 'champion';
  if (e.role === 'master') return 'master' + NINJA_BASES.indexOf(e.base);
  return 'warlord' + DEMON_BASES.indexOf(e.base);
}
function talkBox(e, lines, choices) {
  openModal(`<div class="talk"><div class="speaker">${e.title}</div>
    ${lines.map(l => `<p>&ldquo;${l}&rdquo;</p>`).join('')}
    <div class="choices">${choices.join('')}</div></div>`, 'talk');
  modal.classList.add('talkmode');
}
function openBossTalk(e) {
  talkTarget = e;
  e.talked = true;
  e.facing = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z);
  P.facing = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
  P.state = 'idle'; P.blocking = false; P.lock = e;
  showTalkChoices(e, BOSS_TALK[talkKey(e)].lines, false);
}
function showTalkChoices(e, lines, asked) {
  const T = BOSS_TALK[talkKey(e)];
  talkBox(e, lines, [
    `<button data-act="talk|bow">Bow, then draw your sword<span>Honor the duel: start with full Ki</span></button>`,
    `<button data-act="talk|taunt">&ldquo;${T.taunt}&rdquo;<span>Taunt: they hit harder, but take more damage and drop more gold</span></button>`,
    asked ? '' : `<button class="secondary" data-act="talk|ask">&ldquo;Show me how you fight.&rdquo;<span>Learn their moves</span></button>`,
  ]);
}
function talkChoice(c) {
  const e = talkTarget;
  if (!e) return;
  const T = BOSS_TALK[talkKey(e)];
  if (c === 'ask') { showTalkChoices(e, [T.ask], true); return; }
  if (c === 'fight') {
    closeModal();
    talkTarget = null;
    e.state = 'chase'; e.t = 0;
    if (e.talkChoice === 'bow') { P.ki = 100; floatText(headPos(), 'Ki full', 'xp', 1.2); }
    else { shake(0.5); burst(e.pos.x, height(e.pos.x, e.pos.z) + e.def.scale * 1.5, e.pos.z, 60, 0xff3a10, 5, 5, 1, 2); }
    banner(e.title, e.talkChoice === 'taunt' ? 'Enraged!' : 'The duel begins', 2);
    return;
  }
  e.talkChoice = c;
  if (c === 'taunt') { e.enraged = true; e.dmg *= 1.25; e.goldMul *= 1.6; }
  talkBox(e, [c === 'bow' ? T.bow : T.tauntReply], [`<button data-act="talk|fight">Fight!</button>`]);
}

// ============================================================ Character creator
let creatorFromStart = false;
function openCreator(fromStart) {
  creatorFromStart = fromStart;
  renderCreator();
}
function renderCreator() {
  const L = P.look;
  const row = (key, label) => `<div class="crow"><div class="clabel">${label}</div><div class="swatches">${LOOK_OPTIONS[key].map(c =>
    `<button class="sw ${L[key] === c ? 'on' : ''}" style="background:${hex(c)}" data-act="look|${key}:${c}" aria-label="${label} ${hex(c)}"></button>`).join('')}</div></div>`;
  const hats = LOOK_OPTIONS.hat.map(h => `<button class="hatbtn ${L.hat === h ? 'on' : ''}" data-act="look|hat:${h}">${HAT_NAMES[h]}</button>`).join('');
  const styles = Object.entries(STYLES).map(([k, st]) => `<button class="stylecard ${P.style === k ? 'on' : ''}" data-act="style|${k}"><b>${st.name}</b><span>${st.desc}</span><em>Special: ${st.special}</em></button>`).join('');
  const html = `<h2>Your samurai</h2>
    <div class="styles">${styles}</div>
    <p class="sub">Skin and hair apply to every outfit. Robe, hakama, scarf and headwear make up <b>Your Own Style</b>, which you can wear anytime from the inventory (I).</p>
    ${row('skin', 'Skin')}${row('hair', 'Hair')}${row('cloth', 'Robe')}${row('cloth2', 'Hakama')}${row('scarf', 'Scarf')}
    <div class="crow"><div class="clabel">Headwear</div><div class="hats">${hats}</div></div>
    <div class="btns"><button data-act="creatorDone">${creatorFromStart ? 'Begin the journey' : 'Done'}</button></div>`;
  if (ui === 'creator') modalBox.innerHTML = html;
  else { openModal(html, 'creator'); modal.classList.add('side'); }
}
function setStyle(key) {
  if (!STYLES[key]) return;
  P.style = key;
  P.sheathed = key !== 'archer';
  P.state = 'idle';
  rebuildPlayerRig();
  if (ui === 'creator') renderCreator();
}
function setLook(arg) {
  const [k, v] = arg.split(':');
  P.look[k] = k === 'hat' ? v : Number(v);
  if (!['skin', 'hair'].includes(k)) P.skin = 'custom';
  rebuildPlayerRig();
  renderCreator();
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
      <div class="btns"><button data-act="curse">But the Demon King is laughing&hellip;</button></div>`, 'ending');
  }, 3000);
}

// ============================================================ A new life
// With his last breath the Demon King curses the hero: they are torn out of this world
// and reborn as a child on an island of five villages.
function showCurse() {
  screenFlash(1);
  shake(1);
  openModal(`<div class="kanji">呪</div><h2 class="center">The Demon King's Curse</h2>
    <p>&ldquo;You think you have won?&rdquo; Shuten-doji laughs as his body turns to ash. &ldquo;If I cannot have this world, <i>you</i> will not have it either!&rdquo;</p>
    <p>The sky splits open. A storm of black fire swallows you, and the Tokaido road vanishes.</p>
    <p>When you wake, your hands are small. Your sword is gone. You are a <b>child</b> again, on an island you have never seen,
    where five villages live around a great sacred tree.</p>
    <p class="sub center">Choose the village that will raise you. It is your new home, and its gift stays with you all your life.</p>
    <div class="btns"><button data-act="villages">Choose your village</button></div>`, 'curse');
}
function openVillageChoice() {
  openModal(`<div class="kanji">五つの里</div><h2 class="center">The Five Villages</h2>
    <p class="sub center">Where will you grow up?</p>
    <div class="villages">${ELEMENTS.map(el => `
      <button class="village" data-act="join|${el.index}" style="--el:${el.css}">
        <i>${el.kanji}</i><b>${el.village} &middot; ${el.name}</b>
        <span>${el.desc}</span><em>${el.perk}</em><em>Village art (V): ${el.art.name}. ${el.art.desc}</em>
      </button>`).join('')}</div>`, 'village');
}
function startNewLife(k) {
  const el = ELEMENTS[k], t = el.town;
  Object.assign(P, {
    lvl: 1, xp: 0, gold: 20, potions: 3, elixirs: 0, weapon: 'bokken', ownedWeapons: ['bokken'], armor: 'cloth', charms: [],
    bow: 'hankyu', ownedBows: ['hankyu'], skin: 'custom', discovered: [t.index], lastTown: t.index, bossDead: true,
  });
  P.life = { village: k, age: 6, task: null, done: 0, adult: false, echoDead: false };
  P.artCd = 0; P.hiddenT = 0;
  syncRelations();
  P.dead = false; P.state = 'idle'; P.hp = maxHp(); P.st = maxSt(); P.ki = 0; P.lock = null;
  P.sheathed = !isArcher();
  syncLife();
  closeModal();
  ui = 'travel';
  const fade = $('fade');
  fade.style.opacity = '1';
  setTimeout(() => {
    goHome();
    rebuildPlayerRig();
    fade.style.opacity = '0';
    ui = null;
    banner(el.village, 'A new life begins. You are six years old.', 4);
    setTimeout(() => { if (!P.life.task) nextTask(); save(); }, 4200);
    save();
  }, 700);
}
function goHome() {
  const h = nwSite.homes[P.life.village];
  P.pos.set(h.x, 0, h.z);
  P.y = height(h.x, h.z); P.vy = 0;
  P.facing = h.facing; camYaw = h.facing + Math.PI;
  currentTown = ELEMENTS[P.life.village].town;
}
// Hide or reveal the echo depending on where the life story stands.
function syncLife() {
  const wake = P.life && P.life.adult && !P.life.echoDead;
  if (wake && !echo.alive) { respawnEnemy(echo); echo.talked = false; }
  else if (!wake && echo.alive) markDead(echo);
}

// ---- Life tasks: each one finished is another year of growing up.
const LIFE_PLAN = [
  { type: 'water' },
  { type: 'gather', n: 5 },
  { type: 'train', n: 12 },
  { type: 'deliver', hop: 1 },
  { type: 'hunt', what: 'imp', n: 3 },
  { type: 'gather', n: 7 },
  { type: 'train', n: 20 },
  { type: 'deliver', hop: 2 },
  { type: 'hunt', what: 'imp', n: 6 },
  { type: 'hunt', what: 'beast', n: 2 },
];
const pickups = [];
const pickupMat = new Map();
function nextTask() {
  const L = P.life, el = ELEMENTS[L.village];
  let task;
  if (L.age < 16) { L.task = null; updateQuest(); return; }
  if (!L.adult) task = { type: 'ceremony' };
  else if (!L.echoDead) task = { type: 'echo' };
  else {
    // Grown-up life: odd jobs for the villages, for gold.
    const r = Math.floor(Math.random() * 3);
    task = r === 0 ? { type: 'hunt', what: 'beast', n: 3, pay: 150 } : r === 1 ? { type: 'deliver', hop: 1 + Math.floor(Math.random() * 4), pay: 90 } : { type: 'gather', n: 8, pay: 70 };
  }
  task.have = 0;
  if (task.type === 'deliver') task.target = ELEMENTS[(L.village + task.hop) % 5].town.index;
  if (task.type === 'water') task.stage = 0;
  L.task = task;
  if (task.type === 'gather') spawnPickups(task.n + 2);
  banner(taskTitle(task), taskText(task), 3.2);
  updateQuest();
}
function taskTitle(t) {
  return { water: 'A chore for Mother', gather: 'Gathering', train: 'Training', deliver: 'A letter to deliver', hunt: 'A hunt', ceremony: 'Coming of age', echo: 'The Demon King\'s shadow' }[t.type];
}
function taskText(t) {
  const el = ELEMENTS[P.life.village];
  switch (t.type) {
    case 'water': return t.stage ? 'Carry the bucket home to your family' : 'Draw water from the village well';
    case 'gather': return `Collect ${el.item} around ${el.village} (${t.have}/${t.n})`;
    case 'train': return `Strike the dojo's straw dummies (${t.have}/${t.n})`;
    case 'deliver': return `Deliver a letter to the elder of ${TOWNS[t.target].name}`;
    case 'hunt': return `Drive off ${t.what === 'imp' ? 'spirit imps' : 'wild oni'} in the wilds (${t.have}/${t.n})`;
    case 'ceremony': return P.life.graduated ? `Visit the elder of ${el.village} for your coming-of-age ceremony` : `Graduate from the ${el.village} Academy, then visit the elder for your coming of age`;
    case 'echo': return 'Something stirs beneath the sacred tree at the Crossroads. Face it.';
  }
  return '';
}
function updateQuest() {
  const q = $('quest'), L = P.life;
  const lines = [];
  if (L) {
    if (L.task) lines.push([taskTitle(L.task), taskText(L.task), null]);
    if (L.lesson && lessonDef(L.lesson.id)) lines.push(['Academy &middot; ' + lessonDef(L.lesson.id).name, lessonText(L.lesson), '#ffe080']);
    else if (!L.graduated) lines.push([`Academy &middot; Year ${schoolYear() + 1}`, `Talk to ${ACADEMY_MASTER[L.village]} in the academy yard for your next mission`, '#ffe080']);
    if (L.smission) lines.push([`${L.smission.rank}-rank &middot; ${L.smission.name}`, squadMissionText(L.smission), '#ffd860']);
    if (L.mission) lines.push(['Mission &middot; ' + ELEMENTS[L.mission.v].village, MISSION_TEXT[L.mission.type](L.mission, ELEMENTS[L.mission.v]), ELEMENTS[L.mission.v].css]);
  }
  if (!lines.length || P.pos.x > NEW_X) { q.classList.add('hidden'); return; }
  const el = ELEMENTS[L.village];
  q.classList.remove('hidden');
  q.style.setProperty('--el', el.css);
  q.innerHTML = `<div class="qage">${el.kanji} Age ${L.age} &middot; ${el.village}${L.squad ? ' &middot; ' + L.squad.name : ''}</div>`
    + lines.map(([t, txt, c], i) => `<b class="${i ? 'qmission' : ''}" ${c ? `style="color:${c}"` : ''}>${t}</b><span>${txt}</span>`).join('');
}
function spawnPickups(n) {
  clearPickups();
  const el = ELEMENTS[P.life.village], t = el.town;
  if (!pickupMat.has(el.key)) pickupMat.set(el.key, new THREE.MeshStandardMaterial({ color: el.color, emissive: el.color, emissiveIntensity: 1.4 }));
  const geo = new THREE.OctahedronGeometry(0.28);
  for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
    const a = Math.random() * Math.PI * 2, r = rand(t.r + 6, t.r + 45);
    const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
    if (townDist(x, z) < 3 || Math.hypot(x - NW.x, z - NW.z) > NW.r - 40 || height(x, z) < -0.3) continue;
    const m = new THREE.Mesh(geo, pickupMat.get(el.key));
    m.position.set(x, height(x, z) + 0.8, z);
    scene.add(m);
    pickups.push(m);
    i++;
  }
}
function clearPickups() {
  for (const m of pickups) scene.remove(m);
  pickups.length = 0;
}
function updatePickups(dt) {
  if (!pickups.length) return;
  const task = P.life?.task;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const m = pickups[i];
    m.rotation.y += dt * 2;
    m.position.y = height(m.position.x, m.position.z) + 0.8 + Math.sin(time * 3 + i) * 0.15;
    const les = P.life?.lesson;
    if (Math.hypot(m.position.x - P.pos.x, m.position.z - P.pos.z) < 1.5 && les?.type === 'gather') {
      burst(m.position.x, m.position.y, m.position.z, 18, ELEMENTS[P.life.village].color, 2, 3, 0.7, 1);
      scene.remove(m);
      pickups.splice(i, 1);
      lessonCount('gather');
      continue;
    }
    if (Math.hypot(m.position.x - P.pos.x, m.position.z - P.pos.z) < 1.5 && task?.type === 'gather') {
      burst(m.position.x, m.position.y, m.position.z, 18, ELEMENTS[P.life.village].color, 2, 3, 0.7, 1);
      scene.remove(m);
      pickups.splice(i, 1);
      task.have++;
      floatText(headPos(), `${task.have}/${task.n}`, 'xp', 1);
      updateQuest();
      if (task.have >= task.n) { clearPickups(); finishTask(); }
    }
  }
}
function trainHit(reach, fx, fz) {
  trainHitAcademy(reach, fx, fz);
  const task = P.life?.task;
  if (task?.type !== 'train') return;
  for (const d of nwSite.dummies[P.life.village] ?? []) {
    const dx = d.x - P.pos.x, dz = d.z - P.pos.z, dist = Math.hypot(dx, dz);
    if (dist > reach || (dx * fx + dz * fz) / (dist || 1) < 0) continue;
    task.have++;
    spawnImpact(d.x, height(d.x, d.z) + 1.4, d.z, { color: 0xffe0a0, size: 1 });
    floatText(new THREE.Vector3(d.x, height(d.x, d.z) + 2.4, d.z), `${task.have}/${task.n}`, 'xp', 0.8);
    updateQuest();
    if (task.have >= task.n) finishTask();
    return;
  }
}
function lifeKill(e) {
  squadKill(e);
  if (e.type.startsWith('imp_')) lessonCount('imps');
  if (e.type.startsWith('beast_')) lessonCount('oni');
  if (e.spar) lessonCount('spar');
  const m = P.life?.mission;
  if (m?.type === 'clear' && e.type === 'beast_' + ELEMENTS[m.v].key) { m.have++; updateQuest(); if (m.have >= m.n) missionDone(); }
  if (m?.type === 'duel' && e === champion) {
    setTimeout(() => banner('The champion yields', `${ELEMENTS[m.v].village} honors your victory.`, 3), 600);
    missionDone();
  }
  const task = P.life?.task;
  if (task?.type !== 'hunt' || !e.type.startsWith(task.what + '_')) return;
  task.have++;
  updateQuest();
  if (task.have >= task.n) finishTask();
}
function finishTask() {
  const L = P.life, task = L.task, el = ELEMENTS[L.village];
  L.task = null;
  L.done++;
  const gold = task.pay ?? 10 + L.age * 4, xp = 25 + L.age * 8;
  P.gold += gold;
  gainXP(xp);
  floatText(headPos(), `+${gold} gold`, 'gold', 1.4);
  if (task.gift && !P.ownedWeapons.includes(task.gift)) {
    P.ownedWeapons.push(task.gift);
    P.weapon = task.gift;
  }
  ageUp(task.gift ? `${el.sensei} gives you a real steel katana!` : null);
}
function ageUp(note) {
  const L = P.life;
  L.age++;
  P.hp = maxHp();
  rebuildPlayerRig();
  resizeCompanions();
  burst(P.pos.x, P.y + 1.2, P.pos.z, 50, ELEMENTS[L.village].color, 3, 4, 1.1, 1);
  if (L.age === 12 && !L.graduated) note = `${ELEMENTS[L.village].sensei}: "A real sword? Not until you graduate from the Academy!"`;
  if (L.age === RIVAL_AGE) note = 'The other villages now see you as a warrior of ' + ELEMENTS[L.village].village + '. Their guards will not let you pass. Visit their envoys at the Crossroads.';
  if (L.age === ART_AGE) {
    const el = ELEMENTS[L.village];
    note = `${el.sensei} teaches you the ${el.name} art: ${el.art.name}! Press V.`;
    updateHint();
  }
  const sub = note ?? (L.age < 16 ? 'You grow a little taller.' : L.age === 16 ? 'You are grown. The elder wants to see you.' : 'Another year of your new life.');
  banner(L.age === 16 ? 'Sixteen years old' : `Happy birthday! Age ${L.age}`, sub, 3);
  setTimeout(() => { if (P.life === L && !L.task) nextTask(); save(); }, 3200);
  save();
}
function comingOfAge() {
  const L = P.life, el = ELEMENTS[L.village];
  L.adult = true;
  L.task = null;
  if (!P.ownedWeapons.includes(el.blade)) P.ownedWeapons.push(el.blade);
  P.weapon = el.blade;
  if (P.armor === 'cloth') P.armor = 'leather';
  rebuildPlayerRig();
  syncLife();
  screenFlash(0.6);
  burst(P.pos.x, P.y + 1.5, P.pos.z, 90, el.color, 4, 6, 1.4, 2);
  openModal(`<div class="kanji">${el.kanji}</div><h2 class="center">The Coming of Age</h2>
    <p>The whole village gathers. ${el.parents[0]} is crying, and ${el.parents[1]} pretends not to be.</p>
    <p>&ldquo;Ten years ago you fell from a black storm,&rdquo; the elder says. &ldquo;We raised you as one of our own. Today you are a ${el.name} samurai of ${el.village}.&rdquo;</p>
    <p>The elder places the village's heirloom in your hands: <b style="color:${el.css}">${WEAPONS[el.blade].name}</b>.</p>
    <p class="sub">&ldquo;But listen. Since the night you came, something has been growing under the sacred tree at the Crossroads. It speaks with the Demon King's voice.&rdquo;</p>
    <div class="btns"><button data-act="close">Accept the blade</button></div>`, 'dialog');
  save();
  setTimeout(() => { if (!L.task) nextTask(); }, 400);
}
function echoDefeated() {
  const L = P.life;
  if (!L) return;
  L.echoDead = true;
  L.task = null;
  save();
  setTimeout(() => {
    openModal(`<div class="kanji">新生</div><h1>A New Legend</h1>
      <p class="center">The echo of Shuten-doji screams and fades into the roots of the sacred tree. This time, he is gone for good.</p>
      <p class="center">The five villages light lanterns all night in your name. You have lived two lives, and saved two worlds.</p>
      <p class="center sub">Your life goes on: the villages still need a samurai. Take on jobs from your family for gold, and grow old in peace.</p>
      <div class="btns"><button data-act="close">Live on</button></div>`, 'victory');
    nextTask();
  }, 2500);
}
// ---- Village arts: each element's own power, on V. Taught by the sensei at age 8.
const ART_AGE = 8;
function useArt() {
  if (!P.life || ui || P.dead || !started) return;
  const el = ELEMENTS[P.life.village], art = el.art;
  if (P.life.age < ART_AGE) { banner('', `${el.sensei} will teach you the ${el.name} art when you are ${ART_AGE}.`, 2); return; }
  if (inInterior(P.pos.x)) return;
  if (['special', 'whirl', 'dodge', 'stunned'].includes(P.state)) return;
  if (P.artCd > 0) { floatText(headPos(), Math.ceil(P.artCd) + 's', 'xp', 0.7); return; }
  // Arts grow stronger as you grow up.
  const pow = atkPower() * (0.55 + 0.45 * growth());
  const A = { heavy: true, finisher: true, mult: 1 };
  const near = r => enemies.filter(e => e.alive && distTo(e) < r && Math.abs(height(e.pos.x, e.pos.z) - P.y) < 4);
  const hurt = (e, mult, kb = 1) => {
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    damageEnemy(e, Math.round(pow * mult * rand(0.9, 1.1)), false, A, dx / d * kb, dz / d * kb);
  };
  const ey = e => height(e.pos.x, e.pos.z) + e.def.scale * 1.3;
  P.state = 'idle'; P.blocking = false;
  if (!isArcher()) unsheath();
  shake(0.35); fovKick = 4;
  switch (el.key) {
    case 'shadow': {
      const t = near(16).sort((a, b) => distTo(a) - distTo(b))[0];
      burst(P.pos.x, P.y + 1.2, P.pos.z, 50, 0x6a3aaa, 3, 4, 0.8, 0);
      if (t) {
        const dx = t.pos.x - P.pos.x, dz = t.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
        P.pos.set(t.pos.x + dx / d * (t.def.radius + 1.2), 0, t.pos.z + dz / d * (t.def.radius + 1.2));
        P.facing = Math.atan2(-dx, -dz);
        hurt(t, 2.6, 1);
        spawnSlashLine(new THREE.Vector3(P.pos.x, P.y + 1.3, P.pos.z), new THREE.Vector3(t.pos.x, ey(t), t.pos.z), { color: 0xb48cff, width: 0.5, life: 0.4 });
      } else {
        P.pos.x += Math.sin(P.facing) * 9; P.pos.z += Math.cos(P.facing) * 9;
      }
      P.y = height(P.pos.x, P.pos.z);
      P.invul = 0.8; P.hiddenT = 2.5;
      for (const e of enemies) if (e.alive && !e.role && distTo(e) < 25 && e.state !== 'dead') { e.state = 'return'; e.t = 0; }
      burst(P.pos.x, P.y + 1.2, P.pos.z, 50, 0xb48cff, 3, 4, 0.8, 0);
      break;
    }
    case 'fire': {
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        for (const r of [2.5, 4.5, 6.5]) burst(P.pos.x + Math.cos(a) * r, P.y + 0.4, P.pos.z + Math.sin(a) * r, 2, k % 2 ? 0xff7a1a : 0xffd040, 2, 5, 0.7, -3);
      }
      for (const e of near(7.5)) { hurt(e, 1.6, 1); e.burnT = 4; e.burnDmg = Math.max(3, Math.round(pow * 0.18)); }
      screenFlash(0.25);
      break;
    }
    case 'golden': {
      const ts = near(18).sort((a, b) => distTo(a) - distTo(b)).slice(0, 5);
      ts.forEach((e, k) => setTimeout(() => {
        if (!e.alive) return;
        const top = new THREE.Vector3(e.pos.x + rand(-2, 2), ey(e) + 24, e.pos.z + rand(-2, 2));
        spawnBolt(top, new THREE.Vector3(e.pos.x, ey(e), e.pos.z), 0xffe060);
        spawnImpact(e.pos.x, ey(e), e.pos.z, { color: 0xffe060, size: 2.4 });
        hurt(e, 2.0, 0.5);
        if (e.alive && !isKing(e)) { e.state = 'hurt'; e.t = -0.6; }
      }, k * 120));
      if (!ts.length) spawnBolt(new THREE.Vector3(P.pos.x, P.y + 26, P.pos.z), new THREE.Vector3(P.pos.x + Math.sin(P.facing) * 5, P.y, P.pos.z + Math.cos(P.facing) * 5), 0xffe060);
      screenFlash(0.4);
      break;
    }
    case 'ice': {
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        burst(P.pos.x + Math.cos(a) * 3, P.y + 0.6, P.pos.z + Math.sin(a) * 3, 3, 0xbfe8ff, 6, 2, 0.8, 1);
      }
      for (const e of near(8)) {
        hurt(e, 1.1, 0.2);
        if (!e.alive) continue;
        e.slowT = 6;
        if (!isKing(e)) { e.state = 'hurt'; e.t = e.role ? -1.2 : -3; }
        floatText(new THREE.Vector3(e.pos.x, ey(e) + 1.2, e.pos.z), 'Frozen', 'xp', 1);
        burst(e.pos.x, ey(e), e.pos.z, 24, 0xdff4ff, 2, 2, 1.2, 0);
      }
      break;
    }
    case 'water': {
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        burst(P.pos.x + Math.cos(a) * 1.5, P.y + 0.5, P.pos.z + Math.sin(a) * 1.5, 3, 0x5ac8f0, 9, 3, 0.7, 6);
      }
      for (const e of near(8)) hurt(e, 0.9, 2.2);
      const heal = Math.round(maxHp() * 0.33);
      P.hp = Math.min(maxHp(), P.hp + heal);
      floatText(headPos(), '+' + heal, 'heal', 1.2);
      break;
    }
  }
  floatText(new THREE.Vector3(P.pos.x, P.y + 3.2, P.pos.z), art.name, 'crit', 1.1);
  P.artCd = P.life.lesson?.type === 'art' ? 1.5 : art.cd;
  const ac = academyHere();
  if (ac && Math.hypot(P.pos.x - ac.x, P.pos.z - ac.z) < 14) lessonCount('art');
}

// ---- Envoys, missions and alliances.
const MISSION_TEXT = {
  clear: (m, el) => `Drive off ${m.n} ${el.name} Oni in the wilds near ${el.village} (${m.have}/${m.n})`,
  gift: (m, el) => `Carry a gift of ${m.gold} gold to the elder of ${el.village}`,
  duel: (m, el) => `Defeat the Champion of ${el.village} under the sacred tree`,
};
function openEnvoy(k) {
  const el = ELEMENTS[k], L = P.life;
  if (!L) {
    openModal(`<h2>Envoy of ${el.village}</h2><p>&ldquo;Peace under the tree, stranger.&rdquo;</p><div class="btns"><button class="secondary" data-act="close">Farewell (E)</button></div>`, 'dialog');
    return;
  }
  if (k === L.village) {
    openModal(`<h2>Envoy of ${el.village}</h2><p>&ldquo;Ah, one of ours! The other envoys watch you closely. Win them over, and ${el.village} will be stronger for it.&rdquo;</p>
      ${relationsHtml()}<div class="btns"><button class="secondary" data-act="close">Farewell (E)</button></div>`, 'dialog');
    return;
  }
  const done = L.missions[k], rel = relName(k), m = L.mission;
  let body;
  if (L.age < RIVAL_AGE) body = `<p>&ldquo;Run along, child. The quarrels between villages are not for you&hellip; yet.&rdquo;</p>`;
  else if (m && m.v === k) body = `<p>&ldquo;Well? ${el.village} is waiting.&rdquo;</p><p class="sub">Mission: ${MISSION_TEXT[m.type](m, el)}</p>`;
  else if (m) body = `<p>&ldquo;Finish your business with ${ELEMENTS[m.v].village} first.&rdquo;</p>`;
  else {
    const type = done === 0 ? 'clear' : done === 1 ? 'gift' : done === 2 ? 'duel' : 'clear';
    const pitch = {
      clear: done >= 3 ? `&ldquo;Ally, the wild oni are restless again near ${el.village}. Will you help? We pay well.&rdquo;` : `&ldquo;You are from ${ELEMENTS[L.village].village}. Why should we trust you? Wild oni threaten our fields. Drive them off, and we will talk.&rdquo;`,
      gift: `&ldquo;You kept your word. Now show respect: bring our elder a gift, and our gates will open to you.&rdquo;`,
      duel: `&ldquo;One last test. Our champion will meet you here, under the tree. Win, and ${el.village} will stand beside you as an ally.&rdquo;`,
    }[type];
    body = `<p>${pitch}</p><div class="btns"><button data-act="mission|${k}">Accept the mission</button></div>`;
  }
  const ally = isAlly(k) && L.age >= RIVAL_AGE;
  openModal(`<h2>Envoy of ${el.village} <span class="relbadge rel-${rel.replace(' ', '')}">${rel}</span></h2>
    ${body}
    ${ally ? (L.ally === k ? `<p class="sub">${el.name} warrior ${allyName(k)} travels with you.</p><div class="btns"><button class="secondary" data-act="dismiss">Send ${allyName(k)} home</button></div>`
      : `<p class="sub">As an ally, ${el.village} will lend you a warrior to fight at your side.</p><div class="btns"><button data-act="recruit|${k}">Ask for a warrior</button></div>`) : ''}
    <div class="btns" style="margin-top:10px"><button class="secondary" data-act="close">Farewell (E)</button></div>`, 'dialog');
}
function relationsHtml() {
  return `<div class="relations">${ELEMENTS.map(el => `<div><b style="color:${el.css}">${el.kanji} ${el.village}</b><span class="relbadge rel-${relName(el.index).replace(' ', '')}">${relName(el.index)}</span></div>`).join('')}</div>`;
}
function startMission(k) {
  const L = P.life, done = L.missions[k], el = ELEMENTS[k];
  const type = done === 0 ? 'clear' : done === 1 ? 'gift' : done === 2 ? 'duel' : 'clear';
  const m = { v: k, type, have: 0, n: type === 'clear' ? (done >= 3 ? 3 : 2) : 1, gold: 150 };
  L.mission = m;
  closeModal();
  if (type === 'clear') for (const e of enemies) if (!e.alive && e.type === 'beast_' + el.key && !e.summoned) respawnEnemy(e);
  if (type === 'duel') ensureChampion(k);
  banner('Mission for ' + el.village, MISSION_TEXT[type](m, el), 3.2);
  updateQuest();
  save();
}
let champion = null;
function ensureChampion(k) {
  const el = ELEMENTS[k];
  if (!champion || champion.type !== 'champion_' + el.key) {
    if (champion) markDead(champion);
    champion = createEnemy('champion_' + el.key, NW.x - 8, NW.z - 8, { role: 'champion', title: 'Champion of ' + el.village, facing: 0 });
  } else if (!champion.alive) respawnEnemy(champion);
  champion.talked = false;
}
// Bring older saves up to date and put the world in line with the life story.
function syncRelations() {
  const L = P.life;
  if (!L) { if (champion?.alive) markDead(champion); spawnCompanion(); return; }
  if (!L.rel) L.rel = ELEMENTS.map((_, k) => (k === L.village ? 100 : -30));
  if (!L.missions) L.missions = [0, 0, 0, 0, 0];
  if (L.mission === undefined) L.mission = null;
  if (L.ally === undefined) L.ally = null;
  if (!L.badges) L.badges = [];
  if (L.lesson === undefined) L.lesson = null;
  if (L.smission === undefined) L.smission = null;
  if (L.lesson && !lessonDef(L.lesson.id)) L.lesson = null;
  if (L.age < 16 && L.task && L.task.type !== 'ceremony') L.task = null;
  setupLesson();
  if (L.squadFollow === undefined) L.squadFollow = true;
  setupSquadMission();
  if (L.mission?.type === 'duel') ensureChampion(L.mission.v);
  else if (champion?.alive) markDead(champion);
  spawnCompanion();
}
function deliverGift() {
  const m = P.life.mission, el = ELEMENTS[m.v];
  if (P.gold < m.gold) {
    openModal(`<h2>Elder of ${el.village}</h2><p>&ldquo;You came with empty hands? Come back with ${m.gold} gold.&rdquo;</p><div class="btns"><button class="secondary" data-act="close">Leave</button></div>`, 'dialog');
    return;
  }
  P.gold -= m.gold;
  openModal(`<h2>Elder of ${el.village}</h2><p>&ldquo;A fine gift. Perhaps ${ELEMENTS[P.life.village].village} is not so bad after all.&rdquo;</p><div class="btns"><button data-act="close">Bow</button></div>`, 'dialog');
  missionDone();
}
function missionDone() {
  const L = P.life, m = L.mission, k = m.v, el = ELEMENTS[k];
  const before = relName(k);
  L.missions[k]++;
  L.rel[k] = Math.min(100, L.rel[k] + 30);
  L.mission = null;
  const gold = L.missions[k] > 3 ? 150 : 40 * L.missions[k];
  P.gold += gold;
  gainXP(80 + 20 * L.missions[k]);
  const after = relName(k);
  if (after !== before && after === 'At peace') banner('Peace with ' + el.village, 'Their guards stand down, and their gates open to you.', 4);
  else if (after !== before && after === 'Ally') banner('Alliance with ' + el.village + '!', 'Discounts in their shops, and their envoy will lend you a warrior.', 4.5);
  else banner('Mission complete', `${el.village} thanks you. +${gold} gold`, 3);
  burst(P.pos.x, P.y + 1.4, P.pos.z, 60, el.color, 3, 5, 1.2, 2);
  updateQuest();
  save();
}
// ---- A warrior from an allied village who travels and fights beside you.
const ALLY_NAMES = ['Kuroha', 'Hibiki', 'Kinji', 'Shizuka', 'Ren'];
const allyName = k => ALLY_NAMES[k];
const companions = [];
function recruitAlly(k) {
  P.life.ally = k;
  rebuildCompanions();
  closeModal();
  banner(allyName(k) + ' joins you', `A ${ELEMENTS[k].name} warrior of ${ELEMENTS[k].village} will fight at your side.`, 3);
  save();
}
function dismissAlly() {
  P.life.ally = null;
  rebuildCompanions();
  closeModal();
  save();
}
function spawnCompanion() { rebuildCompanions(); }
// Squad mates grow up with you.
function resizeCompanions() { for (const c of companions) if (c.k === P.life?.village && c.slot !== 0) c.rig.root.scale.setScalar(ageScale()); }
function rebuildCompanions() {
  for (const c of companions) scene.remove(c.rig.root);
  companions.length = 0;
  const L = P.life;
  if (!L) return;
  const add = (name, k, opts, slot) => {
    const rig = makeHumanoid(opts);
    rig.root.scale.setScalar(opts.kid ? ageScale() : 1);
    scene.add(rig.root);
    companions.push({ name, k, rig, slot, pos: P.pos.clone().add(new THREE.Vector3(slot * 2, 0, 2)), facing: 0, cd: Math.random(), swing: 0, target: null });
  };
  const el = ELEMENTS[L.village];
  if (L.graduated && L.squad && L.squadFollow) {
    L.squad.mates.forEach((name, i) => add(name, L.village, {
      cloth: i ? el.color : 0x2a2a34, cloth2: i ? 0x1a1a1a : el.color, hat: i ? 'band' : null, bandColor: el.color, scarf: el.color,
      weapon: 'katana', skin: [0xe0b48a, 0xc99a72][i], hair: [0x1a1410, 0x5a3020][i], kid: true,
    }, i ? 1 : -1));
  }
  if (L.ally !== null && L.ally !== undefined) {
    const ae = ELEMENTS[L.ally];
    add(allyName(L.ally), L.ally, { cloth: ae.color, cloth2: 0x1a1a1a, hat: 'band', bandColor: ae.color, armor: 0x3a3a40, weapon: 'katana', skin: 0xd6a37e }, 0);
  }
}
function updateCompanion(dt) {
  const inside = inInterior(P.pos.x);
  for (const c of companions) {
    c.rig.root.visible = !inside;
    if (inside) continue;
    if (Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) > 35) c.pos.set(P.pos.x - Math.sin(P.facing) * 2.5 + c.slot * 1.5, 0, P.pos.z - Math.cos(P.facing) * 2.5);
    // Pick the nearest foe that is fighting near the player.
    if (!c.target || !c.target.alive || distTo(c.target) > 18) {
      c.target = null;
      let bd = 14;
      for (const e of enemies) {
        if (!e.alive || e.spar || (e.faction !== undefined && !hostileTo(e.faction)) || e.state === 'idle' || e.state === 'return') continue;
        const d = distTo(e);
        if (d < bd) { bd = d; c.target = e; }
      }
    }
    let tx, tz, stop;
    if (c.target) { tx = c.target.pos.x + c.slot * 0.8; tz = c.target.pos.z; stop = c.target.def.radius + 1.4; }
    else {
      const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
      tx = P.pos.x - fx * 2.4 + fz * 1.8 * c.slot; tz = P.pos.z - fz * 2.4 - fx * 1.8 * c.slot; stop = 0.8;
    }
    const dx = tx - c.pos.x, dz = tz - c.pos.z, d = Math.hypot(dx, dz);
    let moving = 0;
    if (d > stop) {
      const sp = Math.min(d - stop, (c.target ? 6.8 : d > 6 ? 10 : 6) * dt);
      c.pos.x += dx / d * sp; c.pos.z += dz / d * sp;
      moving = 1;
    }
    if (d > 0.1) c.facing = angleLerp(c.facing, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
    collideStatic(c.pos, 0.4);
    c.cd -= dt;
    if (c.target && d <= stop + 0.5 && c.cd <= 0) {
      c.cd = 1.1; c.swing = 0.35;
      const e = c.target, nx = (e.pos.x - c.pos.x) / (d || 1), nz = (e.pos.z - c.pos.z) / (d || 1);
      const dmg = Math.round((8 + P.lvl * 3) * rand(0.9, 1.1));
      spawnImpact(e.pos.x - nx * e.def.radius, height(e.pos.x, e.pos.z) + e.def.scale * 1.3, e.pos.z - nz * e.def.radius, { color: ELEMENTS[c.k].color, size: 1.3 });
      damageEnemy(e, dmg, false, { mult: 1 }, nx, nz);
    }
    c.swing = Math.max(0, c.swing - dt);
    c.rig.root.position.set(c.pos.x, height(c.pos.x, c.pos.z), c.pos.z);
    c.rig.root.rotation.y = c.facing;
    c.rig.armR.rotation.x = c.swing > 0 ? lerp(-2.4, 0.6, 1 - c.swing / 0.35) : lerp(c.rig.armR.rotation.x, REST_ARM, 0.15);
    animateWalk(c.rig, dt, moving);
  }
}

// ============================================================ The Academy
// Children of each village train in the academy yard. Ten lessons; graduates are
// given a real sword and assigned to a squad that takes ranked missions.
const ACADEMY_MASTER = ['Master Oboro', 'Master Kagari', 'Master Kohaku', 'Master Hyou', 'Master Nagisa'];
const SQUAD_MATES = [['Kage-no-Rin', 'Tobi'], ['Hinata', 'Rokuro'], ['Kinta', 'Sayo'], ['Yukiko', 'Tetsu'], ['Mio', 'Kaito']];
// The curriculum: ten school years from age 6 to 15, three missions each. Finishing a
// year's missions is a birthday; finishing year ten (at 16) is graduation.
const T = {
  rings: (l, d) => `Run through the glowing rings in order (${l.have}/${d.n}) &middot; ${Math.ceil(l.t)}s`,
  strikes: (l, d) => `Strike the academy dummies (${l.have}/${d.n})`,
  targets: (l, d) => `Hit each straw target around the yard (${l.have}/${d.n})`,
  guard: (l, d) => `Hold Q and block your sparring partner's blows (${l.have}/${d.n})`,
  parry: (l, d) => `Tap Q just as a blow lands to parry it (${l.have}/${d.n})`,
  roll: (l, d) => `Roll (F) through your partner's attacks (${l.have}/${d.n})`,
  art: (l, d) => `Use your village art (V) in the academy yard (${l.have}/${d.n})`,
  spar: () => 'Win a sparring match against your classmate',
  race: (l) => (l.have ? 'Now run back to the master!' : 'Run to the far village gate') + ` &middot; ${Math.ceil(l.t)}s`,
  imps: (l, d) => `Drive off spirit imps in the wilds (${l.have}/${d.n})`,
  oni: (l, d) => `Hunt wild oni far out in the wilds (${l.have}/${d.n})`,
  water: (l) => (l.have ? 'Carry the bucket to the academy master' : 'Draw water from the village well'),
  gather: (l, d) => `Collect ${ELEMENTS[P.life.village].item} around the village (${l.have}/${d.n})`,
  jump: (l, d) => `Jump (Space) in the academy yard (${l.have}/${d.n})`,
  meditate: (l, d) => `Stand still by the ${ELEMENTS[P.life.village].name} monument and breathe (${Math.floor(l.have)}/${d.n}s)`,
  deliver: (l) => `Carry the master's letter to the elder of ${TOWNS[l.target].name}`,
};
const CURRICULUM = [
  [{ id: 'y1a', type: 'rings', name: 'Footwork', n: 6, time: 70 }, { id: 'y1b', type: 'strikes', name: 'First Cuts', n: 6 }, { id: 'y1c', type: 'water', name: 'Water for the Academy', n: 2 }],
  [{ id: 'y2a', type: 'targets', name: 'Target Practice', n: 4 }, { id: 'y2b', type: 'gather', name: 'Herb Gathering', n: 5 }, { id: 'y2c', type: 'jump', name: 'Leaping Crane', n: 5 }],
  [{ id: 'y3a', type: 'art', name: 'Your Village Art', n: 2 }, { id: 'y3b', type: 'guard', name: 'Guard Up', n: 4 }, { id: 'y3c', type: 'strikes', name: 'A Hundred Cuts', n: 12 }],
  [{ id: 'y4a', type: 'deliver', name: 'The First Letter', hop: 1, n: 1 }, { id: 'y4b', type: 'meditate', name: 'Still Water', n: 12 }, { id: 'y4c', type: 'rings', name: 'Swift Feet', n: 6, time: 50 }],
  [{ id: 'y5a', type: 'parry', name: 'The Parry', n: 2 }, { id: 'y5b', type: 'roll', name: 'Rolling Escape', n: 4 }, { id: 'y5c', type: 'imps', name: 'Imp Patrol', n: 2 }],
  [{ id: 'y6a', type: 'spar', name: 'Sparring Match', n: 1 }, { id: 'y6b', type: 'gather', name: 'Deep Gathering', n: 7 }, { id: 'y6c', type: 'race', name: 'Gate Run', n: 2, time: 80 }],
  [{ id: 'y7a', type: 'imps', name: 'Clearing the Paths', n: 4 }, { id: 'y7b', type: 'deliver', name: 'The Far Letter', hop: 2, n: 1 }, { id: 'y7c', type: 'targets', name: 'Eagle Eye', n: 4 }],
  [{ id: 'y8a', type: 'guard', name: 'Iron Guard', n: 8 }, { id: 'y8b', type: 'parry', name: 'Turning Steel', n: 4 }, { id: 'y8c', type: 'art', name: 'Mastering the Art', n: 4 }],
  [{ id: 'y9a', type: 'spar', name: 'The Rematch', n: 1, tough: true }, { id: 'y9b', type: 'oni', name: 'First Oni Hunt', n: 1 }, { id: 'y9c', type: 'race', name: 'Wind Runner', n: 2, time: 65 }],
  [{ id: 'y10a', type: 'imps', name: 'Final Exam: The Wilds', n: 5 }, { id: 'y10b', type: 'oni', name: 'Final Exam: The Oni', n: 2 }, { id: 'y10c', type: 'meditate', name: 'Final Exam: Clear Mind', n: 20 }],
];
const ALL_LESSONS = CURRICULUM.flat();
const lessonDef = id => ALL_LESSONS.find(d => d.id === id);
const lessonText = l => T[lessonDef(l.id).type](l, lessonDef(l.id));
const ringMeshes = [];
let sparPartner = null;
function academyHere() {
  const L = P.life;
  return L ? nwSite.academy[L.village] : null;
}
// The school year a child is in: their age, capped at year ten.
const schoolYear = () => clamp(P.life.age - 6, 0, 9);
function openAcademy(town) {
  const L = P.life, el = ELEMENTS[town.element], master = ACADEMY_MASTER[town.element];
  if (!L || L.village !== town.element) {
    openModal(`<h2>${master}</h2><p>&ldquo;This academy trains the children of ${el.village}. Off you go.&rdquo;</p><div class="btns"><button class="secondary" data-act="close">Bow (E)</button></div>`, 'dialog');
    return;
  }
  if (L.graduated) { openMissionDesk(); return; }
  const y = schoolYear(), year = CURRICULUM[y], active = L.lesson;
  const rows = year.map(d => {
    const done = L.badges.includes(d.id);
    const btn = done ? '<div class="price">Passed</div>' : active ? '' : `<button data-act="lesson|${d.id}">Begin</button>`;
    return `<div class="item ${done ? 'passed' : ''}"><div class="rank rank-D">${done ? '&#10004;' : y + 1}</div><div class="meta"><div class="name">${d.name}</div><div class="desc">${T[d.type]({ have: 0, t: d.time ?? 0, target: d.hop ? ELEMENTS[(L.village + d.hop) % 5].town.index : 0 }, d).replace(/ &middot;.*$/, '').replace(/\(0\/\d+s?\)/, '')}</div></div>${btn}</div>`;
  }).join('');
  const total = L.badges.filter(id => lessonDef(id)).length;
  openModal(`<h2>${master} &middot; ${el.village} Academy</h2>
    <p>&ldquo;${total === 0 ? 'Welcome, little one! Every samurai of ' + el.village + ' grows up here. Finish each year\'s three missions, and you grow a year older. Finish all ten years, and you graduate with a real sword and a squad of your own.' : 'Year ' + (y + 1) + '. Discipline is a habit, little one.'}&rdquo;</p>
    <p class="sub">Year ${y + 1} of 10 &middot; ${total}/${ALL_LESSONS.length} academy missions passed &middot; each one: +3 max health</p>
    <div class="items">${rows}</div>
    <div class="btns">${active ? `<button class="secondary" data-act="quitLesson">Give up: ${lessonDef(active.id).name}</button>` : ''}<button class="secondary" data-act="close">Bow (E)</button></div>`, 'dialog');
}
function startLesson(id) {
  const L = P.life, def = lessonDef(id);
  if (!def || L.lesson) return;
  L.lesson = { id, type: def.type, have: 0, t: def.time ?? 0, hit: [] };
  if (def.type === 'deliver') L.lesson.target = ELEMENTS[(L.village + def.hop) % 5].town.index;
  closeModal();
  setupLesson();
  banner('Academy: ' + def.name, lessonText(L.lesson).replace(/ &middot;.*$/, ''), 3);
  updateQuest();
  save();
}
// Spawn whatever the active lesson needs (also after loading a save).
function setupLesson() {
  const l = P.life?.lesson;
  clearRings();
  if (!l) return;
  if (l.type === 'rings') showRings();
  if (['guard', 'parry', 'roll', 'spar'].includes(l.type)) ensureSpar(l.type === 'spar', lessonDef(l.id).tough);
  if (l.type === 'gather') spawnPickups(lessonDef(l.id).n + 2);
}
function endLesson(passed) {
  const L = P.life, l = L.lesson;
  if (!l) return;
  L.lesson = null;
  clearRings();
  if (l.type === 'gather') clearPickups();
  if (sparPartner?.alive) markDead(sparPartner);
  if (!passed) { banner('Mission stopped', 'Try again anytime at the academy.', 1.8); updateQuest(); save(); return; }
  const def = lessonDef(l.id);
  L.badges.push(def.id);
  gainXP(20 + schoolYear() * 8);
  P.gold += 5 + schoolYear() * 3;
  P.hp = maxHp();
  floatText(headPos(), '+3 max HP', 'heal', 1.4);
  burst(P.pos.x, P.y + 1.2, P.pos.z, 40, ELEMENTS[L.village].color, 3, 4, 1, 1);
  const year = CURRICULUM[schoolYear()];
  if (year.every(d => L.badges.includes(d.id))) {
    // A school year finished: a year older.
    if (schoolYear() === 9) { ageUp('You passed every year of the Academy!'); setTimeout(graduate, 3400); }
    else ageUp(`Year ${schoolYear() + 1} of the Academy complete!`);
  } else banner('Passed: ' + def.name, `${year.filter(d => L.badges.includes(d.id)).length}/3 missions this year`, 2.6);
  updateQuest();
  save();
}
function lessonCount(type, by = 1) {
  const l = P.life?.lesson;
  if (!l || l.type !== type) return;
  const def = lessonDef(l.id);
  l.have += by;
  if (type !== 'meditate') floatText(headPos(), `${l.have}/${def.n}`, 'xp', 0.8);
  updateQuest();
  if (l.have >= def.n) endLesson(true);
}
function ensureSpar(forReal, tough) {
  const ac = academyHere();
  if (!sparPartner) {
    sparPartner = createEnemy('student', ac.x, ac.z + 2, { role: 'spar', title: 'Classmate' });
    sparPartner.spar = true;
  } else {
    sparPartner.home.set(ac.x, 0, ac.z + 2);
    respawnEnemy(sparPartner);
  }
  sparPartner.maxHp = sparPartner.hp = tough ? 260 : 110;
  sparPartner.dmg = tough ? 8 : 4;
  sparPartner.talked = true;
  sparPartner.realMatch = forReal;
  sparPartner.state = 'chase';
}
function showRings() {
  clearRings();
  const ac = academyHere();
  const geo = new THREE.TorusGeometry(1.3, 0.12, 8, 28);
  ac.rings.forEach((r, i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffe080, emissive: 0xffc040, emissiveIntensity: i === 0 ? 2.4 : 0.6 }));
    m.position.set(r.x, height(r.x, r.z) + 1.4, r.z);
    scene.add(m);
    ringMeshes.push(m);
  });
}
function clearRings() {
  for (const m of ringMeshes) scene.remove(m);
  ringMeshes.length = 0;
}
let wasGrounded = true;
function updateAcademy(dt) {
  const L = P.life, l = L?.lesson;
  if (!l) return;
  const def = lessonDef(l.id), ac = academyHere();
  if (!def) { L.lesson = null; return; }
  if (def.time) {
    l.t -= dt;
    if (l.t <= 0) { banner('Too slow!', 'Talk to the master to try again.', 2.5); endLesson(false); return; }
    if (Math.floor(l.t) !== Math.floor(l.t + dt)) updateQuest();
  }
  const inYard = Math.hypot(P.pos.x - ac.x, P.pos.z - ac.z) < 9;
  if (l.type === 'rings') {
    ringMeshes.forEach((m, i) => { m.rotation.y += dt * 2; m.visible = i >= l.have; m.material.emissiveIntensity = i === l.have ? 2.4 : 0.4; });
    const r = ac.rings[l.have];
    if (r && Math.hypot(P.pos.x - r.x, P.pos.z - r.z) < 2) { burst(r.x, P.y + 1.4, r.z, 20, 0xffe080, 3, 3, 0.6, 0); lessonCount('rings'); }
  } else if (l.type === 'race') {
    const goal = l.have === 0 ? ac.gate : ac.master;
    if (Math.hypot(P.pos.x - goal.x, P.pos.z - goal.z) < 4) { lessonCount('race'); if (P.life.lesson) banner('Halfway!', 'Now back to the master', 1.5); }
  } else if (l.type === 'jump') {
    if (inYard && wasGrounded && !P.grounded) lessonCount('jump');
  } else if (l.type === 'meditate') {
    const mo = ac.monument;
    const still = Math.hypot(P.pos.x - mo.x, P.pos.z - mo.z) < 6 && inputDir().len === 0 && P.state === 'idle';
    if (still) {
      const before = Math.floor(l.have);
      l.have += dt;
      if (Math.floor(l.have) !== before) { updateQuest(); if (Math.random() < 0.5) burst(P.pos.x, P.y + 1.6, P.pos.z, 6, ELEMENTS[L.village].color, 1, 1, 1, 1); }
      if (l.have >= def.n) endLesson(true);
    }
  } else if (l.type === 'water') {
    if (l.have === 1 && Math.hypot(P.pos.x - ac.master.x, P.pos.z - ac.master.z) < 4) { lessonCount('water'); banner('Thank you!', 'The master drinks deeply.', 1.6); }
  } else if (sparPartner && sparPartner.alive && ['guard', 'parry', 'roll', 'spar'].includes(l.type)) {
    // Keep the classmate in the yard and focused on you.
    if (sparPartner.state === 'idle' || sparPartner.state === 'return') { sparPartner.state = 'chase'; sparPartner.t = 0; }
  }
  wasGrounded = P.grounded;
}
function trainHitAcademy(reach, fx, fz) {
  const l = P.life?.lesson, ac = academyHere();
  if (!l || !ac) return;
  const list = l.type === 'strikes' ? ac.dummies : l.type === 'targets' ? ac.targets : null;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const dx = d.x - P.pos.x, dz = d.z - P.pos.z, dist = Math.hypot(dx, dz);
    if (dist > reach || (dx * fx + dz * fz) / (dist || 1) < 0.2) continue;
    if (l.type === 'targets') { if (l.hit.includes(i)) continue; l.hit.push(i); }
    spawnImpact(d.x, height(d.x, d.z) + 1.4, d.z, { color: 0xffe0a0, size: 1 });
    lessonCount(l.type);
    if (l.type === 'strikes') return;
  }
}
function graduate() {
  const L = P.life, el = ELEMENTS[L.village];
  L.graduated = true;
  if (!L.task && L.age >= 16 && !L.adult) setTimeout(nextTask, 600);
  L.squad = { name: 'Squad ' + (3 + L.village * 2), mates: SQUAD_MATES[L.village], done: 0, rankDone: { D: 0, C: 0, B: 0, A: 0, S: 0 } };
  L.squadFollow = true;
  if (!P.ownedWeapons.includes('steel')) P.ownedWeapons.push('steel');
  P.weapon = 'steel';
  rebuildPlayerRig();
  rebuildCompanions();
  screenFlash(0.5);
  openModal(`<div class="kanji">${el.kanji}</div><h2 class="center">Graduation Day</h2>
    <p>${ACADEMY_MASTER[L.village]} ties the ${el.name} headband around your forehead. &ldquo;You passed every lesson. You are a true student of ${el.village} now.&rdquo;</p>
    <p>You receive your first real sword: <b>${WEAPONS.steel.name}</b>.</p>
    <p>&ldquo;You are assigned to <b>${L.squad.name}</b>, with <b>${L.squad.mates[0]}</b> and <b>${L.squad.mates[1]}</b>. Your squad travels together and fights together. Come to me for missions: D rank first, and if you prove yourselves, all the way to S rank.&rdquo;</p>
    <div class="btns"><button data-act="close">Meet your squad</button></div>`, 'dialog');
  save();
}

// ---- Squad missions, ranked D to S, given out at the academy after graduation.
const RANKS = ['D', 'C', 'B', 'A', 'S'];
const RANK_NEED = { D: 0, C: 2, B: 4, A: 6, S: 8 };
const RANK_PAY = { D: [40, 40], C: [90, 80], B: [160, 150], A: [300, 300], S: [600, 600] };
const SQUAD_MISSIONS = {
  D: [{ type: 'cat', name: 'The runaway cat', text: 'The baker\'s cat Tora ran off into the fields. Find her and bring her back.' },
    { type: 'pests', n: 4, name: 'Pests in the fields', text: 'Imps are trampling the rice. Drive off four of them.' }],
  C: [{ type: 'escort', name: 'Escort the merchant', text: 'A merchant must reach another village safely. Bandit imps lurk on the road.' }],
  B: [{ type: 'hunt', n: 3, name: 'Oni hunt', text: 'Three wild oni are raiding travelers far out in the wilds. Hunt them down.' }],
  A: [{ type: 'rogue', name: 'The rogue ninja', text: 'A ninja who betrayed the village hides in the wilds with his gang. Stop him.' }],
  S: [{ type: 'warlord', name: 'The demon warlord', text: 'A demon warlord has crawled out of the earth with his oni. If he reaches a village, it will burn. S rank: only the best squads return.' }],
};
const rankOk = r => (P.life.squad.done >= RANK_NEED[r]);
function openMissionDesk() {
  const L = P.life, el = ELEMENTS[L.village], sq = L.squad, m = L.smission;
  const rows = RANKS.map(r => {
    const def = SQUAD_MISSIONS[r][(sq.rankDone[r] ?? 0) % SQUAD_MISSIONS[r].length];
    const [g, xp] = RANK_PAY[r];
    const ok = rankOk(r);
    const btn = m ? '' : ok ? `<button data-act="smission|${r}">Accept</button>` : `<button disabled>${RANK_NEED[r] - sq.done} more missions</button>`;
    return `<div class="item"><div class="rank rank-${r}">${r}</div><div class="meta"><div class="name">${def.name}</div><div class="desc">${def.text}</div></div><div class="price">&#9672; ${g}</div>${btn}</div>`;
  }).join('');
  openModal(`<h2>${ACADEMY_MASTER[L.village]} &middot; Mission Desk</h2>
    <p class="sub">${sq.name}: you, ${sq.mates.join(' and ')} &middot; ${sq.done} missions completed</p>
    ${m ? `<p>Current mission: <b>${m.name}</b> (${m.rank} rank). ${squadMissionText(m)}</p><div class="btns"><button class="secondary" data-act="quitSquad">Abandon mission</button></div>` : ''}
    <div class="items">${rows}</div>
    <div class="btns"><button class="secondary" data-act="squadFollow">${L.squadFollow ? 'Squad: wait in the village' : 'Squad: travel with me'}</button><button class="secondary" data-act="close">Bow (E)</button></div>`, 'dialog');
}
// A spot out in the wilds, far from any village.
function wildSpot(minD, maxD) {
  for (let k = 0; k < 200; k++) {
    const a = Math.random() * Math.PI * 2, r = rand(minD, maxD);
    const x = NW.x + Math.cos(a) * r, z = NW.z + Math.sin(a) * r;
    if (townDist(x, z) > 40 && height(x, z) > -0.3) return { x, z };
  }
  return { x: NW.x + 200, z: NW.z };
}
const missionFoes = [];
let catMesh = null, merchant = null;
function startSquadMission(rank) {
  const L = P.life, sq = L.squad;
  const def = SQUAD_MISSIONS[rank][(sq.rankDone[rank] ?? 0) % SQUAD_MISSIONS[rank].length];
  const m = { rank, type: def.type, name: def.name, have: 0, n: def.n ?? 1 };
  const home = ELEMENTS[L.village].town;
  if (m.type === 'cat') {
    const a = Math.random() * Math.PI * 2, d = home.r + rand(30, 90);
    m.spot = { x: home.x + Math.cos(a) * d, z: home.z + Math.sin(a) * d };
  } else if (m.type === 'escort') {
    m.dest = ELEMENTS[(L.village + (Math.random() < 0.5 ? 1 : 4)) % 5].town.index;
  } else if (m.type === 'rogue' || m.type === 'warlord') {
    m.spot = wildSpot(250, NW.r - 80);
  }
  L.smission = m;
  closeModal();
  setupSquadMission();
  banner(`${rank}-rank mission: ${def.name}`, squadMissionText(m), 3.5);
  updateQuest();
  save();
}
// Spawn whatever the active mission needs (also used after loading a save).
function setupSquadMission() {
  const m = P.life?.smission;
  clearMissionStuff();
  if (!m) return;
  const home = ELEMENTS[P.life.village].town;
  if (m.type === 'cat' && !m.found) {
    catMesh = makeCat();
    catMesh.position.set(m.spot.x, height(m.spot.x, m.spot.z), m.spot.z);
    scene.add(catMesh);
  } else if (m.type === 'cat' && m.found) {
    catMesh = makeCat(); scene.add(catMesh);
  } else if (m.type === 'escort') {
    merchant = makeHumanoid({ cloth: 0x7a5a2a, cloth2: 0x3a2a1a, hat: 'kasa', skin: 0xe0b48a });
    scene.add(merchant.root);
    merchant.pos = P.pos.clone().add(new THREE.Vector3(1.5, 0, 1.5));
    merchant.facing = 0;
  } else if (m.type === 'rogue') {
    const boss = createEnemy('ninjaMaster', m.spot.x, m.spot.z, { tier: 0.6, summoned: true });
    boss.title = 'Rogue Ninja Kurogiri'; boss.missionBoss = true;
    missionFoes.push(boss);
    for (let k = 0; k < 3; k++) missionFoes.push(createEnemy('ninja', m.spot.x + rand(-6, 6), m.spot.z + rand(-6, 6), { tier: 0.4, summoned: true }));
  } else if (m.type === 'warlord') {
    const boss = createEnemy('warlord', m.spot.x, m.spot.z, { tier: 0.8, summoned: true });
    boss.title = 'Warlord Akuma'; boss.missionBoss = true;
    missionFoes.push(boss);
    for (let k = 0; k < 4; k++) missionFoes.push(createEnemy('beast_' + ELEMENTS[k].key, m.spot.x + rand(-9, 9), m.spot.z + rand(-9, 9), { tier: 0.5, summoned: true }));
  }
  void home;
}
function clearMissionStuff() {
  if (catMesh) { scene.remove(catMesh); catMesh = null; }
  if (merchant) { scene.remove(merchant.root); merchant = null; }
  for (const e of missionFoes) if (e.alive) markDead(e);
  missionFoes.length = 0;
}
function makeCat() {
  const g = new THREE.Group(), fur = new THREE.MeshStandardMaterial({ color: 0xe08a3a, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8).scale(1.4, 0.8, 0.8), fur); body.position.y = 0.3; body.rotation.y = Math.PI / 2; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), fur); head.position.set(0, 0.5, 0.35); g.add(head);
  for (const sx of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 4), fur); ear.position.set(sx * 0.1, 0.7, 0.35); g.add(ear); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.5, 5), fur); tail.position.set(0, 0.45, -0.45); tail.rotation.x = -0.6; g.add(tail);
  g.traverse(o => { o.castShadow = true; });
  return g;
}
function squadMissionText(m) {
  switch (m.type) {
    case 'cat': return m.found ? `Bring Tora back to ${ACADEMY_MASTER[P.life.village]}` : 'Find Tora the cat in the fields around the village (marked on the map)';
    case 'pests': return `Drive off spirit imps near the village (${m.have}/${m.n})`;
    case 'escort': return `Escort the merchant safely to ${TOWNS[m.dest].name}${m.ambushed ? '' : '. Stay alert'}`;
    case 'hunt': return `Hunt wild oni in the far wilds (${m.have}/${m.n})`;
    case 'rogue': return 'Defeat Rogue Ninja Kurogiri and his gang (marked on the map)';
    case 'warlord': return 'Slay Warlord Akuma before he reaches a village (marked on the map)';
  }
  return '';
}
function updateSquadMission(dt) {
  const m = P.life?.smission;
  if (!m) return;
  const ac = academyHere();
  if (m.type === 'cat' && catMesh) {
    if (!m.found) {
      catMesh.rotation.y += dt * 0.5;
      if (Math.hypot(P.pos.x - m.spot.x, P.pos.z - m.spot.z) < 2.2) { m.found = true; banner('Found Tora!', 'She follows you. Bring her back to the academy.', 2.5); updateQuest(); }
    } else {
      const tx = P.pos.x - Math.sin(P.facing) * 1.2, tz = P.pos.z - Math.cos(P.facing) * 1.2;
      catMesh.position.x = lerp(catMesh.position.x, tx, 1 - Math.exp(-4 * dt));
      catMesh.position.z = lerp(catMesh.position.z, tz, 1 - Math.exp(-4 * dt));
      catMesh.position.y = height(catMesh.position.x, catMesh.position.z);
      catMesh.rotation.y = P.facing;
      if (Math.hypot(P.pos.x - ac.master.x, P.pos.z - ac.master.z) < 4) squadMissionDone();
    }
  } else if (m.type === 'escort' && merchant) {
    const dx = P.pos.x - merchant.pos.x, dz = P.pos.z - merchant.pos.z, d = Math.hypot(dx, dz);
    if (d > 2.2) { const sp = Math.min(d - 2.2, (d > 8 ? 8 : 5.5) * dt); merchant.pos.x += dx / d * sp; merchant.pos.z += dz / d * sp; merchant.facing = Math.atan2(dx, dz); }
    if (d > 40) merchant.pos.set(P.pos.x - 2, 0, P.pos.z - 2);
    merchant.root.position.set(merchant.pos.x, height(merchant.pos.x, merchant.pos.z), merchant.pos.z);
    merchant.root.rotation.y = merchant.facing;
    animateWalk(merchant, dt, d > 2.3 ? 1 : 0);
    const dest = TOWNS[m.dest], home = ELEMENTS[P.life.village].town;
    // An ambush halfway along the road.
    if (!m.ambushed && Math.hypot(P.pos.x - home.x, P.pos.z - home.z) > Math.hypot(dest.x - home.x, dest.z - home.z) * 0.45) {
      m.ambushed = true;
      banner('Ambush!', 'Protect the merchant!', 2);
      for (let k = 0; k < 4; k++) {
        const a = Math.random() * Math.PI * 2;
        const e = createEnemy('imp_' + ELEMENTS[TOWNS[m.dest].element].key, P.pos.x + Math.cos(a) * 12, P.pos.z + Math.sin(a) * 12, { tier: 0.5, summoned: true });
        e.state = 'chase';
        missionFoes.push(e);
      }
    }
    if (townDist(P.pos.x, P.pos.z) < 0 && townAt(P.pos.x, P.pos.z) === dest && townDist(merchant.pos.x, merchant.pos.z) < 0) squadMissionDone();
  }
}
function squadKill(e) {
  const m = P.life?.smission;
  if (!m) return;
  if ((m.type === 'pests' && e.type.startsWith('imp_')) || (m.type === 'hunt' && e.type.startsWith('beast_'))) {
    m.have++; updateQuest();
    if (m.have >= m.n) squadMissionDone();
  } else if ((m.type === 'rogue' || m.type === 'warlord') && e.missionBoss) squadMissionDone();
}
function squadMissionDone() {
  const L = P.life, m = L.smission, sq = L.squad;
  const [g, xp] = RANK_PAY[m.rank];
  L.smission = null;
  clearMissionStuff();
  sq.done++;
  sq.rankDone[m.rank] = (sq.rankDone[m.rank] ?? 0) + 1;
  P.gold += g;
  gainXP(xp);
  let extra = '';
  if (m.rank === 'S' && !P.ownedWeapons.includes('raikiri')) { P.ownedWeapons.push('raikiri'); extra = ' You earned Raikiri, the Lightning Cutter!'; }
  const unlocked = RANKS.find(r => RANK_NEED[r] === sq.done);
  banner(`${m.rank}-rank mission complete!`, `+${g} gold.${extra}${unlocked ? ` ${unlocked}-rank missions unlocked!` : ''}`, 4);
  burst(P.pos.x, P.y + 1.4, P.pos.z, 60, 0xffd860, 3, 5, 1.2, 2);
  updateQuest();
  save();
}
function endSquadMission() {
  P.life.smission = null;
  clearMissionStuff();
  updateQuest();
  save();
}

// ---- Going in and out of houses.
function enterRoom(kind, out, id, town) {
  const room = rooms.find(r => r.kind === kind);
  P.outside = out;
  P.houseId = id;
  P.houseTown = town;
  ui = 'travel';
  const fade = $('fade');
  fade.style.opacity = '1';
  setTimeout(() => {
    P.pos.set(room.spawn.x, 0, room.spawn.z);
    P.y = 0; P.vy = 0; P.kb.set(0, 0, 0); P.lock = null;
    P.facing = Math.PI; camYaw = 0;
    fade.style.opacity = '0';
    ui = null;
  }, 350);
}
function enterHouse(it) {
  enterRoom(it.room, it.out, it.id, it.town);
}
function exitHouse() {
  const o = P.outside ?? { x: TOWNS[P.lastTown].spawn.x, z: TOWNS[P.lastTown].spawn.z, facing: TOWNS[P.lastTown].spawnFacing };
  ui = 'travel';
  const fade = $('fade');
  fade.style.opacity = '1';
  setTimeout(() => {
    P.pos.set(o.x, 0, o.z);
    P.y = height(o.x, o.z); P.vy = 0;
    P.facing = o.facing; camYaw = o.facing + Math.PI;
    P.outside = null; P.houseId = null;
    fade.style.opacity = '0';
    ui = null;
  }, 350);
}
function searchStash() {
  const id = P.houseId ?? 'none';
  if (P.looted.includes(id)) { banner('', 'Nothing else here.', 1.4); return; }
  P.looted.push(id);
  const r = Math.random();
  const gold = randInt(8, 30) + P.lvl * 3;
  if (r < 0.3) { P.potions++; banner('Found a healing potion', id === 'home' ? 'Mother always keeps one for you.' : 'Tucked behind the rice bowls.', 2.2); }
  else if (r < 0.4) { P.elixirs++; banner('Found an elixir', 'A rare find!', 2.2); }
  else { P.gold += gold; banner(`Found ${gold} gold`, 'Coins in an old tea tin.', 2.2); }
  burst(P.pos.x, P.y + 1, P.pos.z, 20, 0xffd860, 2, 3, 0.7, 1);
  save();
}
function useBed() {
  if (P.houseId === 'home') { sleepAtHome(); return; }
  P.hp = Math.min(maxHp(), P.hp + maxHp() * 0.5);
  banner('A short nap', 'You feel better.', 1.6);
}

function openHome(town) {
  const L = P.life;
  const el = ELEMENTS[town.element];
  if (!L || L.village !== town.element) {
    openModal(`<h2>A family of ${el.village}</h2><p>&ldquo;Oh, a visitor! Rest your feet at the shrine, traveler.&rdquo;</p>
      <div class="btns"><button class="secondary" data-act="close">Farewell (E)</button></div>`, 'dialog');
    return;
  }
  const task = L.task;
  if (task?.type === 'water' && task.stage === 1) {
    openModal(`<h2>${el.parents[0]}</h2><p>&ldquo;What a strong child! A whole bucket, and you only spilled half.&rdquo;</p>
      <div class="btns"><button data-act="close">Smile</button></div>`, 'dialog');
    finishTask();
    return;
  }
  const lines = L.age < 9 ? [`&ldquo;There you are! Don't wander past the fences, little one.&rdquo;`, `${el.parents[1]} ruffles your hair.`]
    : L.age < 16 ? [`&ldquo;You're getting so tall. ${el.sensei} says you have a gift.&rdquo;`, `${el.parents[1]}: &ldquo;Mind the imps on the paths. Hit first, and keep your guard up.&rdquo;`]
    : [`&ldquo;Our child, a samurai of ${el.village}. Your grandparents would be proud.&rdquo;`, `${el.parents[1]}: &ldquo;Sleep here whenever you like. This is your home.&rdquo;`];
  P.lastTown = town.index;
  openModal(`<h2>Home &middot; ${el.parents.join(' &amp; ')}</h2>
    ${lines.map(l => `<p>${l}</p>`).join('')}
    ${task ? `<p class="sub">Current task: ${taskText(task)}</p>` : ''}
    <div class="btns"><button data-act="inside">Go inside</button><button data-act="sleep">Sleep (heal &amp; save)</button><button class="secondary" data-act="close">Head out (E)</button></div>`, 'dialog');
}
function goInsideHome() {
  closeModal();
  const h = nwSite.homes[P.life.village];
  enterRoom('home', { x: h.x, z: h.z, facing: h.facing }, 'home', ELEMENTS[P.life.village].town);
}
function openSensei(town) {
  const el = ELEMENTS[town.element], L = P.life;
  const mine = L && L.village === town.element;
  const tip = !mine ? 'Our dojo trains only the children of this village. Still, a blade is a blade. Keep yours sharp.'
    : L.age < 12 ? 'Hit the dummies, little one! Click to swing, and keep swinging. Hold Q to block.'
    : L.age < 16 ? 'Good footwork. Remember: press Q just as a blow lands to parry it.'
    : 'You have outgrown my lessons. When your Ki is full, press X: show them what a samurai of ' + el.village + ' can do.';
  openModal(`<h2>${el.sensei}</h2><p>&ldquo;${tip}&rdquo;</p>
    ${mine && L.task?.type === 'train' ? `<p class="sub">Training: ${L.task.have}/${L.task.n} strikes</p>` : ''}
    <div class="btns"><button class="secondary" data-act="close">Bow (E)</button></div>`, 'dialog');
}
function drawWater() {
  const l = P.life?.lesson;
  if (l?.type === 'water' && l.have === 0) {
    l.have = 1;
    burst(P.pos.x, P.y + 1, P.pos.z, 20, 0x8ad0ff, 2, 3, 0.7, 1);
    banner('Bucket filled', 'Carry it to the academy master', 2);
    updateQuest();
    return;
  }
  const task = P.life?.task;
  if (task?.type === 'water' && task.stage === 0) {
    task.stage = 1;
    burst(P.pos.x, P.y + 1, P.pos.z, 20, 0x8ad0ff, 2, 3, 0.7, 1);
    banner('Bucket filled', 'Carry it home to your family', 2);
    updateQuest();
  } else banner('', 'The well water is cold and clear.', 1.5);
}
function sleepAtHome() {
  P.hp = maxHp(); P.st = maxSt();
  closeModal();
  const fade = $('fade');
  fade.style.opacity = '1';
  ui = 'travel';
  setTimeout(() => {
    for (const e of enemies) if (!e.alive && !e.role && !e.summoned) respawnEnemy(e);
    fade.style.opacity = '0';
    ui = null;
    banner('Good morning', 'Health restored. Progress saved.', 2);
    save();
  }, 900);
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
  if (inInterior(P.pos.x)) {
    ctx.fillStyle = '#3a2a1e'; ctx.fillRect(0, 0, Wd, H);
    ctx.fillStyle = '#c8b080'; ctx.fillText('Indoors', Wd / 2, H / 2 + 30);
  } else if (inNewWorld(P.pos.x)) {
    drawNwMap(ctx, X, Z, scale, full);
  } else if (realm) {
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
    ctx.fillRect(0, Z(ASH_Z), Wd, Math.max(0, Z(BOUNDS.minZ - 50) - Z(ASH_Z)));
    ctx.fillStyle = 'rgba(220, 230, 240, 0.35)';
    ctx.fillRect(0, Z(FROST.start), Wd, Z(FROST.end) - Z(FROST.start));
    ctx.strokeStyle = '#a08a62'; ctx.lineWidth = full ? 2 : 1.5;
    ctx.setLineDash([4, 3]);
    for (const t of TOWNS) if (t.hamlet) { ctx.beginPath(); ctx.moveTo(X(t.attach[0]), Z(t.attach[1])); ctx.lineTo(X(t.x), Z(t.z)); ctx.stroke(); }
    for (const nb of NINJA_BASES) { ctx.beginPath(); ctx.moveTo(X(nb.attach[0]), Z(nb.attach[1])); ctx.lineTo(X(nb.x), Z(nb.z)); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#c4a874'; ctx.lineWidth = full ? 4 : 3; ctx.lineJoin = 'round';
    ctx.beginPath();
    PATH.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    ctx.stroke();
    for (const t of TOWNS) {
      const known = P.discovered.includes(t.index);
      ctx.fillStyle = known ? (t.city ? 'rgba(240, 220, 170, 0.9)' : 'rgba(232, 193, 90, 0.85)') : 'rgba(150, 150, 150, 0.6)';
      ctx.beginPath(); ctx.arc(X(t.x), Z(t.z), Math.max(t.city ? 8 : 5, t.r * scale), 0, Math.PI * 2); ctx.fill();
      if (t.city) { ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 2; ctx.stroke(); }
      if (full || scale > 0.5) {
        ctx.fillStyle = '#fff';
        ctx.fillText(known ? t.name : '???', X(t.x), Z(t.z) - Math.max(8, t.r * scale) - 4);
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
function drawNwMap(ctx, X, Z, scale, full) {
  ctx.fillStyle = '#1a3e52';
  ctx.fillRect(0, 0, 4000, 4000);
  for (const el of ELEMENTS) {
    ctx.fillStyle = el.css + '55';
    ctx.beginPath();
    ctx.moveTo(X(NW.x), Z(NW.z));
    ctx.arc(X(NW.x), Z(NW.z), (NW.r - 30) * scale, el.angle - Math.PI / 5, el.angle + Math.PI / 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = '#c4a874'; ctx.lineWidth = full ? 3 : 2;
  for (const t of NW_TOWNS) {
    ctx.beginPath(); ctx.moveTo(X(t.attach[0]), Z(t.attach[1])); ctx.lineTo(X(t.x), Z(t.z)); ctx.stroke();
    for (const hop of [1, 2]) {
      const n = NW_TOWNS[(t.element + hop) % 5];
      ctx.beginPath(); ctx.moveTo(X(t.x), Z(t.z)); ctx.lineTo(X(n.x), Z(n.z)); ctx.stroke();
    }
    const ox = NW.x + (t.x - NW.x) / NW.ring * 235, oz = NW.z + (t.z - NW.z) / NW.ring * 235;
    ctx.beginPath(); ctx.moveTo(X(t.x), Z(t.z)); ctx.lineTo(X(ox), Z(oz)); ctx.stroke();
  }
  ctx.fillStyle = '#f6d8ec';
  ctx.beginPath(); ctx.arc(X(NW.x), Z(NW.z), Math.max(5, 20 * scale), 0, Math.PI * 2); ctx.fill();
  if (echo?.alive) { ctx.fillStyle = '#b48cff'; ctx.beginPath(); ctx.arc(X(echo.pos.x), Z(echo.pos.z), 5, 0, Math.PI * 2); ctx.fill(); }
  for (const t of NW_TOWNS) {
    const el = ELEMENTS[t.element], known = P.discovered.includes(t.index);
    ctx.fillStyle = known ? el.css : 'rgba(150,150,150,0.7)';
    ctx.beginPath(); ctx.arc(X(t.x), Z(t.z), Math.max(5, t.r * scale), 0, Math.PI * 2); ctx.fill();
    if (P.life?.village === t.element) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    if (full || scale > 0.5) {
      ctx.fillStyle = '#fff';
      ctx.fillText(known ? el.kanji + ' ' + t.name : '???', X(t.x), Z(t.z) - Math.max(8, t.r * scale) - 4);
      if (full && P.life) {
        const r = relName(t.element);
        ctx.fillStyle = { Home: '#ffd860', Ally: '#7dff8a', 'At peace': '#dddddd', Rival: '#ff6a5a' }[r];
        ctx.fillText(r, X(t.x), Z(t.z) + Math.max(8, t.r * scale) + 14);
      }
    }
  }
  if (full) { ctx.fillStyle = '#f6d8ec'; ctx.fillText('The Crossroads', X(NW.x), Z(NW.z) + 26); }
  for (const m of pickups) { ctx.fillStyle = '#fff6a0'; ctx.fillRect(X(m.position.x) - 2, Z(m.position.z) - 2, 4, 4); }
  const sm = P.life?.smission;
  if (sm) {
    const t = sm.spot && !sm.found ? sm.spot : sm.type === 'escort' ? TOWNS[sm.dest] : sm.found ? academyHere().master : null;
    if (t) {
      const pulse = 5 + Math.sin(performance.now() / 200) * 2;
      ctx.strokeStyle = '#ffd860'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(t.x), Z(t.z), pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd860'; ctx.fillText(sm.rank, X(t.x), Z(t.z) + 4);
    }
  }
}
function toggleMap() {
  const el = $('bigmap');
  if (ui === 'map') { el.classList.add('hidden'); ui = null; return; }
  ui = 'map';
  if (document.pointerLockElement) document.exitPointerLock();
  el.classList.remove('hidden');
  const Wd = bigCanvas.width, H = bigCanvas.height;
  if (inNewWorld(P.pos.x)) drawMap(big, Wd, H, NW.x, NW.z, Math.min(Wd, H) / (NW.r * 2 + 20), true);
  else {
    const scale = Math.min(Wd / (BOUNDS.maxX - BOUNDS.minX + 40), H / (BOUNDS.maxZ - BOUNDS.minZ + 40));
    drawMap(big, Wd, H, 0, (BOUNDS.minZ + BOUNDS.maxZ) / 2, scale, true);
  }
}

// ============================================================ World state (location, sky, prompts)
let currentTown = null, arenaAnnounced = false, currentPlace = null, wasNw = false;
const _w = [0, 0, 0, 0, 0];
const _nwPal = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hemi: 0.5 };
const _center = new THREE.Vector3();
function interactLabel(it) {
  return it.kind === 'shop' ? 'Trade at ' + it.shop.shopName
      : it.kind === 'shrine' ? 'Pray at the shrine &mdash; rest, save &amp; travel'
      : it.kind === 'chest' ? (P.warlordsDead.includes(it.index) ? 'Open the treasure chest' : 'Sealed chest &mdash; defeat the warlord')
      : it.kind === 'home' ? (P.life?.village === it.town.element ? 'Go home &mdash; your family' : 'Talk to the family')
      : it.kind === 'sensei' ? 'Talk to ' + ELEMENTS[it.town.element].sensei
      : it.kind === 'well' ? 'Draw water from the well'
      : it.kind === 'house' ? 'Go inside the house'
      : it.kind === 'exit' ? 'Step outside'
      : it.kind === 'academy' ? `Talk to ${ACADEMY_MASTER[it.town.element]} &mdash; the Academy`
      : it.kind === 'envoy' ? `Speak with the envoy of ${ELEMENTS[it.element].village}${P.life ? ' (' + relName(it.element) + ')' : ''}`
      : it.kind === 'stash' ? (P.looted.includes(P.houseId) ? 'The cupboard is empty' : 'Search the cupboard')
      : it.kind === 'bed' ? (P.houseId === 'home' ? 'Sleep in your futon (heal &amp; save)' : 'Rest on the futon')
      : 'Talk to the elder';
}
function updateWorldState(dt) {
  if (inNewWorld(P.pos.x) !== wasNw) { wasNw = !wasNw; updateQuest(); }
  const inside = inInterior(P.pos.x);
  roomLight.intensity = inside ? 30 : 0;
  sun.intensity = inside ? 0 : 3.6;
  if (inside) {
    const r = roomAt(P.pos.x, P.pos.z);
    roomLight.position.set(r.x, 2.6, r.z - 0.5);
    hud.locName.textContent = P.houseId === 'home' ? 'Your home' : 'A house in ' + (P.houseTown?.name ?? 'the village');
    hud.locSub.textContent = P.houseId === 'home' ? ELEMENTS[P.life?.village ?? 0].parents.join(' & ') + "'s house" : r.kind === 'town' ? 'A merchant family\'s house' : 'A farming family\'s house';
    scene.fog.color.set(0x2a1e14); scene.fog.near = 14; scene.fog.far = 60;
    hemi.intensity = 0.45; hemi.groundColor.set(0x5a4030);
    updateSky(camera.position, dt, PAL.day.top, PAL.day.hor, PAL.day.sun, true);
    refreshEnvironment('day');
    scene.environmentIntensity = 0.35;
    updateAmbient(dt, _center.set(P.pos.x, P.y, P.pos.z), 'none', time);
    const it = nearInteract();
    hud.prompt.style.display = it ? 'block' : 'none';
    if (it) hud.prompt.innerHTML = '<b class="gold">[E]</b> ' + interactLabel(it);
    return;
  }
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
  const nwOn = inNewWorld(P.pos.x);
  const sec = nwOn ? ELEMENTS[nwSector(P.pos.x, P.pos.z)] : null;
  if (nwOn && !t) {
    const hubD = Math.hypot(P.pos.x - NW.x, P.pos.z - NW.z);
    hud.locName.textContent = hubD < 40 ? 'The Crossroads' : sec.name + ' Wilds';
    hud.locSub.textContent = hubD < 40 ? 'The great sacred tree' : P.life && P.life.age < 10 ? 'Stay close to the path, little one' : 'Spirits roam here';
  } else if (nwOn && t) {
    hud.locName.textContent = t.name;
    hud.locSub.textContent = ELEMENTS[t.element].name + ' village · ' + (P.life ? (P.life.village === t.element ? 'home' : relName(t.element).toLowerCase()) : 'shop · shrine');
  } else if (realm) {
    const i = DEMON_BASES.indexOf(realm);
    hud.locName.textContent = realm.name;
    hud.locSub.textContent = P.warlordsDead.includes(i) ? (P.chestsLooted.includes(i) ? 'Conquered' : 'The treasure awaits') : 'Danger ' + '★'.repeat(Math.min(5, i + 2));
  } else if (t) { hud.locName.textContent = t.name; hud.locSub.textContent = t.city ? 'Walled city · market · forge · shrine' : t.hamlet ? 'Hidden hamlet · shop · shrine' : 'Safe haven · shop · shrine'; }
  else if (nb) { const i = NINJA_BASES.indexOf(nb); hud.locName.textContent = nb.name; hud.locSub.textContent = 'Ninja base · Danger ' + '★'.repeat(i + 1); }
  else if (arenaDist(P.pos.x, P.pos.z) < ARENA.r + 30) { hud.locName.textContent = 'Shrine of Oni Mountain'; hud.locSub.textContent = P.bossDead ? 'Peaceful at last' : 'Danger ★★★★★'; }
  else {
    const tier = regionIndex(P.pos.x, P.pos.z);
    hud.locName.textContent = REGIONS[tier].name;
    hud.locSub.textContent = 'Danger ' + '★'.repeat(REGIONS[tier].danger);
  }

  // Sky and light: blue road, ashen north, burning demon realm.
  const a = realm || nwOn ? 0 : smooth(ASH_Z + 30, ASH_Z - 130, P.pos.z) * (P.bossDead ? 0.3 : 1);
  let base = realm ? PAL.realm : PAL.day;
  if (nwOn) {
    // Blend the element skies by where you stand on the island.
    nwWeights(P.pos.x, P.pos.z, _w);
    const hubK = 1 - smooth(30, 90, Math.hypot(P.pos.x - NW.x, P.pos.z - NW.z));
    _nwPal.top.setRGB(0, 0, 0); _nwPal.hor.setRGB(0, 0, 0); _nwPal.sun.setRGB(0, 0, 0); _nwPal.hemi = 0;
    ELEMENTS.forEach((el, k) => {
      const w = lerp(_w[k], 0.2, hubK), Q = PAL[el.key];
      _nwPal.top.r += Q.top.r * w; _nwPal.top.g += Q.top.g * w; _nwPal.top.b += Q.top.b * w;
      _nwPal.hor.r += Q.hor.r * w; _nwPal.hor.g += Q.hor.g * w; _nwPal.hor.b += Q.hor.b * w;
      _nwPal.sun.r += Q.sun.r * w; _nwPal.sun.g += Q.sun.g * w; _nwPal.sun.b += Q.sun.b * w;
      _nwPal.hemi += Q.hemi * w;
    });
    base = _nwPal;
  }
  skyTop.copy(base.top).lerp(PAL.ash.top, a);
  skyHor.copy(base.hor).lerp(PAL.ash.hor, a);
  sunCol.copy(base.sun).lerp(PAL.ash.sun, a);
  scene.fog.color.copy(skyHor);
  scene.fog.near = realm ? 40 : 70;
  scene.fog.far = realm ? 170 : nwOn ? 240 : lerp(260, 180, a);
  sun.color.copy(sunCol);
  hemi.intensity = lerp(base.hemi, PAL.ash.hemi, a);
  hemi.groundColor.set(realm ? 0x8a2a10 : 0x5a4a35);
  updateSky(camera.position, dt, skyTop, skyHor, sunCol, !!realm || nwOn);
  refreshEnvironment(realm ? 'realm' : nwOn ? 'nw' + sec.key : a > 0.5 ? 'ash' : 'day');
  scene.environmentIntensity = realm ? 0.5 : lerp(0.8, 0.55, a);
  const marsh = REGIONS[regionIndex(P.pos.x, P.pos.z)]?.name === 'Firefly Marsh';
  const mode = nwOn ? sec.ambient : realm || arenaDist(P.pos.x, P.pos.z) < 90 ? 'embers' : P.pos.z < ASH_Z ? 'ash'
    : frostAmt(P.pos.z) > 0.3 ? 'snow' : marsh ? 'fireflies'
    : P.pos.z > -620 || townAt(P.pos.x, P.pos.z) ? 'petals' : 'none';
  updateAmbient(dt, _center.set(P.pos.x, P.y, P.pos.z), mode, time);

  const it = P.dead ? null : nearInteract();
  if (it) {
    hud.prompt.style.display = 'block';
    const label = interactLabel(it);
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
  const tx = P.pos.x, ty = P.y + 0.5 + 1.3 * ageScale(), tz = P.pos.z;
  const cp = Math.cos(camPitch);
  let cx = tx + Math.sin(camYaw) * cp * camDist, cy = ty + Math.sin(camPitch) * camDist + 0.6, cz = tz + Math.cos(camYaw) * cp * camDist;
  cy = Math.max(cy, height(cx, cz) + 0.7);
  if (shakeAmt > 0) {
    cx += rand(-1, 1) * shakeAmt * 0.4; cy += rand(-1, 1) * shakeAmt * 0.4; cz += rand(-1, 1) * shakeAmt * 0.4;
    shakeAmt = Math.max(0, shakeAmt - dt * 1.8);
  }
  if (ui === 'creator') {
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    camera.position.set(P.pos.x + fx * 3.4 - fz * 0.9, P.y + 1.7, P.pos.z + fz * 3.4 + fx * 0.9);
    camera.lookAt(P.pos.x - fz * 0.7, P.y + 1.2, P.pos.z + fx * 0.7);
  } else if (talkTarget) {
    // Over-the-shoulder framing of the boss during the pre-battle talk.
    const T = talkTarget, th = height(T.pos.x, T.pos.z) + T.def.scale * 1.9;
    const ax = T.pos.x - P.pos.x, az = T.pos.z - P.pos.z, al = Math.hypot(ax, az) || 1;
    // Stand partway toward the boss, off to one side, so they fill the upper frame.
    const along = Math.max(0, al - 7 - T.def.scale * 3);
    cx = P.pos.x + ax / al * along + az / al * 2.2; cz = P.pos.z + az / al * along - ax / al * 2.2;
    cy = Math.max(height(cx, cz) + 1.2, th * 0.75);
    camera.position.set(cx, cy, cz);
    camera.lookAt(T.pos.x, th, T.pos.z);
  } else if (inInterior(P.pos.x)) {
    // Indoors: a closer camera that stays inside the walls and under the ceiling.
    const r = roomAt(P.pos.x, P.pos.z), d = Math.min(camDist, 4.2);
    let ix = tx + Math.sin(camYaw) * cp * d, iz = tz + Math.cos(camYaw) * cp * d;
    ix = clamp(ix, r.x - 5.6, r.x + 5.6); iz = clamp(iz, r.z - 4.1, r.z + 4.1);
    camera.position.set(ix, clamp(ty + Math.sin(camPitch) * d + 0.4, 0.8, 2.85), iz);
    camera.lookAt(tx, ty, tz);
  } else {
    camera.position.set(cx, cy, cz);
    camera.lookAt(tx, ty, tz);
  }
  fovKick = Math.max(0, fovKick - dt * 20);
  const fov = 60 - fovKick;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  sun.position.set(tx + SUN_DIR.x * 150, ty + SUN_DIR.y * 150, tz + SUN_DIR.z * 150);
  sun.target.position.set(tx, ty, tz);
}

// ============================================================ Save / load / start
const SAVE_KEY = 'roninsroad.save.v3', OLD_KEYS = ['roninsroad.save.v2', 'roninsroad.save.v1'];
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      lvl: P.lvl, xp: P.xp, gold: P.gold, potions: P.potions, elixirs: P.elixirs, weapon: P.weapon, armor: P.armor,
      charms: P.charms, discovered: P.discovered, lastTown: P.lastTown, bossDead: P.bossDead, kills: P.kills,
      ownedWeapons: P.ownedWeapons, skin: P.skin, ownedSkins: P.ownedSkins, look: P.look,
      style: P.style, bow: P.bow, ownedBows: P.ownedBows,
      mastersDead: P.mastersDead, warlordsDead: P.warlordsDead, chestsLooted: P.chestsLooted,
      life: P.life, looted: P.looted,
    }));
  } catch { /* storage unavailable: play on without saving */ }
}
function loadSave() {
  try {
    let s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s) {
      // Older saves knew four towns; map them onto the new road with its two cities.
      for (const k of OLD_KEYS) { s = JSON.parse(localStorage.getItem(k)); if (s) break; }
      if (s) {
        s.discovered = (s.discovered ?? [0]).map(i => OLD_TOWN_ORDER[i] ?? 0);
        s.lastTown = OLD_TOWN_ORDER[s.lastTown] ?? 0;
      }
    }
    if (!s || !WEAPONS[s.weapon] || !ARMORS[s.armor] || !TOWNS[s.lastTown]) return null;
    s.ownedWeapons = [...new Set(['worn', s.weapon, ...(s.ownedWeapons ?? [])])].filter(k => WEAPONS[k]);
    s.ownedSkins = [...new Set(['ronin', 'custom', ...(s.ownedSkins ?? [])])].filter(k => SKINS[k]);
    s.look = { ...DEFAULT_LOOK, ...(s.look ?? {}) };
    if (!STYLES[s.style]) s.style = 'two';
    s.ownedBows = [...new Set(['hankyu', ...(s.ownedBows ?? [])])].filter(k => BOWS[k]);
    if (!BOWS[s.bow]) s.bow = 'hankyu';
    if (!SKINS[s.skin]) s.skin = 'ronin';
    if (s.life && !ELEMENTS[s.life.village]) s.life = null;
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
    discovered: [0], lastTown: 0, bossDead: false, kills: 0, ownedWeapons: ['worn'], skin: 'ronin', ownedSkins: ['ronin', 'custom'],
    look: { ...DEFAULT_LOOK }, style: 'two', bow: 'hankyu', ownedBows: ['hankyu'],
    mastersDead: [], warlordsDead: [], chestsLooted: [], life: null, looted: [],
  }, s ?? {});
  P.looted = [...(P.looted ?? [])];
  P.outside = null; P.houseId = null;
  P.life = P.life ? { ...P.life } : null;
  for (const k of ['charms', 'discovered', 'ownedWeapons', 'ownedSkins', 'mastersDead', 'warlordsDead', 'chestsLooted', 'ownedBows']) P[k] = [...P[k]];
  P.sheathed = P.style !== 'archer';
  P.look = { ...P.look };
  P.dead = false; P.state = 'idle'; P.hp = maxHp(); P.st = maxSt(); P.ki = 0;
  if (P.bossDead && boss.alive) markDead(boss);
  NINJA_BASES.forEach((nb, i) => {
    const open = P.mastersDead.includes(i);
    nb.portal.setOpen(open);
    if (open && nb.masterEnemy.alive) markDead(nb.masterEnemy);
  });
  DEMON_BASES.forEach((db, i) => { if (P.warlordsDead.includes(i) && db.warlordEnemy.alive) markDead(db.warlordEnemy); });
  syncLife();
  syncRelations();
  placeAtTown(P.lastTown);
  rebuildPlayerRig();
  closeModal();
  $('hud').classList.remove('hidden');
  started = true;
  if (P.life && P.life.task?.type === 'gather') spawnPickups(P.life.task.n - P.life.task.have + 1);
  if (P.life && !P.life.task) setTimeout(nextTask, 1500);
  banner(TOWNS[P.lastTown].name, P.life ? `Age ${P.life.age} · your new life continues` : s ? 'Your journey continues' : 'Talk to the elder, then head north', 3);
  save();
  updateQuest();
  // Beat the game before the new world existed? The curse catches up with you now.
  if (P.bossDead && !P.life) setTimeout(showCurse, 2500);
}

// ============================================================ Boot
spawnWorldEnemies();
rebuildPlayerRig();
placeAtTown(0);
updateChunks(P.pos.x, P.pos.z);
window.__game = {
  renderer, P, enemies, TOWNS, interactables, NINJA_BASES, DEMON_BASES, projectiles,
  get boss() { return boss; }, get ui() { return ui; }, get gfxHigh() { return gfxHigh; },
  setCam(yaw, pitch, dist) { camYaw = yaw; camPitch = pitch; camDist = dist; },
  unsheath, startNewLife, finishTask, get echo() { return echo; }, nwSite, ELEMENTS, rooms, companions,
};

const clock = new THREE.Clock();
let frameNo = 0;
function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  let dt = Math.min(0.05, rawDt);
  frameNo++;
  tuneResolution(rawDt);
  if (frameNo % 8 === 0) updateChunks(P.pos.x, P.pos.z);
  if (started && !ui) {
    if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
    else if (slowmo > 0) { slowmo -= dt; dt *= 0.35; }
    time += dt;
    const here = townAt(P.pos.x, P.pos.z);
    const playerSafe = P.dead || (!!here && !(here.nw && hostileTo(here.element)));
    if (special) {
      // The world nearly freezes while the samurai moves at full speed.
      updateSpecial(Math.min(0.05, rawDt));
      updateEnemies(dt * 0.03, playerSafe);
      updateProjectiles(dt * 0.03);
    } else {
      updatePlayer(dt);
      updateEnemies(dt, playerSafe);
      updateProjectiles(dt);
    }
    updateRains(dt);
    updateNPCs(dt);
    updatePortals(dt);
    updatePickups(dt);
    updateCompanion(dt);
    updateAcademy(dt);
    updateSquadMission(dt);
    updateEffects(dt);
    updateParticles(dt);
    updateWorldState(dt);
    hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
  } else if (!started) {
    camYaw += dt * 0.08;
    updateSky(camera.position, dt, PAL.day.top, PAL.day.hor, PAL.day.sun);
    refreshEnvironment('day');
  }
  updateCamera(dt);
  updateFloaters(dt);
  if (started) {
    if (frameNo % 2 === 0) updateHUD();
    if (frameNo % 4 === 0) drawMap(mini, 180, 180, P.pos.x, P.pos.z, 0.9, false);
  }
  if (gfxHigh) composer.render(); else renderer.render(scene, camera);
}
showTitle();
frame();
