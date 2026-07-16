/**
 * The suit-restricted card-duel combat system shared by Friedrich (and later
 * Maria), per the official Histogame rulebook (designer Richard Sivél).
 *
 * Key facts that shape this model:
 *  - The board is overlaid with a grid of sectors; each sector has ONE of the
 *    four French suits. A general may only play cards whose suit matches the
 *    sector it stands in. (Two generals in different sectors each play their own
 *    sector's suit in the same battle.)
 *  - A Tactical Card shows exactly ONE suit and ONE value (2..13) — NOT a value
 *    per suit. Plus a wild "Reserve" card, declared on play as any suit, 1..10.
 *  - Generals have NO tactical value. A general has a RANK (stacking/removal
 *    order only). Combat strength = a secret troop count (1..8) plus the value
 *    of Tactical Cards played. Frederick himself has no combat number; the 13 of
 *    spades is merely illustrated with him.
 *  - Combat is a bidding duel: the running score starts at (attacker troops −
 *    defender troops); the side with the negative score plays matching-suit
 *    cards to push it positive, the right to play switches whenever the score
 *    reaches ≥ 0, and a side that cannot/will not play loses.
 */

export type Suit = 'clubs' | 'spades' | 'hearts' | 'diamonds';

export const SUITS: readonly Suit[] = ['clubs', 'spades', 'hearts', 'diamonds'] as const;

/** Legal printed values on a suited Tactical Card. */
export const MIN_CARD_VALUE = 2;
export const MAX_CARD_VALUE = 13;

/** A normal Tactical Card: one suit, one value 2..13. */
export interface SuitCard {
  readonly id: string;
  readonly kind: 'suit';
  readonly suit: Suit;
  readonly value: number;
}

/** A Reserve (wild): on play the owner declares any suit and any value 1..10. */
export interface ReserveCard {
  readonly id: string;
  readonly kind: 'reserve';
}

export type TacticalCard = SuitCard | ReserveCard;

/** How a Reserve is declared at the moment it is played. */
export interface ReservePlay {
  readonly suit: Suit;
  readonly value: number; // 1..10
}

/**
 * Each great power owns a 50-card deck: values 2..13 in all four suits (48
 * cards) plus 2 Reserves. `owner` distinguishes the four identical-composition
 * decks (they have different backs in the physical game).
 */
export function buildTacticalDeck(owner: string): TacticalCard[] {
  const cards: TacticalCard[] = [];
  for (const suit of SUITS) {
    for (let value = MIN_CARD_VALUE; value <= MAX_CARD_VALUE; value++) {
      cards.push({ id: `${owner}-${suit}-${value}`, kind: 'suit', suit, value });
    }
  }
  cards.push({ id: `${owner}-reserve-1`, kind: 'reserve' });
  cards.push({ id: `${owner}-reserve-2`, kind: 'reserve' });
  return cards;
}

/** True if `card` may be played by a general standing in a sector of `suit`. */
export function canPlayInSector(card: TacticalCard, sectorSuit: Suit): boolean {
  return card.kind === 'reserve' || card.suit === sectorSuit;
}

/** The value a card contributes when played (Reserve uses its declared value). */
export function playedValue(card: TacticalCard, reserve?: ReservePlay): number {
  return card.kind === 'reserve' ? (reserve?.value ?? 0) : card.value;
}
