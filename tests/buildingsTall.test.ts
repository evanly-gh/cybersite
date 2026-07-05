import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// tall.ts/special.ts build canvas textures (window facades, sigil, strip ad) via
// makeCanvasTexture — stub a chainable 2D-context proxy like farField.test.ts does.
function makeCtxStub(): CanvasRenderingContext2D {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 });
        return () => proxy;
      },
      set: () => true
    }
  );
  return proxy as CanvasRenderingContext2D;
}

(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => makeCtxStub()
  })
};

import { buildTallStepped, buildTallSlab, FLOOR_H } from '../src/assets/buildings/tall';
import { buildMonolith } from '../src/assets/buildings/special';

/** Real GPU draw calls: 1 per mesh unless material is an array (then 1 per group). */
function countDrawCalls(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    n += Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1;
  });
  return n;
}

function contractChecks(group: THREE.Group, expectedRoofY: number, name: string): void {
  it(`${name}: userData contract (roofY, footprint, beacons)`, () => {
    expect(group.userData.roofY).toBeCloseTo(expectedRoofY, 5);
    const fp = group.userData.footprint as [number, number];
    expect(fp).toHaveLength(2);
    expect(fp[0]).toBeGreaterThan(0);
    expect(fp[1]).toBeGreaterThan(0);
    const beacons = group.userData.beacons as THREE.Mesh[];
    expect(Array.isArray(beacons)).toBe(true);
    expect(beacons.length).toBeGreaterThan(0);
    for (const b of beacons) expect(b.isMesh).toBe(true);
  });

  it(`${name}: <= 6 draw calls`, () => {
    expect(countDrawCalls(group)).toBeLessThanOrEqual(6);
  });

  it(`${name}: origin at ground center — geometry spans up from ~0 and straddles x/z 0`, () => {
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.1);
    expect(box.min.x).toBeLessThan(0);
    expect(box.max.x).toBeGreaterThan(0);
    expect(box.min.z).toBeLessThan(0);
    expect(box.max.z).toBeGreaterThan(0);
    // roofY is the main roof; only mast/sign/halo may poke above it.
    expect(box.max.y).toBeGreaterThanOrEqual(group.userData.roofY as number);
  });
}

describe('buildTallStepped', () => {
  const group = buildTallStepped(makeRng(7));
  contractChecks(group, 34 * FLOOR_H, 'stepped');

  it('respects a custom floors count', () => {
    const tall = buildTallStepped(makeRng(7), 50);
    expect(tall.userData.roofY).toBeCloseTo(50 * FLOOR_H, 5);
  });

  it('is deterministic for the same seed', () => {
    const a = buildTallStepped(makeRng(3)).userData.footprint as [number, number];
    const b = buildTallStepped(makeRng(3)).userData.footprint as [number, number];
    expect(a).toEqual(b);
  });
});

describe('buildTallSlab', () => {
  const group = buildTallSlab(makeRng(11));
  contractChecks(group, 40 * FLOOR_H, 'slab');

  it('has the 40x16 slab footprint', () => {
    expect(group.userData.footprint).toEqual([40, 16]);
  });
});

describe('buildMonolith', () => {
  const group = buildMonolith(makeRng(5));
  contractChecks(group, 52 * FLOOR_H, 'monolith');

  it('has a 46x46 footprint and a tagged halo mesh', () => {
    expect(group.userData.footprint).toEqual([46, 46]);
    const halo = group.userData.halo as THREE.Mesh;
    expect(halo?.isMesh).toBe(true);
    // halo must be inside the group so it renders/animates with it
    let found = false;
    group.traverse((o) => {
      if (o === halo) found = true;
    });
    expect(found).toBe(true);
  });
});
