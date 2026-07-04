import { describe, it, expect } from 'vitest';
import { makeRng } from '../src/utils/rng';

describe('makeRng', () => {
  it('produces identical outputs for the same seed', () => {
    const rng1 = makeRng(42);
    const rng2 = makeRng(42);

    const outputs1 = [rng1(), rng1(), rng1(), rng1(), rng1()];
    const outputs2 = [rng2(), rng2(), rng2(), rng2(), rng2()];

    expect(outputs1).toEqual(outputs2);
  });

  it('produces different outputs for different seeds', () => {
    const rng1 = makeRng(42);
    const rng2 = makeRng(99);

    const outputs1 = [rng1(), rng1(), rng1()];
    const outputs2 = [rng2(), rng2(), rng2()];

    expect(outputs1).not.toEqual(outputs2);
  });

  it('range(a, b) stays in [a, b) over 1000 draws', () => {
    const rng = makeRng(12345);
    for (let i = 0; i < 1000; i++) {
      const val = rng.range(2, 5);
      expect(val).toBeGreaterThanOrEqual(2);
      expect(val).toBeLessThan(5);
    }
  });

  it('int(a, b) returns integers inclusive on both ends', () => {
    const rng = makeRng(54321);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const val = rng.int(0, 3);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(3);
      expect(Number.isInteger(val)).toBe(true);
      seen.add(val);
    }
    // Should see all of 0, 1, 2, 3
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });

  it('pick only returns members of the array', () => {
    const rng = makeRng(777);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    }
  });

  it('chance(p) returns boolean based on probability', () => {
    const rng = makeRng(999);
    const trueCount = (() => {
      let count = 0;
      for (let i = 0; i < 1000; i++) {
        if (rng.chance(0.5)) count++;
      }
      return count;
    })();
    // With p=0.5 and 1000 samples, should be roughly 500 ± margin
    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });
});
