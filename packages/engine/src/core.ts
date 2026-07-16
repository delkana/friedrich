/**
 * The engine contract every game (Friedrich, later Maria) implements.
 *
 * A game is defined by a `GameDefinition`: how to set up initial state from a
 * seed + players, a pure `reducer` that validates and applies one action, and a
 * `redact` function that produces the view a given player is allowed to see
 * (hiding opponents' hands). The server and clients all run the same reducer.
 */

import type { RngState } from './rng.js';

export type PlayerId = string;

/** Every game state carries the RNG so results are reproducible from the seed. */
export interface BaseState {
  readonly rng: RngState;
  /** Monotonic version, bumped on every successfully applied action. */
  readonly version: number;
}

/** Every action records who is attempting it; the reducer authorizes it. */
export interface BaseAction {
  readonly type: string;
  readonly by: PlayerId;
}

/** Thrown by a reducer to reject an illegal action. Server relays the message. */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

export interface GameDefinition<S extends BaseState, A extends BaseAction, V = S> {
  readonly id: string;
  /** Minimum and maximum seats this game supports. */
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** Build the initial authoritative state from a seed and seated players. */
  setup(seed: string, players: readonly PlayerId[]): S;
  /** Pure transition. Returns the next state or throws IllegalActionError. */
  reducer(state: S, action: A): S;
  /** Produce the redacted view a given player may see (hide hidden info). */
  redact(state: S, viewer: PlayerId): V;
}
