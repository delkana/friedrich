/**
 * Generate the coastline and the home-country borders → packages/friedrich/src/geography.ts
 *
 * Two features, two sources, on purpose:
 *
 *  - THE COAST exists only on the printed board — no city data implies where the
 *    water is — so it is read off the scan. The sea is not blue: it is the same
 *    cream as the parchment margin, so "sea" is found by colour and then by
 *    connectivity (the big cream regions that reach the edge of the sheet). That
 *    connectivity step is what keeps the cream city circles, which are dotted all
 *    over the land, from punching holes in it.
 *
 *  - THE BORDERS come from `node.home` in the map data, NOT from the printed
 *    line. That is the whole point: supply asks "is this generalÂ in his home
 *    country?", and it answers with node.home. A border traced off the scan could
 *    disagree with that, and then the map would be lying about the rule. Each
 *    nation's territory is the region of the board nearer to one of its home
 *    cities than to anyone else's, clipped to dry land.
 *
 * Prereqs: docs/assets/vassal/board-6000x4000.png (gitignored — see the rules
 * doc for provenance) and `powershell ./scripts/dump-board.ps1` for the pixels.
 *
 * Usage: node scripts/extract-geography.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const GRID = 'docs/assets/extraction/board-grid';
const OUT = 'packages/friedrich/src/geography.ts';

// ---- the board's pixels --------------------------------------------------

const meta = JSON.parse(readFileSync(`${GRID}.json`, 'utf8').replace(/^﻿/, ''));
const buf = readFileSync(`${GRID}.bin`);
const { width: W, height: H, stride, boardWidth: BW, boardHeight: BH } = meta;
const SCALE = BW / W; // board units per grid cell

/** System.Drawing hands back 24bpp BGR, rows top-down (verified against the scan). */
const rgb = (x, y) => {
  const o = y * stride + x * 3;
  return [buf[o + 2], buf[o + 1], buf[o]];
};

/**
 * The parchment cream of the sea and the margin. Austria's territory is a near
 * white (237,227,200) and must stay OUT of this, which is why the red channel
 * has to clear 244 rather than something looser.
 */
const isCream = (r, g, b) => r >= 244 && g >= 232 && b >= 180 && b < g && g < r;

const idx = (x, y) => y * W + x;

// ---- water: the cream that reaches the edge of the sheet ------------------

const cream = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isCream(...rgb(x, y))) cream[idx(x, y)] = 1;

/** Flood every cream region; the ones touching the sheet edge are sea or margin. */
const water = new Uint8Array(W * H);
{
  const seen = new Uint8Array(W * H);
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    if (!cream[idx(sx, sy)] || seen[idx(sx, sy)]) continue;
    const cells = [];
    const stack = [[sx, sy]];
    seen[idx(sx, sy)] = 1;
    let touchesEdge = false;
    while (stack.length) {
      const [x, y] = stack.pop();
      cells.push(idx(x, y));
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!cream[idx(nx, ny)] || seen[idx(nx, ny)]) continue;
        seen[idx(nx, ny)] = 1;
        stack.push([nx, ny]);
      }
    }
    // a city's cream disc is a few dozen cells and lands nowhere near the edge
    if (touchesEdge || cells.length > 1500) for (const c of cells) water[c] = 1;
  }
}
const rawLand = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) rawLand[i] = water[i] ? 0 : 1;

/**
 * Keep only real ground. Everything printed ON the sea — the FRIEDRICH title,
 * the 1756 box, the hourglass — is ink on cream, so it comes through as "not
 * water" and would otherwise be traced as a little island with its own
 * coastline. Central Europe is one enormous connected blob; the decorations are
 * not.
 */
const land = new Uint8Array(W * H);
{
  const seen = new Uint8Array(W * H);
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    if (!rawLand[idx(sx, sy)] || seen[idx(sx, sy)]) continue;
    const cells = [];
    const stack = [[sx, sy]];
    seen[idx(sx, sy)] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      cells.push(idx(x, y));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!rawLand[idx(nx, ny)] || seen[idx(nx, ny)]) continue;
        seen[idx(nx, ny)] = 1;
        stack.push([nx, ny]);
      }
    }
    if (cells.length > W * H * 0.01) for (const c of cells) land[c] = 1;
  }
}

// ---- check it against the cities before trusting it ----------------------

const src = readFileSync('packages/friedrich/src/map-data.ts', 'utf8');
const cities = [...src.matchAll(/\{ id: '([^']+)', name: "[^"]*", suit: '[^']+', x: (\d+), y: (\d+)([^}]*)\}/g)].map((m) => ({
  id: m[1],
  x: Number(m[2]),
  y: Number(m[3]),
  home: /home: '([a-z]+)'/.exec(m[4])?.[1] ?? null,
  occupiedBy: /occupiedBy: '([a-z]+)'/.exec(m[4])?.[1] ?? null,
}));
if (cities.length < 600) throw new Error(`only parsed ${cities.length} cities from map-data.ts`);

const gx = (bx) => Math.min(W - 1, Math.max(0, Math.round(bx / SCALE)));
const gy = (by) => Math.min(H - 1, Math.max(0, Math.round(by / SCALE)));
const wet = cities.filter((c) => !land[idx(gx(c.x), gy(c.y))]);
console.log(`cities: ${cities.length} | on water after classification: ${wet.length}`);
if (wet.length) console.log('  ' + wet.slice(0, 12).map((c) => c.id).join(', '));

// ---- contours: marching squares over a binary mask -----------------------

/** Segments around the true-region of `mask`, at cell resolution. */
function marchingSquares(mask) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[idx(x, y)]);
  const segs = [];
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const T = [x + 0.5, y], R = [x + 1, y + 0.5], B = [x + 0.5, y + 1], L = [x, y + 0.5];
      const push = (a, b) => segs.push([a, b]);
      switch (c) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(T, R); break;
        case 6: case 9: push(T, B); break;
        case 7: case 8: push(L, T); break;
        case 5: push(L, T); push(B, R); break;
        case 10: push(L, B); push(T, R); break;
      }
    }
  }
  return segs;
}

/** Chain segments end-to-end into polylines. */
function chain(segs) {
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const ends = new Map();
  for (const s of segs) {
    for (const p of [s[0], s[1]]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(s);
    }
  }
  const used = new Set();
  const lines = [];
  for (const seed of segs) {
    if (used.has(seed)) continue;
    used.add(seed);
    const line = [seed[0], seed[1]];
    // walk forward, then backward
    for (const dir of [0, 1]) {
      for (;;) {
        const tip = dir === 0 ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip)) ?? []).find((s) => !used.has(s));
        if (!next) break;
        used.add(next);
        const other = key(next[0]) === key(tip) ? next[1] : next[0];
        if (dir === 0) line.push(other); else line.unshift(other);
      }
    }
    if (line.length > 2) lines.push(line);
  }
  return lines;
}

/** Douglas–Peucker: drop the points that were only ever pixel stair-steps. */
function simplify(line, tol) {
  if (line.length < 3) return line;
  const d2 = (p, a, b) => {
    const [px, py] = p, [ax, ay] = a, [bx, by] = b;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return (px - cx) ** 2 + (py - cy) ** 2;
  };
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 0, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = d2(line[i], line[a], line[b]);
      if (d > worst) { worst = d; wi = i; }
    }
    if (wi > 0 && worst > tol * tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

const toBoard = (line) => line.map(([x, y]) => [Math.round((x + 0.5) * SCALE), Math.round((y + 0.5) * SCALE)]);

/** Trim the parts that only exist because the sheet ends there. */
const M = 60; // board units
const nearFrame = ([x, y]) => x < M || y < M || x > BW - M || y > BH - M;

function polylines(mask, { tol = 1.6, minPoints = 4, dropFrame = false, minExtent = 0 } = {}) {
  const out = [];
  for (const line of chain(marchingSquares(mask))) {
    const board = toBoard(simplify(line, tol));
    // a ring too small to read is noise, not a country
    const xs = board.map((p) => p[0]), ys = board.map((p) => p[1]);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (extent < minExtent) continue;
    if (!dropFrame) {
      if (board.length >= minPoints) out.push(board);
      continue;
    }
    // split the ring wherever it runs along the edge of the sheet
    let run = [];
    for (const p of board) {
      if (nearFrame(p)) {
        if (run.length >= minPoints) out.push(run);
        run = [];
      } else run.push(p);
    }
    if (run.length >= minPoints) out.push(run);
  }
  return out;
}

// the land mask's outline IS the coast, once the edges of the sheet are cut off
const coast = polylines(land, { tol: 1.6, minPoints: 6, dropFrame: true, minExtent: 400 })
  .filter((l) => l.length >= 6);
console.log(`coastline: ${coast.length} lines, ${coast.reduce((n, l) => n + l.length, 0)} points`);

// ---- home countries: nearest home city, clipped to dry land ---------------

const HOMES = [...new Set(cities.map((c) => c.home).filter(Boolean))].sort();
console.log(`home countries: ${HOMES.join(', ')}`);

/** Which nation's home country a cell belongs to: nearest city wins, as the rule reads it. */
const owner = new Int8Array(W * H).fill(-1);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!land[idx(x, y)]) continue;
    const bx = (x + 0.5) * SCALE, by = (y + 0.5) * SCALE;
    let best = null, bd = Infinity;
    for (const c of cities) {
      const d = (c.x - bx) ** 2 + (c.y - by) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    owner[idx(x, y)] = best.home ? HOMES.indexOf(best.home) : -1;
  }
}

const territory = {};
for (const [i, home] of HOMES.entries()) {
  const mask = new Uint8Array(W * H);
  for (let c = 0; c < W * H; c++) if (owner[c] === i) mask[c] = 1;
  territory[home] = polylines(mask, { tol: 1.6, minPoints: 4, minExtent: 120 });
  const pts = territory[home].reduce((n, l) => n + l.length, 0);
  console.log(`  ${home.padEnd(9)} ${String(territory[home].length).padStart(3)} rings, ${pts} points`);
}

/**
 * Saxony, drawn apart from the rest of the Reich as the board draws it. It IS
 * Imperial home country — so it stays inside that outline — but Friedrich's army
 * is sitting on it, and rule 5 makes Prussia the one who defends its objectives.
 * The shading is the reminder.
 */
const occupiedMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!land[idx(x, y)]) continue;
    const bx = (x + 0.5) * SCALE, by = (y + 0.5) * SCALE;
    let best = null, bd = Infinity;
    for (const c of cities) {
      const d = (c.x - bx) ** 2 + (c.y - by) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best.occupiedBy) occupiedMask[idx(x, y)] = 1;
  }
}
const occupied = polylines(occupiedMask, { tol: 1.6, minPoints: 4, minExtent: 120 });
console.log(`  occupied Saxony: ${occupied.length} rings, ${occupied.reduce((n, l) => n + l.length, 0)} points`);

// ---- write it out --------------------------------------------------------

const fmt = (lines) =>
  lines.map((l) => '    [' + l.map(([x, y]) => `[${x},${y}]`).join(',') + '],').join('\n');

const ts = `/**
 * GENERATED — do not edit. Run: node scripts/extract-geography.mjs
 *
 * COASTLINE is traced off the printed board: the sea there is the same cream as
 * the margin, so it is found by colour and connectivity rather than by being
 * blue. Only the North Sea and Baltic shores survive — the parts of the outline
 * that merely follow the edge of the sheet are cut away.
 *
 * HOME_COUNTRY is NOT traced. It is derived from \`home\` in the map data — the
 * same field the supply rule reads — so what a player sees and what the rule
 * does cannot drift apart. Each region is the ground nearer to one of that
 * nation's home cities than to any other city, clipped to dry land. Russia and
 * France are absent because they have no home country.
 *
 * Points are board coordinates (${BW}x${BH}); each entry is one open polyline.
 */

export type Polyline = readonly (readonly [number, number])[];

export const COASTLINE: readonly Polyline[] = [
${fmt(coast)}
];

export const HOME_COUNTRY: Readonly<Record<string, readonly Polyline[]>> = {
${HOMES.map((h) => `  ${h}: [\n${fmt(territory[h])}\n  ],`).join('\n')}
};

/**
 * Saxony — the Imperial Army's home country with Friedrich's army standing on
 * it. The board shades it apart from the rest of the Reich, and rule 5 says why:
 * "Prussia is defending occupied Sachsen (Saxony)." Every one of the Imperial
 * Army's ten objectives is in here, so this is the ground the whole Imperial war
 * is about. It sits INSIDE HOME_COUNTRY.imperial, not beside it.
 */
export const OCCUPIED_SAXONY: readonly Polyline[] = [
${fmt(occupied)}
];
`;
writeFileSync(OUT, ts);
console.log(`\nwrote ${OUT}`);
