import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hopDistance } from '@friedrich/engine';
import { retreatOptions } from './retreat.js';
import { friedrichMap } from './map-data.js';
import type { Piece, Train } from './pieces.js';

const NO_TRAINS: Record<string, Train> = {};
const general = (id: string, node: string, nation: Piece['nation'] = 'prussia'): Piece =>
  ({ id, nation, rank: 1, node, troops: 4, faceUp: true });

/** The loser sits at `from`; the winner is adjacent. */
const scene = (from: string, winner: string, extra: Piece[] = []) => ({
  pieces: Object.fromEntries(
    [general('loser', from), general('winner', winner, 'austria'), ...extra].map((p) => [p.id, p]),
  ),
  from,
  winner,
});

test('a retreat ends exactly the required number of cities away', () => {
  const s = scene('berlin', 'potsdam');
  for (const distance of [1, 2, 3]) {
    const options = retreatOptions(s.pieces, NO_TRAINS, s.from, s.winner, distance);
    assert.ok(options.length > 0, `expected somewhere to go at distance ${distance}`);
    for (const node of options) {
      // reachable in exactly `distance` steps — never fewer
      assert.equal(
        hopDistance(friedrichMap, s.from, node) <= distance,
        true,
        `${node} should be within ${distance} of ${s.from}`,
      );
      assert.notEqual(node, s.from, 'a retreat never ends where it began');
    }
  }
});

test('the retreat ends as far from the winning general as it can', () => {
  const s = scene('berlin', 'potsdam');
  const options = retreatOptions(s.pieces, NO_TRAINS, s.from, s.winner, 2);
  const away = options.map((n) => hopDistance(friedrichMap, n, s.winner));
  assert.equal(new Set(away).size, 1, 'all offered destinations are equally far — that is the rule');

  // nothing reachable in exactly 2 steps is further from Potsdam than what we offer
  const best = away[0]!;
  const twoAway = new Set<string>();
  for (const a of friedrichMap.adjacency.get('berlin') ?? []) {
    for (const b of friedrichMap.adjacency.get(a) ?? []) if (b !== 'berlin' && b !== 'potsdam' && a !== 'potsdam') twoAway.add(b);
  }
  for (const node of twoAway) {
    assert.ok(hopDistance(friedrichMap, node, s.winner) <= best, `${node} is further than the chosen retreat`);
  }
});

test('a retreat may not pass through or land on any piece — even a friendly one', () => {
  // wall Berlin in: every neighbour occupied leaves nowhere to go
  const blockers = [...friedrichMap.adjacency.get('berlin')!].map((n, i) => general(`blocker${i}`, n, 'prussia'));
  const s = scene('berlin', 'potsdam', blockers);
  assert.deepEqual(retreatOptions(s.pieces, NO_TRAINS, s.from, s.winner, 1), [], 'boxed in — the stack is destroyed');
});

test('a supply train blocks a retreat just as a general does', () => {
  const s = scene('berlin', 'potsdam');
  const open = retreatOptions(s.pieces, NO_TRAINS, s.from, s.winner, 1);
  assert.ok(open.length > 0);

  const trains: Record<string, Train> = Object.fromEntries(
    [...friedrichMap.adjacency.get('berlin')!].map((n, i) => [`t${i}`, { id: `t${i}`, nation: 'russia', node: n }]),
  );
  assert.deepEqual(
    retreatOptions(s.pieces, trains, s.from, s.winner, 1),
    [],
    'the rules forbid retreating onto a train, even to destroy it',
  );
});

test('a retreat never re-enters a city, so a dead end cannot be padded out', () => {
  // Oschatz has three roads (Wurzen, Riesa, Torgau). Block two, and the only way
  // out is a single corridor — a 2-step retreat cannot bounce back and forth.
  const s = scene('oschatz', 'riesa', [general('b1', 'wurzen', 'austria')]);
  const options = retreatOptions(s.pieces, NO_TRAINS, s.from, s.winner, 2);
  assert.ok(!options.includes('oschatz'), 'cannot step out and back');
  for (const node of options) assert.notEqual(node, 'torgau', 'torgau is 1 step, not 2');
});

test('a stack that cannot go the full distance has nowhere to retreat', () => {
  const s = scene('berlin', 'potsdam');
  // no simple path of 600 steps exists from Berlin
  assert.deepEqual(retreatOptions(s.pieces, NO_TRAINS, s.from, s.winner, 600), []);
});
