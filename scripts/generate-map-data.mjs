/**
 * Generate packages/friedrich/src/map-data.ts from reconciled.json.
 * Also reports graph connectivity — isolated components imply missing roads.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const rec = readJson('docs/assets/extraction/reconciled.json');

// Non-city regions printed on the board (turn track, card boxes) that VASSAL
// models as Main Map regions, plus 'Walderbrot' (unknown margin box, roadless).
const SKIP = new Set(['1', '2', '3', '4', '5', 'fatecards', 'turnreturn', 'walderbrot']);
rec.cities = rec.cities.filter((c) => !SKIP.has(c.id.replace(/[#-]\d+$/, '').replace(/\s/g, '')));
const keep = new Set(rec.cities.map((c) => c.id));
rec.edges = rec.edges.filter((e) => keep.has(e.a) && keep.has(e.b));

// hand-verified road corrections (docs/assets/extraction/road-patches.json)
const patches = readJson('docs/assets/extraction/road-patches.json');
for (const id of patches.removeCities ?? []) {
  rec.cities = rec.cities.filter((c) => c.id !== id);
  keep.delete(id);
  rec.edges = rec.edges.filter((e) => e.a !== id && e.b !== id);
}
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const removed = new Set((patches.removeEdges ?? []).map((e) => edgeKey(e.a, e.b)));
rec.edges = rec.edges.filter((e) => !removed.has(edgeKey(e.a, e.b)));
const existing = new Set(rec.edges.map((e) => edgeKey(e.a, e.b)));
for (const e of patches.addEdges ?? []) {
  if (!keep.has(e.a) || !keep.has(e.b)) {
    console.warn(`PATCH SKIPPED (unknown id): ${e.a} -- ${e.b}`);
    continue;
  }
  if (existing.has(edgeKey(e.a, e.b))) continue;
  rec.edges.push({ a: e.a, b: e.b, main: !!e.main });
  existing.add(edgeKey(e.a, e.b));
}

/**
 * Board tint -> whose home country that ground is (rule 1).
 *
 * "All dark-blue areas (including all exclaves) are the home country of Prussia;
 * all light blue areas are the home country of Hanover" — the board really does
 * use two blues, Prussia #9CD3F1 against Hanover's paler #D3EAF2.
 *
 * "The home country of the Imperial Army is all yellow territories, INCLUDING
 * Sachsen" — so the Reich's yellow (#F6E87E) counts every bit as much as
 * Saxony's gold (#F4DB65), and Hessen's is the same yellow again.
 *
 * The keys are the tints as the transcription spells them, which is why Hanover
 * is `hannover` here: keying it `hanover` silently dropped all 49 of its cities
 * on the floor and left its generals with no home country at all.
 */
const HOME = {
  prussia: 'prussia',
  hannover: 'hanover',
  hre: 'imperial',
  saxony: 'imperial',
  hessen: 'imperial',
  austria: 'austria',
  sweden: 'sweden',
  // poland is nobody's home country; Russia and France have none at all
};

/**
 * Cities the tile transcription left untinted, read straight off the 6000px
 * board instead (the colour sampled beside each one is given).
 */
const HOME_OVERRIDE = {
  emden: 'prussia', // #90CAEF — East Frisia, Prussian since 1744
  stassfurt: 'prussia', // #7EC1DC
  goldberge: 'prussia', // #80CBEA — Silesia
  'schonberg-501': 'austria', // #E8E1CA — Moravia
  'ostrow-607': null, // #F1B89B — Poland: nobody's home
};

const nodes = rec.cities.map((c) => {
  const parts = [
    `id: '${c.id}'`,
    `name: ${JSON.stringify(c.name)}`,
    `suit: '${c.suit}'`,
    `x: ${c.x}`,
    `y: ${c.y}`,
  ];
  if (c.bold) parts.push('setup: true');
  if (c.depot) parts.push('depot: true');
  if (c.objectiveFor) parts.push(`objectiveFor: '${c.objectiveFor}'`);
  if (c.objectiveOrder) parts.push(`objectiveOrder: ${c.objectiveOrder}`);
  const home = c.id in HOME_OVERRIDE ? HOME_OVERRIDE[c.id] : HOME[c.tint];
  if (home) parts.push(`home: '${home}'`);
  // Saxony is the Imperial Army's home country but Friedrich's army is sitting
  // on it, which is why the board gives it its own shade — and why rule 5 says
  // "Prussia is defending occupied Sachsen".
  if (c.tint === 'saxony') parts.push(`occupiedBy: 'prussia'`);
  return `  { ${parts.join(', ')} },`;
});

const edges = rec.edges.map((e) => `  { a: '${e.a}', b: '${e.b}'${e.main ? ', mainRoad: true' : ''} },`);

// connectivity report
const adj = new Map(rec.cities.map((c) => [c.id, []]));
for (const e of rec.edges) {
  adj.get(e.a)?.push(e.b);
  adj.get(e.b)?.push(e.a);
}
const seen = new Set();
const components = [];
for (const c of rec.cities) {
  if (seen.has(c.id)) continue;
  const comp = [];
  const q = [c.id];
  seen.add(c.id);
  while (q.length) {
    const n = q.pop();
    comp.push(n);
    for (const m of adj.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        q.push(m);
      }
    }
  }
  components.push(comp);
}
components.sort((a, b) => b.length - a.length);
console.log(`components: ${components.length} | main: ${components[0].length} of ${rec.cities.length}`);
for (const comp of components.slice(1, 15)) {
  console.log(`  island (${comp.length}): ${comp.slice(0, 8).join(', ')}${comp.length > 8 ? '…' : ''}`);
}
const isolated = components.slice(1).flat();

const stamps = rec.suits
  .map((s) => `  { suit: '${s.suit}', x: ${Math.round(s.x)}, y: ${Math.round(s.y)} },`)
  .join('\n');

// ---- sector boundaries = Voronoi diagram of the 33 suit stamps ----
// Each stamp is the centre of one suit sector, so the sector a city belongs to
// is the nearest stamp (which is also how its suit is assigned in reconcile).
// The Voronoi cell edges are therefore exactly the printed sector-grid lines.
const SITES = rec.suits.map((s) => ({ suit: s.suit, x: s.x, y: s.y }));
const BB = { minx: 70, miny: 70, maxx: 5930, maxy: 3930 };

function clipHalfplane(poly, mx, my, nx, ny) {
  const out = [];
  const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny;
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const sA = side(A), sB = side(B);
    if (sA >= 0) out.push(A);
    if ((sA >= 0) !== (sB >= 0)) {
      const t = sA / (sA - sB);
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
    }
  }
  return out;
}

function voronoiCell(site) {
  let poly = [
    [BB.minx, BB.miny], [BB.maxx, BB.miny], [BB.maxx, BB.maxy], [BB.minx, BB.maxy],
  ];
  for (const o of SITES) {
    if (o === site) continue;
    poly = clipHalfplane(poly, (site.x + o.x) / 2, (site.y + o.y) / 2, site.x - o.x, site.y - o.y);
    if (poly.length === 0) break;
  }
  return poly;
}

// collect deduped interior edges (skip segments lying on the map border)
const onBorder = (x1, y1, x2, y2) =>
  (x1 <= BB.minx + 1 && x2 <= BB.minx + 1) || (x1 >= BB.maxx - 1 && x2 >= BB.maxx - 1) ||
  (y1 <= BB.miny + 1 && y2 <= BB.miny + 1) || (y1 >= BB.maxy - 1 && y2 >= BB.maxy - 1);
const segMap = new Map();
for (const site of SITES) {
  const poly = voronoiCell(site);
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const x1 = Math.round(A[0]), y1 = Math.round(A[1]), x2 = Math.round(B[0]), y2 = Math.round(B[1]);
    if (x1 === x2 && y1 === y2) continue;
    if (onBorder(x1, y1, x2, y2)) continue;
    const key = x1 < x2 || (x1 === x2 && y1 <= y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
    segMap.set(key, { x1, y1, x2, y2 });
  }
}
const sectorLines = [...segMap.values()]
  .map((s) => `  { x1: ${s.x1}, y1: ${s.y1}, x2: ${s.x2}, y2: ${s.y2} },`)
  .join('\n');
console.log(`sector stamps: ${SITES.length} | boundary segments: ${segMap.size}`);

const ts = `/**
 * AUTHENTIC Friedrich Anniversary Edition map — GENERATED, do not hand-edit.
 * Source: VASSAL module city coordinates (680 regions, 6000x4000 board space)
 * + road graph transcribed from the board scan by a 24-tile vision fleet
 * + authoritative objective lists (official playing aid / army sheet).
 * Regenerate: node scripts/generate-map-data.mjs (after re-running the
 * merge/reconcile pipeline). See docs/friedrich-rules.md for provenance.
 *
 * Draft caveats: suits assigned by nearest sector stamp (boundary cities may be
 * off until the sector-rectangle pass); road graph ~95% complete (long-edge
 * review + island reconnection pending); 'home' derived from scan tints.
 */

import { buildMap, type MapNode, type MapEdge, type Suit } from '@friedrich/engine';

export const NODES: readonly MapNode[] = [
${nodes.join('\n')}
];

export const EDGES: readonly MapEdge[] = [
${edges.join('\n')}
];

/** The 33 sector suit stamps (rendered faded like the printed board). Each is
 * the centre of one suit sector; a city's suit is its nearest stamp. */
export const SUIT_STAMPS: readonly { suit: Suit; x: number; y: number }[] = [
${stamps}
];

/** Sector boundary lines = Voronoi edges of the 33 stamps (the printed grid). */
export const SECTOR_LINES: readonly { x1: number; y1: number; x2: number; y2: number }[] = [
${sectorLines}
];

export const friedrichMap = buildMap(NODES, EDGES);
`;

writeFileSync('packages/friedrich/src/map-data.ts', ts);
console.log(`wrote ${rec.cities.length} nodes, ${rec.edges.length} edges | isolated cities: ${isolated.length}`);
