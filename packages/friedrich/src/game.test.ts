import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IllegalActionError, randomSeed } from '@friedrich/engine';
import { Friedrich, suggestAllotment, depotsBlocked, reentrySites, HIDDEN_TROOPS } from './game.js';
import { NATION_ORDER } from './powers.js';
import { TROOP_MAX, TROOP_PER_GENERAL_MAX, DEPOT_CITIES, substituteSites } from './pieces.js';
import { friedrichMap } from './map-data.js';
import { checkVictory, objectivesOf, requiredObjectives } from './victory.js';
import { inSupply } from './supply.js';
import type { FriedrichState, FriedrichAction } from './state.js';

const emptyNeighbour = (s: FriedrichState, node: string): string =>
  [...friedrichMap.adjacency.get(node)!].find(
    (n) => !Object.values(s.pieces).some((p) => p.node === n) && !Object.values(s.trains).some((t) => t.node === n),
  )!;

const PLAYERS = ['p0', 'p1', 'p2', 'p3'];
const act = (s: FriedrichState, a: FriedrichAction): FriedrichState => Friedrich.reducer(s, a);

/**
 * End the current stage and answer any discard the new stage owes (France's),
 * so tests that fast-forward through many stages don't stall on the choice.
 */
const endStage = (s: FriedrichState): FriedrichState => {
  const next = act(s, { type: 'endNationTurn', by: 'p0' });
  return next.pendingDiscard
    ? act(next, { type: 'discardCard', by: 'p0', cardId: next.pendingDiscard.cardIds[0]! })
    : next;
};

/** Answer a pending retreat by taking the first legal destination offered. */
const resolveRetreat = (s: FriedrichState): FriedrichState =>
  s.pendingRetreat ? act(s, { type: 'chooseRetreat', by: 'p0', node: s.pendingRetreat.options[0]! }) : s;

/** A game paused at set-up, before anyone has allotted troops. */
const rawSetup = (): FriedrichState => Friedrich.setup('seed-1', PLAYERS);

/** Take every nation through the set-up allotment so the war has begun. */
const allotAll = (s: FriedrichState): FriedrichState =>
  NATION_ORDER.reduce(
    (acc, nation) => act(acc, { type: 'allotTroops', by: 'p0', nation, alloc: suggestAllotment(acc, nation) }),
    s,
  );

const fresh = (): FriedrichState => allotAll(rawSetup());

/** Set exact troop strengths for a scenario (allotment is the players' choice). */
const armed = (s: FriedrichState, troops: Record<string, number>): FriedrichState => ({
  ...s,
  pieces: Object.fromEntries(
    Object.entries(s.pieces).map(([id, p]) => [id, troops[id] !== undefined ? { ...p, troops: troops[id]! } : p]),
  ),
});

/** Reposition a piece for a combat scenario (tests may shape pure state freely). */
const placed = (s: FriedrichState, moves: Record<string, string>): FriedrichState => ({
  ...s,
  pieces: Object.fromEntries(
    Object.entries(s.pieces).map(([id, p]) => [id, moves[id] ? { ...p, node: moves[id] } : p]),
  ),
});

test('set-up raffles the roles, places every general, and waits for troop allotment', () => {
  const s = rawSetup();
  assert.equal(s.phase, 'setup');
  assert.deepEqual(s.allocated, []);
  assert.equal(Object.keys(s.pieces).length, 24, 'all 24 generals are on the board');
  assert.ok(
    Object.values(s.pieces).every((p) => p.troops === 0),
    'generals start empty — troops are allotted secretly by their player',
  );
  assert.equal(Object.keys(s.trains).length, 11, 'supply trains start on their depot cities');

  // Every player is dealt a role, and between them they cover all four.
  const dealt = PLAYERS.flatMap((p) => s.seats[p] ?? []);
  assert.deepEqual([...dealt].sort(), ['elisabeth', 'frederick', 'mariaTheresa', 'pompadour']);
});

test('a new game is a new deal, not a repeat of the last one', () => {
  // Regression: both the hotseat client and the server used to pass a constant
  // seed (a literal, and the room code), so every game dealt the identical deck
  // and raffled Frederick to the same seat. setup() was never the problem — the
  // callers were, which is why nothing here caught it.
  const games = Array.from({ length: 20 }, () => Friedrich.setup(randomSeed(), PLAYERS));
  const decks = new Set(games.map((s) => s.drawDeck.map((c) => c.id).join(',')));
  assert.equal(decks.size, 20, 'every game shuffles its own deck');

  // and the shuffle reaches the players: Prussia's opening hand is dealt off the
  // top of that deck once the armies are raised
  const opening = new Set(games.map((s) => allotAll(s).hands.prussia.map((c) => c.id).sort().join(',')));
  assert.equal(opening.size, 20, "Prussia's opening hand differs game to game");
});

test('the log never shows an internal id', () => {
  // The log is the game's narration, and the only record a player can look back
  // over. It once said "prussia supply train → oschatz" and "keith is
  // reinforced"; every message goes through cityName/nationName/generalName now.
  let s = fresh();
  s = act(s, { type: 'moveTrain', by: 'p0', trainId: 'sup-prussia-1', to: emptyNeighbour(s, 'juterbog') });
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'torgau' });
  s = act(s, { type: 'undoMove', by: 'p0', pieceId: 'friedrich' });
  for (let i = 0; i < 8; i++) s = endStage(s);

  const ids = [
    ...NATION_ORDER, // 'prussia', 'imperial', …
    ...Object.keys(s.pieces), // 'friedrich', 'keith', …
    ...Object.values(s.trains).map((t) => t.id),
    'oschatz', 'juterbog', 'torgau', // node ids
  ];
  for (const line of s.log) {
    for (const id of ids) {
      // ids are lowercase; a real name is capitalised or spelled out
      assert.ok(!new RegExp(`\\b${id}\\b`).test(line), `log line shows the raw id "${id}": ${line}`);
    }
  }
});

test('the raffle deals roles to different seats across games', () => {
  const seatOf = (seed: string): string =>
    PLAYERS.find((p) => Friedrich.setup(seed, PLAYERS).seats[p]?.includes('frederick'))!;
  const seats = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(seatOf));
  assert.ok(seats.size > 1, 'Frederick is not always the same seat');
});

test('a nation may not act until it has allotted its troops', () => {
  const s = rawSetup();
  assert.throws(() => act(s, { type: 'endNationTurn', by: 'p0' }), IllegalActionError);
});

test('allotment must spend the whole establishment, 1..max per general', () => {
  const s = rawSetup();
  const spread = suggestAllotment(s, 'prussia');

  const short = { ...spread, friedrich: spread['friedrich']! - 1 };
  assert.throws(() => act(s, { type: 'allotTroops', by: 'p0', nation: 'prussia', alloc: short }), IllegalActionError);

  const zeroed = { ...spread, friedrich: 0, winterfeldt: spread['winterfeldt']! + spread['friedrich']! };
  assert.throws(() => act(s, { type: 'allotTroops', by: 'p0', nation: 'prussia', alloc: zeroed }), IllegalActionError);

  const over = { ...spread, friedrich: TROOP_PER_GENERAL_MAX.prussia + 1 };
  assert.throws(() => act(s, { type: 'allotTroops', by: 'p0', nation: 'prussia', alloc: over }), IllegalActionError);

  const ok = act(s, { type: 'allotTroops', by: 'p0', nation: 'prussia', alloc: spread });
  const total = Object.values(ok.pieces)
    .filter((p) => p.nation === 'prussia')
    .reduce((a, p) => a + p.troops, 0);
  assert.equal(total, TROOP_MAX.prussia);
  assert.deepEqual(ok.allocated, ['prussia']);
  assert.equal(ok.phase, 'setup', 'still waiting on the other nations');
  assert.throws(
    () => act(ok, { type: 'allotTroops', by: 'p0', nation: 'prussia', alloc: spread }),
    IllegalActionError,
    'a nation cannot allot twice',
  );
});

test('the war begins only once every nation has allotted', () => {
  const s = allotAll(rawSetup());
  assert.equal(s.phase, 'war');
  assert.equal(s.activeNationIndex, 0, 'Prussia acts first');
  assert.equal(s.hands.prussia.length, 7, 'and draws its allotment as its stage opens');
  for (const nation of NATION_ORDER) {
    const total = Object.values(s.pieces)
      .filter((p) => p.nation === nation)
      .reduce((a, p) => a + p.troops, 0);
    assert.equal(total, TROOP_MAX[nation], `${nation} fielded its full establishment`);
  }
});

test('setup opens Prussia\'s stage with a draw; other nations draw on their own stage', () => {
  const s = fresh();
  assert.equal(s.pieces['friedrich']?.node, 'oschatz');
  assert.equal(s.pieces['daun']?.node, 'brunn');
  assert.equal(s.hands.prussia.length, 7, 'Prussia draws its 7-card allotment at setup');
  assert.equal(s.hands.austria.length, 0, 'Austria has not drawn yet');
  assert.equal(s.drawDeck.length, 43, 'the shared 50-card deck, minus the 7 Prussia drew');
  assert.equal(s.setsUsed, 1, 'only the first of the four decks is in play');
  assert.equal(s.activeNationIndex, 0, 'Prussia acts first');
});

test('every nation draws from the same deck', () => {
  let s = fresh();
  assert.equal(s.hands.hanover.length, 0);
  s = act(s, { type: 'endNationTurn', by: 'p0' }); // advance to Hanover's stage
  assert.equal(s.hands.hanover.length, 2, 'Hanover draws its 1+1 allotment');
  assert.equal(s.drawDeck.length, 41, "Hanover's draw comes out of the same deck Prussia drew from");
});

test('when the draw deck runs out, the next of the four decks is opened', () => {
  // drain the deck down to one card, then let Hanover draw its two
  const base = fresh();
  const s: FriedrichState = { ...base, drawDeck: base.drawDeck.slice(0, 1) };
  const next = act(s, { type: 'endNationTurn', by: 'p0' }); // Hanover's stage → draws 2

  assert.equal(next.hands.hanover.length, 2, 'Hanover still got its full allotment');
  assert.equal(next.setsUsed, 2, 'the second deck was opened');
  assert.equal(next.drawDeck.length, 49, 'a fresh 50-card deck, minus the one card still owed');
  assert.ok(next.log.some((l) => /deck 2 is opened/i.test(l)), 'the players are told');
});

test('once all four decks are used up, the two fullest piles are shuffled back', () => {
  const base = fresh();
  // all four decks opened and exhausted; piles hold what has been played
  const pile = (n: number, origin: string) =>
    Array.from({ length: n }, (_, i) => ({ id: `${origin}-x${i}`, kind: 'suit' as const, suit: 'clubs' as const, value: 5, origin }));
  const s: FriedrichState = {
    ...base,
    drawDeck: [],
    setsUsed: 4,
    playedSets: [pile(3, 'set1'), pile(20, 'set2'), pile(9, 'set3'), pile(30, 'set4')],
  };
  const next = act(s, { type: 'endNationTurn', by: 'p0' }); // Hanover draws 2

  assert.equal(next.setsUsed, 4, 'there is no fifth deck');
  // the two biggest piles (set4=30 and set2=20) are recycled: 50 cards, 2 drawn
  assert.equal(next.drawDeck.length, 48);
  assert.deepEqual(next.playedSets.map((p) => p.length), [3, 0, 9, 0], 'only the recycled piles are emptied');
  assert.ok(
    next.hands.hanover.every((c) => c.origin === 'set2' || c.origin === 'set4'),
    'Hanover drew from the recycled cards',
  );
});

/** Advance to France's stage (it acts last in the order). */
const toFrance = (s: FriedrichState): FriedrichState =>
  NATION_ORDER.slice(0, NATION_ORDER.indexOf('france')).reduce(
    (acc) => act(acc, { type: 'endNationTurn', by: 'p0' }),
    s,
  );

test('France draws four and chooses one of them to discard', () => {
  const s = toFrance(fresh());
  assert.equal(s.hands.france.length, 4, 'all four drawn are in hand until France chooses');
  assert.equal(s.pendingDiscard?.nation, 'france');
  assert.deepEqual([...s.pendingDiscard!.cardIds].sort(), s.hands.france.map((c) => c.id).sort());

  // the whole stage waits on the choice
  assert.throws(() => act(s, { type: 'endNationTurn', by: 'p0' }), IllegalActionError);
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'soubise', to: 'kassel' }), IllegalActionError);

  // France may pick ANY of the four — not merely the last dealt
  const chosen = s.hands.france[0]!;
  const after = act(s, { type: 'discardCard', by: 'p0', cardId: chosen.id });
  assert.equal(after.pendingDiscard, null);
  assert.equal(after.hands.france.length, 3, 'France keeps three');
  assert.ok(!after.hands.france.some((c) => c.id === chosen.id), 'the chosen card is gone');
  assert.ok(after.playedSets.flat().some((c) => c.id === chosen.id), 'and is set aside on its own pile');
  act(after, { type: 'endNationTurn', by: 'p0' }); // the stage runs on
});

test('France may only discard a card it just drew', () => {
  let s = toFrance(fresh());
  // give France a card it held from before — that one is not a legal choice
  const older = { id: 'older-card', kind: 'suit' as const, suit: 'clubs' as const, value: 9, origin: 'set1' };
  s = { ...s, hands: { ...s.hands, france: [...s.hands.france, older] } };
  assert.throws(() => act(s, { type: 'discardCard', by: 'p0', cardId: 'older-card' }), IllegalActionError);
  assert.throws(() => act(s, { type: 'discardCard', by: 'p0', cardId: 'no-such-card' }), IllegalActionError);
});

test('the cards France may discard are hidden from everyone else', () => {
  const s = toFrance(fresh());
  const france = s.players.find((p) => (s.seats[p] ?? []).includes('pompadour'))!;
  const other = s.players.find((p) => !(s.seats[p] ?? []).includes('pompadour'))!;
  assert.equal(Friedrich.redact(s, france).pendingDiscard?.cardIds.length, 4, 'France sees its own choices');
  const theirs = Friedrich.redact(s, other).pendingDiscard;
  assert.equal(theirs?.nation, 'france', 'others know France owes a discard');
  assert.deepEqual(theirs?.cardIds, [], "but a card id spells out the card, so they don't see which");
});

test('the 50 cards in play are conserved across the deck, hands and played piles', () => {
  const s = fresh();
  const inHands = NATION_ORDER.reduce((n, nat) => n + s.hands[nat].length, 0);
  const setAside = s.playedSets.reduce((n, pile) => n + pile.length, 0);
  assert.equal(s.drawDeck.length + inHands + setAside, 50);
});

test('an outnumbered attacker who concedes takes the gap as casualties and retreats', () => {
  // Browne (6 troops) parked at Riesa, adjacent to Friedrich (4) alone at Oschatz.
  let s = armed(placed(fresh(), { browne: 'riesa', winterfeldt: 'wurzen' }), { friedrich: 4, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  assert.ok(s.combat, 'a battle started');
  assert.equal(s.combat!.duel.toMove, 'attacker', 'friedrich is behind at -2');

  s = act(s, { type: 'combatPass', by: 'p0' }); // friedrich accepts defeat
  assert.equal(s.combat, null, 'battle resolved');
  assert.equal(s.pieces['friedrich']?.troops, 2, 'lost the 2-troop gap');
  // the winner picks where the beaten stack ends up
  assert.equal(s.pendingRetreat?.chooser, 'austria');
  assert.equal(s.pendingRetreat?.nation, 'prussia');
  s = resolveRetreat(s);
  assert.notEqual(s.pieces['friedrich']?.node, 'oschatz', 'retreated off Oschatz');
  assert.equal(s.pieces['browne']?.troops, 6, 'winner loses nothing');
  assert.equal(s.pieces['browne']?.node, 'riesa', 'winner holds its ground');
});

test('stacking to outnumber the enemy makes the defender lose and retreat', () => {
  // Winterfeldt stands with Friedrich at Oschatz (4+5=9) against Browne at Riesa (6).
  let s = armed(placed(fresh(), { browne: 'riesa' }), { friedrich: 4, winterfeldt: 5, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  assert.equal(s.combat!.duel.attacker.troops, 9, 'stack pools its troops');
  assert.equal(s.combat!.duel.toMove, 'defender', 'browne is behind at -3');

  s = act(s, { type: 'combatPass', by: 'p0' }); // browne concedes 3
  assert.equal(s.combat, null);
  assert.equal(s.pieces['browne']?.troops, 3, 'lost exactly the 3-troop gap');
  s = resolveRetreat(s);
  assert.notEqual(s.pieces['browne']?.node, 'riesa', 'defender retreated');
  assert.equal(s.pieces['friedrich']?.node, 'oschatz', 'attacker holds its ground');
  assert.equal(s.pieces['winterfeldt']?.troops, 5, 'winner loses nothing');
});

test('nothing else happens until the pending retreat is settled', () => {
  let s = armed(placed(fresh(), { browne: 'riesa', winterfeldt: 'wurzen' }), { friedrich: 4, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  s = act(s, { type: 'combatPass', by: 'p0' });

  const pending = s.pendingRetreat!;
  assert.ok(pending.options.length > 1, 'several destinations tie, so the winner really chooses');
  assert.ok(!pending.options.includes('oschatz'), 'and none of them is where the battle was');

  // the game is held up until the choice is made ("retreat before the next combat")
  assert.throws(() => act(s, { type: 'endNationTurn', by: 'p0' }), IllegalActionError);
  assert.throws(() => act(s, { type: 'chooseRetreat', by: 'p0', node: 'berlin' }), IllegalActionError);

  const dest = pending.options[1]!;
  s = act(s, { type: 'chooseRetreat', by: 'p0', node: dest });
  assert.equal(s.pendingRetreat, null);
  assert.equal(s.pieces['friedrich']?.node, dest, 'the winner put the loser where it wanted');
  act(s, { type: 'endNationTurn', by: 'p0' }); // play resumes
});

test('a beaten stack retreats together and keeps its ranks', () => {
  // Friedrich (4) + Winterfeldt (2) at Oschatz lose to Browne (9): 3 casualties
  let s = armed(placed(fresh(), { browne: 'riesa' }), { friedrich: 4, winterfeldt: 2, browne: 9 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  s = act(s, { type: 'combatPass', by: 'p0' });
  s = resolveRetreat(s);

  // casualties come off the bottom of the stack: Winterfeldt (rank 2) goes first
  assert.equal(s.pieces['winterfeldt'], undefined, 'the junior general is removed');
  assert.equal(s.offMap['winterfeldt']?.nation, 'prussia', 'and can be recruited back later');
  assert.equal(s.pieces['friedrich']?.troops, 3, 'the rest comes off the survivor');
  assert.notEqual(s.pieces['friedrich']?.node, 'oschatz', 'which retreated');
});

test('strength stays secret until a battle declares it', () => {
  const s = armed(placed(fresh(), { browne: 'riesa', winterfeldt: 'wurzen' }), { friedrich: 4, browne: 6 });
  assert.deepEqual(s.sightings, {}, 'nobody has shown anybody anything at set-up');

  const fought = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  // "the opposing players state how many troops their participating generals command"
  assert.deepEqual(fought.sightings['friedrich'], { total: 4, with: [], certain: true });
  assert.deepEqual(fought.sightings['browne'], { total: 6, with: [], certain: true });
  assert.equal(fought.sightings['winterfeldt'], undefined, 'a general who did not fight declared nothing');
  assert.ok(fought.log.some((l) => /Strengths declared — Prussia 4, Austria 6/.test(l)));
});

test('a stack declares its total, never the split inside it', () => {
  let s = armed(placed(fresh(), { browne: 'riesa' }), { friedrich: 4, winterfeldt: 5, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });

  // Friedrich and Winterfeldt declared 9 between them — 4+5 stays private
  assert.deepEqual(s.sightings['friedrich'], { total: 9, with: ['winterfeldt'], certain: true });
  assert.deepEqual(s.sightings['winterfeldt'], { total: 9, with: ['friedrich'], certain: true });
});

test('after a battle the survivors are still known exactly — casualties are public', () => {
  let s = armed(placed(fresh(), { browne: 'riesa', winterfeldt: 'wurzen' }), { friedrich: 4, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  s = act(s, { type: 'combatPass', by: 'p0' }); // Friedrich concedes, losing the 2-troop gap
  s = resolveRetreat(s);

  assert.equal(s.pieces['friedrich']?.troops, 2);
  assert.deepEqual(s.sightings['friedrich'], { total: 2, with: [], certain: true }, 'the loss was there for all to see');
  assert.deepEqual(s.sightings['browne'], { total: 6, with: [], certain: true }, 'the winner lost nothing');
});

test('recruiting clouds every general that nation owns', () => {
  let s = armed(placed(fresh(), { browne: 'riesa', winterfeldt: 'wurzen' }), { friedrich: 4, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  s = act(s, { type: 'combatPass', by: 'p0' });
  s = resolveRetreat(s);
  assert.equal(s.sightings['friedrich']?.certain, true);

  // Prussia recruits: the rules make the number public but not who receives it
  s = withHand(s, 'prussia', [13]);
  s = act(s, { type: 'recruit', by: 'p0', reinforceId: 'heinrich', troops: 2, trains: 0, cardIds: ['pay-0'] });

  assert.deepEqual(s.sightings['friedrich'], { total: 2, with: [], certain: false }, 'Friedrich might be the one reinforced');
  assert.equal(s.sightings['browne']?.certain, true, "Austria's declaration is untouched by Prussia recruiting");
  assert.ok(!s.log.some((l) => /heinrich/i.test(l)), 'the public log must not name who was reinforced');
  // 32 at set-up, 2 lost in the battle, 2 bought back
  assert.ok(s.log.some((l) => /Prussia now commands 32 troops/.test(l)), 'but the nation-wide total is public');
});

test('a player is shown enemy strength only as far as the table has seen it', () => {
  let s = armed(placed(fresh(), { browne: 'riesa', winterfeldt: 'wurzen' }), { friedrich: 4, browne: 6 });
  const austria = s.players.find((p) => (s.seats[p] ?? []).includes('mariaTheresa'))!;

  const before = Friedrich.redact(s, austria);
  assert.equal(before.pieces['friedrich']?.troops, HIDDEN_TROOPS, 'Prussia is a closed book');
  assert.deepEqual(before.sightings, {});

  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  const after = Friedrich.redact(s, austria);
  assert.equal(after.pieces['friedrich']?.troops, HIDDEN_TROOPS, 'the counter itself stays hidden');
  assert.deepEqual(after.sightings['friedrich'], { total: 4, with: [], certain: true }, 'but the declaration is public');
});

test('movement is rejected onto an enemy city, out of range, or out of turn', () => {
  const s = placed(fresh(), { browne: 'riesa' });
  // Friedrich cannot MOVE onto Riesa — Browne holds it; must attack instead.
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'riesa' }), IllegalActionError);
  // Oschatz to Brünn is far out of range.
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'brunn' }), IllegalActionError);
  // Austria cannot move on Prussia's stage.
  assert.throws(() => act(s, { type: 'move', by: 'p1', pieceId: 'daun', to: 'olmutz' }), IllegalActionError);
});

test('legal movement works on real roads: Oschatz -> Torgau', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'torgau' });
  assert.equal(s.pieces['friedrich']?.node, 'torgau');
});

test('a general may move only once per stage, but the move can be undone', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'torgau' });
  assert.equal(s.stageMoves['friedrich'], 'oschatz', 'origin recorded for ghost/undo');
  // second move of the same general is rejected
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'riesa' }), IllegalActionError);
  // undo returns it home and frees it to move again
  s = act(s, { type: 'undoMove', by: 'p0', pieceId: 'friedrich' });
  assert.equal(s.pieces['friedrich']?.node, 'oschatz');
  assert.equal(s.stageMoves['friedrich'], undefined);
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'torgau' });
  assert.equal(s.pieces['friedrich']?.node, 'torgau');
});

test('committing to a battle finalizes moves (no more undo)', () => {
  let s = placed(fresh(), { browne: 'riesa' });
  s = act(s, { type: 'move', by: 'p0', pieceId: 'seydlitz', to: 'potsdam' });
  assert.equal(s.stageMoves['seydlitz'], 'brandenburg');
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  assert.deepEqual(s.stageMoves, {}, 'stage moves cleared on attack');
  assert.throws(() => act(s, { type: 'undoMove', by: 'p0', pieceId: 'seydlitz' }), IllegalActionError);
});

test('ending a stage clears the move budget for the next nation', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'torgau' });
  s = act(s, { type: 'endNationTurn', by: 'p0' });
  assert.deepEqual(s.stageMoves, {});
});

test('setup builds an 18-card Cards of Fate deck', () => {
  const s = fresh();
  assert.equal(s.fateDeck.length, 18);
  assert.equal(s.fateDrawn.length, 0);
  assert.equal(s.winner, null);
});

test('an attacker wins by holding all of its objective cities', () => {
  const conquered: Record<string, 'france'> = {};
  for (const id of objectivesOf('france')) conquered[id] = 'france';
  const s: FriedrichState = { ...fresh(), conquered };
  assert.deepEqual(checkVictory(s), { side: 'attacker', nation: 'france' });
});

test('Prussia wins by survival once Russia, Sweden and France are out', () => {
  const s: FriedrichState = { ...fresh(), eliminated: ['russia', 'sweden', 'france'] };
  assert.deepEqual(checkVictory(s), { side: 'defender' });
});

test('eased victory: Sweden needs only its 1st-order objectives once Russia is out', () => {
  const easedReq = requiredObjectives({ ...fresh(), eliminated: ['russia'] }, 'sweden');
  const fullReq = requiredObjectives(fresh(), 'sweden');
  assert.ok(easedReq.length > 0 && fullReq.length > easedReq.length, 'Sweden has 2nd-order objectives that ease away');

  const conquered = Object.fromEntries(easedReq.map((id) => [id, 'sweden' as const]));
  assert.equal(checkVictory({ ...fresh(), conquered }), null, 'not a win while Russia is still in');
  assert.deepEqual(
    checkVictory({ ...fresh(), conquered, eliminated: ['russia'] }),
    { side: 'attacker', nation: 'sweden' },
  );
});

test('France only withdraws after both the India and America cards are drawn', () => {
  let s = fresh();
  for (let i = 0; i < 400 && !s.winner; i++) s = endStage(s);
  if (s.eliminated.includes('france')) {
    assert.ok(
      s.fateDrawn.includes('india') && s.fateDrawn.includes('america'),
      'France left the war only after both of its Cards of Fate',
    );
  }
  assert.ok(s.winner, 'the war reaches a conclusion');
});

test('an attacker seizes its objective by occupying it', () => {
  // march Daun into Breslau (an Austrian objective), which starts empty
  const nbr = [...friedrichMap.adjacency.get('breslau')!].find(
    (n) => !Object.values(fresh().pieces).some((p) => p.node === n),
  )!;
  let s = placed(fresh(), { daun: nbr });
  // NATION_ORDER: prussia,hanover,russia,sweden,austria,… → 4 stage-ends reach Austria
  for (let i = 0; i < 4; i++) s = act(s, { type: 'endNationTurn', by: 'p0' });
  s = act(s, { type: 'move', by: 'p1', pieceId: 'daun', to: 'breslau' });
  assert.equal(s.pieces['daun']?.node, 'breslau');
  assert.equal(s.conquered['breslau'], 'austria', 'Breslau is now held by Austria');
});

test('the Clock of Fate starts drawing at the end of turn 6', () => {
  let s = fresh();
  const end = () => endStage(s);
  for (let i = 0; i < 35; i++) s = end(); // through the end of turn 5
  assert.equal(s.turn, 6);
  assert.equal(s.fateDrawn.length, 0, 'no fate cards before turn 6');
  for (let i = 0; i < 7; i++) s = end(); // finish turn 6
  assert.equal(s.turn, 7);
  assert.equal(s.fateDrawn.length, 1, 'one fate card drawn at the end of turn 6');
});

test('no actions are allowed once the war is decided', () => {
  const s: FriedrichState = { ...fresh(), winner: { side: 'defender' } };
  assert.throws(() => act(s, { type: 'endNationTurn', by: 'p0' }), IllegalActionError);
});

test('every starting general begins in supply', () => {
  const s = fresh();
  for (const g of Object.values(s.pieces)) {
    assert.ok(inSupply(s, g), `${g.id} at ${g.node} starts out of supply`);
  }
});

test('a general standing on its own supply train is in supply', () => {
  const s = fresh();
  const moved: FriedrichState = { ...s, pieces: { ...s.pieces, fermor: { ...s.pieces['fermor']!, node: 'torun' } } };
  assert.ok(inSupply(moved, moved.pieces['fermor']!));
});

test('a general cut off from supply flips face-down, then is destroyed next supply phase', () => {
  // strand Fermor deep in the west, far from any Russian train and not in a home country
  let s: FriedrichState = { ...fresh(), pieces: { ...fresh().pieces, fermor: { ...fresh().pieces['fermor']!, node: 'kassel' } } };
  assert.equal(inSupply(s, s.pieces['fermor']!), false);

  for (let i = 0; i < 3; i++) s = endStage(s); // through Russia's first supply phase
  assert.equal(s.pieces['fermor']?.faceUp, false, 'cut off → face-down (no loss yet)');

  for (let i = 0; i < 7; i++) s = endStage(s); // to Russia's next supply phase
  assert.equal(s.pieces['fermor'], undefined, 'still cut off → destroyed');
});

test('a general entering a city captures the enemy supply train there', () => {
  // Wismar holds a Swedish train and no general to defend it.
  const nbr = emptyNeighbour(fresh(), 'wismar');
  let s = placed(fresh(), { keith: nbr });
  s = act(s, { type: 'move', by: 'p0', pieceId: 'keith', to: 'wismar' });
  assert.equal(s.pieces['keith']?.node, 'wismar');
  assert.ok(!Object.values(s.trains).some((t) => t.node === 'wismar'), 'the Swedish train is captured');
});

test('a supply train can be moved on its turn', () => {
  let s = fresh();
  const nbr = emptyNeighbour(s, 'juterbog');
  s = act(s, { type: 'moveTrain', by: 'p0', trainId: 'sup-prussia-1', to: nbr });
  assert.equal(s.trains['sup-prussia-1']?.node, nbr);
});

/** Give a nation a known hand so recruitment payment is deterministic. */
const withHand = (s: FriedrichState, nation: 'prussia', values: number[]): FriedrichState => ({
  ...s,
  hands: {
    ...s.hands,
    [nation]: values.map((v, i) => ({ id: `pay-${i}`, kind: 'suit' as const, suit: 'clubs' as const, value: v })),
  },
});

test('recruiting spends Tactical Cards as money — 6 points per troop, no change given', () => {
  // Prussia starts at its full establishment, so first bleed it: a nation can
  // only recruit back up to the ceiling.
  // the rulebook's own example rate: pay 13+12 = 25 points for 4 troops (24) — 1 point lost
  let s = withHand(armed(fresh(), { friedrich: 1, winterfeldt: 1 }), 'prussia', [13, 12]);
  const before = s.pieces['friedrich']!.troops;
  s = act(s, { type: 'recruit', by: 'p0', reinforceId: 'friedrich', troops: 4, trains: 0, cardIds: ['pay-0', 'pay-1'] });
  assert.equal(s.pieces['friedrich']?.troops, before + 4, 'four troops joined Friedrich');
  assert.equal(s.hands.prussia.length, 0, 'both cards were spent');
  assert.equal(s.playedSets.flat().length, 2, 'spent cards are set aside');
});

test('recruiting is refused when the cards do not cover the cost', () => {
  const s = withHand(armed(fresh(), { friedrich: 1 }), 'prussia', [5]);
  assert.throws(
    () => act(s, { type: 'recruit', by: 'p0', reinforceId: 'friedrich', troops: 1, trains: 0, cardIds: ['pay-0'] }),
    IllegalActionError,
    '5 points cannot buy a 6-point troop',
  );
});

test('a lost general returns at a depot and must receive a troop', () => {
  const base = fresh();
  const lost = base.pieces['keith']!;
  const pieces = { ...base.pieces };
  delete pieces['keith'];
  let s: FriedrichState = withHand(
    { ...base, pieces, offMap: { keith: { id: 'keith', nation: 'prussia', rank: lost.rank } } },
    'prussia',
    [13],
  );
  // a returning general with no troops is illegal
  assert.throws(
    () => act(s, { type: 'recruit', by: 'p0', node: 'grunberg', generalId: 'keith', troops: 0, trains: 0, cardIds: ['pay-0'] }),
    IllegalActionError,
  );
  // Jüterbog is where a Prussian train starts, but it carries no depot star —
  // pieces re-enter only at depot cities
  assert.throws(
    () => act(s, { type: 'recruit', by: 'p0', node: 'juterbog', generalId: 'keith', troops: 2, trains: 0, cardIds: ['pay-0'] }),
    IllegalActionError,
  );
  s = act(s, { type: 'recruit', by: 'p0', node: 'grunberg', generalId: 'keith', troops: 2, trains: 0, cardIds: ['pay-0'] });
  assert.equal(s.pieces['keith']?.node, 'grunberg', 'Keith is back in the field');
  assert.equal(s.pieces['keith']?.troops, 2);
  assert.equal(s.offMap['keith'], undefined, 'no longer off-map');
  assert.equal(s.stageMoves['keith'], 'grunberg', 'may not move the phase it re-enters');
});

test('with every depot blocked, a nation re-enters in its substitute region at 8 a troop', () => {
  const base = fresh();
  assert.equal(depotsBlocked(base, 'prussia'), false, 'Prussia starts with its own depots');
  assert.deepEqual(reentrySites(base, 'prussia'), { sites: DEPOT_CITIES.prussia, cost: 6 });

  // Austria's generals sit on all five Prussian depots
  const seize = Object.fromEntries(
    DEPOT_CITIES.prussia.map((depot, i) => [['daun', 'browne', 'lothringen', 'laudon', 'lacy'][i]!, depot]),
  );
  const blocked = placed(base, seize);
  assert.equal(depotsBlocked(blocked, 'prussia'), true);

  const { sites, cost } = reentrySites(blocked, 'prussia');
  assert.equal(cost, 8, 'rule 10b: 6 → 8 points');
  assert.ok(sites.includes('bernau'), 'any city in the Berlin spades sector will do');
  assert.ok(!sites.includes('breslau'), 'but only that sector');

  // Keith is lost, and must now come back through the substitute site
  const lost = blocked.pieces['keith']!;
  const pieces = { ...blocked.pieces };
  delete pieces['keith'];
  let s = withHand({ ...blocked, pieces, offMap: { keith: { id: 'keith', nation: 'prussia', rank: lost.rank } } },
    'prussia', [13]);

  // 13 points buys two troops at the normal rate (12); at the blocked rate it buys one (16 > 13)
  assert.throws(
    () => act(s, { type: 'recruit', by: 'p0', node: 'bernau', generalId: 'keith', troops: 2, trains: 0, cardIds: ['pay-0'] }),
    IllegalActionError,
    'the surcharge bites',
  );
  s = act(s, { type: 'recruit', by: 'p0', node: 'bernau', generalId: 'keith', troops: 1, trains: 0, cardIds: ['pay-0'] });
  assert.equal(s.pieces['keith']?.node, 'bernau', 'Keith returns at the substitute site');
  assert.ok(s.log.some((l) => /blocked-depot rate/.test(l)));
});

test('a depot held by your own other nation does not earn a substitute site', () => {
  // Frederick plays both Prussia and Hanover, so he can simply march them off —
  // rule 10a only relieves depots blocked by ANOTHER PLAYER
  const base = fresh();
  const hanoverians = ['ferdinand', 'cumberland'];
  const seize = Object.fromEntries(DEPOT_CITIES.prussia.slice(0, 2).map((d, i) => [hanoverians[i]!, d]));
  const s = placed(base, seize);
  assert.equal(depotsBlocked(s, 'prussia'), false);
});

test('the substitute regions follow the rulebook, sector by sector', () => {
  const inRegion = (n: Parameters<typeof substituteSites>[0], id: string) => substituteSites(n).includes(id);
  assert.ok(inRegion('prussia', 'berlin'), 'Prussia: the Berlin spades sector');
  assert.ok(inRegion('russia', 'warszawa'), 'Russia: the Warszawa spades sector');
  assert.ok(inRegion('austria', 'brunn'), 'Austria: the Brünn diamonds sector');
  assert.ok(inRegion('hanover', 'stade'), 'Hanover: the Stade diamonds sector');
  assert.ok(inRegion('sweden', 'stralsund'), 'Sweden: Sverige and its exclaves');
  assert.ok(inRegion('imperial', 'erlangen'), 'Imperial: the spades sector south of Hildburghausen');
  assert.ok(inRegion('france', 'wiesbaden'), 'France: the hearts sector south of Koblenz');

  // Austria's is "Austrian territory only" — Silesia is in the sector but Prussian
  assert.ok(
    substituteSites('austria').every((id) => friedrichMap.nodes.get(id)?.home === 'austria'),
    'Austria may not re-enter on land it does not hold',
  );
  // Hanover's is "only north of Munster"
  const munsterY = friedrichMap.nodes.get('munster-36')!.y;
  assert.ok(
    substituteSites('hanover').every((id) => friedrichMap.nodes.get(id)!.y < munsterY),
    'Hanover stays north of Munster',
  );
});

test('a nation may not exceed its troop establishment', () => {
  const s = withHand(fresh(), 'prussia', [13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13]);
  const ids = s.hands.prussia.map((c) => c.id);
  assert.throws(
    () => act(s, { type: 'recruit', by: 'p0', reinforceId: 'friedrich', troops: 30, trains: 0, cardIds: ids }),
    IllegalActionError,
    'Prussia is capped at 32 troops',
  );
});

test('ending a nation stage advances to the next nation in order', () => {
  let s = fresh();
  assert.equal(s.activeNationIndex, 0); // prussia
  s = act(s, { type: 'endNationTurn', by: 'p0' });
  assert.equal(s.activeNationIndex, 1); // hanover
});
