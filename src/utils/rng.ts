/**
 * Seeded random number generator interface
 */
export interface Rng {
  (): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}

/**
 * Creates a seeded RNG using mulberry32 algorithm
 * @param seed - The seed value
 * @returns An Rng instance
 */
export function makeRng(seed: number): Rng {
  // mulberry32 core
  let a = seed | 0;
  const fn = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = x + Math.imul(x ^ (x >>> 7), 61 | x) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  // Extend with helper methods via Object.assign
  return Object.assign(fn, {
    /**
     * Returns a random number in [a, b)
     */
    range(a: number, b: number): number {
      return a + fn() * (b - a);
    },

    /**
     * Returns a random integer in [a, b] (inclusive both ends)
     */
    int(a: number, b: number): number {
      return a + Math.floor(fn() * (b - a + 1));
    },

    /**
     * Picks a random element from an array
     */
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(fn() * arr.length)];
    },

    /**
     * Returns true with probability p
     */
    chance(p: number): boolean {
      return fn() < p;
    },
  }) as Rng;
}
