import type { BaseState, BaseAction, PlayerId, TacticalCard, ReservePlay, DuelState } from '@friedrich/engine';
import type { Role, Nation } from './powers.js';
import type { Piece, Train } from './pieces.js';
import type { FateCard } from './fate.js';

/** How the game ended. `defender` = Frederick/Prussia surviving the war. */
export type Winner = { readonly side: 'attacker'; readonly nation: Nation } | { readonly side: 'defender' };

/**
 * What the table has been shown about one general's strength.
 *
 * Troop counts are secret, and combat is the only thing that reveals them:
 * "the opposing players state how many troops their participating generals
 * command". That is said out loud, so a sighting is PUBLIC knowledge — not
 * per-viewer — and it is the STACK's total, never the private split inside it.
 * A general is therefore only pinned to an exact number if he fought alone.
 */
export interface Sighting {
  /** The strength declared: this general's, or the whole stack's if `with` is set. */
  readonly total: number;
  /** The others who shared that declared total ([] if he stood alone). */
  readonly with: readonly string[];
  /**
   * False once the number could have changed without being shown — the rules
   * make a nation's recruiting public but not which general received the troops,
   * so one recruit clouds every general it owns.
   */
  readonly certain: boolean;
}

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
  /**
   * `setup` = players are secretly allotting their troop establishments to their
   * generals ("How to start"); the war begins once every nation has allotted.
   */
  readonly phase: 'setup' | 'war';
  /** Nations whose troops have been allotted during set-up. */
  readonly allocated: readonly Nation[];
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
  /** Generals lost in the field, available to re-enter at a depot (§10). */
  readonly offMap: Readonly<Record<string, { id: string; nation: Nation; rank: number }>>;
  /** Supply trains lost, per nation, available to be bought back. */
  readonly offMapTrains: Readonly<Record<Nation, number>>;
  /** Each nation's Tactical Card hand. */
  readonly hands: Readonly<Record<Nation, readonly TacticalCard[]>>;
  /**
   * The single face-down draw deck every nation draws from — the box's four
   * 50-card decks are used one at a time (rule 3). Its order is secret, so
   * redaction empties it and reports `deckCount` instead.
   */
  readonly drawDeck: readonly TacticalCard[];
  /** Cards left in the draw deck. Only set on a redacted view, where it is hidden. */
  readonly deckCount?: number;
  /** Played cards, set aside sorted by their deck of origin (`playedSets[0]` = deck 1). */
  readonly playedSets: readonly (readonly TacticalCard[])[];
  /** How many of the four decks have served as the draw deck so far. */
  readonly setsUsed: number;
  /**
   * France's stage opens by drawing four cards and discarding one **of its
   * choice** ("select one to discard immediately"), so the stage pauses here
   * until it picks. `cardIds` are the cards just drawn — the only legal choices,
   * and hidden from everyone else.
   */
  readonly pendingDiscard: { readonly nation: Nation; readonly cardIds: readonly string[] } | null;
  /**
   * A beaten stack waiting to be retreated. The winner picks the path (rule 8),
   * which only matters when several legal destinations are equally far from it;
   * a single option is applied without asking.
   */
  readonly pendingRetreat: {
    /** The nation doing the retreating. */
    readonly nation: Nation;
    /** The winner, who chooses. */
    readonly chooser: Nation;
    readonly pieceIds: readonly string[];
    readonly from: string;
    readonly options: readonly string[];
  } | null;
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
  /**
   * Public knowledge of enemy strength, by general id: what a battle declared,
   * and whether it can still be trusted. Absent = never seen.
   */
  readonly sightings: Readonly<Record<string, Sighting>>;
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
  /** Set-up: secretly allot a nation's whole establishment across its generals. */
  | ({ type: 'allotTroops'; nation: Nation; alloc: Record<string, number> } & BaseAction)
  | ({ type: 'move'; pieceId: string; to: string } & BaseAction)
  | ({ type: 'moveTrain'; trainId: string; to: string } & BaseAction)
  /**
   * Recruit (§10), paying with Tactical Cards used as money (6 points per troop
   * or supply train; no change given). `generalId` brings a lost general back at
   * the depot `node` and must receive at least one troop; otherwise `troops`
   * reinforce the on-map general `reinforceId`. `trains` return at `node`.
   */
  | ({
      type: 'recruit';
      node?: string;
      generalId?: string;
      reinforceId?: string;
      troops: number;
      trains: number;
      cardIds: string[];
    } & BaseAction)
  /** France: choose which of the cards it just drew to discard face-down. */
  | ({ type: 'discardCard'; cardId: string } & BaseAction)
  /** The battle's winner picks where the beaten stack ends its retreat. */
  | ({ type: 'chooseRetreat'; node: string } & BaseAction)
  | ({ type: 'undoMove'; pieceId: string } & BaseAction)
  | ({ type: 'attack'; attackerId: string; defenderId: string } & BaseAction)
  | ({ type: 'combatPlay'; cardId: string; reserve?: ReservePlay } & BaseAction)
  | ({ type: 'combatPass' } & BaseAction)
  | ({ type: 'endNationTurn' } & BaseAction)
  | ({ type: 'ping'; note: string } & BaseAction);
