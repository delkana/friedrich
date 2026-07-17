import {
  IllegalActionError,
  seedFromString,
  rngShuffle,
  buildTacticalDeck,
  reachableNodes,
  areAdjacent,
  hopDistance,
  startDuel,
  playCard,
  pass,
  type GameDefinition,
  type PlayerId,
  type TacticalCard,
  type RngState,
} from '@friedrich/engine';
import { NATION_ORDER, BASE_DRAW, type Role, type Nation } from './powers.js';
import {
  ALL_GENERALS,
  INITIAL_TRAINS,
  TROOP_PER_GENERAL_MAX,
  TROOP_PER_GENERAL_MIN,
  MAX_STACK,
  TRAIN_MOVE,
  TRAIN_MOVE_MAIN,
  RECRUIT_COST,
  SUBSTITUTE_COST,
  substituteSites,
  TROOP_MAX,
  DEPOT_CITIES,
  areEnemies,
  sideOf,
  type Piece,
  type Train,
} from './pieces.js';
import { friedrichMap } from './map-data.js';
import { retreatOptions } from './retreat.js';
import { buildFateDeck, FATE_LABEL, type FateCard } from './fate.js';
import { checkVictory } from './victory.js';
import { runSupplyPhase } from './supply.js';
import type { FriedrichState, FriedrichAction, CombatSub, Winner, Sighting } from './state.js';

type PieceMap = Record<string, Piece>;

// ---- helpers -------------------------------------------------------------

/**
 * "Using the Tactical Cards 13,13,13,13, the roles of Friedrich, Elisabeth,
 * Maria Theresa and Pompadour are raffled to the players." — so the roles are
 * dealt at random, not by seat order. At three players one seat runs both
 * Elisabeth and Pompadour.
 */
function assignSeats(players: readonly PlayerId[], rng: RngState): { seats: Record<PlayerId, Role[]>; rng: RngState } {
  const groups: Role[][] =
    players.length === 3
      ? [['frederick'], ['mariaTheresa'], ['elisabeth', 'pompadour']]
      : [['frederick'], ['mariaTheresa'], ['elisabeth'], ['pompadour']];
  const raffle = rngShuffle(rng, groups);
  const seats: Record<PlayerId, Role[]> = {};
  players.forEach((p, i) => {
    seats[p] = raffle.items[i]!;
  });
  return { seats, rng: raffle.r };
}

const activeNationOf = (s: FriedrichState): Nation => NATION_ORDER[s.activeNationIndex]!;

/** Display helpers so the dispatch log reads like a report, not like ids. */
export const cityName = (id: string): string => friedrichMap.nodes.get(id)?.name ?? id;
export const properName = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

function occupiedNodes(pieces: PieceMap): Set<string> {
  const set = new Set<string>();
  for (const p of Object.values(pieces)) set.add(p.node);
  return set;
}

const piecesAtNode = (pieces: PieceMap, node: string): Piece[] =>
  Object.values(pieces).filter((p) => p.node === node);

/** Same-nation generals stacked at a node, ordered by command rank (1 first). */
const stackAt = (pieces: PieceMap, node: string, nation: Nation): Piece[] =>
  piecesAtNode(pieces, node)
    .filter((p) => p.nation === nation)
    .sort((a, b) => a.rank - b.rank);

/** Remove `casualties` troops from a stack, lowest command (highest rank #) first. */
function applyCasualties(pieces: PieceMap, stack: readonly Piece[], casualties: number): void {
  let remaining = casualties;
  for (const p of [...stack].sort((a, b) => b.rank - a.rank)) {
    if (remaining <= 0) break;
    const cur = pieces[p.id];
    if (!cur) continue;
    const take = Math.min(remaining, cur.troops);
    remaining -= take;
    const left = cur.troops - take;
    if (left <= 0) delete pieces[p.id];
    else pieces[p.id] = { ...cur, troops: left };
  }
}

// ---- what the table knows about enemy strength ---------------------------

/**
 * Record what a stack declared as it went into battle. The declaration is the
 * stack's total; the split inside it stays private, so each member is tagged
 * with who it was pooled with.
 */
function declare(sightings: FriedrichState['sightings'], stack: readonly Piece[]): Record<string, Sighting> {
  const out = { ...sightings };
  const total = stack.reduce((n, p) => n + p.troops, 0);
  for (const p of stack) {
    out[p.id] = { total, with: stack.filter((x) => x.id !== p.id).map((x) => x.id), certain: true };
  }
  return out;
}

/**
 * A nation recruits: the rules make the number public but not who receives it,
 * so every general it owns might now be stronger than last declared.
 */
function cloudSightings(sightings: FriedrichState['sightings'], pieces: PieceMap, nation: Nation): Record<string, Sighting> {
  const out = { ...sightings };
  for (const [id, s] of Object.entries(out)) {
    if (pieces[id]?.nation === nation) out[id] = { ...s, certain: false };
  }
  return out;
}

function finalizeCombat(state: FriedrichState, combat: CombatSub): FriedrichState {
  const duel = combat.duel;
  const r = duel.result!;
  const hands = {
    ...state.hands,
    [combat.attackerNation]: duel.attacker.hand,
    [combat.defenderNation]: duel.defender.hand,
  };
  // cards played in the battle are set aside on their own deck's pile
  const playedBy = (nation: Nation, remaining: readonly TacticalCard[]): TacticalCard[] => {
    const rem = new Set(remaining.map((c) => c.id));
    return state.hands[nation].filter((c) => !rem.has(c.id));
  };
  const playedSets = setAside(state.playedSets, [
    ...playedBy(combat.attackerNation, duel.attacker.hand),
    ...playedBy(combat.defenderNation, duel.defender.hand),
  ]);
  const pieces: PieceMap = { ...state.pieces };
  const log = [...state.log];
  let pendingRetreat: FriedrichState['pendingRetreat'] = null;

  if (r.outcome === 'tie') {
    log.push('Battle tied — both sides hold.');
  } else {
    const loserNation = r.loser === 'attacker' ? combat.attackerNation : combat.defenderNation;
    const winnerNation = r.loser === 'attacker' ? combat.defenderNation : combat.attackerNation;
    const loserNode = r.loser === 'attacker' ? combat.attackerNode : combat.defenderNode;
    const winnerNode = r.loser === 'attacker' ? combat.defenderNode : combat.attackerNode;
    const stack = stackAt(pieces, loserNode, loserNation);

    if (r.loserEliminated) {
      for (const p of stack) delete pieces[p.id];
      log.push(`${properName(loserNation)}'s force at ${cityName(loserNode)} is wiped out (${r.casualties} troops lost).`);
    } else {
      applyCasualties(pieces, stack, r.casualties);
      const survivors = stack.filter((p) => pieces[p.id]);
      // retreat the full distance, never through a piece, ending as far from the
      // winner as possible — the winner picks only when destinations tie
      const options = retreatOptions(pieces, state.trains, loserNode, winnerNode, r.casualties);
      if (options.length === 0) {
        for (const p of survivors) delete pieces[p.id];
        log.push(`${properName(loserNation)} lost ${r.casualties} and could not retreat the full ${r.casualties} cities — destroyed.`);
      } else if (options.length === 1) {
        const dest = options[0]!;
        for (const p of survivors) pieces[p.id] = { ...pieces[p.id]!, node: dest };
        log.push(`${properName(loserNation)} loses ${r.casualties} and retreats ${r.casualties} to ${cityName(dest)}.`);
      } else {
        pendingRetreat = {
          nation: loserNation,
          chooser: winnerNation,
          pieceIds: survivors.map((p) => p.id),
          from: loserNode,
          options,
        };
        log.push(`${properName(loserNation)} loses ${r.casualties} and must retreat ${r.casualties} — ${properName(winnerNation)} chooses the path.`);
      }
    }
  }

  // generals lost in the battle go off-map, where they may be recruited back (§10)
  const offMap = { ...state.offMap };
  for (const [id, p] of Object.entries(state.pieces)) {
    if (!pieces[id]) offMap[id] = { id: p.id, nation: p.nation, rank: p.rank };
  }

  // The casualties and any general removed are there for all to see, so what the
  // table knows stays exact: re-declare each surviving stack at its true strength
  // and forget the pieces that left the board.
  let sightings: Record<string, Sighting> = {};
  for (const [id, s] of Object.entries(state.sightings)) if (pieces[id]) sightings[id] = s;
  for (const node of new Set([combat.attackerNode, combat.defenderNode])) {
    for (const nation of [combat.attackerNation, combat.defenderNation]) {
      const stack = stackAt(pieces, node, nation);
      if (stack.length) sightings = declare(sightings, stack);
    }
  }

  return { ...state, version: state.version + 1, pieces, hands, playedSets, offMap, sightings, combat: null, pendingRetreat, log };
}

// ---- card draw + deck cycling --------------------------------------------

/** The box holds four identical 50-card Tactical Card decks (rule 3). */
export const CARD_SETS = 4;
const setName = (i: number): string => `set${i + 1}`;
/** Which of the four decks a card was printed with. */
const setIndexOf = (card: TacticalCard): number => Math.max(0, CARD_SET_NAMES.indexOf(card.origin ?? ''));
const CARD_SET_NAMES: readonly string[] = Array.from({ length: CARD_SETS }, (_, i) => setName(i));

/** Set played cards aside on the pile of their own deck of origin. */
function setAside(
  playedSets: FriedrichState['playedSets'],
  cards: readonly TacticalCard[],
): TacticalCard[][] {
  const piles = playedSets.map((p) => [...p]);
  for (const card of cards) piles[setIndexOf(card)]!.push(card);
  return piles;
}

/**
 * Refill the draw deck (rule 3). While pristine decks remain, the next one is
 * shuffled and becomes the draw deck. Once all four have been used up, the two
 * piles that have accumulated the most played cards are shuffled together.
 */
function refillDeck(state: {
  rng: FriedrichState['rng'];
  playedSets: FriedrichState['playedSets'];
  setsUsed: number;
}): { rng: FriedrichState['rng']; deck: TacticalCard[]; playedSets: TacticalCard[][]; setsUsed: number; note: string } {
  const piles = state.playedSets.map((p) => [...p]);
  if (state.setsUsed < CARD_SETS) {
    // a fresh deck: its cards have never been dealt, so the pile for it is empty
    const sh = rngShuffle(state.rng, buildTacticalDeck(setName(state.setsUsed)));
    return {
      rng: sh.r,
      deck: sh.items,
      playedSets: piles,
      setsUsed: state.setsUsed + 1,
      note: `Tactical Card deck ${state.setsUsed} is used up — deck ${state.setsUsed + 1} is opened.`,
    };
  }
  // all four decks opened: recycle the two fullest piles
  const order = piles.map((p, i) => i).sort((a, b) => piles[b]!.length - piles[a]!.length);
  const [x, y] = [order[0]!, order[1]!];
  const sh = rngShuffle(state.rng, [...piles[x]!, ...piles[y]!]);
  piles[x] = [];
  piles[y] = [];
  return {
    rng: sh.r,
    deck: sh.items,
    playedSets: piles,
    setsUsed: state.setsUsed,
    note: `Decks ${x + 1} and ${y + 1} are shuffled back together (${sh.items.length} cards).`,
  };
}

/** Draw `count` cards from the shared deck, opening the next deck when it runs dry. */
function drawCards(
  state: { rng: FriedrichState['rng']; drawDeck: readonly TacticalCard[]; playedSets: FriedrichState['playedSets']; setsUsed: number },
  count: number,
): {
  rng: FriedrichState['rng'];
  drawDeck: TacticalCard[];
  playedSets: TacticalCard[][];
  setsUsed: number;
  drawn: TacticalCard[];
  log: string[];
} {
  let deck = [...state.drawDeck];
  let piles: TacticalCard[][] = state.playedSets.map((p) => [...p]);
  let rng = state.rng;
  let setsUsed = state.setsUsed;
  const drawn: TacticalCard[] = [];
  const log: string[] = [];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      const r = refillDeck({ rng, playedSets: piles, setsUsed });
      if (r.deck.length === 0) break; // every card is in someone's hand
      rng = r.rng;
      deck = r.deck;
      piles = r.playedSets;
      setsUsed = r.setsUsed;
      log.push(r.note);
    }
    drawn.push(deck.shift()!);
  }
  return { rng, drawDeck: deck, playedSets: piles, setsUsed, drawn, log };
}

/** The first phase of a nation's stage: draw its Tactical Card allotment. */
function beginStage(state: FriedrichState, nation: Nation): FriedrichState {
  const allot = state.drawAllot[nation] ?? 0;
  if (allot <= 0) return state;
  const res = drawCards(state, allot);
  const hand: TacticalCard[] = [...state.hands[nation], ...res.drawn];
  const log = [...res.log, `${properName(nation)} draws ${res.drawn.length} card(s).`];
  // "Of the four Tactical Cards drawn each turn, select one to discard
  // immediately" — France's choice, so the stage waits for it.
  const pendingDiscard =
    nation === 'france' && res.drawn.length > 0
      ? { nation, cardIds: res.drawn.map((c) => c.id) }
      : null;
  if (pendingDiscard) log.push('France must discard one of the cards it drew.');
  return {
    ...state,
    rng: res.rng,
    drawDeck: res.drawDeck,
    playedSets: res.playedSets,
    setsUsed: res.setsUsed,
    hands: { ...state.hands, [nation]: hand },
    pendingDiscard,
    log: [...state.log, ...log],
  };
}

// ---- end-game: conquest, Cards of Fate, victory --------------------------

function victoryMessage(w: Winner): string {
  return w.side === 'defender'
    ? 'Frederick has survived the war — Prussia wins!'
    : `${w.nation} has seized all its objectives — ${w.nation} wins!`;
}

/** Stamp a winner onto the state if the game is now decided. */
function withWinner(state: FriedrichState): FriedrichState {
  if (state.winner) return state;
  const w = checkVictory(state);
  return w ? { ...state, winner: w, log: [...state.log, victoryMessage(w)] } : state;
}

/** Force a nation out of the war: remove its pieces, hand and control markers. */
function eliminateNation(state: FriedrichState, nation: Nation): FriedrichState {
  if (state.eliminated.includes(nation)) return state;
  const pieces: PieceMap = {};
  for (const [id, p] of Object.entries(state.pieces)) if (p.nation !== nation) pieces[id] = p;
  const conquered: Record<string, Nation> = {};
  for (const [node, holder] of Object.entries(state.conquered)) if (holder !== nation) conquered[node] = holder;
  return {
    ...state,
    pieces,
    hands: { ...state.hands, [nation]: [] },
    conquered,
    eliminated: [...state.eliminated, nation],
    log: [...state.log, `${nation} withdraws from the war.`],
  };
}

/** Retire one Prussian general (lowest command = highest rank number present). */
function retirePrussianGeneral(state: FriedrichState): FriedrichState {
  const victim = Object.values(state.pieces)
    .filter((p) => p.nation === 'prussia')
    .sort((a, b) => b.rank - a.rank)[0];
  if (!victim) return state;
  const pieces = { ...state.pieces };
  delete pieces[victim.id];
  return { ...state, pieces, log: [...state.log, `A Prussian general (${victim.id}) is retired.`] };
}

/** Draw and execute the top Card of Fate. */
function drawFate(state: FriedrichState): FriedrichState {
  const card = state.fateDeck[0] as FateCard | undefined;
  if (!card) return state;
  let s: FriedrichState = {
    ...state,
    fateDeck: state.fateDeck.slice(1),
    fateDrawn: [...state.fateDrawn, card],
    log: [...state.log, `Card of Fate: ${FATE_LABEL[card]}.`],
  };
  switch (card) {
    case 'elisabeth':
      s = retirePrussianGeneral(eliminateNation(s, 'russia'));
      break;
    case 'sweden':
      s = retirePrussianGeneral(eliminateNation(s, 'sweden'));
      break;
    case 'america':
      s = maybeWithdrawFrance(reduceDraw(s, 'hanover', 1));
      break;
    case 'india':
      s = maybeWithdrawFrance(reduceDraw(reduceDraw(s, 'austria', 4), 'france', 3));
      break;
    case 'lordBute':
      s = reduceDraw(s, 'prussia', 5);
      break;
    case 'poems':
      s = reduceDraw(s, 'prussia', 4);
      break;
    case 'minor':
      break;
  }
  return s;
}

/** France quits only once BOTH the India and America cards have been drawn. */
function maybeWithdrawFrance(state: FriedrichState): FriedrichState {
  const drawn = state.fateDrawn;
  if (drawn.includes('india') && drawn.includes('america') && !state.eliminated.includes('france')) {
    return eliminateNation(state, 'france');
  }
  return state;
}

/** Permanently lower a nation's card draw (never raises it). */
function reduceDraw(state: FriedrichState, nation: Nation, value: number): FriedrichState {
  const cur = state.drawAllot[nation] ?? 0;
  if (value >= cur) return state;
  return { ...state, drawAllot: { ...state.drawAllot, [nation]: value } };
}

// ---- game definition -----------------------------------------------------

export const Friedrich: GameDefinition<FriedrichState, FriedrichAction> = {
  id: 'friedrich',
  minPlayers: 3,
  maxPlayers: 4,

  setup(seed: string, players: readonly PlayerId[]): FriedrichState {
    if (players.length < this.minPlayers || players.length > this.maxPlayers) {
      throw new IllegalActionError(`Friedrich supports ${this.minPlayers}-${this.maxPlayers} players.`);
    }
    let rng = seedFromString(seed);
    // "Shuffle one of the four Tactical Card decks for immediate use by all four
    // players. Set aside the other 3 decks for later." No nation holds any cards
    // at the start; each draws its allotment as its own stage opens.
    const first = rngShuffle(rng, buildTacticalDeck(setName(0)));
    rng = first.r;
    const drawDeck = first.items;
    const playedSets: TacticalCard[][] = Array.from({ length: CARD_SETS }, () => []);
    const hands: Record<Nation, TacticalCard[]> = {} as Record<Nation, TacticalCard[]>;
    for (const nation of NATION_ORDER) hands[nation] = [];
    const fate = buildFateDeck(rng);
    rng = fate.rng;
    // all 24 generals on their set-up cities; troops are allotted by the players
    const pieces: PieceMap = {};
    for (const g of ALL_GENERALS) {
      pieces[g.id] = { id: g.id, nation: g.nation, rank: g.rank, node: g.node, troops: 0, faceUp: true };
    }
    const trains: Record<string, Train> = {};
    for (const t of INITIAL_TRAINS) trains[t.id] = t;
    const raffled = assignSeats(players, rng);
    rng = raffled.rng;

    const base: FriedrichState = {
      rng,
      version: 0,
      phase: 'setup',
      allocated: [],
      players: [...players],
      seats: raffled.seats,
      turn: 1,
      activeNationIndex: 0,
      pieces,
      trains,
      offMap: {},
      offMapTrains: { prussia: 0, hanover: 0, russia: 0, sweden: 0, austria: 0, imperial: 0, france: 0 },
      hands,
      drawDeck,
      playedSets,
      setsUsed: 1,
      pendingDiscard: null,
      pendingRetreat: null,
      sightings: {}, // nobody has shown anybody anything yet
      drawAllot: { ...BASE_DRAW },
      stageMoves: {},
      combat: null,
      conquered: {},
      eliminated: [],
      fateDeck: fate.deck,
      fateDrawn: [],
      winner: null,
      log: [`Roles raffled to ${players.length} players. Each nation must now allot its troops.`],
    };
    // the war does not begin until every nation's troops are allotted
    return base;
  },

  reducer(state: FriedrichState, action: FriedrichAction): FriedrichState {
    if (state.winner && action.type !== 'ping') {
      throw new IllegalActionError('The war is over.');
    }
    if (state.phase === 'setup' && action.type !== 'allotTroops' && action.type !== 'ping') {
      throw new IllegalActionError('The armies are still being raised — allot your troops first.');
    }
    // the discard is made "immediately": nothing else happens until France picks
    if (state.pendingDiscard && action.type !== 'discardCard' && action.type !== 'ping') {
      throw new IllegalActionError(`${properName(state.pendingDiscard.nation)} must discard a card first.`);
    }
    // "A defeated general has to retreat before the next combat is resolved."
    if (state.pendingRetreat && action.type !== 'chooseRetreat' && action.type !== 'ping') {
      throw new IllegalActionError(`${properName(state.pendingRetreat.chooser)} must first choose where ${properName(state.pendingRetreat.nation)} retreats.`);
    }
    switch (action.type) {
      case 'ping':
        return { ...state, version: state.version + 1, log: [...state.log, `${action.by}: ${action.note}`] };

      case 'chooseRetreat': {
        const pending = state.pendingRetreat;
        if (!pending) throw new IllegalActionError('No retreat is pending.');
        if (!pending.options.includes(action.node)) {
          throw new IllegalActionError('That is not a legal end to this retreat.');
        }
        const pieces: PieceMap = { ...state.pieces };
        for (const id of pending.pieceIds) {
          const p = pieces[id];
          if (p) pieces[id] = { ...p, node: action.node };
        }
        return withWinner({
          ...state,
          version: state.version + 1,
          pieces,
          pendingRetreat: null,
          log: [...state.log, `${properName(pending.nation)} retreats to ${cityName(action.node)}.`],
        });
      }

      case 'discardCard': {
        const pending = state.pendingDiscard;
        if (!pending) throw new IllegalActionError('Nothing to discard.');
        if (!pending.cardIds.includes(action.cardId)) {
          throw new IllegalActionError('You may only discard one of the cards you just drew.');
        }
        const card = state.hands[pending.nation].find((c) => c.id === action.cardId);
        if (!card) throw new IllegalActionError('That card is not in your hand.');
        return {
          ...state,
          version: state.version + 1,
          hands: {
            ...state.hands,
            [pending.nation]: state.hands[pending.nation].filter((c) => c.id !== action.cardId),
          },
          playedSets: setAside(state.playedSets, [card]),
          pendingDiscard: null,
          log: [...state.log, `${properName(pending.nation)} discards a card face-down.`],
        };
      }

      case 'allotTroops': {
        if (state.phase !== 'setup') throw new IllegalActionError('Troops are allotted only at set-up.');
        const { nation, alloc } = action;
        if (state.allocated.includes(nation)) throw new IllegalActionError(`${nation} has already allotted its troops.`);

        const generals = Object.values(state.pieces).filter((p) => p.nation === nation);
        const ids = new Set(generals.map((g) => g.id));
        const given = Object.keys(alloc);
        if (given.length !== ids.size || given.some((id) => !ids.has(id))) {
          throw new IllegalActionError('Allot troops to exactly this nation\'s generals.');
        }
        const perMax = TROOP_PER_GENERAL_MAX[nation];
        for (const [id, n] of Object.entries(alloc)) {
          if (!Number.isInteger(n) || n < TROOP_PER_GENERAL_MIN || n > perMax) {
            throw new IllegalActionError(`Each general must receive ${TROOP_PER_GENERAL_MIN}–${perMax} troops (${id}: ${n}).`);
          }
        }
        const total = Object.values(alloc).reduce((a, b) => a + b, 0);
        if (total !== TROOP_MAX[nation]) {
          throw new IllegalActionError(`${nation} must allot all ${TROOP_MAX[nation]} troops (you allotted ${total}).`);
        }

        const pieces = { ...state.pieces };
        for (const [id, n] of Object.entries(alloc)) pieces[id] = { ...pieces[id]!, troops: n };
        const allocated = [...state.allocated, nation];
        let next: FriedrichState = {
          ...state,
          version: state.version + 1,
          pieces,
          allocated,
          log: [...state.log, `${properName(nation)} has raised its army (${total} troops).`],
        };
        // once every nation has allotted, the war begins with Prussia's stage
        if (NATION_ORDER.every((n) => allocated.includes(n))) {
          next = beginStage({ ...next, phase: 'war', log: [...next.log, 'The armies are in the field — Prussia to act.'] }, NATION_ORDER[0]!);
        }
        return next;
      }

      case 'move': {
        if (state.combat) throw new IllegalActionError('Finish the current battle first.');
        const piece = state.pieces[action.pieceId];
        if (!piece) throw new IllegalActionError('No such general.');
        if (piece.nation !== activeNationOf(state)) throw new IllegalActionError(`It is ${activeNationOf(state)}'s turn.`);
        if (state.stageMoves[piece.id] !== undefined) {
          throw new IllegalActionError('That general has already moved this turn. Undo it first.');
        }

        const reach = reachableNodes(friedrichMap, piece.node, occupiedNodes(state.pieces));
        if (!reach.has(action.to)) throw new IllegalActionError('That city is not reachable this move.');

        const there = piecesAtNode(state.pieces, action.to);
        if (there.some((p) => p.nation !== piece.nation)) {
          throw new IllegalActionError('An enemy holds that city — attack from an adjacent city instead.');
        }
        if (there.length >= MAX_STACK) throw new IllegalActionError('That city is already stacked to the limit.');

        const pieces = { ...state.pieces, [piece.id]: { ...piece, node: action.to } };
        const dest = friedrichMap.nodes.get(action.to)!;
        const log = [`${properName(piece.id)} marches to ${dest.name}.`];

        // capture an enemy supply train standing in the entered city
        let trains = state.trains;
        let offMapTrains = state.offMapTrains;
        const enemyTrain = Object.values(state.trains).find(
          (t) => t.node === action.to && sideOf(t.nation) !== sideOf(piece.nation),
        );
        if (enemyTrain) {
          const tr = { ...state.trains };
          delete tr[enemyTrain.id];
          trains = tr;
          // the loser may buy it back later at a depot (§10)
          offMapTrains = { ...state.offMapTrains, [enemyTrain.nation]: (state.offMapTrains[enemyTrain.nation] ?? 0) + 1 };
          log.push(`${piece.nation} captures a ${enemyTrain.nation} supply train at ${dest.name}!`);
        }

        // objective conquest: an attacker seizes its own objective by occupying
        // it; a defender re-takes it by moving onto it
        let conquered = state.conquered;
        if (dest.objectiveFor) {
          if (piece.nation === dest.objectiveFor) {
            conquered = { ...conquered, [action.to]: piece.nation };
            log.push(`${piece.nation} seizes ${dest.name}!`);
          } else if (sideOf(piece.nation) === 'defender' && conquered[action.to]) {
            const c = { ...conquered };
            delete c[action.to];
            conquered = c;
            log.push(`Prussia retakes ${dest.name}.`);
          }
        }

        return withWinner({
          ...state,
          version: state.version + 1,
          pieces,
          trains,
          offMapTrains,
          conquered,
          stageMoves: { ...state.stageMoves, [piece.id]: piece.node },
          log: [...state.log, ...log],
        });
      }

      case 'moveTrain': {
        if (state.combat) throw new IllegalActionError('Finish the current battle first.');
        const train = state.trains[action.trainId];
        if (!train) throw new IllegalActionError('No such supply train.');
        if (train.nation !== activeNationOf(state)) throw new IllegalActionError(`It is ${activeNationOf(state)}'s turn.`);

        // trains move 2 cities (3 entirely on main roads), no jumping over pieces
        const occupied = new Set<string>([
          ...Object.values(state.pieces).map((p) => p.node),
          ...Object.values(state.trains).map((t) => t.node),
        ]);
        const reach = reachableNodes(friedrichMap, train.node, occupied, {
          maxSteps: TRAIN_MOVE,
          maxStepsMainRoad: TRAIN_MOVE_MAIN,
        });
        if (!reach.has(action.to)) throw new IllegalActionError('That city is out of the train\'s range.');
        // a train may not enter a city held by an enemy piece
        const side = sideOf(train.nation);
        const enemyThere =
          piecesAtNode(state.pieces, action.to).some((p) => sideOf(p.nation) !== side) ||
          Object.values(state.trains).some((t) => t.node === action.to && sideOf(t.nation) !== side);
        if (enemyThere) throw new IllegalActionError('An enemy holds that city.');

        return {
          ...state,
          version: state.version + 1,
          trains: { ...state.trains, [train.id]: { ...train, node: action.to } },
          log: [...state.log, `${train.nation} supply train → ${action.to}.`],
        };
      }

      case 'recruit': {
        if (state.combat) throw new IllegalActionError('Finish the current battle first.');
        const nation = activeNationOf(state);
        const { troops, trains: wantTrains, cardIds } = action;
        if (troops < 0 || wantTrains < 0 || (troops === 0 && wantTrains === 0)) {
          throw new IllegalActionError('Nothing to recruit.');
        }
        // with every depot blocked by another player, the nation names a
        // substitute re-entry site instead — and everything costs 8, not 6 (§10)
        const { sites, cost: unitCost } = reentrySites(state, nation);
        const substituting = unitCost === SUBSTITUTE_COST;

        // a re-entry site is only needed for pieces actually re-entering
        const needsDepot = !!action.generalId || wantTrains > 0;
        if (needsDepot) {
          if (!action.node || !sites.includes(action.node)) {
            throw new IllegalActionError(
              substituting
                ? 'All your depots are blocked — re-enter at a city in your substitute region.'
                : 'Pieces may only re-enter at one of your depot cities.',
            );
          }
        }
        const there = action.node ? piecesAtNode(state.pieces, action.node) : [];
        if (needsDepot && there.some((p) => p.nation !== nation)) {
          throw new IllegalActionError('Another nation holds that city.');
        }
        if (needsDepot && Object.values(state.trains).some((t) => t.node === action.node && t.nation !== nation)) {
          throw new IllegalActionError('Another nation holds that city.');
        }

        // troop establishment ceiling
        const onMap = Object.values(state.pieces).filter((p) => p.nation === nation).reduce((n, p) => n + p.troops, 0);
        if (onMap + troops > TROOP_MAX[nation]) {
          throw new IllegalActionError(`${nation} may not exceed its establishment of ${TROOP_MAX[nation]} troops.`);
        }

        // a re-entering general is free but must receive at least one troop
        const general = action.generalId ? state.offMap[action.generalId] : undefined;
        let reinforce: Piece | undefined;
        if (action.generalId) {
          if (!general || general.nation !== nation) throw new IllegalActionError('No such lost general.');
          if (troops < 1) throw new IllegalActionError('A returning general must receive at least one new troop.');
          if (there.length >= MAX_STACK) throw new IllegalActionError('That depot is already stacked to the limit.');
        } else if (troops > 0) {
          // troops may reinforce any general already on the map
          reinforce = action.reinforceId ? state.pieces[action.reinforceId] : undefined;
          if (!reinforce || reinforce.nation !== nation) {
            throw new IllegalActionError('Choose one of your generals on the map to reinforce.');
          }
        }
        if (wantTrains > (state.offMapTrains[nation] ?? 0)) throw new IllegalActionError('No lost supply train to bring back.');
        // a returning train may not share the depot with generals (§10 example)
        if (wantTrains > 0 && there.length > 0) throw new IllegalActionError('That depot is occupied — a supply train needs an empty city.');

        // pay: TCs are money, any suit; no change is given for overpayment
        const paying = cardIds.map((id) => state.hands[nation].find((c) => c.id === id));
        if (paying.some((c) => !c)) throw new IllegalActionError('You do not hold those cards.');
        if (paying.some((c) => c!.kind === 'reserve')) throw new IllegalActionError('A Reserve cannot be spent as money.');
        const paid = paying.reduce((n, c) => n + (c!.kind === 'suit' ? c!.value : 0), 0);
        // the surcharge applies to everything the nation recruits while cut off
        // from its depots, "even if the troop is not given to a re-entering general"
        const cost = (troops + wantTrains) * unitCost;
        if (paid < cost) throw new IllegalActionError(`That costs ${cost} points of Tactical Cards; you offered ${paid}.`);

        const spent = new Set(cardIds);
        const hands = { ...state.hands, [nation]: state.hands[nation].filter((c) => !spent.has(c.id)) };
        const playedSets = setAside(state.playedSets, paying.map((c) => c!));
        const where = action.node ? friedrichMap.nodes.get(action.node)?.name ?? action.node : '';
        const log = [
          `${properName(nation)} recruits ${troops} troop(s)${wantTrains ? ` and ${wantTrains} supply train(s)` : ''} for ${cost} points (paid ${paid})${substituting ? ' — at the blocked-depot rate of 8' : ''}.`,
        ];

        const pieces = { ...state.pieces };
        const offMap = { ...state.offMap };
        if (general && action.node) {
          // re-enters with the new troops; may not move this phase
          pieces[general.id] = { id: general.id, nation, rank: general.rank, node: action.node, troops, faceUp: true };
          delete offMap[general.id];
          log.push(`${general.id} returns to the field at ${where}.`);
        } else if (reinforce) {
          // The log is public, so it must not say WHO was reinforced: "a player
          // just says how many troops he is recruiting, but not which general(s)
          // will receive them ... he has to tell the other players the new
          // troops-total of his nation."
          pieces[reinforce.id] = { ...reinforce, troops: reinforce.troops + troops };
        }
        if (troops > 0) log.push(`${properName(nation)} now commands ${onMap + troops} troops.`);

        let trains = state.trains;
        let offMapTrains = state.offMapTrains;
        if (wantTrains > 0 && action.node) {
          const t = { ...trains };
          for (let i = 0; i < wantTrains; i++) {
            const id = `sup-${nation}-r${state.version}-${i}`;
            t[id] = { id, nation, node: action.node };
          }
          trains = t;
          offMapTrains = { ...offMapTrains, [nation]: (offMapTrains[nation] ?? 0) - wantTrains };
          log.push(`A ${nation} supply train returns at ${where}.`);
        }

        return {
          ...state,
          version: state.version + 1,
          pieces,
          trains,
          offMap,
          offMapTrains,
          // the new troops went to a general nobody named, so every one of this
          // nation's declared strengths is now only a "was"
          sightings: troops > 0 ? cloudSightings(state.sightings, pieces, nation) : state.sightings,
          hands,
          playedSets,
          // a re-entering general may not move in the phase it returns
          stageMoves: general && action.node ? { ...state.stageMoves, [general.id]: action.node } : state.stageMoves,
          log: [...state.log, ...log],
        };
      }

      case 'undoMove': {
        if (state.combat) throw new IllegalActionError('Cannot undo during a battle.');
        const origin = state.stageMoves[action.pieceId];
        const piece = state.pieces[action.pieceId];
        if (origin === undefined || !piece) throw new IllegalActionError('That general has not moved this turn.');
        const stageMoves = { ...state.stageMoves };
        delete stageMoves[action.pieceId];
        return {
          ...state,
          version: state.version + 1,
          pieces: { ...state.pieces, [action.pieceId]: { ...piece, node: origin } },
          stageMoves,
          log: [...state.log, `${action.pieceId} move undone (→ ${origin}).`],
        };
      }

      case 'attack': {
        if (state.combat) throw new IllegalActionError('A battle is already underway.');
        const atk = state.pieces[action.attackerId];
        const def = state.pieces[action.defenderId];
        if (!atk || !def) throw new IllegalActionError('No such general.');
        if (atk.nation !== activeNationOf(state)) throw new IllegalActionError(`It is ${activeNationOf(state)}'s turn.`);
        if (!areEnemies(atk.nation, def.nation)) throw new IllegalActionError('That is not an enemy.');
        if (!areAdjacent(friedrichMap, atk.node, def.node)) throw new IllegalActionError('Target is not adjacent.');

        const atkStack = stackAt(state.pieces, atk.node, atk.nation);
        const defStack = stackAt(state.pieces, def.node, def.nation);
        const sum = (s: readonly Piece[]) => s.reduce((n, p) => n + p.troops, 0);
        const atkSuit = friedrichMap.nodes.get(atk.node)!.suit;
        const defSuit = friedrichMap.nodes.get(def.node)!.suit;

        const duel = startDuel(
          { troops: sum(atkStack), sectorSuit: atkSuit, hand: state.hands[atk.nation] },
          { troops: sum(defStack), sectorSuit: defSuit, hand: state.hands[def.nation] },
        );
        const combat: CombatSub = {
          attackerNode: atk.node,
          defenderNode: def.node,
          attackerNation: atk.nation,
          defenderNation: def.nation,
          duel,
        };
        // "the opposing players state how many troops their participating
        // generals command" — the one moment strength becomes public
        const sightings = declare(declare(state.sightings, atkStack), defStack);

        return {
          ...state,
          version: state.version + 1,
          combat,
          sightings,
          stageMoves: {}, // committing to a battle finalizes this stage's moves
          log: [
            ...state.log,
            `${properName(atk.nation)} attacks ${properName(def.nation)} at ${cityName(def.node)}.`,
            `Strengths declared: ${properName(atk.nation)} ${sum(atkStack)}, ${properName(def.nation)} ${sum(defStack)}.`,
          ],
        };
      }

      case 'combatPlay':
      case 'combatPass': {
        if (!state.combat) throw new IllegalActionError('No battle in progress.');
        const side = state.combat.duel.toMove;
        const duel =
          action.type === 'combatPlay'
            ? playCard(state.combat.duel, side, action.cardId, action.reserve)
            : pass(state.combat.duel, side);
        if (duel.status === 'active') {
          return { ...state, version: state.version + 1, combat: { ...state.combat, duel } };
        }
        return finalizeCombat(state, { ...state.combat, duel });
      }

      case 'endNationTurn': {
        if (state.combat) throw new IllegalActionError('Finish the current battle first.');

        // the ending nation's supply phase: recover / cut off / annihilate
        const ending = activeNationOf(state);
        const supply = runSupplyPhase(state, ending);
        if (supply.log.length) {
          const offMap = { ...state.offMap };
          for (const p of supply.removed) offMap[p.id] = { id: p.id, nation: p.nation, rank: p.rank };
          state = { ...state, pieces: supply.pieces, offMap, log: [...state.log, ...supply.log] };
        }

        // advance to the next nation still in the war, detecting a full round
        let idx = state.activeNationIndex;
        let wrapped = false;
        for (let steps = 0; steps < NATION_ORDER.length; steps++) {
          idx = (idx + 1) % NATION_ORDER.length;
          if (idx === 0) wrapped = true;
          if (!state.eliminated.includes(NATION_ORDER[idx]!)) break;
        }
        const finishedRound = state.turn;
        let next: FriedrichState = {
          ...state,
          version: state.version + 1,
          activeNationIndex: idx,
          turn: wrapped ? state.turn + 1 : state.turn,
          stageMoves: {}, // new stage: fresh move budget and ghosts
          log: [...state.log, `${activeNationOf(state)} ends its stage; ${NATION_ORDER[idx]} to act.`],
        };
        // from the end of turn 6, the Clock of Fate draws one card each turn
        if (wrapped && finishedRound >= 6 && next.fateDeck.length > 0) {
          next = drawFate(next);
        }
        // the new nation's stage opens with its card draw
        next = beginStage(next, NATION_ORDER[idx]!);
        return withWinner(next);
      }

      default: {
        const _exhaustive: never = action;
        throw new IllegalActionError(`Unknown action: ${(_exhaustive as { type: string }).type}`);
      }
    }
  },

  redact(state: FriedrichState, viewer: PlayerId): FriedrichState {
    const controlled = nationsControlledBy(state, viewer);

    // hide the hands of nations the viewer doesn't control, and the draw deck's
    // order (nobody may see the coming draws) — only its size is public
    const hands = { ...state.hands };
    for (const nation of NATION_ORDER) {
      if (!controlled.has(nation)) hands[nation] = [];
    }

    // hide secret troop counts on pieces the viewer doesn't own (-1 = hidden)
    const pieces: PieceMap = {};
    for (const [id, p] of Object.entries(state.pieces)) {
      pieces[id] = controlled.has(p.nation) ? p : { ...p, troops: HIDDEN_TROOPS };
    }

    // in a battle, hide the opposing side's hand (pooled troop totals stay
    // visible — the rules reveal them at the reveal step)
    let combat = state.combat;
    if (combat) {
      const mask = (party: CombatSub['duel']['attacker'], nation: Nation) =>
        controlled.has(nation) ? party : { ...party, hand: [] };
      combat = {
        ...combat,
        duel: {
          ...combat.duel,
          attacker: mask(combat.duel.attacker, combat.attackerNation),
          defender: mask(combat.duel.defender, combat.defenderNation),
        },
      };
    }

    // a card id spells out its suit and value, so the pending-discard choices are
    // only for the nation making the choice — others just see that it is pending
    const pendingDiscard =
      state.pendingDiscard && !controlled.has(state.pendingDiscard.nation)
        ? { ...state.pendingDiscard, cardIds: [] }
        : state.pendingDiscard;

    return { ...state, hands, drawDeck: [], deckCount: state.drawDeck.length, pieces, combat, pendingDiscard };
  },
};

/** Sentinel troop value in a redacted view: this general's strength is secret. */
export const HIDDEN_TROOPS = -1;

export const NATION_OF_ROLE: Record<Role, readonly Nation[]> = {
  frederick: ['prussia', 'hanover'],
  elisabeth: ['russia', 'sweden'],
  mariaTheresa: ['austria', 'imperial'],
  pompadour: ['france'],
};

/** The set of nations a seated player controls (via their role(s)). */
export function nationsControlledBy(state: FriedrichState, viewer: PlayerId): Set<Nation> {
  const set = new Set<Nation>();
  for (const role of state.seats[viewer] ?? []) {
    for (const n of NATION_OF_ROLE[role]) set.add(n);
  }
  return set;
}

/** The nation an action must be entitled to act as (for authorization). */
/** The seat that plays a nation (a role can hold two, e.g. Prussia + Hanover). */
function playerOf(state: FriedrichState, nation: Nation): PlayerId | null {
  for (const [player, roles] of Object.entries(state.seats)) {
    for (const role of roles) if (NATION_OF_ROLE[role].includes(nation)) return player;
  }
  return null;
}

/**
 * Rule 10a's trigger: "Should all of a nation's depot cities be occupied by
 * pieces from ANOTHER PLAYER". Pieces you control yourself don't count — you
 * could always march them out of the way — so a depot held by your own other
 * nation blocks re-entry without earning you a substitute site.
 */
export function depotsBlocked(state: FriedrichState, nation: Nation): boolean {
  const mine = playerOf(state, nation);
  const foreign = (owner: Nation) => mine === null || playerOf(state, owner) !== mine;
  return DEPOT_CITIES[nation].every(
    (depot) =>
      Object.values(state.pieces).some((p) => p.node === depot && foreign(p.nation)) ||
      Object.values(state.trains).some((t) => t.node === depot && foreign(t.nation)),
  );
}

/** Where `nation` may bring pieces back this turn, and what a troop costs there. */
export function reentrySites(state: FriedrichState, nation: Nation): { sites: readonly string[]; cost: number } {
  return depotsBlocked(state, nation)
    ? { sites: substituteSites(nation), cost: SUBSTITUTE_COST } // rule 10b
    : { sites: DEPOT_CITIES[nation], cost: RECRUIT_COST };
}

export function requiredNation(state: FriedrichState, action: FriedrichAction): Nation | null {
  if (action.type === 'ping') return null;
  if (action.type === 'allotTroops') return action.nation; // you may only raise your own armies
  if (action.type === 'discardCard') return state.pendingDiscard?.nation ?? null;
  if (action.type === 'chooseRetreat') return state.pendingRetreat?.chooser ?? null; // the winner picks
  if (action.type === 'combatPlay' || action.type === 'combatPass') {
    if (!state.combat) return null;
    return state.combat.duel.toMove === 'attacker' ? state.combat.attackerNation : state.combat.defenderNation;
  }
  return NATION_ORDER[state.activeNationIndex] ?? null;
}

/**
 * A legal default allotment: spread a nation's establishment as evenly as the
 * per-general min/max allow. Players may adjust before confirming.
 */
export function suggestAllotment(state: FriedrichState, nation: Nation): Record<string, number> {
  const generals = Object.values(state.pieces).filter((p) => p.nation === nation).sort((a, b) => a.rank - b.rank);
  const perMax = TROOP_PER_GENERAL_MAX[nation];
  const alloc: Record<string, number> = {};
  for (const g of generals) alloc[g.id] = TROOP_PER_GENERAL_MIN;
  let left = TROOP_MAX[nation] - generals.length * TROOP_PER_GENERAL_MIN;
  // give the strongest commands the extra troops first
  while (left > 0) {
    let placed = false;
    for (const g of generals) {
      if (left <= 0) break;
      if (alloc[g.id]! < perMax) { alloc[g.id] = alloc[g.id]! + 1; left--; placed = true; }
    }
    if (!placed) break; // establishment exceeds capacity (cannot happen with the real sheet)
  }
  return alloc;
}

/**
 * Server-side authorization: may this player take this action now? Returns an
 * error message, or null if allowed. (The pure reducer stays permissive; the
 * authoritative server calls this so a player can only act for their own nation
 * whose turn/battle it is. Local hotseat bypasses it.)
 */
export function authorizeAction(state: FriedrichState, viewer: PlayerId, action: FriedrichAction): string | null {
  const need = requiredNation(state, action);
  if (!need) return null;
  if (!nationsControlledBy(state, viewer).has(need)) {
    return `It is not your turn — ${need} is acting.`;
  }
  return null;
}
