/**
 * Movement reachability on the map graph, shared by Friedrich and Maria.
 *
 * Rules modeled here:
 *  - A general moves up to `maxSteps` cities (default 3), or `maxStepsMainRoad`
 *    (default 4) if EVERY step of the path runs along a main road.
 *  - No piece may jump over another: the path may not pass THROUGH an occupied
 *    city. A move may still END on an occupied city (the caller decides whether
 *    that stop is legal — joining a friendly stack vs. blocked by an enemy).
 *
 * `reachableNodes` returns every node reachable as a destination together with
 * the fewest steps to get there. The start node is excluded from the result.
 */

import { type MapGraph, type NodeId, edgeBetween } from './map.js';

export interface ReachOptions {
  readonly maxSteps?: number;
  readonly maxStepsMainRoad?: number;
}

export function reachableNodes(
  graph: MapGraph,
  from: NodeId,
  occupied: ReadonlySet<NodeId>,
  opts: ReachOptions = {},
): Map<NodeId, number> {
  const maxSteps = opts.maxSteps ?? 3;
  const maxStepsMainRoad = opts.maxStepsMainRoad ?? 4;
  const ceiling = Math.max(maxSteps, maxStepsMainRoad);

  const result = new Map<NodeId, number>();
  // Explore states (node, allMainRoad-so-far); a longer all-main path can reach
  // further than a mixed path, so we key visited by that flag too.
  const best = new Map<string, number>();
  const stack: Array<{ node: NodeId; steps: number; allMain: boolean }> = [
    { node: from, steps: 0, allMain: true },
  ];

  while (stack.length) {
    const cur = stack.pop()!;
    // Cannot pass through an occupied city (but the start is where we begin).
    if (cur.node !== from && occupied.has(cur.node)) continue;
    if (cur.steps >= ceiling) continue;

    for (const next of graph.adjacency.get(cur.node) ?? []) {
      const edge = edgeBetween(graph, cur.node, next);
      const allMain = cur.allMain && !!edge?.mainRoad;
      const limit = allMain ? maxStepsMainRoad : maxSteps;
      const steps = cur.steps + 1;
      if (steps > limit) continue;

      const key = `${next}|${allMain ? 1 : 0}`;
      if ((best.get(key) ?? Infinity) <= steps) continue;
      best.set(key, steps);

      const prev = result.get(next);
      if (prev === undefined || steps < prev) result.set(next, steps);

      stack.push({ node: next, steps, allMain });
    }
  }

  result.delete(from);
  return result;
}

/**
 * Every legal route from `from` to `to`, under the same rules as
 * `reachableNodes`. Each path starts at `from` and ends at `to`.
 *
 * Which cities a general passes THROUGH can matter as much as where he stops —
 * in Friedrich he conquers objectives by moving over them — and a destination
 * three cities off is often reachable more than one way. Paths are short (four
 * steps at the very most) on a road net where a city has a handful of
 * neighbours, so listing them outright is cheap and exact.
 */
export function pathsBetween(
  graph: MapGraph,
  from: NodeId,
  to: NodeId,
  occupied: ReadonlySet<NodeId>,
  opts: ReachOptions = {},
): NodeId[][] {
  const maxSteps = opts.maxSteps ?? 3;
  const maxStepsMainRoad = opts.maxStepsMainRoad ?? 4;
  const out: NodeId[][] = [];
  const path: NodeId[] = [from];
  const seen = new Set<NodeId>([from]);

  const walk = (node: NodeId, steps: number, allMain: boolean): void => {
    if (node === to) {
      out.push([...path]);
      return; // a route that goes on past its destination is a different move
    }
    if (steps >= (allMain ? maxStepsMainRoad : maxSteps)) return;
    for (const next of graph.adjacency.get(node) ?? []) {
      if (seen.has(next)) continue;
      // may not pass through a piece; stopping on one is the caller's business
      if (occupied.has(next) && next !== to) continue;
      const edge = edgeBetween(graph, node, next);
      const main = allMain && !!edge?.mainRoad;
      if (steps + 1 > (main ? maxStepsMainRoad : maxSteps)) continue;
      seen.add(next);
      path.push(next);
      walk(next, steps + 1, main);
      path.pop();
      seen.delete(next);
    }
  };
  walk(from, 0, true);
  return out;
}
