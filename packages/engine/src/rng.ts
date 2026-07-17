/**
 * Deterministic, serializable PRNG.
 *
 * The RNG state is a single 32-bit integer that lives inside the game state, so
 * the server and every client that replays the same action log reach the exact
 * same result. This is what keeps an authoritative server and predicting clients
 * in lockstep. Never call Math.random() in the engine.
 */

export interface RngState {
  /** Internal PRNG accumulator (mulberry32). */
  readonly s: number;
}

/**
 * A fresh, unguessable seed for a NEW game.
 *
 * Everything downstream is deterministic in the seed — the deck order, the deal,
 * the role raffle — so the seed is the ONE place a game gets its randomness.
 * Callers must never invent their own: a constant deals the identical game every
 * time, and anything public (a room code) lets a player read the deck order off
 * the table. This is the only non-deterministic function in the engine, and it
 * is called once, before a game exists.
 */
export function randomSeed(): string {
  type CryptoLike = {
    randomUUID?: () => string;
    getRandomValues?: <T extends ArrayBufferView>(a: T) => T;
  };
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bits = c.getRandomValues(new Uint32Array(4));
    return Array.from(bits, (n) => n.toString(36)).join('-');
  }
  // last resort: still varies per game, just not cryptographically
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Hash an arbitrary seed string into a 32-bit integer (xmur3). */
export function seedFromString(str: string): RngState {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return { s: (h ^= h >>> 16) >>> 0 };
}

/** Advance the RNG one step, returning the next state and a float in [0, 1). */
export function rngNext(r: RngState): { r: RngState; value: number } {
  let a = r.s | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { r: { s: a >>> 0 }, value };
}

/** Return an integer in [0, maxExclusive) and the advanced RNG state. */
export function rngInt(r: RngState, maxExclusive: number): { r: RngState; value: number } {
  const next = rngNext(r);
  return { r: next.r, value: Math.floor(next.value * maxExclusive) };
}

/**
 * Fisher–Yates shuffle. Pure: returns a new array and the advanced RNG state,
 * so a shuffled deck is fully reproducible from the seed.
 */
export function rngShuffle<T>(r: RngState, items: readonly T[]): { r: RngState; items: T[] } {
  const out = items.slice();
  let rng = r;
  for (let i = out.length - 1; i > 0; i--) {
    const draw = rngInt(rng, i + 1);
    rng = draw.r;
    const j = draw.value;
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return { r: rng, items: out };
}
