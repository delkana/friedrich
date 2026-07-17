import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IllegalActionError } from '@friedrich/engine';
import { Friedrich, suggestAllotment } from './game.js';
import { NATION_ORDER } from './powers.js';
import { TROOP_MAX, TROOP_PER_GENERAL_MAX } from './pieces.js';
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
  assert.equal(s.pieces['friedrich']?.node, 'dresden');
  assert.equal(s.pieces['daun']?.node, 'brunn');
  assert.equal(s.hands.prussia.length, 7, 'Prussia draws its 7-card allotment at setup');
  assert.equal(s.hands.austria.length, 0, 'Austria has not drawn yet');
  assert.equal(s.decks.prussia.length, 43, '50-card deck minus the 7 drawn');
  assert.equal(s.decks.austria.length, 50, 'Austria\'s deck is untouched');
  assert.equal(s.activeNationIndex, 0, 'Prussia acts first');
});

test('a nation draws its allotment at the start of its stage', () => {
  let s = fresh();
  assert.equal(s.hands.hanover.length, 0);
  s = act(s, { type: 'endNationTurn', by: 'p0' }); // advance to Hanover's stage
  assert.equal(s.hands.hanover.length, 2, 'Hanover draws its 1+1 allotment');
  assert.equal(s.decks.hanover.length, 48);
});

test('a nation\'s cards are conserved across hand + deck + discard', () => {
  const s = fresh();
  const total = (n: 'prussia') => s.hands[n].length + s.decks[n].length + s.discards[n].length;
  assert.equal(total('prussia'), 50);
});

test('an outnumbered attacker who concedes takes the gap as casualties and retreats', () => {
  // Browne (6 troops) parked at Pirna, adjacent to Friedrich (4) alone at Dresden.
  let s = armed(placed(fresh(), { browne: 'pirna', winterfeldt: 'grossenhain' }), { friedrich: 4, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  assert.ok(s.combat, 'a battle started');
  assert.equal(s.combat!.duel.toMove, 'attacker', 'friedrich is behind at -2');

  s = act(s, { type: 'combatPass', by: 'p0' }); // friedrich accepts defeat
  assert.equal(s.combat, null, 'battle resolved');
  assert.equal(s.pieces['friedrich']?.troops, 2, 'lost the 2-troop gap');
  assert.notEqual(s.pieces['friedrich']?.node, 'dresden', 'retreated off Dresden');
  assert.equal(s.pieces['browne']?.troops, 6, 'winner loses nothing');
  assert.equal(s.pieces['browne']?.node, 'pirna', 'winner holds its ground');
});

test('stacking to outnumber the enemy makes the defender lose and retreat', () => {
  // Winterfeldt stands with Friedrich at Dresden (4+5=9) against Browne at Pirna (6).
  let s = armed(placed(fresh(), { browne: 'pirna' }), { friedrich: 4, winterfeldt: 5, browne: 6 });
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  assert.equal(s.combat!.duel.attacker.troops, 9, 'stack pools its troops');
  assert.equal(s.combat!.duel.toMove, 'defender', 'browne is behind at -3');

  s = act(s, { type: 'combatPass', by: 'p0' }); // browne concedes 3
  assert.equal(s.combat, null);
  assert.equal(s.pieces['browne']?.troops, 3, 'lost exactly the 3-troop gap');
  assert.notEqual(s.pieces['browne']?.node, 'pirna', 'defender retreated');
  assert.equal(s.pieces['friedrich']?.node, 'dresden', 'attacker holds its ground');
  assert.equal(s.pieces['winterfeldt']?.troops, 5, 'winner loses nothing');
});

test('movement is rejected onto an enemy city, out of range, or out of turn', () => {
  const s = placed(fresh(), { browne: 'pirna' });
  // Friedrich cannot MOVE onto Pirna — Browne holds it; must attack instead.
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'pirna' }), IllegalActionError);
  // Dresden to Brünn is far out of range.
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'brunn' }), IllegalActionError);
  // Austria cannot move on Prussia's stage.
  assert.throws(() => act(s, { type: 'move', by: 'p1', pieceId: 'daun', to: 'olmutz' }), IllegalActionError);
});

test('legal movement works on real roads: Dresden -> Meissen', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'meissen' });
  assert.equal(s.pieces['friedrich']?.node, 'meissen');
});

test('a general may move only once per stage, but the move can be undone', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'meissen' });
  assert.equal(s.stageMoves['friedrich'], 'dresden', 'origin recorded for ghost/undo');
  // second move of the same general is rejected
  assert.throws(() => act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'grossenhain' }), IllegalActionError);
  // undo returns it home and frees it to move again
  s = act(s, { type: 'undoMove', by: 'p0', pieceId: 'friedrich' });
  assert.equal(s.pieces['friedrich']?.node, 'dresden');
  assert.equal(s.stageMoves['friedrich'], undefined);
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'meissen' });
  assert.equal(s.pieces['friedrich']?.node, 'meissen');
});

test('committing to a battle finalizes moves (no more undo)', () => {
  let s = placed(fresh(), { browne: 'pirna' });
  s = act(s, { type: 'move', by: 'p0', pieceId: 'seydlitz', to: 'potsdam' });
  assert.equal(s.stageMoves['seydlitz'], 'berlin');
  s = act(s, { type: 'attack', by: 'p0', attackerId: 'friedrich', defenderId: 'browne' });
  assert.deepEqual(s.stageMoves, {}, 'stage moves cleared on attack');
  assert.throws(() => act(s, { type: 'undoMove', by: 'p0', pieceId: 'seydlitz' }), IllegalActionError);
});

test('ending a stage clears the move budget for the next nation', () => {
  let s = fresh();
  s = act(s, { type: 'move', by: 'p0', pieceId: 'friedrich', to: 'meissen' });
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
  for (let i = 0; i < 400 && !s.winner; i++) s = act(s, { type: 'endNationTurn', by: 'p0' });
  if (s.eliminated.includes('france')) {
    assert.ok(
      s.fateDrawn.includes('india') && s.fateDrawn.includes('america'),
      'France left the war only after both of its Cards of Fate',
    );
  }
  assert.ok(s.winner, 'the war reaches a conclusion');
});

test('an attacker seizes its objective by occupying it', () => {
  // march Daun into Breslau (an Austrian objective) — first send its Prussian
  // garrison elsewhere, so this tests conquest rather than combat
  const nbr = [...friedrichMap.adjacency.get('breslau')!].find(
    (n) => !Object.values(fresh().pieces).some((p) => p.node === n),
  )!;
  let s = placed(fresh(), { daun: nbr, schwerin: 'stettin', keith: 'konigsberg' });
  // NATION_ORDER: prussia,hanover,russia,sweden,austria,… → 4 stage-ends reach Austria
  for (let i = 0; i < 4; i++) s = act(s, { type: 'endNationTurn', by: 'p0' });
  s = act(s, { type: 'move', by: 'p1', pieceId: 'daun', to: 'breslau' });
  assert.equal(s.pieces['daun']?.node, 'breslau');
  assert.equal(s.conquered['breslau'], 'austria', 'Breslau is now held by Austria');
});

test('the Clock of Fate starts drawing at the end of turn 6', () => {
  let s = fresh();
  const end = () => act(s, { type: 'endNationTurn', by: 'p0' });
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

  for (let i = 0; i < 3; i++) s = act(s, { type: 'endNationTurn', by: 'p0' }); // through Russia's first supply phase
  assert.equal(s.pieces['fermor']?.faceUp, false, 'cut off → face-down (no loss yet)');

  for (let i = 0; i < 7; i++) s = act(s, { type: 'endNationTurn', by: 'p0' }); // to Russia's next supply phase
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
  assert.equal(s.discards.prussia.length, 2, 'spent cards go to the discard pile');
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
    () => act(s, { type: 'recruit', by: 'p0', node: 'juterbog', generalId: 'keith', troops: 0, trains: 0, cardIds: ['pay-0'] }),
    IllegalActionError,
  );
  s = act(s, { type: 'recruit', by: 'p0', node: 'juterbog', generalId: 'keith', troops: 2, trains: 0, cardIds: ['pay-0'] });
  assert.equal(s.pieces['keith']?.node, 'juterbog', 'Keith is back in the field');
  assert.equal(s.pieces['keith']?.troops, 2);
  assert.equal(s.offMap['keith'], undefined, 'no longer off-map');
  assert.equal(s.stageMoves['keith'], 'juterbog', 'may not move the phase it re-enters');
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
