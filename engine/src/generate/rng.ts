// SPDX-License-Identifier: Apache-2.0
//
// The seeded PRNG for the generation path (CLAUDE.md invariant 3). All
// integer math is 32-bit (Math.imul), so sequences are identical on every
// machine. Randomness is always passed explicitly as an Rng.
export type Rng = () => number;

/** mulberry32: tiny, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Named sub-seed derivation (ADR-0001 resolution 3): the charter carries a
 * single root seed; each subsystem derives its own stream, so adding a new
 * subsystem never shifts another's sequence. fnv1a over the name, mixed
 * with the root.
 */
export function deriveSeed(root: number, name: string): number {
  let h = (0x811c9dc5 ^ root) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Integer in [min, max] inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Deterministic pick from a non-empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}
