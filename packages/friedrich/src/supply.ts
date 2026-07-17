/**
 * Supply and attrition. A general is in supply if it stands in its own home
 * country, or can trace a line of at most six cities — through friendly-or-empty
 * cities only, never through a hostile piece — to one of its nation's supply
 * trains. Attrition is binary and checked in each nation's own supply phase: a
 * newly cut-off general is flipped face-down; if it is still cut off at its next
 * supply phase it loses everything and is removed. Merging with a face-down
 * general drags a face-up one down too.
 */

import { friedrichMap } from './map-data.js';
import { sideOf, SUPPLY_RANGE, DEPOT_CITIES, ALL_GENERALS, type Piece, type Train } from './pieces.js';
import type { Nation } from './powers.js';
import type { FriedrichState } from './state.js';

/** The general's real name for the log — never his internal id. */
const name = (id: string): string => ALL_GENERALS.find((g) => g.id === id)?.name ?? id;

/** Cities a general may not trace supply through: those holding a hostile piece. */
function hostileNodes(state: FriedrichState, side: 'attacker' | 'defender'): Set<string> {
  const blocked = new Set<string>();
  for (const p of Object.values(state.pieces)) if (sideOf(p.nation) !== side) blocked.add(p.node);
  for (const t of Object.values(state.trains)) if (sideOf(t.nation) !== side) blocked.add(t.node);
  return blocked;
}

/** Is `general` currently in supply? */
export function inSupply(state: FriedrichState, general: Piece): boolean {
  const here = friedrichMap.nodes.get(general.node);
  if (here?.home === general.nation) return true; // home country is always in supply
  // "Russia and France have no home country, but their generals are in supply if
  // occupying their depot cities." (rule 9)
  if (DEPOT_CITIES[general.nation].includes(general.node)) return true;

  const myTrains = new Set(
    Object.values(state.trains).filter((t: Train) => t.nation === general.nation).map((t) => t.node),
  );
  if (myTrains.size === 0) return false;
  if (myTrains.has(general.node)) return true; // standing on own train

  // BFS ≤ SUPPLY_RANGE cities, never entering a hostile city, seeking a train
  const blocked = hostileNodes(state, sideOf(general.nation));
  const seen = new Set<string>([general.node]);
  let frontier = [general.node];
  for (let dist = 0; dist < SUPPLY_RANGE && frontier.length; dist++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const nbr of friedrichMap.adjacency.get(node) ?? []) {
        if (seen.has(nbr) || blocked.has(nbr)) continue;
        if (myTrains.has(nbr)) return true;
        seen.add(nbr);
        next.push(nbr);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * Run a nation's supply phase, returning the updated pieces map and log lines.
 * Recovers, cuts off, or annihilates each of the nation's generals.
 */
export function runSupplyPhase(
  state: FriedrichState,
  nation: Nation,
): { pieces: Record<string, Piece>; log: string[]; removed: Piece[] } {
  const mine = Object.values(state.pieces).filter((p) => p.nation === nation);
  // stacking hazard: any node holding a face-down general drags its stackmates down
  const faceDownNodes = new Set(mine.filter((p) => !p.faceUp).map((p) => p.node));

  const pieces: Record<string, Piece> = { ...state.pieces };
  const log: string[] = [];
  const removed: Piece[] = [];
  for (const g of mine) {
    const supplied = inSupply(state, g);
    const effectivelyDown = !g.faceUp || faceDownNodes.has(g.node);
    if (supplied) {
      if (!g.faceUp) {
        pieces[g.id] = { ...g, faceUp: true };
        log.push(`${name(g.id)} regains supply.`);
      }
    } else if (effectivelyDown) {
      delete pieces[g.id];
      removed.push(g);
      log.push(`${name(g.id)} has starved out of supply and is destroyed.`);
    } else {
      pieces[g.id] = { ...g, faceUp: false };
      log.push(`${name(g.id)} is cut off from supply!`);
    }
  }
  return { pieces, log, removed };
}
