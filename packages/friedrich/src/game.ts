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
} from '@friedrich/engine';
import { NATION_ORDER, BASE_DRAW, type Role, type Nation } from './powers.js';
import {
  INITIAL_PIECES,
  INITIAL_TRAINS,
  MAX_STACK,
  TRAIN_MOVE,
  TRAIN_MOVE_MAIN,
  RECRUIT_COST,
  TROOP_MAX,
  DEPOT_CITIES,
  areEnemies,
  sideOf,
  type Piece,
  type Train,
} from './pieces.js';
import { friedrichMap } from './map-data.js';
import { buildFateDeck, FATE_LABEL, type FateCard } from './fate.js';
import { checkVictory } from './victory.js';
import { runSupplyPhase } from './supply.js';
import type { FriedrichState, FriedrichAction, CombatSub, Winner } from './state.js';

type PieceMap = Record<string, Piece>;

// ---- helpers -------------------------------------------------------------

function assignSeats(players: readonly PlayerId[]): Record<PlayerId, Role[]> {
  const seatRoles: Role[][] =
    players.length === 3
      ? [['frederick'], ['mariaTheresa'], ['elisabeth', 'pompadour']]
      : [['frederick'], ['mariaTheresa'], ['elisabeth'], ['pompadour']];
  const seats: Record<PlayerId, Role[]> = {};
  players.forEach((p, i) => {
    seats[p] = seatRoles[i]!;
  });
  return seats;
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

/**
 * SIMPLIFIED retreat: pick an empty city reachable within `distance` cities
 * (no passing through pieces) that is as far as possible from the winner. The
 * exact rule (retreat the full distance, winner picks the path, never re-enter a
 * city) is approximated here; returns null if nowhere to go.
 */
function retreatNode(pieces: PieceMap, from: string, winner: string, distance: number): string | null {
  const occ = occupiedNodes(pieces);
  const reach = reachableNodes(friedrichMap, from, occ, { maxSteps: distance, maxStepsMainRoad: distance });
  let best: string | null = null;
  let bestDist = -1;
  for (const node of reach.keys()) {
    if (occ.has(node)) continue; // retreat only to an empty city
    const d = hopDistance(friedrichMap, node, winner);
    if (d > bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}

function finalizeCombat(state: FriedrichState, combat: CombatSub): FriedrichState {
  const duel = combat.duel;
  const r = duel.result!;
  const hands = {
    ...state.hands,
    [combat.attackerNation]: duel.attacker.hand,
    [combat.defenderNation]: duel.defender.hand,
  };
  // cards played in the battle go to each nation's discard pile
  const playedBy = (nation: Nation, remaining: readonly TacticalCard[]): TacticalCard[] => {
    const rem = new Set(remaining.map((c) => c.id));
    return state.hands[nation].filter((c) => !rem.has(c.id));
  };
  const discards = {
    ...state.discards,
    [combat.attackerNation]: [...state.discards[combat.attackerNation], ...playedBy(combat.attackerNation, duel.attacker.hand)],
    [combat.defenderNation]: [...state.discards[combat.defenderNation], ...playedBy(combat.defenderNation, duel.defender.hand)],
  };
  const pieces: PieceMap = { ...state.pieces };
  const log = [...state.log];

  if (r.outcome === 'tie') {
    log.push('Battle tied — both sides hold.');
  } else {
    const loserNation = r.loser === 'attacker' ? combat.attackerNation : combat.defenderNation;
    const loserNode = r.loser === 'attacker' ? combat.attackerNode : combat.defenderNode;
    const winnerNode = r.loser === 'attacker' ? combat.defenderNode : combat.attackerNode;
    const stack = stackAt(pieces, loserNode, loserNation);

    if (r.loserEliminated) {
      for (const p of stack) delete pieces[p.id];
      log.push(`${properName(loserNation)}'s force at ${cityName(loserNode)} is wiped out (${r.casualties} troops lost).`);
    } else {
      applyCasualties(pieces, stack, r.casualties);
      const survivors = stack.filter((p) => pieces[p.id]);
      const dest = retreatNode(pieces, loserNode, winnerNode, r.casualties);
      if (!dest) {
        for (const p of survivors) delete pieces[p.id];
        log.push(`${properName(loserNation)} lost ${r.casualties} and could not retreat — destroyed.`);
      } else {
        for (const p of survivors) pieces[p.id] = { ...pieces[p.id]!, node: dest };
        log.push(`${properName(loserNation)} loses ${r.casualties} and retreats ${r.casualties} to ${cityName(dest)}.`);
      }
    }
  }

  // generals lost in the battle go off-map, where they may be recruited back (§10)
  const offMap = { ...state.offMap };
  for (const [id, p] of Object.entries(state.pieces)) {
    if (!pieces[id]) offMap[id] = { id: p.id, nation: p.nation, rank: p.rank };
  }

  return { ...state, version: state.version + 1, pieces, hands, discards, offMap, combat: null, log };
}

// ---- card draw + deck cycling --------------------------------------------

/** Draw `count` cards, reshuffling the discard pile into the deck when it runs dry. */
function drawCards(
  rng: FriedrichState['rng'],
  deck: readonly TacticalCard[],
  discard: readonly TacticalCard[],
  count: number,
): { rng: FriedrichState['rng']; deck: TacticalCard[]; discard: TacticalCard[]; drawn: TacticalCard[] } {
  let d = [...deck];
  let disc = [...discard];
  let r = rng;
  const drawn: TacticalCard[] = [];
  for (let i = 0; i < count; i++) {
    if (d.length === 0) {
      if (disc.length === 0) break; // truly out of cards
      const sh = rngShuffle(r, disc);
      r = sh.r;
      d = sh.items;
      disc = [];
    }
    drawn.push(d.shift()!);
  }
  return { rng: r, deck: d, discard: disc, drawn };
}

/** The first phase of a nation's stage: draw its Tactical Card allotment. */
function beginStage(state: FriedrichState, nation: Nation): FriedrichState {
  const allot = state.drawAllot[nation] ?? 0;
  if (allot <= 0) return state;
  const res = drawCards(state.rng, state.decks[nation], state.discards[nation], allot);
  let hand: TacticalCard[] = [...state.hands[nation], ...res.drawn];
  let discard = res.discard;
  const log = [`${nation} draws ${res.drawn.length} card(s).`];
  if (nation === 'france' && hand.length > 0) {
    discard = [...discard, hand[hand.length - 1]!]; // France discards one face-down
    hand = hand.slice(0, -1);
    log.push('France discards a card face-down.');
  }
  return {
    ...state,
    rng: res.rng,
    decks: { ...state.decks, [nation]: res.deck },
    discards: { ...state.discards, [nation]: discard },
    hands: { ...state.hands, [nation]: hand },
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
    // each nation gets a shuffled 50-card deck; hands start empty and are drawn
    // at the start of each nation's stage
    const decks: Record<Nation, TacticalCard[]> = {} as Record<Nation, TacticalCard[]>;
    const hands: Record<Nation, TacticalCard[]> = {} as Record<Nation, TacticalCard[]>;
    const discards: Record<Nation, TacticalCard[]> = {} as Record<Nation, TacticalCard[]>;
    for (const nation of NATION_ORDER) {
      const shuffled = rngShuffle(rng, buildTacticalDeck(nation));
      rng = shuffled.r;
      decks[nation] = shuffled.items;
      hands[nation] = [];
      discards[nation] = [];
    }
    const fate = buildFateDeck(rng);
    rng = fate.rng;
    const pieces: PieceMap = {};
    for (const p of INITIAL_PIECES) pieces[p.id] = { ...p, faceUp: true };
    const trains: Record<string, Train> = {};
    for (const t of INITIAL_TRAINS) trains[t.id] = t;

    const base: FriedrichState = {
      rng,
      version: 0,
      players: [...players],
      seats: assignSeats(players),
      turn: 1,
      activeNationIndex: 0,
      pieces,
      trains,
      offMap: {},
      offMapTrains: { prussia: 0, hanover: 0, russia: 0, sweden: 0, austria: 0, imperial: 0, france: 0 },
      hands,
      decks,
      discards,
      drawAllot: { ...BASE_DRAW },
      stageMoves: {},
      combat: null,
      conquered: {},
      eliminated: [],
      fateDeck: fate.deck,
      fateDrawn: [],
      winner: null,
      log: [`Game created with ${players.length} player(s). Prussia to act.`],
    };
    // Prussia's stage opens immediately — draw its cards
    return beginStage(base, NATION_ORDER[0]!);
  },

  reducer(state: FriedrichState, action: FriedrichAction): FriedrichState {
    if (state.winner && action.type !== 'ping') {
      throw new IllegalActionError('The war is over.');
    }
    switch (action.type) {
      case 'ping':
        return { ...state, version: state.version + 1, log: [...state.log, `${action.by}: ${action.note}`] };

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
        // a depot is only needed for pieces actually re-entering
        const needsDepot = !!action.generalId || wantTrains > 0;
        if (needsDepot) {
          if (!action.node || !DEPOT_CITIES[nation].includes(action.node)) {
            throw new IllegalActionError('Pieces may only re-enter at one of your depot cities.');
          }
        }
        const there = action.node ? piecesAtNode(state.pieces, action.node) : [];
        if (needsDepot && there.some((p) => p.nation !== nation)) {
          throw new IllegalActionError('Another nation holds that depot.');
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
        const cost = (troops + wantTrains) * RECRUIT_COST;
        if (paid < cost) throw new IllegalActionError(`That costs ${cost} points of Tactical Cards; you offered ${paid}.`);

        const spent = new Set(cardIds);
        const hands = { ...state.hands, [nation]: state.hands[nation].filter((c) => !spent.has(c.id)) };
        const discards = { ...state.discards, [nation]: [...state.discards[nation], ...paying.map((c) => c!)] };
        const where = action.node ? friedrichMap.nodes.get(action.node)?.name ?? action.node : '';
        const log = [`${nation} recruits ${troops} troop(s)${wantTrains ? ` and ${wantTrains} supply train(s)` : ''} for ${cost} points (paid ${paid}).`];

        const pieces = { ...state.pieces };
        const offMap = { ...state.offMap };
        if (general && action.node) {
          // re-enters with the new troops; may not move this phase
          pieces[general.id] = { id: general.id, nation, rank: general.rank, node: action.node, troops, faceUp: true };
          delete offMap[general.id];
          log.push(`${general.id} returns to the field at ${where}.`);
        } else if (reinforce) {
          pieces[reinforce.id] = { ...reinforce, troops: reinforce.troops + troops };
          log.push(`${reinforce.id} is reinforced to ${reinforce.troops + troops} troops.`);
        }

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
          hands,
          discards,
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
        return {
          ...state,
          version: state.version + 1,
          combat,
          stageMoves: {}, // committing to a battle finalizes this stage's moves
          log: [...state.log, `${properName(atk.nation)} attacks ${properName(def.nation)} at ${cityName(def.node)}.`],
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

    // hide hands of nations the viewer doesn't control; hide every draw deck's
    // order (a player must not see their own future draws)
    const hands = { ...state.hands };
    const decks = { ...state.decks };
    for (const nation of NATION_ORDER) {
      if (!controlled.has(nation)) hands[nation] = [];
      decks[nation] = [];
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

    return { ...state, hands, decks, pieces, combat };
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
export function requiredNation(state: FriedrichState, action: FriedrichAction): Nation | null {
  if (action.type === 'ping') return null;
  if (action.type === 'combatPlay' || action.type === 'combatPass') {
    if (!state.combat) return null;
    return state.combat.duel.toMove === 'attacker' ? state.combat.attackerNation : state.combat.defenderNation;
  }
  return NATION_ORDER[state.activeNationIndex] ?? null;
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
