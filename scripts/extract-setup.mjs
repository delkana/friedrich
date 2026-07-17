/**
 * Recover the EXACT set-up cities from the VASSAL module's ready-to-play save.
 *
 * The army sheet gives each piece's start as a map grid reference (Friedrich F4,
 * Lehwaldt M9). Our extracted map data has no margin grid, so rather than guess
 * cities from the sheet we read the module's "PLAY FRIEDRICH.vsav", which has
 * every piece already placed. Its coordinates land on the board's city points
 * exactly (0px), so the mapping is unambiguous.
 *
 * Prereqs: docs/assets/vassal/Friedrich_v1.0.vmod (gitignored — see the rules
 * doc for provenance) and `node scripts/parse-vassal.mjs` for the city coords.
 *
 * Usage: node scripts/extract-setup.mjs
 * Output: a table of piece -> city, for pasting into packages/friedrich/src/pieces.ts.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const VMOD = 'docs/assets/vassal/Friedrich_v1.0.vmod';
const CITIES = 'docs/assets/extraction/vassal-cities.json';

/**
 * Pull one entry out of a zip, walking the central directory. (Node has no zip
 * reader and the other scripts here are dependency-free, so this stays in-house
 * rather than pulling in a package for two files.)
 */
function unzipEntry(buf, wanted) {
  // End of central directory: signature 0x06054b50, scanned from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // start of central directory
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const local = buf.readUInt32LE(p + 42);
      const method = buf.readUInt16LE(local + 8);
      const compSize = buf.readUInt32LE(p + 20);
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      return method === 0 ? raw : inflateRawSync(raw);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry not found in zip: ${wanted}`);
}

// The .vmod is a zip; the .vsav inside it is itself a zip holding `savedGame`.
const vsav = unzipEntry(readFileSync(VMOD), 'PLAY FRIEDRICH.vsav');
const savedGame = unzipEntry(vsav, 'savedGame');

/** VASSAL obfuscates saves: "!VCSK" + hex bytes XORed with a one-byte key. */
function deobfuscate(raw) {
  if (!raw.startsWith('!VCSK')) throw new Error('not a VASSAL obfuscated file');
  const hex = raw.slice(5);
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

const save = deobfuscate(savedGame.toString('latin1'));
const cities = JSON.parse(readFileSync(CITIES, 'utf8')).cities;

const nearest = (x, y) => {
  let best = null;
  let bd = Infinity;
  for (const c of cities) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) { bd = d; best = c; }
  }
  return { city: best, d: Math.round(bd) };
};

// A placed piece trails as `…<img>.png;<Name>/…<board>;<x>;<y>;<gpid>;`, where the
// board is `null` for a piece never moved and `Main Map` for one that has been.
const RE = /([A-Za-z0-9_]+)\.png;([^;/]*)\/[^]{0,300}?(?:null|Main Map);(-?\d+);(-?\d+);(\d+);/g;
const placed = new Map();
for (const m of save.matchAll(RE)) {
  const img = m[1];
  const x = Number(m[3]);
  const y = Number(m[4]);
  const isPiece = /Supply|Cumberland|^\d+_/.test(img) && !/_Fate|_card/.test(img);
  if (!isPiece || (!x && !y)) continue;
  placed.set(`${img}@${x},${y}`, { img, x, y });
}

const rows = [...placed.values()]
  .map((p) => ({ ...p, ...nearest(p.x, p.y) }))
  .sort((a, b) => a.img.localeCompare(b.img));

for (const r of rows) console.log(`${r.img.padEnd(20)} (${r.x},${r.y}) -> ${r.city.name}  [${r.d}px]`);
console.log(`\n${rows.length} pieces (24 generals + 11 supply trains expected).`);
const sloppy = rows.filter((r) => r.d > 0);
if (sloppy.length) console.log(`WARNING: ${sloppy.length} piece(s) not exactly on a city point.`);
