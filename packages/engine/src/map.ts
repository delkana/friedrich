/**
 * Generic map-graph model. Both games move pieces dot-to-dot along lines across
 * a board partitioned into suited regions. The concrete node/edge data for
 * Friedrich (and later Maria) is provided by the game package; this file only
 * defines the shared shape and lookup helpers.
 */

import type { Suit } from './cards.js';

export type NodeId = string;

export interface MapNode {
  readonly id: NodeId;
  /** Display / historical name of the town or crossing. */
  readonly name: string;
  /** Region suit used to resolve battles fought at this node. */
  readonly suit: Suit;
  /** True if this is a fortress/objective town (capture matters for victory). */
  readonly fortress?: boolean;
  /** Nation id whose home country this node lies in (always in supply there). */
  readonly home?: string;
  /**
   * Nation defending this node's objectives despite it not being their home —
   * ground somebody else's army sits on. Friedrich's board draws such a region
   * in its own shade, and rule 5 gives the reason: "Prussia is defending
   * occupied Sachsen (Saxony)."
   */
  readonly occupiedBy?: string;
  /** Nation id this node is a victory objective for. */
  readonly objectiveFor?: string;
  /** 1 = first-order objective, 2 = second-order. */
  readonly objectiveOrder?: 1 | 2;
  /** True if pieces may set up here at game start (bold on the board). */
  readonly setup?: boolean;
  /** True if this is a printed depot city (starburst on the board). */
  readonly depot?: boolean;
  /** Nations that may use this node as a supply depot (re-entry / supply source). */
  readonly depotFor?: readonly string[];
  /** 2D position for rendering (abstract board coordinates). */
  readonly x: number;
  readonly y: number;
}

export interface MapEdge {
  readonly a: NodeId;
  readonly b: NodeId;
  /** Optional terrain flag affecting movement (e.g. river crossing). */
  readonly river?: boolean;
  /** Main roads grant a movement bonus (a general reaches 4 cities, not 3). */
  readonly mainRoad?: boolean;
}

export interface MapGraph {
  readonly nodes: ReadonlyMap<NodeId, MapNode>;
  /** Adjacency: node id → set of directly connected node ids. */
  readonly adjacency: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  readonly edges: readonly MapEdge[];
  /** Undirected edge lookup keyed by `min|max` node ids. */
  readonly edgeIndex: ReadonlyMap<string, MapEdge>;
}

const edgeKey = (a: NodeId, b: NodeId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Build an indexed, adjacency-backed graph from flat node/edge lists. */
export function buildMap(nodes: readonly MapNode[], edges: readonly MapEdge[]): MapGraph {
  const nodeMap = new Map<NodeId, MapNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const adjacency = new Map<NodeId, Set<NodeId>>();
  for (const n of nodes) adjacency.set(n.id, new Set());
  const edgeIndex = new Map<string, MapEdge>();
  for (const e of edges) {
    if (!nodeMap.has(e.a) || !nodeMap.has(e.b)) {
      throw new Error(`Edge references unknown node: ${e.a} <-> ${e.b}`);
    }
    adjacency.get(e.a)!.add(e.b);
    adjacency.get(e.b)!.add(e.a);
    edgeIndex.set(edgeKey(e.a, e.b), e);
  }

  return { nodes: nodeMap, adjacency, edges, edgeIndex };
}

export function neighbors(graph: MapGraph, id: NodeId): ReadonlySet<NodeId> {
  return graph.adjacency.get(id) ?? new Set();
}

export function areAdjacent(graph: MapGraph, a: NodeId, b: NodeId): boolean {
  return graph.adjacency.get(a)?.has(b) ?? false;
}

export function edgeBetween(graph: MapGraph, a: NodeId, b: NodeId): MapEdge | undefined {
  return graph.edgeIndex.get(edgeKey(a, b));
}

/** Shortest-path hop count between two nodes (ignores pieces), or Infinity. */
export function hopDistance(graph: MapGraph, from: NodeId, to: NodeId): number {
  if (from === to) return 0;
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let dist = 0;
  while (frontier.length) {
    dist++;
    const next: NodeId[] = [];
    for (const n of frontier) {
      for (const m of graph.adjacency.get(n) ?? []) {
        if (seen.has(m)) continue;
        if (m === to) return dist;
        seen.add(m);
        next.push(m);
      }
    }
    frontier = next;
  }
  return Infinity;
}
