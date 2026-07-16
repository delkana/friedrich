/**
 * Extract the Main Map city regions from the VASSAL module's buildFile.
 * Output: docs/assets/extraction/vassal-cities.json
 *   [{ name, x, y }] in the pixel space of board-6000x4000.png.
 *
 * The buildFile nests each board's Region list inside its Board element; only
 * the "Main Map" board holds real cities (other boards are trackers/decks).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const xml = readFileSync('docs/assets/vassal/buildFile.xml', 'utf8');

const boardStart = xml.indexOf('name="Main Map"');
const boardEnd = xml.indexOf('</VASSAL.build.module.map.boardPicker.Board>', boardStart);
if (boardStart < 0 || boardEnd < 0) throw new Error('Main Map board not found');
const section = xml.slice(boardStart, boardEnd);

const regions = [];
const re = /Region name="([^"]+)" originx="(-?\d+)" originy="(-?\d+)"/g;
let m;
while ((m = re.exec(section))) {
  regions.push({ name: m[1], x: Number(m[2]), y: Number(m[3]) });
}

// sanity: flag duplicate names (legit ones exist, e.g. three Friedlands)
const byName = new Map();
for (const r of regions) {
  byName.set(r.name, (byName.get(r.name) ?? 0) + 1);
}
const dupes = [...byName.entries()].filter(([, n]) => n > 1);

writeFileSync(
  'docs/assets/extraction/vassal-cities.json',
  JSON.stringify({ count: regions.length, dupes: Object.fromEntries(dupes), cities: regions }, null, 2),
);
console.log(`regions ${regions.length} | unique names ${byName.size} | duplicated names: ${dupes.map(([n, c]) => `${n}x${c}`).join(', ') || 'none'}`);
