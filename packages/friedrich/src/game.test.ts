import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IllegalActionError } from '@friedrich/engine';
import { Friedrich } from './game.js';
import type { FriedrichState, FriedrichAction } from './state.js';

const PLAYERS = ['p0', 'p1', 'p2', 'p3'];
const fresh = (): FriedrichState => Friedrich.setup('seed-1', PLAYERS);
const act = (s: FriedrichState, a: FriedrichAction): FriedrichState => Friedrich.reducer(s, a);

/** Reposition a piece for a combat scenario (tests may shape pure state freely). */
const placed = (s: FriedrichState, moves: Record<string, string>): FriedrichState => ({
  ...s,
  pieces: Object.fromEntries(
    Object.entries(s.pieces).map(([id, p]) => [id, moves[id] ? { ...p, node: moves[id] } : p]),
  ),
});

test('setup deals hands and places the starting generals on the authentic map', () => {
  const s = fresh();
  assert.equal(s.pieces['friedrich']?.node, 'berlin');
  assert.equal(s.pieces['daun']?.node, 'brunn');
  assert.equal(s.pieces['richelieu']?.node, 'iserlohn');
  assert.equal(s.hands.prussia.length, 7, 'Prussia draws its 7-card allotment');
  assert.equal(s.hands.austria.length, 5);
  assert.equal(s.activeNationIndex, 0, 'Prussia acts first');
});

test('an outnumbered attacker who concedes takes the gap as casualties and retreats', () => {
  // Browne (6 troops) parked at Pirna, adjacent to Keith (4) at Dresden.
  let s = placed(fresh(), { browne: 'pirna' });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'keith', defenderId: 'browne' });
  assert.ok(s.combat, 'a battle started');
  assert.equal(s.combat!.duel.toMove, 'attacker', 'keith is behind at -2');

  s = act(s, { type: 'combatPass', by: 'p0' }); // keith accepts defeat
  assert.equal(s.combat, null, 'battle resolved');
  assert.equal(s.pieces['keith']?.troops, 2, 'lost the 2-troop gap');
  assert.notEqual(s.pieces['keith']?.node, 'dresden', 'retreated off Dresden');
  assert.equal(s.pieces['browne']?.troops, 6, 'winner loses nothing');
  assert.equal(s.pieces['browne']?.node, 'pirna', 'winner holds its ground');
});

test('stacking to outnumber the enemy makes the defender lose and retreat', () => {
  // Heinrich joins Keith at Dresden (5+4=9) against Browne at Pirna (6).
  let s = placed(fresh(), { heinrich: 'dresden', browne: 'pirna' });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'keith', defenderId: 'browne' });
  assert.equal(s.combat!.duel.attacker.troops, 9, 'stack pools its troops');
  assert.equal(s.combat!.duel.toMove, 'defender', 'browne is behind at -3');

  s = act(s, { type: 'combatPass', by: 'p0' }); // browne concedes 3
  assert.equal(s.combat, null);
  assert.equal(s.pieces['browne']?.troops, 3, 'lost exactly the 3-troop gap');
  assert.notEqual(s.pieces['browne']?.node, 'pirna', 'defender retreated');
  assert.equal(s.pieces['keith']?.node, 'dresden', 'attacker holds its ground');
  assert.equal(s.pieces['heinrich']?.troops, 5, 'winner loses nothing');
});

test('movement is rejected onto an enemy city, out of range, or out of turn', () => {
  const s = placed(fresh(), { browne: 'pirna' });
  // Keith cannot MOVE onto Pirna — Browne holds it; must attack instead.
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'keith', to: 'pirna' }), IllegalActionError);
  // Berlin to Brünn is far out of range.
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'brunn' }), IllegalActionError);
  // Austria cannot move on Prussia's stage.
  assert.throws(() => act(s, { type: 'move', by: 'p1', pieceId: 'daun', to: 'olmutz' }), IllegalActionError);
});

test('legal movement works on real roads: Dresden -> Meissen', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'keith', to: 'meissen' });
  assert.equal(s.pieces['keith']?.node, 'meissen');
});

test('a general may move only once per stage, but the move can be undone', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'keith', to: 'meissen' });
  assert.equal(s.stageMoves['keith'], 'dresden', 'origin recorded for ghost/undo');
  // second move of the same general is rejected
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'keith', to: 'grossenhain' }), IllegalActionError);
  // undo returns it home and frees it to move again
  s = act(s, { type: 'undoMove', by: 'p0', pieceId: 'keith' });
  assert.equal(s.pieces['keith']?.node, 'dresden');
  assert.equal(s.stageMoves['keith'], undefined);
  s = act(s, { type: 'move', by: 'p0', pieceId: 'keith', to: 'meissen' });
  assert.equal(s.pieces['keith']?.node, 'meissen');
});

test('committing to a battle finalizes moves (no more undo)', () => {
  let s = placed(fresh(), { browne: 'pirna' });
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'potsdam' });
  assert.equal(s.stageMoves['friedrich'], 'berlin');
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'keith', defenderId: 'browne' });
  assert.deepEqual(s.stageMoves, {}, 'stage moves cleared on attack');
  assert.throws(() => act(s, { type: 'undoMove', by: 'p0', pieceId: 'friedrich' }), IllegalActionError);
});

test('ending a stage clears the move budget for the next nation', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'keith', to: 'meissen' });
  s = act(s, { type: 'endNationTurn', by: 'p0' });
  assert.deepEqual(s.stageMoves, {});
});

test('ending a nation stage advances to the next nation in order', () => {
  let s = fresh();
  assert.equal(s.activeNationIndex, 0); // prussia
  s = act(s, { type: 'endNationTurn', by: 'p0' });
  assert.equal(s.activeNationIndex, 1); // hanover
});
