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
 *
 * Enumerating every such path is hopeless: the retreat distance is the number of
 * troops lost, so a big stack can be driven back 20+ cities, by which point most
 * of the map is reachable and the path count explodes (~6.5× per extra two
 * cities).
 *
 * We never enumerate. Only the *farthest* destinations can win, so we rank the
 * candidate cities by distance from the winner and ask a decision question —
 * "is there an exact-length path to this one?" — starting with the best band and
 * stopping at the first band that answers yes.
 *
 * That is fast for a structural reason, not a lucky one: the winner is always
 * adjacent to the loser (they just fought), so a city far from the winner is
 * necessarily far from where the retreat starts, which leaves the walk almost no
 * slack to wander with — and it is slack that makes the search branch. The
 * bands that matter are therefore the cheapest ones to decide. Measured over the
 * real board this is ~10-20ms even for a 31-city retreat, the worst a legal
 * position can produce (a 3-general stack cannot hold more than Prussia's whole
 * 32-troop establishment, and a stack that loses all its troops is destroyed
 * rather than retreated). The map's diameter is 43+, comfortably more, so the
 * slack never gets large enough to bite.
 */

import { hopDistance } from '@friedrich/engine';
import { friedrichMap } from './map-data.js';
import type { Piece, Train } from './pieces.js';

/** Cities the retreating stack may pass through or stop on. */
function openCities(
  pieces: Readonly<Record<string, Piece>>,
  trains: Readonly<Record<string, Train>>,
  from: string,
): Set<string> {
  const blocked = new Set<string>();
  for (const p of Object.values(pieces)) blocked.add(p.node);
  for (const t of Object.values(trains)) blocked.add(t.node);
  blocked.delete(from); // the retreating stack does not block its own exit
  return blocked;
}

/** Hops from `origin` to every city reachable without passing a piece. */
function distancesFrom(origin: string, blocked: ReadonlySet<string>, limit = Infinity): Map<string, number> {
  const dist = new Map<string, number>([[origin, 0]]);
  let frontier = [origin];
  for (let d = 1; d <= limit && frontier.length; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const nbr of friedrichMap.adjacency.get(node) ?? []) {
        if (dist.has(nbr) || blocked.has(nbr)) continue;
        dist.set(nbr, d);
        next.push(nbr);
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Two-colour the open region around `from`. If it is bipartite, every path
 * between two cities has a fixed parity, so an exact-length path to a city of
 * the wrong parity is impossible however much room there is — the one case where
 * a search could otherwise thrash without finding anything.
 */
function parityClasses(from: string, blocked: ReadonlySet<string>): Map<string, number> | null {
  const colour = new Map<string, number>([[from, 0]]);
  const queue = [from];
  let bipartite = true;
  while (queue.length) {
    const node = queue.shift()!;
    for (const nbr of friedrichMap.adjacency.get(node) ?? []) {
      if (blocked.has(nbr)) continue;
      if (!colour.has(nbr)) {
        colour.set(nbr, colour.get(node)! ^ 1);
        queue.push(nbr);
      } else if (colour.get(nbr) === colour.get(node)) {
        bipartite = false; // an odd cycle: any amount of slack can be absorbed
      }
    }
  }
  return bipartite ? colour : null;
}

/** Is there a simple path of exactly `length` steps from `from` to `to`? */
function existsPathOfLength(
  from: string,
  to: string,
  length: number,
  blocked: ReadonlySet<string>,
  toDist: Map<string, number>,
): boolean {
  const visited = new Set<string>([from]);
  const walk = (node: string, remaining: number): boolean => {
    if (remaining === 0) return node === to;
    // cannot possibly still get there: the shortest way is already too long
    const left = toDist.get(node);
    if (left === undefined || left > remaining) return false;
    for (const next of friedrichMap.adjacency.get(node) ?? []) {
      if (visited.has(next) || blocked.has(next)) continue;
      visited.add(next);
      if (walk(next, remaining - 1)) return true; // one path is enough
      visited.delete(next);
    }
    return false;
  };
  return walk(from, length);
}

/**
 * Every city the retreating stack could legally end on, already narrowed to
 * those as far from the winner as the rules demand. Empty if it cannot retreat
 * the full distance — in which case the stack is destroyed.
 */
export function retreatOptions(
  pieces: Readonly<Record<string, Piece>>,
  trains: Readonly<Record<string, Train>>,
  from: string,
  winnerNode: string,
  distance: number,
): string[] {
  if (distance <= 0) return [];
  const blocked = openCities(pieces, trains, from);

  // a retreat of N cities needs N+1 distinct ones: too small a pocket is fatal
  const reachable = distancesFrom(from, blocked);
  if (reachable.size <= distance) return [];

  const colour = parityClasses(from, blocked);
  const fromColour = colour?.get(from);

  // only cities within N hops can end an N-step path; rank them by the rule's
  // tie-break — furthest from the winning general first
  const candidates = [...reachable.keys()]
    .filter((n) => n !== from && reachable.get(n)! <= distance)
    .map((n) => ({ node: n, away: hopDistance(friedrichMap, n, winnerNode) }))
    .sort((a, b) => b.away - a.away || (a.node < b.node ? -1 : 1));

  // walk down the distance bands; the first band with a legal retreat is the answer
  for (let i = 0; i < candidates.length; ) {
    const away = candidates[i]!.away;
    const band: string[] = [];
    while (i < candidates.length && candidates[i]!.away === away) band.push(candidates[i++]!.node);

    const legal = band.filter((to) => {
      // in a bipartite pocket the parity is fixed, so this is decided outright
      if (colour && ((colour.get(to)! ^ fromColour!) & 1) !== (distance & 1)) return false;
      return existsPathOfLength(from, to, distance, blocked, distancesFrom(to, blocked));
    });
    if (legal.length) return legal.sort();
  }
  return [];
}
