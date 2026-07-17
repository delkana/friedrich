/**
 * The 33 printed sectors. "A rectangular grid divides the map into 33 sectors.
 * Each sector is marked with a suit" — and each stamp we extracted sits at the
 * centre of one, so a city's sector is simply its nearest stamp (which is how
 * its suit is assigned in the first place).
 *
 * Sectors matter for two rules: which Tactical Cards a general may play, and
 * where a nation may re-enter pieces when all its depots are blocked (rule 10).
 */

import type { Suit, MapNode } from '@friedrich/engine';
import { SUIT_STAMPS, friedrichMap } from './map-data.js';

/** Index of the sector a point falls in (its nearest suit stamp). */
export function sectorAt(x: number, y: number): number {
  let best = 0;
  let bestDist = Infinity;
  SUIT_STAMPS.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export const sectorOf = (node: MapNode): number => sectorAt(node.x, node.y);

/** The sector containing a named city — e.g. "the Berlin spades sector". */
export function sectorOfCity(id: string): number {
  const node = friedrichMap.nodes.get(id);
  if (!node) throw new Error(`unknown city: ${id}`);
  return sectorOf(node);
}

/**
 * "the spades sector south of Hildburghausen", "the hearts sector south of
 * Koblenz" — the nearest sector of that suit whose centre lies south of the
 * named city (the board's y grows southwards).
 */
export function sectorSouthOf(id: string, suit: Suit): number {
  const from = friedrichMap.nodes.get(id);
  if (!from) throw new Error(`unknown city: ${id}`);
  let best = -1;
  let bestDist = Infinity;
  SUIT_STAMPS.forEach((s, i) => {
    if (s.suit !== suit || s.y <= from.y) return;
    const d = Math.hypot(s.x - from.x, s.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  if (best < 0) throw new Error(`no ${suit} sector south of ${id}`);
  return best;
}

/** Every city in a sector. */
export function citiesInSector(sector: number): string[] {
  const out: string[] = [];
  for (const node of friedrichMap.nodes.values()) if (sectorOf(node) === sector) out.push(node.id);
  return out;
}
