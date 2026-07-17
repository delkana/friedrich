/**
 * Retreat (rulebook rule 8).
 *
 * "The length of the retreat is the same as the number of troops lost. During a
 * retreat a stack may never split up. The winning player chooses the retreat
 * path, according to the following conditions:
 *  - The general must retreat the full distance and has to finish his retreat as
 *    far away as possible from the winning general (only the winning general
 *    matters).
 *  - A retreating general may never enter a city a second time.
 *  - A retreating general may not enter or move through a city containing any
 *    other piece (enemy or friendly); not even to eliminate a supply train nor to
 *    stack with a friendly general. A general can retreat through an objective
 *    city, but cannot (re-)conquer it.
 * If a general cannot retreat the full distance, he loses all his troops and is
 * removed from the map."
 *
 * So a legal retreat is a path of EXACTLY `distance` steps that never repeats a
 * city and never touches an occupied one. Because the path itself has no lasting
 * effect — nothing is captured or conquered along the way — only where it ends
 * matters, and the ending is forced to be maximally far from the winner. The
 * winner's choice therefore bites only when several destinations tie.
 */

import { hopDistance } from '@friedrich/engine';
import { friedrichMap } from './map-data.js';
import type { Piece, Train } from './pieces.js';

/**
 * Enumerating fixed-length simple paths is exponential in the worst case, so the
 * search is bounded. Real retreats are short (distance = troops lost, and a
 * general holds at most 8), where this is never approached.
 */
const SEARCH_BUDGET = 400_000;

/**
 * Every city the retreating stack could legally end on, already narrowed to
 * those as far from the winner as the rules demand. Empty if it cannot retreat
 * the full distance — in which case the stack is destroyed.
 *
 * `from` is the loser's city; its own pieces are ignored (they are the ones
 * moving), everything else on the board blocks.
 */
export function retreatOptions(
  pieces: Readonly<Record<string, Piece>>,
  trains: Readonly<Record<string, Train>>,
  from: string,
  winnerNode: string,
  distance: number,
): string[] {
  if (distance <= 0) return [];

  const blocked = new Set<string>();
  for (const p of Object.values(pieces)) blocked.add(p.node);
  for (const t of Object.values(trains)) blocked.add(t.node);
  blocked.delete(from); // the retreating stack itself does not block its own exit

  const endpoints = new Set<string>();
  const visited = new Set<string>([from]);
  let budget = SEARCH_BUDGET;

  const walk = (node: string, depth: number): void => {
    if (budget-- <= 0) return;
    if (depth === distance) {
      endpoints.add(node);
      return;
    }
    for (const next of friedrichMap.adjacency.get(node) ?? []) {
      if (visited.has(next) || blocked.has(next)) continue;
      visited.add(next);
      walk(next, depth + 1);
      visited.delete(next);
    }
  };
  walk(from, 0);
  if (endpoints.size === 0) return [];

  // "has to finish his retreat as far away as possible from the winning general"
  let furthest = -1;
  const away = new Map<string, number>();
  for (const node of endpoints) {
    const d = hopDistance(friedrichMap, node, winnerNode);
    away.set(node, d);
    if (d > furthest) furthest = d;
  }
  return [...endpoints].filter((n) => away.get(n) === furthest).sort();
}
