import { test } from 'node:test';
import assert from 'node:assert/strict';

import { randomSeed, seedFromString, rngShuffle } from './rng.js';

const deck = Array.from({ length: 50 }, (_, i) => i);
const shuffledWith = (seed: string) => rngShuffle(seedFromString(seed), deck).items.join(',');

test('a seed reproduces its shuffle exactly', () => {
  // this is the whole point of the seeded RNG: server and clients must agree
  assert.equal(shuffledWith('abc'), shuffledWith('abc'));
});

test('different seeds shuffle differently', () => {
  assert.notEqual(shuffledWith('abc'), shuffledWith('abd'));
});

test('a shuffle keeps every card exactly once', () => {
  const out = rngShuffle(seedFromString('x'), deck).items;
  assert.deepEqual([...out].sort((a, b) => a - b), deck);
});

test('randomSeed gives a fresh seed every time', () => {
  // A game is deterministic in its seed, so a repeated seed = a repeated game:
  // the same deck order, the same deal, the same role raffle. This is the one
  // thing standing between "shuffled" and "identical every time".
  const seeds = new Set(Array.from({ length: 500 }, randomSeed));
  assert.equal(seeds.size, 500);
});

test('seeds from randomSeed actually shuffle differently', () => {
  const deals = new Set(Array.from({ length: 50 }, () => shuffledWith(randomSeed())));
  assert.equal(deals.size, 50, 'every new game deals a different deck');
});
