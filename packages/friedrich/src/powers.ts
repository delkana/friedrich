/**
 * Friedrich's factions. Seven nations are grouped under four player ROLES.
 * Prussia's role (Frederick) is always the lone defender. At 3 players, one seat
 * runs both Elisabeth and Pompadour. (Per the Histogame rulebook.)
 */

export type Nation =
  | 'prussia'
  | 'hanover'
  | 'russia'
  | 'sweden'
  | 'austria'
  | 'imperial' // Reichsarmee / Imperial Army
  | 'france';

export type Role = 'frederick' | 'elisabeth' | 'mariaTheresa' | 'pompadour';

export interface RoleInfo {
  readonly id: Role;
  readonly name: string;
  readonly nations: readonly Nation[];
  readonly isDefender: boolean;
  readonly color: string;
}

export const ROLE_INFO: Readonly<Record<Role, RoleInfo>> = {
  frederick: { id: 'frederick', name: 'Frederick (Prussia & Hanover)', nations: ['prussia', 'hanover'], isDefender: true, color: '#3b5b92' },
  elisabeth: { id: 'elisabeth', name: 'Elisabeth (Russia & Sweden)', nations: ['russia', 'sweden'], isDefender: false, color: '#3b8f4f' },
  mariaTheresa: { id: 'mariaTheresa', name: 'Maria Theresa (Austria & Imperial Army)', nations: ['austria', 'imperial'], isDefender: false, color: '#b23b3b' },
  pompadour: { id: 'pompadour', name: 'Pompadour (France)', nations: ['france'], isDefender: false, color: '#6a4c93' },
};

/** Fixed order the seven nations act in each turn (rulebook sequence of play). */
export const NATION_ORDER: readonly Nation[] = ['prussia', 'hanover', 'russia', 'sweden', 'austria', 'imperial', 'france'] as const;

/** Tactical cards each nation draws at the start of its action stage (base game). */
export const BASE_DRAW: Readonly<Record<Nation, number>> = {
  prussia: 7, // 4 + 3
  hanover: 2, // 1 + 1
  russia: 4,
  sweden: 1,
  austria: 5, // 4 + 1
  imperial: 1,
  france: 4, // draws 4, then discards 1 face-down
};
