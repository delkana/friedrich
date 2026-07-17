/**
 * Generals on the board. Each general has a secret troop count (1..8) and a
 * RANK (lower = higher command; used for stacking order and casualty removal —
 * NOT combat strength). Supply trains are modeled later.
 */

import type { NodeId } from '@friedrich/engine';
import type { Nation } from './powers.js';

export interface Piece {
  readonly id: string;
  readonly nation: Nation;
  /** Command rank: 1 is the supreme commander; higher numbers are removed first. */
  readonly rank: number;
  readonly node: NodeId;
  /** Secret troop strength, 1..8. */
  readonly troops: number;
  /** Face-down = currently out of supply (still acts; see supply rules later). */
  readonly faceUp: boolean;
}

/** Prussia + Hanover defend; everyone else attacks. Attackers never fight each other. */
export function sideOf(nation: Nation): 'defender' | 'attacker' {
  return nation === 'prussia' || nation === 'hanover' ? 'defender' : 'attacker';
}

export function areEnemies(a: Nation, b: Nation): boolean {
  return sideOf(a) !== sideOf(b);
}

/**
 * The full roster of 24 generals, with the names, ranks and per-nation counts of
 * the official army sheet. Troops are NOT fixed here: at set-up each player
 * secretly allots their nation's establishment across its generals (rule "How to
 * start"), so `troops` is filled in during the setup phase.
 *
 * The sheet gives each general's set-up city as a map grid reference (Friedrich
 * F4, Lehwaldt M9, …). Those margin coordinates aren't in our extracted map
 * data, so the cities below are the historically sensible ones in the right
 * sector (Lehwaldt in East Prussia, Dohna in Pomerania, Schwerin/Keith in
 * Silesia, Frederick invading Saxony). Every one is verified to start in supply.
 */
export interface GeneralSpec {
  readonly id: string;
  readonly name: string;
  readonly nation: Nation;
  readonly rank: number;
  readonly node: NodeId;
}

export const ALL_GENERALS: readonly GeneralSpec[] = [
  // Prussia (8) — establishment 32
  { id: 'friedrich', name: 'Friedrich d. Große', nation: 'prussia', rank: 1, node: 'dresden' },
  { id: 'winterfeldt', name: 'Winterfeldt', nation: 'prussia', rank: 2, node: 'dresden' },
  { id: 'heinrich', name: 'Prinz Heinrich', nation: 'prussia', rank: 3, node: 'leipzig' },
  { id: 'schwerin', name: 'Schwerin', nation: 'prussia', rank: 4, node: 'breslau' },
  { id: 'keith', name: 'Keith', nation: 'prussia', rank: 5, node: 'breslau' },
  { id: 'seydlitz', name: 'Seydlitz', nation: 'prussia', rank: 6, node: 'berlin' },
  { id: 'dohna', name: 'Dohna', nation: 'prussia', rank: 7, node: 'stettin' },
  { id: 'lehwaldt', name: 'Lehwaldt', nation: 'prussia', rank: 8, node: 'konigsberg' },
  // Hanover (2) — establishment 12
  { id: 'ferdinand', name: 'Ferdinand v. Braunschweig', nation: 'hanover', rank: 1, node: 'stade' },
  { id: 'cumberland', name: 'Cumberland', nation: 'hanover', rank: 2, node: 'hannover' },
  // Russia (4) — establishment 16
  { id: 'saltikov', name: 'Saltikov', nation: 'russia', rank: 1, node: 'warszawa' },
  { id: 'fermor', name: 'Fermor', nation: 'russia', rank: 2, node: 'warszawa' },
  { id: 'apraxin', name: 'Apraxin', nation: 'russia', rank: 3, node: 'torun' },
  { id: 'tottleben', name: 'Tottleben', nation: 'russia', rank: 4, node: 'torun' },
  // Sweden (1) — establishment 4
  { id: 'ehrensvard', name: 'Ehrensvärd', nation: 'sweden', rank: 1, node: 'stralsund' },
  // Austria (5) — establishment 30
  { id: 'daun', name: 'Daun', nation: 'austria', rank: 1, node: 'brunn' },
  { id: 'browne', name: 'Browne', nation: 'austria', rank: 2, node: 'melnik' },
  { id: 'lothringen', name: 'Karl v. Lothringen', nation: 'austria', rank: 3, node: 'melnik' },
  { id: 'laudon', name: 'Laudon', nation: 'austria', rank: 4, node: 'olmutz' },
  { id: 'lacy', name: 'Lacy', nation: 'austria', rank: 5, node: 'tabor' },
  // Imperial Army (1) — establishment 6
  { id: 'hildburghausen', name: 'Hildburghausen', nation: 'imperial', rank: 1, node: 'erlangen' },
  // France (3) — establishment 20
  { id: 'richelieu', name: 'Richelieu', nation: 'france', rank: 1, node: 'iserlohn' },
  { id: 'soubise', name: 'Soubise', nation: 'france', rank: 2, node: 'fulda' },
  { id: 'chevert', name: 'Chevert', nation: 'france', rank: 3, node: 'iserlohn' },
];

/** Per-general troop limits at set-up (army sheet: min 1, max 8 — less for the minors). */
export const TROOP_PER_GENERAL_MAX: Record<Nation, number> = {
  prussia: 8, hanover: 8, russia: 8, sweden: 4, austria: 8, imperial: 6, france: 8,
};
export const TROOP_PER_GENERAL_MIN = 1;

export const MAX_STACK = 3;

/**
 * A supply train (wooden cube on the board). Cannot fight or hold objectives;
 * it is the mobile supply source that keeps a nation's generals in supply within
 * six cities. Captured (removed) when an enemy general enters its city.
 */
export interface Train {
  readonly id: string;
  readonly nation: Nation;
  readonly node: NodeId;
}

/** Supply trains at their historical start cities (per the army sheet). */
export const INITIAL_TRAINS: readonly Train[] = [
  { id: 'sup-prussia-1', nation: 'prussia', node: 'juterbog' },
  { id: 'sup-prussia-2', nation: 'prussia', node: 'grunberg' },
  { id: 'sup-hanover-1', nation: 'hanover', node: 'hannover' },
  { id: 'sup-russia-1', nation: 'russia', node: 'torun' },
  { id: 'sup-russia-2', nation: 'russia', node: 'warszawa' },
  { id: 'sup-sweden-1', nation: 'sweden', node: 'wismar' },
  { id: 'sup-austria-1', nation: 'austria', node: 'beraun' },
  { id: 'sup-austria-2', nation: 'austria', node: 'pardubitz' },
  { id: 'sup-imperial-1', nation: 'imperial', node: 'erlangen' },
  { id: 'sup-france-1', nation: 'france', node: 'koblenz' },
  { id: 'sup-france-2', nation: 'france', node: 'gemunden' },
];

/**
 * Recruitment (rulebook §10). Tactical Cards are spent like money — their point
 * values — to bring troops, supply trains and lost generals back at a depot
 * city. A general itself is free but must receive at least one new troop, and no
 * nation may exceed its starting troop establishment.
 */
export const RECRUIT_COST = 6; // points of TC per troop, and per supply train

/** Each nation's troop establishment (its starting total; a hard ceiling). */
export const TROOP_MAX: Record<Nation, number> = {
  prussia: 32, hanover: 12, russia: 16, sweden: 4, austria: 30, imperial: 6, france: 20,
};

/** Depot cities where a nation's pieces may re-enter play (per the army sheet). */
export const DEPOT_CITIES: Record<Nation, readonly NodeId[]> = {
  prussia: ['juterbog', 'grunberg'],
  hanover: ['hannover'],
  russia: ['torun', 'warszawa'],
  sweden: ['wismar'],
  austria: ['beraun', 'pardubitz'],
  imperial: ['erlangen'],
  france: ['koblenz', 'gemunden'],
};

/** How far a supply line can be traced (in cities). */
export const SUPPLY_RANGE = 6;
/** Movement allowance for a supply train (cities); +1 entirely on main roads. */
export const TRAIN_MOVE = 2;
export const TRAIN_MOVE_MAIN = 3;
