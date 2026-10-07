// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVES, archetypeOf, validateContent, selectMove, legalMoves, phaseAt, openWindows, spawnsBetween,
  contactHits, resolveContacts, totalTime, activeLength, mulberry, AttackTokens, lungeSpeed,
} from '../src/enemyMoves.js';
import { ENEMIES } from '../src/data.js';

test('content is valid and every enemy has an archetype', () => {
  assert.deepEqual(validateContent(ENEMIES), []);
  for (const type of Object.keys(ENEMIES)) assert.ok(archetypeOf(type), type);
});

test('definitions are immutable', () => {
  assert.ok(Object.isFrozen(MOVES));
  assert.ok(Object.isFrozen(MOVES.slash));
  assert.throws(() => { 'use strict'; MOVES.slash.startup = 0; });
});

test('selection is deterministic for a seed and only picks legal moves', () => {
  const ids = archetypeOf('captain').moves;
  const run = seed => { const rng = mulberry(seed); return Array.from({ length: 20 }, () => selectMove(ids, { dist: 1.5, angle: 0, cooldowns: {}, rng })); };
  assert.deepEqual(run(7), run(7));
  for (const id of run(3)) assert.ok(legalMoves(ids, { dist: 1.5, angle: 0, cooldowns: {} }).includes(id));
});

test('wrong range, wrong direction and cooldowns rule moves out', () => {
  const rng = mulberry(1);
  assert.equal(selectMove(['slash'], { dist: 9, angle: 0, cooldowns: {}, rng }), null);
  assert.equal(selectMove(['slash'], { dist: 1, angle: Math.PI, cooldowns: {}, rng }), null);
  assert.equal(selectMove(['slash'], { dist: 1, angle: 0, cooldowns: { slash: 0.2 }, rng }), null);
  assert.equal(selectMove(['slash'], { dist: 1, angle: 0, cooldowns: { slash: 0 }, rng }), 'slash');
  // Gap closers only from a distance.
  assert.equal(selectMove(['lunge'], { dist: 1, angle: 0, cooldowns: {}, rng }), null);
  assert.equal(selectMove(['lunge'], { dist: 5, angle: 0, cooldowns: {}, rng }), 'lunge');
});

test('phase boundaries', () => {
  const m = MOVES.overhead;
  assert.equal(phaseAt(m, 0), 'startup');
  assert.equal(phaseAt(m, m.startup - 1e-6), 'startup');
  assert.equal(phaseAt(m, m.startup), 'active');
  assert.equal(phaseAt(m, m.startup + activeLength(m)), 'recovery');
  assert.equal(phaseAt(m, totalTime(m)), 'done');
});

test('contact windows open and close on their boundaries', () => {
  const m = MOVES.combo3;
  const w = m.windows[1];
  assert.deepEqual(openWindows(m, m.startup + w.at - 1e-6).includes(1), false);
  assert.deepEqual(openWindows(m, m.startup + w.at).includes(1), true);
  assert.deepEqual(openWindows(m, m.startup + w.until).includes(1), false);
  assert.deepEqual(openWindows(m, 0), []);
});

test('each window hits a target once, even across many frames', () => {
  const m = MOVES.combo3, hits = new Set();
  const atk = { x: 0, z: 0, facing: 0, r: 1 }, tgt = { x: 0, z: 1.5, r: 0.5 };
  let landed = 0;
  for (let t = 0; t < totalTime(m); t += 1 / 120) landed += resolveContacts(m, t, hits, atk, tgt).length;
  assert.equal(landed, m.windows.length);
});

test('a target out of reach or behind is never hit', () => {
  const m = MOVES.slash;
  for (const tgt of [{ x: 0, z: 9, r: 0.5 }, { x: 0, z: -1.5, r: 0.5 }]) {
    const hits = new Set();
    let landed = 0;
    for (let t = 0; t < totalTime(m); t += 1 / 60) landed += resolveContacts(m, t, hits, { x: 0, z: 0, facing: 0, r: 0.5 }, tgt).length;
    assert.equal(landed, 0);
  }
});

test('contact shapes', () => {
  const atk = { x: 0, z: 0, facing: 0, r: 0.5 };
  assert.ok(contactHits({ kind: 'arc', reach: 1, arc: Math.PI / 2 }, atk, { x: 0, z: 1.5, r: 0.4 }));
  assert.ok(!contactHits({ kind: 'arc', reach: 1, arc: Math.PI / 2 }, atk, { x: 1.4, z: 0.2, r: 0.1 }));
  assert.ok(contactHits({ kind: 'circle', radius: 3 }, atk, { x: -2.5, z: 0, r: 0.5 }));
  assert.ok(!contactHits({ kind: 'circle', radius: 3 }, atk, { x: -4, z: 0, r: 0.5 }));
  assert.ok(contactHits({ kind: 'line', reach: 2, width: 0.8 }, atk, { x: 0.2, z: 2, r: 0.4 }));
  assert.ok(!contactHits({ kind: 'line', reach: 2, width: 0.8 }, atk, { x: 2, z: 1, r: 0.4 }));
});

test('projectile spawns fire exactly once', () => {
  const m = MOVES.shurikenFan;
  let fired = 0, prev = -1;
  for (let t = 0; t < totalTime(m); t += 1 / 30) { fired += spawnsBetween(m, prev, t).length; prev = t; }
  assert.equal(fired, 1);
});

test('lunges move only inside their window', () => {
  const m = MOVES.lunge;
  assert.equal(lungeSpeed(m, 0), 0);
  assert.equal(lungeSpeed(m, m.startup + 0.1), m.lunge.speed);
  assert.equal(lungeSpeed(m, m.startup + m.lunge.until + 0.01), 0);
});

test('attack turns cap simultaneous attackers', () => {
  const tk = new AttackTokens(2);
  assert.ok(tk.request('a'));
  assert.ok(tk.request('b'));
  assert.ok(!tk.request('c'));
  assert.ok(tk.request('a'));
  tk.release('a');
  assert.ok(tk.request('c'));
});

test('validation catches broken content', () => {
  assert.ok(validateContent({ mystery: {} }).some(e => e.includes('mystery')));
});
