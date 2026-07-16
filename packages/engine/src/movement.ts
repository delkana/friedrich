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
