/**
 * Victory conditions. An attacker nation wins the instant it controls ALL of its
 * objective cities at once. Prussia (Frederick) wins by survival — once Russia,
 * Sweden and France have all been forced out of the war by the Cards of Fate.
 */

import { friedrichMap } from './map-data.js';
import type { Nation } from './powers.js';
import type { FriedrichState, Winner } from './state.js';

/** Coalition nations that pursue objectives (Prussia & Hanover are the defence). */
export const ATTACKER_NATIONS: readonly Nation[] = ['russia', 'sweden', 'austria', 'imperial', 'france'];

/** Nations whose withdrawal (via Cards of Fate) hands Prussia the survival win. */
export const SURVIVAL_NATIONS: readonly Nation[] = ['russia', 'sweden', 'france'];

/** Objective city ids per nation, precomputed from the map. */
const OBJECTIVES_BY_NATION: ReadonlyMap<Nation, readonly string[]> = (() => {
  const m = new Map<Nation, string[]>();
  for (const node of friedrichMap.nodes.values()) {
    if (!node.objectiveFor) continue;
    const nation = node.objectiveFor as Nation;
    if (!m.has(nation)) m.set(nation, []);
    m.get(nation)!.push(node.id);
  }
  return m;
})();

export const objectivesOf = (nation: Nation): readonly string[] => OBJECTIVES_BY_NATION.get(nation) ?? [];

/** How many of `nation`'s objectives it currently holds (for progress display). */
export function objectiveProgress(state: FriedrichState, nation: Nation): { held: number; total: number } {
  const objs = objectivesOf(nation);
  const held = objs.filter((id) => state.conquered[id] === nation).length;
  return { held, total: objs.length };
}

/** Returns the winner if the game has been decided, else null. */
export function checkVictory(state: FriedrichState): Winner | null {
  for (const nation of ATTACKER_NATIONS) {
    if (state.eliminated.includes(nation)) continue;
    const objs = objectivesOf(nation);
    if (objs.length > 0 && objs.every((id) => state.conquered[id] === nation)) {
      return { side: 'attacker', nation };
    }
  }
  if (SURVIVAL_NATIONS.every((n) => state.eliminated.includes(n))) {
    return { side: 'defender' };
  }
  return null;
}
