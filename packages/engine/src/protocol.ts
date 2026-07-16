/**
 * Wire protocol between client and the authoritative server. Kept in the engine
 * package so both sides share one source of truth. JSON over WebSocket.
 */

import type { BaseAction, PlayerId } from './core.js';

/** Messages sent client -> server. */
export type ClientMessage =
  | { readonly t: 'join'; readonly room: string; readonly name: string }
  | { readonly t: 'action'; readonly action: BaseAction };

/** Messages sent server -> client. */
export type ServerMessage =
  | { readonly t: 'joined'; readonly room: string; readonly playerId: PlayerId; readonly seat: number }
  | { readonly t: 'state'; readonly version: number; readonly view: unknown }
  | { readonly t: 'players'; readonly players: readonly RoomPlayer[] }
  | { readonly t: 'error'; readonly message: string };

export interface RoomPlayer {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly seat: number;
  readonly connected: boolean;
}

export const DEFAULT_PORT = 8787;
