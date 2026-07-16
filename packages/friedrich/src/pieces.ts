/**
 * Generals on the board. Each general has a secret troop count (1..8) and a
 * RANK (lower = higher command; used for stacking order and casualty removal —
 * NOT combat strength). Supply trains are modeled later.
 */

import type { NodeId } from '@friedrich/engine';
import type { Nation } from './powers.js';

export interface Piece {
  readonly id: string;
  readonly nation: Nation;
  /** Command rank: 1 is the supreme commander; higher numbers are removed first. */
  readonly rank: number;
  readonly node: NodeId;
  /** Secret troop strength, 1..8. */
  readonly troops: number;
  /** Face-down = currently out of supply (still acts; see supply rules later). */
  readonly faceUp: boolean;
}

/** Prussia + Hanover defend; everyone else attacks. Attackers never fight each other. */
export function sideOf(nation: Nation): 'defender' | 'attacker' {
  return nation === 'prussia' || nation === 'hanover' ? 'defender' : 'attacker';
}

export function areEnemies(a: Nation, b: Nation): boolean {
  return sideOf(a) !== sideOf(b);
}

/**
 * Starting positions on the authentic map. Named starts follow the official
 * army sheet (Daun at Brünn, Laudon at Olmütz, Ferdinand at Stade, Soubise at
 * Fulda…); sector-coded Prussian/Russian starts are approximated to sensible
 * cities pending the full 24-general setup. Troop counts are demo values — real
 * setup lets players secretly allot troops.
 */
export const INITIAL_PIECES: readonly Omit<Piece, 'faceUp'>[] = [
  { id: 'friedrich', nation: 'prussia', rank: 1, node: 'berlin', troops: 8 },
  { id: 'heinrich', nation: 'prussia', rank: 3, node: 'leipzig', troops: 5 },
  { id: 'keith', nation: 'prussia', rank: 5, node: 'dresden', troops: 4 },
  { id: 'ferdinand', nation: 'hanover', rank: 1, node: 'stade', troops: 4 },
  { id: 'daun', nation: 'austria', rank: 1, node: 'brunn', troops: 8 },
  { id: 'browne', nation: 'austria', rank: 2, node: 'melnik', troops: 6 },
  { id: 'laudon', nation: 'austria', rank: 4, node: 'olmutz', troops: 5 },
  { id: 'fermor', nation: 'russia', rank: 2, node: 'warszawa', troops: 6 },
  { id: 'richelieu', nation: 'france', rank: 1, node: 'iserlohn', troops: 6 },
  { id: 'soubise', nation: 'france', rank: 2, node: 'fulda', troops: 5 },
];

export const MAX_STACK = 3;

/**
 * A supply train (wooden cube on the board). Cannot fight or hold objectives;
 * it is the mobile supply source that keeps a nation's generals in supply within
 * six cities. Captured (removed) when an enemy general enters its city.
 */
export interface Train {
  readonly id: string;
  readonly nation: Nation;
  readonly node: NodeId;
}

/** Supply trains at their historical start cities (per the army sheet). */
export const INITIAL_TRAINS: readonly Train[] = [
  { id: 'sup-prussia-1', nation: 'prussia', node: 'juterbog' },
  { id: 'sup-prussia-2', nation: 'prussia', node: 'grunberg' },
  { id: 'sup-hanover-1', nation: 'hanover', node: 'hannover' },
  { id: 'sup-russia-1', nation: 'russia', node: 'torun' },
  { id: 'sup-russia-2', nation: 'russia', node: 'warszawa' },
  { id: 'sup-sweden-1', nation: 'sweden', node: 'wismar' },
  { id: 'sup-austria-1', nation: 'austria', node: 'beraun' },
  { id: 'sup-austria-2', nation: 'austria', node: 'pardubitz' },
  { id: 'sup-imperial-1', nation: 'imperial', node: 'erlangen' },
  { id: 'sup-france-1', nation: 'france', node: 'koblenz' },
  { id: 'sup-france-2', nation: 'france', node: 'gemunden' },
];

/** How far a supply line can be traced (in cities). */
export const SUPPLY_RANGE = 6;
/** Movement allowance for a supply train (cities); +1 entirely on main roads. */
export const TRAIN_MOVE = 2;
export const TRAIN_MOVE_MAIN = 3;
