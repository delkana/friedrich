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
