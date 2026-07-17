/**
 * The Cards of Fate ("Clock of Fate") end-game deck. From the end of turn 6, one
 * card is drawn and executed as the last action of every turn. The six "Strokes
 * of Fate" drive the historical wind-down: Russia, Sweden and France are forced
 * out of the war one by one, and Prussia wins by survival once all three quit.
 * (The other twelve cards are minor events; here they simply pass.)
 */

import { rngShuffle, type RngState } from '@friedrich/engine';

export type FateCard =
  | 'elisabeth' // death of the Tsarina — Russia quits (+ a Prussian general retires)
  | 'sweden'    // Sweden quits (+ a Prussian general retires)
  | 'india'     // colonial drain — Austria draws 4, France 3
  | 'america'   // Hanover draws 1; with India also drawn, France quits
  | 'lordBute'  // Prussia's subsidies cut — Prussia draws 5
  | 'poems'     // Frederick distracted — Prussia draws 4
  | 'minor';    // a minor event — no mechanical effect

export const FATE_STROKES: readonly FateCard[] = [
  'elisabeth', 'sweden', 'india', 'america', 'lordBute', 'poems',
] as const;

export const FATE_DECK_SIZE = 18;

export const FATE_LABEL: Record<FateCard, string> = {
  elisabeth: 'Death of Empress Elisabeth — Russia withdraws',
  sweden: 'Sweden withdraws from the war',
  india: 'War in India — Austria & France strained',
  america: 'War in America — France withdraws',
  lordBute: 'Lord Bute cuts Prussia’s subsidies',
  poems: 'Frederick’s poems — a distraction',
  minor: 'A minor turn of fate',
};

/** Build the shuffled 18-card fate deck (6 strokes + 12 minor events). */
export function buildFateDeck(rng: RngState): { rng: RngState; deck: FateCard[] } {
  const cards: FateCard[] = [
    ...FATE_STROKES,
    ...Array<FateCard>(FATE_DECK_SIZE - FATE_STROKES.length).fill('minor'),
  ];
  const shuffled = rngShuffle(rng, cards);
  return { rng: shuffled.r, deck: shuffled.items };
}
