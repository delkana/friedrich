import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMap, type MapNode, type MapEdge } from './map.js';
import { reachableNodes } from './movement.js';

// Synthetic line a-b-c-d-e all main road, plus ordinary spurs.
const node = (id: string): MapNode => ({ id, name: id, suit: 'clubs', x: 0, y: 0 });
const graph = buildMap(
  ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(node),
  [
    { a: 'a', b: 'b', mainRoad: true },
    { a: 'b', b: 'c', mainRoad: true },
    { a: 'c', b: 'd', mainRoad: true },
    { a: 'd', b: 'e', mainRoad: true },
    { a: 'a', b: 'f' }, // ordinary
    { a: 'f', b: 'g' },
    { a: 'g', b: 'c' }, // ordinary detour a-f-g-c
  ] as MapEdge[],
);

test('main-road bonus: 4th city reachable only via an all-main path', () => {
  const reach = reachableNodes(graph, 'a', new Set());
  assert.equal(reach.get('d'), 3);
  assert.equal(reach.get('e'), 4, 'e is 4 hops but the whole path is main road');
});

test('a mixed path caps at 3 cities', () => {
  // remove main flag by starting at f: f-g-c-d is ordinary+main mix, 3 max
  const reach = reachableNodes(graph, 'f', new Set());
  assert.equal(reach.get('d'), 3);
  assert.equal(reach.has('e'), false, '4th hop denied on a mixed path');
});

test('no jumping: occupied cities block through-movement but remain endpoints', () => {
  const reach = reachableNodes(graph, 'a', new Set(['b']));
  assert.equal(reach.get('b'), 1, 'may still stop on the occupied city');
  assert.equal(reach.get('c'), 3, 'c now only via the a-f-g-c detour');
  assert.equal(reach.has('e'), false, 'main-road express blocked at b');
});
