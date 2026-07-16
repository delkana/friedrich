/**
 * The suit-restricted card duel that resolves a battle in Friedrich (and Maria).
 *
 * A duel is a bidding game between an attacker and a defender. Each side's
 * strength is its secret troop count plus the values of Tactical Cards it plays.
 * We track a running `diff = attackerTotal − defenderTotal`. The side that is
 * *behind* has the right to play and adds matching-suit card values to close the
 * gap; the instant it draws level or ahead, the right to play switches. A side
 * that is behind and cannot or will not play is defeated; its casualties equal
 * the gap (capped at its troops) and it must retreat that many cities (retreat
 * itself is resolved by the map layer). An exactly-even position where the mover
 * has no matching-suit card and declines is a tie with no losses.
 *
 * This module is a pure state machine: `startDuel` then a sequence of `playCard`
 * / `pass`, each returning a new immutable state. No RNG, no map, no hands
 * management beyond the cards each side brings to the battle.
 */

import { IllegalActionError } from './core.js';
import {
  canPlayInSector,
  playedValue,
  type ReservePlay,
  type Suit,
  type TacticalCard,
} from './cards.js';

export type DuelSide = 'attacker' | 'defender';
export type DuelStatus = 'active' | 'attacker_won' | 'defender_won' | 'tie';

/** What each side brings to a battle. `hand` are the cards it may play. */
export interface DuelCombatant {
  readonly troops: number;
  /** Suit of the map sector this general stands in (its cards must match it). */
  readonly sectorSuit: Suit;
  readonly hand: readonly TacticalCard[];
}

export interface DuelPartyState {
  readonly troops: number;
  readonly sectorSuit: Suit;
  /** Cards still available to play. */
  readonly hand: readonly TacticalCard[];
  /** troops + sum of values played so far. */
  readonly total: number;
}

/** One recorded play, for logging / replay / UI. */
export interface DuelPlay {
  readonly side: DuelSide;
  readonly cardId: string;
  readonly value: number;
  readonly diffAfter: number;
}

export interface DuelResult {
  readonly outcome: DuelStatus;
  readonly loser: DuelSide | null;
  /** Troops the loser loses; also the number of cities it must retreat. */
  readonly casualties: number;
  /** True if casualties wipe out the loser's whole force. */
  readonly loserEliminated: boolean;
}

export interface DuelState {
  readonly attacker: DuelPartyState;
  readonly defender: DuelPartyState;
  readonly toMove: DuelSide;
  readonly status: DuelStatus;
  readonly history: readonly DuelPlay[];
  readonly result: DuelResult | null;
}

const other = (side: DuelSide): DuelSide => (side === 'attacker' ? 'defender' : 'attacker');

const diffOf = (s: DuelState): number => s.attacker.total - s.defender.total;

/** Is `side` behind (has the right to play) at the given diff? */
function isBehind(side: DuelSide, diff: number): boolean {
  return side === 'attacker' ? diff < 0 : diff > 0;
}

function hasMatchingSuitCard(hand: readonly TacticalCard[], sectorSuit: Suit): boolean {
  return hand.some((c) => c.kind === 'suit' && c.suit === sectorSuit);
}

function party(c: DuelCombatant): DuelPartyState {
  if (c.troops < 1) throw new IllegalActionError('A combatant must have at least 1 troop.');
  return { troops: c.troops, sectorSuit: c.sectorSuit, hand: c.hand, total: c.troops };
}

/**
 * Begin a duel. The behind side moves first; on an exactly-even start the
 * attacker moves first (rulebook tie-break).
 */
export function startDuel(attacker: DuelCombatant, defender: DuelCombatant): DuelState {
  const a = party(attacker);
  const d = party(defender);
  const diff = a.total - d.total;
  return {
    attacker: a,
    defender: d,
    toMove: diff > 0 ? 'defender' : 'attacker',
    status: 'active',
    history: [],
    result: null,
  };
}

/** Card ids `side` may legally play right now (matching suit, or any Reserve). */
export function legalCardIds(state: DuelState, side: DuelSide): string[] {
  if (state.status !== 'active' || state.toMove !== side) return [];
  const p = side === 'attacker' ? state.attacker : state.defender;
  return p.hand.filter((c) => canPlayInSector(c, p.sectorSuit)).map((c) => c.id);
}

/**
 * At an exactly-even position the mover MUST play if it holds a matching-suit
 * card (it may not concede to a cheap tie). Reserves never force a play.
 */
export function mustPlay(state: DuelState, side: DuelSide): boolean {
  if (state.status !== 'active' || state.toMove !== side) return false;
  const p = side === 'attacker' ? state.attacker : state.defender;
  return diffOf(state) === 0 && hasMatchingSuitCard(p.hand, p.sectorSuit);
}

function requireActiveMover(state: DuelState, side: DuelSide): void {
  if (state.status !== 'active') throw new IllegalActionError('The duel is already resolved.');
  if (state.toMove !== side) throw new IllegalActionError('It is not this side to play.');
}

/** Play one card (with a Reserve declaration if the card is a Reserve). */
export function playCard(
  state: DuelState,
  side: DuelSide,
  cardId: string,
  reserve?: ReservePlay,
): DuelState {
  requireActiveMover(state, side);
  const p = side === 'attacker' ? state.attacker : state.defender;

  const card = p.hand.find((c) => c.id === cardId);
  if (!card) throw new IllegalActionError('Card is not in this side\'s hand.');
  if (!canPlayInSector(card, p.sectorSuit)) {
    throw new IllegalActionError('Card suit does not match the general\'s sector.');
  }
  if (card.kind === 'reserve') {
    if (!reserve || !Number.isInteger(reserve.value) || reserve.value < 1 || reserve.value > 10) {
      throw new IllegalActionError('A Reserve must declare a value from 1 to 10.');
    }
  }

  const value = playedValue(card, reserve);
  const newParty: DuelPartyState = {
    ...p,
    hand: p.hand.filter((c) => c.id !== cardId),
    total: p.total + value,
  };
  const next: DuelState =
    side === 'attacker' ? { ...state, attacker: newParty } : { ...state, defender: newParty };

  const diff = diffOf(next);
  const toMove = isBehind(side, diff) ? side : other(side);
  const play: DuelPlay = { side, cardId, value, diffAfter: diff };
  return { ...next, toMove, history: [...next.history, play] };
}

/**
 * The mover declines to play. If the position is even this ends the duel as a
 * tie (unless a matching-suit card forced a play). Otherwise the mover — who is
 * behind — is defeated, taking casualties equal to the gap (capped at troops).
 */
export function pass(state: DuelState, side: DuelSide): DuelState {
  requireActiveMover(state, side);
  const diff = diffOf(state);

  if (diff === 0) {
    if (mustPlay(state, side)) {
      throw new IllegalActionError('You hold a matching-suit card and must play at an even score.');
    }
    const result: DuelResult = { outcome: 'tie', loser: null, casualties: 0, loserEliminated: false };
    return { ...state, status: 'tie', result };
  }

  // The mover is behind and concedes.
  const loser = side;
  const loserParty = loser === 'attacker' ? state.attacker : state.defender;
  const gap = Math.abs(diff);
  const casualties = Math.min(gap, loserParty.troops);
  const outcome: DuelStatus = loser === 'attacker' ? 'defender_won' : 'attacker_won';
  const result: DuelResult = {
    outcome,
    loser,
    casualties,
    loserEliminated: casualties >= loserParty.troops,
  };
  return { ...state, status: outcome, result };
}
