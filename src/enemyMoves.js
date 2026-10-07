// Enemy moves as data, plus the pure logic that reads them: content validation, move
// selection and contact geometry. Nothing here touches Three.js or game state, so the
// combat runner in main.js and the tests in tests/ share exactly one contract.
//
// A move runs on one clock, `t` seconds since it started:
//   startup  [0, startup)              telegraph: the enemy winds up and tracks the target
//   active   [startup, startup + len)  contact windows open and close inside this span
//   recovery [startup + len, total)    the enemy is committed and open to punishment
// Window times (`at`, `until`) are relative to the start of the active phase.

const deg = Math.PI / 180;

// Contact shapes, checked against the target's position and radius.
//   arc:    a slice in front of the attacker, `reach` beyond its body radius
//   circle: everything within `radius` of the attacker (stomps, slams)
//   line:   a narrow thrust straight ahead
const arc = (reach, width) => ({ kind: 'arc', reach, arc: width });
const circle = radius => ({ kind: 'circle', radius });
const line = (reach, width = 0.9) => ({ kind: 'line', reach, width });

// Authored move definitions. `anim` and `vfx` are semantic hook ids the runtime maps
// to poses and effects; `telegraph` says how the startup is shown to the player.
const DEFS = [
  // ---- Blades
  { id: 'slash', tags: ['melee'], minRange: 0, maxRange: 2.2, maxAngle: 50 * deg, weight: 3, cooldown: 0.4,
    startup: 0.5, recovery: 0.6, track: 5, anim: 'overhead', vfx: 'swing-v', telegraph: 'glow',
    windows: [{ at: 0.02, until: 0.16, shape: arc(1.2, 120 * deg), dmg: 1 }], lunge: { at: 0, until: 0.1, speed: 4 } },
  { id: 'quickSlash', tags: ['melee'], minRange: 0, maxRange: 2.1, maxAngle: 50 * deg, weight: 3, cooldown: 0.3,
    startup: 0.3, recovery: 0.4, track: 8, anim: 'sweep', vfx: 'swing-h', telegraph: 'glow',
    windows: [{ at: 0.02, until: 0.12, shape: arc(1.1, 130 * deg), dmg: 0.85 }], lunge: { at: 0, until: 0.08, speed: 5 } },
  { id: 'doubleSlash', tags: ['melee', 'combo'], minRange: 0, maxRange: 2.2, maxAngle: 45 * deg, weight: 2, cooldown: 2.5,
    startup: 0.45, recovery: 0.7, track: 5, anim: 'combo', vfx: 'swing-v', telegraph: 'glow',
    windows: [{ at: 0.02, until: 0.14, shape: arc(1.2, 120 * deg), dmg: 0.8 }, { at: 0.34, until: 0.46, shape: arc(1.3, 140 * deg), dmg: 0.9 }],
    lunge: { at: 0.3, until: 0.4, speed: 5 } },
  { id: 'lunge', tags: ['melee', 'gapcloser'], minRange: 3.2, maxRange: 6.5, maxAngle: 25 * deg, weight: 2, cooldown: 3,
    startup: 0.45, recovery: 0.75, track: 6, anim: 'thrust', vfx: 'thrust', telegraph: 'flash',
    windows: [{ at: 0.04, until: 0.3, shape: line(1.6), dmg: 1.15 }], lunge: { at: 0, until: 0.3, speed: 16 } },
  { id: 'flurry', tags: ['melee', 'combo'], minRange: 0, maxRange: 2.3, maxAngle: 45 * deg, weight: 2, cooldown: 3.5,
    startup: 0.35, recovery: 0.8, track: 7, anim: 'combo', vfx: 'swing-h', telegraph: 'glow',
    windows: [0, 0.22, 0.44].map(at => ({ at, until: at + 0.1, shape: arc(1.2, 130 * deg), dmg: 0.6 })),
    lunge: { at: 0, until: 0.5, speed: 3 } },
  { id: 'leapStrike', tags: ['melee', 'gapcloser'], minRange: 4.5, maxRange: 10, maxAngle: 30 * deg, weight: 2, cooldown: 4,
    startup: 0.4, recovery: 0.6, track: 6, anim: 'leap', vfx: 'swing-v', telegraph: 'flash',
    windows: [{ at: 0.32, until: 0.44, shape: arc(1.4, 150 * deg), dmg: 1.2 }], lunge: { at: 0, until: 0.36, speed: 20 } },
  // A feint: a full telegraph that never lands, to bait a parry or a dodge.
  { id: 'feint', tags: ['melee', 'feint'], minRange: 0, maxRange: 2.4, maxAngle: 60 * deg, weight: 1, cooldown: 4,
    startup: 0.35, recovery: 0.15, track: 6, anim: 'overhead', vfx: null, telegraph: 'glow', windows: [] },
  // ---- Throwing
  { id: 'shuriken', tags: ['ranged'], minRange: 5, maxRange: 16, maxAngle: 40 * deg, weight: 3, cooldown: 2.6,
    startup: 0.32, recovery: 0.35, track: 10, anim: 'throw', vfx: null, telegraph: 'none',
    windows: [{ at: 0, until: 0.01, spawn: { kind: 'shuriken', count: 1 } }] },
  { id: 'shurikenFan', tags: ['ranged'], minRange: 4, maxRange: 18, maxAngle: 40 * deg, weight: 3, cooldown: 2.0,
    startup: 0.36, recovery: 0.4, track: 10, anim: 'throw', vfx: null, telegraph: 'none',
    windows: [{ at: 0, until: 0.01, spawn: { kind: 'shuriken', count: 3, spread: 0.22 } }] },
  // ---- Clubs and fists
  { id: 'overhead', tags: ['melee', 'heavy'], minRange: 0, maxRange: 2.6, maxAngle: 40 * deg, weight: 3, cooldown: 0.6,
    startup: 0.7, recovery: 0.85, track: 4, anim: 'overhead', vfx: 'swing-v', telegraph: 'glow',
    windows: [{ at: 0.04, until: 0.16, shape: arc(1.5, 90 * deg), dmg: 1.2 }], lunge: { at: 0, until: 0.1, speed: 4 } },
  { id: 'sweep', tags: ['melee', 'wide'], minRange: 0, maxRange: 3, maxAngle: 80 * deg, weight: 2, cooldown: 2,
    startup: 0.6, recovery: 0.8, track: 3, anim: 'sweep', vfx: 'swing-h', telegraph: 'glow',
    windows: [{ at: 0.02, until: 0.2, shape: arc(1.8, 220 * deg), dmg: 0.9, knock: 9 }] },
  { id: 'stomp', tags: ['aoe'], minRange: 0, maxRange: 2.4, maxAngle: Math.PI, weight: 1, cooldown: 5,
    startup: 0.8, recovery: 0.7, track: 1, anim: 'slam', vfx: 'slam', telegraph: 'ring',
    windows: [{ at: 0, until: 0.08, shape: circle(3.2), dmg: 0.7, unblockable: true, jumpable: true, knock: 8 }] },
  { id: 'combo3', tags: ['melee', 'combo'], minRange: 0, maxRange: 3, maxAngle: 45 * deg, weight: 2, cooldown: 3,
    startup: 0.5, recovery: 0.9, track: 5, anim: 'combo', vfx: 'swing-v', telegraph: 'glow',
    windows: [0, 0.32, 0.7].map((at, i) => ({ at, until: at + 0.12, shape: arc(1.6, (i === 2 ? 200 : 120) * deg), dmg: i === 2 ? 1.1 : 0.7 })),
    lunge: { at: 0.28, until: 0.75, speed: 4 } },
  { id: 'shoulder', tags: ['charge', 'gapcloser'], minRange: 5, maxRange: 11, maxAngle: 25 * deg, weight: 2, cooldown: 5,
    startup: 0.55, recovery: 0.8, track: 6, anim: 'charge', vfx: 'dust', telegraph: 'flash', armor: true,
    windows: [{ at: 0, until: 0.45, shape: circle(1.4), dmg: 1, knock: 12 }], lunge: { at: 0, until: 0.45, speed: 15, locked: true } },
  { id: 'slam', tags: ['aoe', 'heavy'], minRange: 0, maxRange: 7, maxAngle: Math.PI, weight: 2, cooldown: 5,
    startup: 1.05, recovery: 0.9, track: 2, anim: 'slam', vfx: 'slam', telegraph: 'ring', armor: true,
    windows: [{ at: 0, until: 0.08, shape: circle(7), dmg: 1.35, unblockable: true, jumpable: true, knock: 10 }] },
  { id: 'kingSlam', tags: ['aoe', 'heavy'], minRange: 0, maxRange: 9, maxAngle: Math.PI, weight: 2, cooldown: 4.5,
    startup: 1.05, recovery: 1.0, track: 2, anim: 'slam', vfx: 'slam', telegraph: 'ring', armor: true,
    windows: [{ at: 0, until: 0.08, shape: circle(9), dmg: 1.35, unblockable: true, jumpable: true, knock: 12 }] },
  { id: 'kingCharge', tags: ['charge'], minRange: 13, maxRange: 40, maxAngle: 30 * deg, weight: 3, cooldown: 4,
    startup: 0.6, recovery: 0.9, track: 6, anim: 'charge', vfx: 'dust', telegraph: 'flash', armor: true, announce: 'charges!',
    windows: [{ at: 0, until: 0.75, shape: circle(2.6), dmg: 1, unblockable: true, knock: 14 }], lunge: { at: 0, until: 0.75, speed: 22, locked: true } },
  // ---- Small spirits
  { id: 'bite', tags: ['melee'], minRange: 0, maxRange: 1.7, maxAngle: 50 * deg, weight: 3, cooldown: 0.6,
    startup: 0.55, recovery: 0.8, track: 6, anim: 'thrust', vfx: null, telegraph: 'glow',
    windows: [{ at: 0.02, until: 0.14, shape: arc(0.9, 100 * deg), dmg: 1 }], lunge: { at: 0, until: 0.12, speed: 6 } },
  { id: 'hop', tags: ['melee', 'gapcloser'], minRange: 2.5, maxRange: 5, maxAngle: 35 * deg, weight: 2, cooldown: 3,
    startup: 0.5, recovery: 0.9, track: 6, anim: 'leap', vfx: null, telegraph: 'flash',
    windows: [{ at: 0.2, until: 0.32, shape: arc(1, 140 * deg), dmg: 1.1 }], lunge: { at: 0, until: 0.26, speed: 12 } },
  // ---- Practice (academy classmates swing slowly and telegraph long)
  { id: 'practice', tags: ['melee'], minRange: 0, maxRange: 2, maxAngle: 50 * deg, weight: 1, cooldown: 0.8,
    startup: 0.75, recovery: 1.0, track: 4, anim: 'overhead', vfx: 'swing-v', telegraph: 'glow',
    windows: [{ at: 0.02, until: 0.16, shape: arc(1.1, 120 * deg), dmg: 1 }] },
];

export const MOVES = Object.freeze(Object.fromEntries(DEFS.map(m => [m.id, Object.freeze(m)])));

// Fighting styles: how an enemy spaces itself while it waits for a turn to attack.
//   brute:     walks straight in
//   duelist:   circles at mid range and darts in
//   skirmisher: keeps distance, weaves and throws
//   boss:      ignores attack turns and fights all the time
export const ENEMY_STYLES = Object.freeze({
  brute: { circle: 3.2, strafe: 0.4, token: true },
  duelist: { circle: 3.6, strafe: 1, token: true },
  skirmisher: { circle: 7, strafe: 1.2, token: true },
  boss: { circle: 0, strafe: 0, token: false },
});

// Each enemy archetype: its moves and its style. Element variants share one entry.
const ARCHETYPES = {
  bandit: { moves: ['slash', 'doubleSlash', 'lunge'], style: 'duelist' },
  ninja: { moves: ['quickSlash', 'shuriken', 'leapStrike'], style: 'skirmisher' },
  ninjaMaster: { moves: ['quickSlash', 'flurry', 'shurikenFan', 'leapStrike', 'feint'], style: 'boss' },
  oni: { moves: ['overhead', 'sweep', 'stomp'], style: 'brute' },
  blueOni: { moves: ['overhead', 'sweep', 'shoulder'], style: 'brute' },
  captain: { moves: ['combo3', 'overhead', 'stomp', 'shoulder'], style: 'brute' },
  warlord: { moves: ['overhead', 'sweep', 'combo3', 'slam', 'shoulder'], style: 'boss' },
  boss: { moves: ['overhead', 'sweep', 'combo3', 'kingSlam', 'kingCharge'], style: 'boss' },
  echo: { moves: ['overhead', 'sweep', 'combo3', 'kingSlam', 'kingCharge'], style: 'boss' },
  imp: { moves: ['bite', 'hop'], style: 'duelist' },
  beast: { moves: ['overhead', 'sweep', 'stomp'], style: 'brute' },
  guard: { moves: ['quickSlash', 'shuriken', 'leapStrike'], style: 'skirmisher' },
  champion: { moves: ['quickSlash', 'flurry', 'lunge', 'feint'], style: 'boss' },
  student: { moves: ['practice'], style: 'boss' },
};
export function archetypeOf(type) {
  return ARCHETYPES[type] ?? ARCHETYPES[type.split('_')[0]] ?? null;
}

// ---- Move clock
export const activeLength = m => m.windows.reduce((n, w) => Math.max(n, w.until), 0);
export const totalTime = m => m.startup + activeLength(m) + m.recovery;
export function phaseAt(m, t) {
  if (t < m.startup) return 'startup';
  if (t < m.startup + activeLength(m)) return 'active';
  if (t < totalTime(m)) return 'recovery';
  return 'done';
}
// Indices of the contact windows open at time t.
export function openWindows(m, t) {
  const out = [];
  m.windows.forEach((w, i) => { if (t >= m.startup + w.at && t < m.startup + w.until) out.push(i); });
  return out;
}
// Spawn windows (projectiles) that opened during (prevT, t]: each fires exactly once.
export function spawnsBetween(m, prevT, t) {
  const out = [];
  m.windows.forEach((w, i) => {
    if (!w.spawn) return;
    const at = m.startup + w.at;
    if (prevT < at && t >= at) out.push(i);
  });
  return out;
}
export function lungeSpeed(m, t) {
  const L = m.lunge;
  return L && t >= m.startup + L.at && t < m.startup + L.until ? L.speed : 0;
}

// ---- Contact geometry. Positions are {x, z}; facing is a yaw (sin, cos) like the rest of the game.
export function contactHits(shape, atk, tgt) {
  const dx = tgt.x - atk.x, dz = tgt.z - atk.z, d = Math.hypot(dx, dz);
  if (shape.kind === 'circle') return d <= shape.radius + tgt.r;
  const fx = Math.sin(atk.facing), fz = Math.cos(atk.facing);
  const reach = atk.r + shape.reach + tgt.r;
  if (shape.kind === 'arc') {
    if (d > reach) return false;
    if (d < 0.01) return true;
    const cos = (dx * fx + dz * fz) / d;
    return cos >= Math.cos(shape.arc / 2);
  }
  if (shape.kind === 'line') {
    const along = dx * fx + dz * fz, across = Math.abs(dx * fz - dz * fx);
    return along >= -tgt.r && along <= reach && across <= shape.width / 2 + tgt.r;
  }
  return false;
}

// ---- Move selection: only legal moves, weighted, deterministic for a given rng.
// ctx: { dist, angle (absolute angle between facing and the target), cooldowns (id -> seconds left), rng }
export function legalMoves(ids, ctx) {
  return ids.filter(id => {
    const m = MOVES[id];
    return m && ctx.dist >= m.minRange && ctx.dist <= m.maxRange && ctx.angle <= m.maxAngle && !((ctx.cooldowns?.[id] ?? 0) > 0);
  });
}
export function selectMove(ids, ctx) {
  const legal = legalMoves(ids, ctx);
  if (!legal.length) return null;
  const total = legal.reduce((n, id) => n + MOVES[id].weight, 0);
  let r = ctx.rng() * total;
  for (const id of legal) { r -= MOVES[id].weight; if (r < 0) return id; }
  return legal[legal.length - 1];
}
// The longest reach among an archetype's moves: how close it needs to get.
export function engageRange(ids) {
  return ids.reduce((n, id) => Math.max(n, MOVES[id]?.tags.includes('ranged') ? 0 : MOVES[id]?.maxRange ?? 0), 0);
}

// ---- Content validation: every problem as a readable string; empty means valid.
export function validateContent(enemies) {
  const errors = [];
  const seen = new Set();
  for (const m of DEFS) {
    if (seen.has(m.id)) errors.push(`duplicate move id ${m.id}`);
    seen.add(m.id);
    if (!(m.minRange >= 0 && m.maxRange >= m.minRange)) errors.push(`${m.id}: bad range ${m.minRange}..${m.maxRange}`);
    if (!(m.startup > 0)) errors.push(`${m.id}: startup must be positive (it is the telegraph)`);
    if (!(m.recovery > 0)) errors.push(`${m.id}: recovery must be positive`);
    if (!(m.cooldown >= 0)) errors.push(`${m.id}: negative cooldown`);
    if (!(m.weight > 0)) errors.push(`${m.id}: weight must be positive`);
    if (!Array.isArray(m.windows)) errors.push(`${m.id}: windows missing`);
    let last = -1;
    for (const [i, w] of (m.windows ?? []).entries()) {
      if (!(w.at >= 0 && w.until > w.at)) errors.push(`${m.id} window ${i}: impossible timing ${w.at}..${w.until}`);
      if (w.at < last) errors.push(`${m.id} window ${i}: windows out of order`);
      last = w.at;
      if (!w.spawn && !w.shape) errors.push(`${m.id} window ${i}: no contact shape or spawn`);
      if (w.shape && !(w.dmg > 0)) errors.push(`${m.id} window ${i}: contact without damage`);
      if (w.shape && !['arc', 'circle', 'line'].includes(w.shape.kind)) errors.push(`${m.id} window ${i}: unknown shape ${w.shape.kind}`);
    }
    if (m.lunge && !(m.lunge.until > m.lunge.at)) errors.push(`${m.id}: impossible lunge timing`);
  }
  for (const [name, a] of Object.entries(ARCHETYPES)) {
    if (!ENEMY_STYLES[a.style]) errors.push(`archetype ${name}: unknown style ${a.style}`);
    for (const id of a.moves) if (!MOVES[id]) errors.push(`archetype ${name}: missing move ${id}`);
    if (!a.moves.length) errors.push(`archetype ${name}: no moves`);
  }
  for (const type of Object.keys(enemies ?? {})) if (!archetypeOf(type)) errors.push(`enemy ${type}: no archetype`);
  return errors;
}

// A small seeded generator for deterministic tests and fixtures.
export function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Attack turns: only a few ordinary enemies may attack the same target at once; the
// rest circle and wait. Bosses fight without a turn.
export class AttackTokens {
  constructor(capacity) { this.capacity = capacity; this.holders = new Set(); }
  has(id) { return this.holders.has(id); }
  request(id) {
    if (this.holders.has(id)) return true;
    if (this.holders.size >= this.capacity) return false;
    this.holders.add(id);
    return true;
  }
  release(id) { this.holders.delete(id); }
  clear() { this.holders.clear(); }
}

// Contacts that land this frame: open windows whose shape touches the target and that
// have not already hit it. Each window hits a given target at most once; `hits` is the
// move instance's record (window indices) and is updated here.
export function resolveContacts(m, t, hits, atk, tgt) {
  const landed = [];
  for (const i of openWindows(m, t)) {
    const w = m.windows[i];
    if (!w.shape || hits.has(i)) continue;
    if (contactHits(w.shape, atk, tgt)) { hits.add(i); landed.push(i); }
  }
  return landed;
}
