import type { BaseState, BaseAction, PlayerId, TacticalCard, ReservePlay, DuelState } from '@friedrich/engine';
import type { Role, Nation } from './powers.js';
import type { Piece, Train } from './pieces.js';
import type { FateCard } from './fate.js';

/** How the game ended. `defender` = Frederick/Prussia surviving the war. */
export type Winner = { readonly side: 'attacker'; readonly nation: Nation } | { readonly side: 'defender' };

/**
 * An in-progress battle. The duel state machine (engine) does the scoring; this
 * wrapper remembers which stacks and nations are fighting so the result can be
 * applied back to the board. Only one battle is resolved at a time.
 */
export interface CombatSub {
  readonly attackerNode: string;
  readonly defenderNode: string;
  readonly attackerNation: Nation;
  readonly defenderNation: Nation;
  readonly duel: DuelState;
}

export interface FriedrichState extends BaseState {
  /** Seated players in seat order. */
  readonly players: readonly PlayerId[];
  /** Which role(s) each seat controls (a 3-player seat can hold two). */
  readonly seats: Readonly<Record<PlayerId, readonly Role[]>>;
  /** Current turn number (increments after a full round of nations). */
  readonly turn: number;
  /** Whose nation is currently acting (index into NATION_ORDER). */
  readonly activeNationIndex: number;
  /** All generals on the board, keyed by piece id. */
  readonly pieces: Readonly<Record<string, Piece>>;
  /** Supply trains on the board, keyed by train id. */
  readonly trains: Readonly<Record<string, Train>>;
  /** Each nation's Tactical Card hand. */
  readonly hands: Readonly<Record<Nation, readonly TacticalCard[]>>;
  /** Each nation's face-down draw pile (order is secret — hidden in redaction). */
  readonly decks: Readonly<Record<Nation, readonly TacticalCard[]>>;
  /** Each nation's discard pile (played cards, reshuffled when the deck empties). */
  readonly discards: Readonly<Record<Nation, readonly TacticalCard[]>>;
  /** Cards each nation draws at the start of its stage (reduced by some Cards of Fate). */
  readonly drawAllot: Readonly<Record<Nation, number>>;
  /**
   * Generals that have moved during the current nation stage → the city each
   * started the stage in. A general may move only once per stage; the origin
   * powers both undo and the ghost marker. Cleared when the stage ends or a
   * battle is committed.
   */
  readonly stageMoves: Readonly<Record<string, string>>;
  /** The battle being resolved, if any (blocks movement until finished). */
  readonly combat: CombatSub | null;
  /** Objective city id → the attacker nation that currently holds it. */
  readonly conquered: Readonly<Record<string, Nation>>;
  /** Nations forced out of the war by the Cards of Fate. */
  readonly eliminated: readonly Nation[];
  /** The Cards of Fate deck (top = index 0) and the ones already executed. */
  readonly fateDeck: readonly FateCard[];
  readonly fateDrawn: readonly FateCard[];
  /** Set once a side has won; further actions are rejected. */
  readonly winner: Winner | null;
  /** Human-readable event log, newest last. */
  readonly log: readonly string[];
}

export type FriedrichAction =
  | ({ type: 'move'; pieceId: string; to: string } & BaseAction)
  | ({ type: 'moveTrain'; trainId: string; to: string } & BaseAction)
  | ({ type: 'undoMove'; pieceId: string } & BaseAction)
  | ({ type: 'attack'; attackerId: string; defenderId: string } & BaseAction)
  | ({ type: 'combatPlay'; cardId: string; reserve?: ReservePlay } & BaseAction)
  | ({ type: 'combatPass' } & BaseAction)
  | ({ type: 'endNationTurn' } & BaseAction)
  | ({ type: 'ping'; note: string } & BaseAction);
