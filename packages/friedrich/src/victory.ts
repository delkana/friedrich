/**
 * Victory conditions. An attacker nation wins the instant it controls all of the
 * objective cities it needs. Normally that means both 1st- and 2nd-order
 * objectives, but the requirement is EASED to 1st-order only when the war has
 * turned: Sweden needs only 1st-order once Russia is out, and Austria/Imperial
 * need only 1st-order once the Imperial Army has "switched players" (i.e. Russia
 * and Sweden are both out, or France is out). Prussia (Frederick) wins by
 * survival — once Russia, Sweden and France have all been forced out of the war.
 */

import { friedrichMap } from './map-data.js';
import type { Nation } from './powers.js';
import type { FriedrichState, Winner } from './state.js';

export const ATTACKER_NATIONS: readonly Nation[] = ['russia', 'sweden', 'austria', 'imperial', 'france'];
export const SURVIVAL_NATIONS: readonly Nation[] = ['russia', 'sweden', 'france'];

/** 1st- and 2nd-order objective city ids per nation, precomputed from the map. */
const OBJECTIVES_BY_NATION: ReadonlyMap<Nation, { first: string[]; second: string[] }> = (() => {
  const m = new Map<Nation, { first: string[]; second: string[] }>();
  for (const node of friedrichMap.nodes.values()) {
    if (!node.objectiveFor) continue;
    const nation = node.objectiveFor as Nation;
    if (!m.has(nation)) m.set(nation, { first: [], second: [] });
    (node.objectiveOrder === 2 ? m.get(nation)!.second : m.get(nation)!.first).push(node.id);
  }
  return m;
})();

const objs = (nation: Nation) => OBJECTIVES_BY_NATION.get(nation) ?? { first: [], second: [] };

export const objectivesOf = (nation: Nation): readonly string[] => {
  const o = objs(nation);
  return [...o.first, ...o.second];
};

/** Has the Imperial Army "switched players"? (Russia & Sweden out, or France out.) */
function imperialSwitched(state: FriedrichState): boolean {
  const out = (n: Nation) => state.eliminated.includes(n);
  return (out('russia') && out('sweden')) || out('france');
}

/** Is this nation's objective requirement eased to 1st-order only? */
export function isEased(state: FriedrichState, nation: Nation): boolean {
  if (nation === 'sweden') return state.eliminated.includes('russia');
  if (nation === 'austria' || nation === 'imperial') return imperialSwitched(state);
  return false;
}

/** The objectives a nation must hold to win right now (eased conditions applied). */
export function requiredObjectives(state: FriedrichState, nation: Nation): readonly string[] {
  const o = objs(nation);
  return isEased(state, nation) ? o.first : [...o.first, ...o.second];
}

/** How many required objectives a nation currently holds (for progress display). */
export function objectiveProgress(state: FriedrichState, nation: Nation): { held: number; total: number } {
  const req = requiredObjectives(state, nation);
  return { held: req.filter((id) => state.conquered[id] === nation).length, total: req.length };
}

/** Returns the winner if the game has been decided, else null. */
export function checkVictory(state: FriedrichState): Winner | null {
  for (const nation of ATTACKER_NATIONS) {
    if (state.eliminated.includes(nation)) continue;
    const req = requiredObjectives(state, nation);
    if (req.length > 0 && req.every((id) => state.conquered[id] === nation)) {
      return { side: 'attacker', nation };
    }
  }
  if (SURVIVAL_NATIONS.every((n) => state.eliminated.includes(n))) {
    return { side: 'defender' };
  }
  return null;
}
