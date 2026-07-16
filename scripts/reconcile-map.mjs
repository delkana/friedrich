/**
 * Reconcile the scan-tile merge (merged.json, 1800x1211 scan space) against the
 * VASSAL city regions (vassal-cities.json, 6000x4000 board space — authoritative
 * for which cities exist and where) and the authoritative game data
 * (authority.json — objectives).
 *
 * Steps: match by normalized name -> fit affine scan->board transform from the
 * unambiguous matches -> re-match leftovers by transformed proximity + fuzzy
 * name -> carry tile flags (bold/depot/tint) onto VASSAL cities -> resolve road
 * endpoints -> stamp objectives from authority.json -> assign sector suits by
 * nearest stamp (draft; proper rectangles come from a later pass).
 *
 * Output: docs/assets/extraction/reconciled.json + console report.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const vassal = readJson('docs/assets/extraction/vassal-cities.json');
const merged = readJson('docs/assets/extraction/merged.json');
const authority = readJson('docs/assets/extraction/authority.json');

const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

// vmod-specific typos/anglicizations -> board names
const ALIASES = {
  straslund: 'stralsund',
  emdert: 'emden',
  islerlohn: 'iserlohn',
  scmalkalden: 'schmalkalden',
};
const vnorm = (s) => {
  const n = norm(s);
  return ALIASES[n] ?? n;
};

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

// ---- 1. name-unique exact matches ------------------------------------------
const vByNorm = new Map();
for (const v of vassal.cities) {
  const k = vnorm(v.name);
  if (!vByNorm.has(k)) vByNorm.set(k, []);
  vByNorm.get(k).push(v);
}
const mByNorm = new Map();
for (const m of merged.cities) {
  const k = norm(m.name);
  if (!mByNorm.has(k)) mByNorm.set(k, []);
  mByNorm.get(k).push(m);
}

const anchorPairs = [];
for (const [k, vs] of vByNorm) {
  const ms = mByNorm.get(k);
  if (vs.length === 1 && ms?.length === 1) anchorPairs.push({ v: vs[0], m: ms[0] });
}

// ---- 2. affine fit (x' = ax + b, y' = cy + d), trim outliers, refit --------
function fit(pairs) {
  const n = pairs.length;
  const mean = (f) => pairs.reduce((s, p) => s + f(p), 0) / n;
  const mx = mean((p) => p.m.x), my = mean((p) => p.m.y);
  const vx = mean((p) => p.v.x), vy = mean((p) => p.v.y);
  const a = pairs.reduce((s, p) => s + (p.m.x - mx) * (p.v.x - vx), 0) / pairs.reduce((s, p) => s + (p.m.x - mx) ** 2, 0);
  const c = pairs.reduce((s, p) => s + (p.m.y - my) * (p.v.y - vy), 0) / pairs.reduce((s, p) => s + (p.m.y - my) ** 2, 0);
  return { a, b: vx - a * mx, c, d: vy - c * my };
}
let T = fit(anchorPairs);
const apply = (m) => ({ x: T.a * m.x + T.b, y: T.c * m.y + T.d });
const err = (p) => Math.hypot(apply(p.m).x - p.v.x, apply(p.m).y - p.v.y);
const inliers = anchorPairs.filter((p) => err(p) < 120);
T = fit(inliers);
const residuals = inliers.map(err).sort((x, y) => x - y);
const median = residuals[Math.floor(residuals.length / 2)];

// ---- 3. full matching -------------------------------------------------------
const matchOfMerged = new Map(); // merged.id -> vassal city
const matchedVassal = new Set();
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// exact-name matches first (disambiguate duplicates by proximity)
for (const m of merged.cities) {
  const vs = vByNorm.get(norm(m.name));
  if (!vs) continue;
  const p = apply(m);
  const best = vs.filter((v) => !matchedVassal.has(v)).sort((x, y) => dist(p, x) - dist(p, y))[0];
  if (best && dist(p, best) < 250) {
    matchOfMerged.set(m.id + '@' + m.x, best);
    matchedVassal.add(best);
  }
}
// fuzzy pass for the rest
const unmatchedV = vassal.cities.filter((v) => !matchedVassal.has(v));
for (const m of merged.cities) {
  if (matchOfMerged.has(m.id + '@' + m.x)) continue;
  const p = apply(m);
  const near = unmatchedV
    .filter((v) => !matchedVassal.has(v) && dist(p, v) < 160)
    .map((v) => ({ v, lev: levenshtein(norm(m.name), vnorm(v.name)), d: dist(p, v) }))
    .filter((c) => c.lev <= 2)
    .sort((x, y) => x.lev - y.lev || x.d - y.d)[0];
  if (near) {
    matchOfMerged.set(m.id + '@' + m.x, near.v);
    matchedVassal.add(near.v);
  }
}
// many-to-one pass: a merge cluster that split across tiles (same name, offset
// coords) must still fold into the SAME vassal city, or its roads are orphaned.
for (const m of merged.cities) {
  if (matchOfMerged.has(m.id + '@' + m.x)) continue;
  const vs = vByNorm.get(norm(m.name));
  if (!vs) continue;
  const p = apply(m);
  const best = vs.slice().sort((x, y) => dist(p, x) - dist(p, y))[0];
  if (best && dist(p, best) < 450) {
    matchOfMerged.set(m.id + '@' + m.x, best);
    matchedVassal.add(best);
  }
}

// ---- 4. build reconciled city list -----------------------------------------
const flagsOf = new Map(); // vassal city -> flags
for (const m of merged.cities) {
  const v = matchOfMerged.get(m.id + '@' + m.x);
  if (!v) continue;
  const f = flagsOf.get(v) ?? { bold: false, depot: false, tint: m.tint, conf: m.conf, seen: 0 };
  f.bold = f.bold || m.bold;
  f.depot = f.depot || m.depot;
  f.seen += m.seen;
  flagsOf.set(v, f);
}

// objectives from authority (name -> {nation, order})
const objByNorm = new Map();
for (const [nation, spec] of Object.entries(authority.objectives)) {
  for (const n of spec.first) objByNorm.set(norm(n.replace(/\s*\(.*\)/, '')), { nation, order: 1 });
  for (const n of spec.second) objByNorm.set(norm(n.replace(/\s*\(.*\)/, '')), { nation, order: 2 });
}
// Friedland (Böhmen) special case: pick the Bohemian one (southernmost of the three)
const friedlands = vassal.cities.filter((v) => vnorm(v.name) === 'friedland').sort((a, b) => b.y - a.y);

const suits = merged.suitStamps.map((s) => ({ ...apply(s), suit: s.suit, votes: s.votes }));
const nearestSuit = (v) => suits.slice().sort((a, b) => dist(v, a) - dist(v, b))[0];

const cities = vassal.cities.map((v, i) => {
  const f = flagsOf.get(v);
  const key = vnorm(v.name);
  let obj = objByNorm.get(key);
  if (key === 'friedland') obj = v === friedlands[0] ? { nation: 'prussia', order: 1 } : undefined;
  return {
    id: `${key}${vByNorm.get(key).length > 1 ? '-' + i : ''}`,
    name: v.name,
    x: v.x,
    y: v.y,
    suit: nearestSuit(v).suit,
    bold: f?.bold ?? false,
    depot: f?.depot ?? false,
    objectiveFor: obj?.nation,
    objectiveOrder: obj?.order,
    tint: f?.tint ?? 'unknown',
    seenInScan: f?.seen ?? 0,
  };
});
const cityIdOf = new Map(vassal.cities.map((v, i) => [v, cities[i].id]));

// ---- 5. roads ---------------------------------------------------------------
const edgeSet = new Map();
let dropped = 0;
for (const e of merged.edges) {
  const ma = merged.cities.find((c) => c.id === e.a) ?? null;
  const mb = merged.cities.find((c) => c.id === e.b) ?? null;
  const va = ma && matchOfMerged.get(ma.id + '@' + ma.x);
  const vb = mb && matchOfMerged.get(mb.id + '@' + mb.x);
  if (!va || !vb || va === vb) {
    dropped++;
    continue;
  }
  const k = [cityIdOf.get(va), cityIdOf.get(vb)].sort().join('|');
  const prev = edgeSet.get(k);
  if (prev) prev.main = prev.main || e.main;
  else edgeSet.set(k, { a: cityIdOf.get(va), b: cityIdOf.get(vb), main: !!e.main });
}
const edges = [...edgeSet.values()];

// sanity: edge length distribution (board px) — real roads are short
const cityById = new Map(cities.map((c) => [c.id, c]));
const lengths = edges.map((e) => dist(cityById.get(e.a), cityById.get(e.b))).sort((a, b) => a - b);
const suspicious = edges.filter((e) => dist(cityById.get(e.a), cityById.get(e.b)) > 450);

// ---- 6. report + write ------------------------------------------------------
const ghostCities = merged.cities.filter((m) => !matchOfMerged.has(m.id + '@' + m.x));
const unseenVassal = cities.filter((c) => c.seenInScan === 0);
const objMissing = [...objByNorm.keys()].filter(
  (k) => !cities.some((c) => norm(c.id.replace(/-\d+$/, '')) === k && c.objectiveFor),
);

const out = {
  meta: {
    transform: T,
    medianResidualPx: Math.round(median),
    anchors: inliers.length,
    matched: matchOfMerged.size,
    ghosts: ghostCities.length,
    unseenVassal: unseenVassal.length,
    edges: edges.length,
    droppedEdges: dropped,
    suspiciousLongEdges: suspicious.length,
    medianEdgePx: Math.round(lengths[Math.floor(lengths.length / 2)] ?? 0),
  },
  cities,
  edges,
  suits,
  ghosts: ghostCities.map((g) => ({ name: g.name, x: g.x, y: g.y, seen: g.seen, tiles: g.tiles })),
  unseenVassal: unseenVassal.map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y })),
  suspiciousLongEdges: suspicious,
  objectivesUnmatched: objMissing,
};
writeFileSync('docs/assets/extraction/reconciled.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.meta));
console.log(`ghost merged-cities (no vassal match): ${ghostCities.length}`);
console.log(`vassal cities unseen by scan fleet: ${unseenVassal.length}`);
console.log(`objectives not matched to a city: ${objMissing.join(', ') || 'none'}`);
