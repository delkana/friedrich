/**
 * Merge per-tile transcriptions (docs/assets/extraction/tile-*.json) into one
 * draft map dataset. Converts fractional tile coords to source-image pixels via
 * tiles.json, dedupes cities that appear in overlapping tiles, resolves roads by
 * name, clusters suit stamps and sector grid lines, and reports conflicts that
 * need human/vision review.
 *
 * Output: docs/assets/extraction/merged.json
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TILES_DIR = 'docs/assets/tiles';
const EXTRACT_DIR = 'docs/assets/extraction';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const tiles = readJson(join(TILES_DIR, 'tiles.json'));
const tileByName = new Map(tiles.map((t) => [t.name.replace('.png', ''), t]));

const CITY_MERGE_PX = 90; // same-name points closer than this are one city
const CONFLICT_PX = 30; // different-name points closer than this are suspicious
const STAMP_MERGE_PX = 70;
const LINE_MERGE_PX = 18;

const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

const confRank = { low: 0, med: 1, high: 2 };

// ---- load ------------------------------------------------------------------
const rawCities = [];
const rawRoads = [];
const rawStamps = [];
const rawVLines = [];
const rawHLines = [];
const notes = [];
let tilesLoaded = 0;

for (const file of readdirSync(EXTRACT_DIR).filter((f) => /^tile-\d+-\d+\.json$/.test(f))) {
  let data;
  try {
    data = readJson(join(EXTRACT_DIR, file));
  } catch (e) {
    console.error(`SKIP ${file}: ${e.message}`);
    continue;
  }
  const t = tileByName.get(file.replace('.json', ''));
  if (!t) {
    console.error(`SKIP ${file}: no tile rect in tiles.json`);
    continue;
  }
  tilesLoaded++;
  const abs = (fx, fy) => ({ x: Math.round(t.x + fx * t.w), y: Math.round(t.y + fy * t.h) });

  for (const c of data.cities ?? []) {
    if (!c.name) continue;
    rawCities.push({ ...c, ...abs(c.fx, c.fy), tile: data.tile });
  }
  for (const r of data.roads ?? []) {
    if (r.a && r.b) rawRoads.push({ ...r, tile: data.tile });
  }
  for (const s of data.suitStamps ?? []) {
    rawStamps.push({ suit: s.suit, ...abs(s.fx, s.fy), tile: data.tile });
  }
  for (const v of data.sectorLines?.vertical ?? []) rawVLines.push(Math.round(t.x + v * t.w));
  for (const h of data.sectorLines?.horizontal ?? []) rawHLines.push(Math.round(t.y + h * t.h));
  if (data.notes) notes.push(`[${data.tile}] ${data.notes}`);
}

// ---- merge cities ------------------------------------------------------------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clusters = [];
for (const c of rawCities) {
  const key = norm(c.name);
  let target = clusters.find(
    (cl) => cl.key === key && cl.members.some((m) => dist(m, c) < CITY_MERGE_PX),
  );
  if (!target) {
    target = { key, members: [] };
    clusters.push(target);
  }
  target.members.push(c);
}

// uniquify ids when the same normalized name forms several distinct clusters
// (real duplicate towns: two Königsbergs, three Friedlands, two Frankfurts...)
const keyCounts = new Map();
for (const cl of clusters) keyCounts.set(cl.key, (keyCounts.get(cl.key) ?? 0) + 1);
const keySeen = new Map();
for (const cl of clusters) {
  if (keyCounts.get(cl.key) > 1) {
    const n = (keySeen.get(cl.key) ?? 0) + 1;
    keySeen.set(cl.key, n);
    cl.uid = `${cl.key}#${n}`;
  } else cl.uid = cl.key;
}

const cities = clusters.map((cl, i) => {
  const ms = cl.members;
  const best = [...ms].sort((a, b) => confRank[b.conf ?? 'low'] - confRank[a.conf ?? 'low'])[0];
  const mean = (k) => Math.round(ms.reduce((n, m) => n + m[k], 0) / ms.length);
  const mode = (k) => {
    const counts = {};
    for (const m of ms) counts[m[k]] = (counts[m[k]] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  };
  const objectives = [...new Set(ms.map((m) => m.objective).filter((o) => o && o !== 'none'))];
  return {
    id: cl.uid,
    key: cl.key,
    name: best.name,
    x: mean('x'),
    y: mean('y'),
    conf: best.conf ?? 'low',
    seen: ms.length,
    bold: ms.some((m) => m.bold),
    depot: ms.some((m) => m.depot),
    objective: objectives[0] ?? 'none',
    objectiveDisagree: objectives.length > 1 ? objectives : undefined,
    tint: mode('tint'),
    tiles: [...new Set(ms.map((m) => m.tile))],
  };
});

// different-name collisions (likely misread duplicates)
const conflicts = [];
for (let i = 0; i < cities.length; i++) {
  for (let j = i + 1; j < cities.length; j++) {
    const d = dist(cities[i], cities[j]);
    if (d < CONFLICT_PX) {
      conflicts.push({
        a: cities[i].name,
        b: cities[j].name,
        px: Math.round(d),
        at: [cities[i].x, cities[i].y],
      });
    }
  }
}

// ---- roads -------------------------------------------------------------------
const nearestCity = (key, tile) => {
  // resolve by name; if several same-key clusters exist prefer one seen in this tile
  const all = cities.filter((c) => c.key === key);
  if (all.length === 0) return null;
  return all.find((c) => c.tiles.includes(tile)) ?? all[0];
};

const edgeMap = new Map();
const unresolvedRoads = [];
for (const r of rawRoads) {
  const a = nearestCity(norm(r.a), r.tile);
  const b = nearestCity(norm(r.b), r.tile);
  if (!a || !b || a === b) {
    unresolvedRoads.push(`${r.a} -- ${r.b} (${r.tile})`);
    continue;
  }
  const k = [a.id, b.id].sort().join('|');
  const prev = edgeMap.get(k);
  if (prev) prev.main = prev.main || !!r.main;
  else edgeMap.set(k, { a: a.id, b: b.id, main: !!r.main, tiles: [r.tile] });
}
const edges = [...edgeMap.values()];

// ---- suit stamps & sector lines -----------------------------------------------
const stampClusters = [];
for (const s of rawStamps) {
  let t = stampClusters.find((cl) => dist(cl, s) < STAMP_MERGE_PX);
  if (!t) {
    t = { x: s.x, y: s.y, votes: [] };
    stampClusters.push(t);
  }
  t.votes.push(s.suit);
  t.x = Math.round((t.x + s.x) / 2);
  t.y = Math.round((t.y + s.y) / 2);
}
const suitStamps = stampClusters.map((c) => {
  const counts = {};
  for (const v of c.votes) counts[v] = (counts[v] ?? 0) + 1;
  const [suit, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { suit, x: c.x, y: c.y, votes: c.votes.length, agree: n === c.votes.length };
});

function clusterLines(vals) {
  const sorted = [...vals].sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && v - last.max < LINE_MERGE_PX) {
      last.sum += v;
      last.n++;
      last.max = v;
    } else out.push({ sum: v, n: 1, max: v });
  }
  return out.map((c) => ({ at: Math.round(c.sum / c.n), votes: c.n }));
}

const result = {
  meta: { tilesLoaded, rawCities: rawCities.length, mergedCities: cities.length, edges: edges.length },
  cities: cities.sort((a, b) => a.x - b.x || a.y - b.y),
  edges,
  suitStamps,
  gridX: clusterLines(rawVLines),
  gridY: clusterLines(rawHLines),
  conflicts,
  unresolvedRoads,
  notes,
};

writeFileSync(join(EXTRACT_DIR, 'merged.json'), JSON.stringify(result, null, 2));
console.log(
  `tiles ${tilesLoaded} | raw cities ${rawCities.length} -> merged ${cities.length} | edges ${edges.length} | stamps ${suitStamps.length} | conflicts ${conflicts.length} | unresolved roads ${unresolvedRoads.length}`,
);
