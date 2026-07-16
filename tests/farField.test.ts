import { describe, it, expect } from 'vitest';
// --- DOM canvas stub (see tests/billboards.test.ts) ---
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain), set: () => true, apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};
import { buildFarField, buildMoon } from '../src/world/farField';
import { makeRng } from '../src/utils/rng';

describe('farField', () => {
  it('builds skyline + moon', () => {
    const f = buildFarField(makeRng(2), 1);
    let meshes = 0; f.group.traverse(o => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(10);
  });
  it('moon is a group with geometry', () => {
    let meshes = 0; buildMoon(makeRng(2)).traverse(o => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(1);
  });
  it('buildFarField is deterministic', () => {
    const f1 = buildFarField(makeRng(7), 1);
    const f2 = buildFarField(makeRng(7), 1);
    let count1 = 0, count2 = 0;
    f1.group.traverse(o => { if ((o as any).isMesh) count1++; });
    f2.group.traverse(o => { if ((o as any).isMesh) count2++; });
    expect(count1).toBe(count2);
  });
  it('updateAmbient does not throw', () => {
    const f = buildFarField(makeRng(3), 0.5);
    expect(() => f.updateAmbient(0)).not.toThrow();
    expect(() => f.updateAmbient(10.5)).not.toThrow();
  });
  it('density 0.5 produces fewer meshes than density 1', () => {
    const fFull = buildFarField(makeRng(5), 1);
    const fHalf = buildFarField(makeRng(5), 0.5);
    let full = 0, half = 0;
    fFull.group.traverse(o => { if ((o as any).isMesh) full++; });
    fHalf.group.traverse(o => { if ((o as any).isMesh) half++; });
    expect(half).toBeLessThan(full);
  });
});
