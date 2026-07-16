import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IllegalActionError } from './core.js';
import { buildTacticalDeck, type SuitCard, type ReserveCard, type Suit } from './cards.js';
import { startDuel, playCard, pass, mustPlay, legalCardIds, type DuelCombatant } from './combat.js';

const suitCard = (suit: Suit, value: number): SuitCard => ({ id: `${suit}-${value}`, kind: 'suit', suit, value });
const reserve = (id = 'reserve'): ReserveCard => ({ id, kind: 'reserve' });

test('rulebook worked example: Heinrich vs Richelieu+Soubise resolves to a 3-troop defender loss', () => {
  const attacker: DuelCombatant = {
    troops: 2,
    sectorSuit: 'diamonds',
    hand: [suitCard('diamonds', 10), suitCard('diamonds', 7)],
  };
  const defender: DuelCombatant = {
    troops: 4,
    sectorSuit: 'spades',
    hand: [suitCard('spades', 5), suitCard('spades', 3), suitCard('spades', 4)],
  };

  let s = startDuel(attacker, defender);
  assert.equal(s.toMove, 'attacker', 'attacker (behind at -2) plays first');

  // 1. Prussia plays 10 of diamonds -> +8, switch to defender.
  s = playCard(s, 'attacker', 'diamonds-10');
  assert.equal(s.attacker.total - s.defender.total, 8);
  assert.equal(s.toMove, 'defender');

  // 2. France plays 5 of spades -> +3, still behind, keeps the play.
  s = playCard(s, 'defender', 'spades-5');
  assert.equal(s.attacker.total - s.defender.total, 3);
  assert.equal(s.toMove, 'defender');

  // 3. France plays 3 of spades -> 0, switch to attacker.
  s = playCard(s, 'defender', 'spades-3');
  assert.equal(s.attacker.total - s.defender.total, 0);
  assert.equal(s.toMove, 'attacker');
  assert.equal(mustPlay(s, 'attacker'), true, 'attacker holds a diamond and must play at even');

  // 4. Prussia must play 7 of diamonds -> +7, switch to defender.
  s = playCard(s, 'attacker', 'diamonds-7');
  assert.equal(s.attacker.total - s.defender.total, 7);
  assert.equal(s.toMove, 'defender');

  // 5. France plays 4 of spades -> +3, still behind.
  s = playCard(s, 'defender', 'spades-4');
  assert.equal(s.attacker.total - s.defender.total, 3);
  assert.equal(s.toMove, 'defender');

  // 6. France accepts defeat.
  s = pass(s, 'defender');
  assert.equal(s.status, 'attacker_won');
  assert.deepEqual(s.result, {
    outcome: 'attacker_won',
    loser: 'defender',
    casualties: 3,
    loserEliminated: false,
  });
});

test('a hopeless attacker can concede immediately and is eliminated (casualties capped at troops)', () => {
  let s = startDuel(
    { troops: 1, sectorSuit: 'diamonds', hand: [] },
    { troops: 5, sectorSuit: 'spades', hand: [] },
  );
  assert.equal(s.toMove, 'attacker');
  s = pass(s, 'attacker');
  assert.equal(s.status, 'defender_won');
  assert.equal(s.result?.loser, 'attacker');
  assert.equal(s.result?.casualties, 1, 'gap of 4 capped at the attacker\'s 1 troop');
  assert.equal(s.result?.loserEliminated, true);
});

test('even start with no matching-suit card is a tie with no losses', () => {
  let s = startDuel(
    { troops: 3, sectorSuit: 'diamonds', hand: [suitCard('spades', 9)] }, // wrong suit
    { troops: 3, sectorSuit: 'spades', hand: [] },
  );
  assert.equal(s.toMove, 'attacker');
  assert.equal(mustPlay(s, 'attacker'), false);
  assert.deepEqual(legalCardIds(s, 'attacker'), [], 'the off-suit card is not playable here');
  s = pass(s, 'attacker');
  assert.equal(s.status, 'tie');
  assert.equal(s.result?.casualties, 0);
});

test('passing at an even score is illegal while holding a matching-suit card', () => {
  const s = startDuel(
    { troops: 3, sectorSuit: 'diamonds', hand: [suitCard('diamonds', 5)] },
    { troops: 3, sectorSuit: 'spades', hand: [] },
  );
  assert.equal(mustPlay(s, 'attacker'), true);
  assert.throws(() => pass(s, 'attacker'), IllegalActionError);
});

test('a Reserve is wild: playable in any sector with a declared value', () => {
  let s = startDuel(
    { troops: 2, sectorSuit: 'diamonds', hand: [reserve('R1')] },
    { troops: 3, sectorSuit: 'spades', hand: [] },
  );
  assert.deepEqual(legalCardIds(s, 'attacker'), ['R1']);
  s = playCard(s, 'attacker', 'R1', { suit: 'clubs', value: 5 });
  assert.equal(s.attacker.total, 7);
  assert.equal(s.toMove, 'defender');
  s = pass(s, 'defender');
  assert.equal(s.status, 'attacker_won');
  assert.equal(s.result?.casualties, 3);
  assert.equal(s.result?.loserEliminated, true);
});

test('a Reserve must declare a legal value (1..10)', () => {
  const s = startDuel(
    { troops: 2, sectorSuit: 'diamonds', hand: [reserve('R1')] },
    { troops: 3, sectorSuit: 'spades', hand: [] },
  );
  assert.throws(() => playCard(s, 'attacker', 'R1', { suit: 'clubs', value: 11 }), IllegalActionError);
  assert.throws(() => playCard(s, 'attacker', 'R1'), IllegalActionError, 'missing declaration');
});

test('cannot play an off-suit card or play out of turn', () => {
  const s = startDuel(
    { troops: 2, sectorSuit: 'diamonds', hand: [suitCard('spades', 9)] },
    { troops: 3, sectorSuit: 'spades', hand: [suitCard('spades', 2)] },
  );
  assert.throws(() => playCard(s, 'attacker', 'spades-9'), IllegalActionError, 'off-suit');
  assert.throws(() => playCard(s, 'defender', 'spades-2'), IllegalActionError, 'not defender to move');
});

test('a tactical deck is 50 cards: 48 suited (2..13 x4) plus 2 reserves', () => {
  const deck = buildTacticalDeck('prussia');
  assert.equal(deck.length, 50);
  assert.equal(deck.filter((c) => c.kind === 'reserve').length, 2);
  assert.equal(deck.filter((c) => c.kind === 'suit').length, 48);
  const spades = deck.filter((c): c is SuitCard => c.kind === 'suit' && c.suit === 'spades');
  assert.equal(spades.length, 12);
  assert.deepEqual(spades.map((c) => c.value).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});
