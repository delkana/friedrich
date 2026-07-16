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
  { id: 'fermor', nation: 'russia', rank: 2, node: 'konigsberg', troops: 6 },
  { id: 'richelieu', nation: 'france', rank: 1, node: 'iserlohn', troops: 6 },
  { id: 'soubise', nation: 'france', rank: 2, node: 'fulda', troops: 5 },
];

export const MAX_STACK = 3;
