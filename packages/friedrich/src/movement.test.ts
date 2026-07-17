import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SUITS } from '@friedrich/engine';
import { friedrichMap, NODES, EDGES } from './map-data.js';
import { ALL_GENERALS, INITIAL_TRAINS } from './pieces.js';

/**
 * Sanity checks on the GENERATED authentic map data (movement mechanics are
 * unit-tested synthetically in the engine package).
 */

test('map has the full 671 cities and a dense road graph', () => {
  // 680 VASSAL Main Map regions minus 8 non-city artifacts (turn track etc.)
  // minus the phantom Gifhorn duplicate (VASSAL bug, see road-patches.json)
  assert.equal(NODES.length, 671);
  assert.ok(EDGES.length >= 1000, `expected 1000+ roads, got ${EDGES.length}`);
});

test('all node suits are valid and every edge resolves', () => {
  for (const n of NODES) assert.ok(SUITS.includes(n.suit), `bad suit on ${n.id}`);
  for (const e of EDGES) {
    assert.ok(friedrichMap.nodes.has(e.a) && friedrichMap.nodes.has(e.b), `dangling edge ${e.a}-${e.b}`);
  }
});

test('authoritative objectives are on the map with correct owners', () => {
  const objectives = NODES.filter((n) => n.objectiveFor);
  const count = (nation: string) => objectives.filter((n) => n.objectiveFor === nation).length;
  assert.equal(count('austria'), 16, 'Austria 12 first + 4 second order');
  assert.equal(count('russia'), 10);
  assert.equal(count('sweden'), 10, 'Sweden 5 + 5');
  assert.equal(count('france'), 10);
  assert.equal(count('imperial'), 10, 'Imperial 5 + 5');
  assert.equal(count('prussia'), 14, "Prussia's Bohemian objectives");
  assert.equal(friedrichMap.nodes.get('breslau')?.objectiveFor, 'austria');
  assert.equal(friedrichMap.nodes.get('konigsberg')?.objectiveFor, 'russia');
});

test('the road network is one fully connected component', () => {
  // every starting piece must be able to reach Berlin (graph connectivity)
  const start = 'berlin';
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const n = queue.pop()!;
    for (const m of friedrichMap.adjacency.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  for (const p of [...ALL_GENERALS, ...INITIAL_TRAINS]) {
    assert.ok(seen.has(p.node), `${p.id} at ${p.node} is disconnected from the main map`);
  }
  assert.equal(seen.size, NODES.length, 'every city is reachable from Berlin');
});
