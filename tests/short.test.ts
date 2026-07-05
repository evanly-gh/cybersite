import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// short.ts builds canvas textures (sign atlas, arch windows, noren, flag sign, etc.)
// via makeCanvasTexture — stub a chainable 2D-context proxy like buildingsTall.test.ts.
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

import { buildStorefrontRow, buildFancyRestaurant, buildRamenShop, buildBar } from '../src/assets/buildings/short';

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

function seatSanityChecks(group: THREE.Group, expectedCount: number, name: string): void {
  it(`${name}: has ${expectedCount} seat anchors`, () => {
    const seats = group.userData.seats as THREE.Object3D[];
    expect(Array.isArray(seats)).toBe(true);
    expect(seats.length).toBe(expectedCount);
  });

  it(`${name}: every seat anchor is a bare Object3D at hip height, parented in the group`, () => {
    const seats = group.userData.seats as THREE.Object3D[];
    for (const s of seats) {
      expect(s).toBeInstanceOf(THREE.Object3D);
      expect((s as THREE.Mesh).isMesh).toBeFalsy();
      expect(s.position.y).toBeGreaterThan(0);
      expect(s.position.y).toBeLessThan(1.0);
      let found = false;
      group.traverse((o) => {
        if (o === s) found = true;
      });
      expect(found).toBe(true);
    }
  });
}

function contractChecks(group: THREE.Group, name: string, maxDrawCalls: number): void {
  it(`${name}: userData contract (roofY, footprint)`, () => {
    expect(group.userData.roofY).toBeGreaterThan(0);
    const fp = group.userData.footprint as [number, number];
    expect(fp).toHaveLength(2);
    expect(fp[0]).toBeGreaterThan(0);
    expect(fp[1]).toBeGreaterThan(0);
  });

  it(`${name}: <= ${maxDrawCalls} draw calls`, () => {
    expect(countDrawCalls(group)).toBeLessThanOrEqual(maxDrawCalls);
  });

  it(`${name}: origin at ground center — geometry spans up from ~0 and straddles x/z 0`, () => {
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.1);
    expect(box.min.x).toBeLessThan(0);
    expect(box.max.x).toBeGreaterThan(0);
  });
}

describe('buildStorefrontRow', () => {
  const group = buildStorefrontRow(makeRng(1));
  contractChecks(group, 'storefrontRow', 6);

  it('has a billboard anchor tagged userData.billboardAnchors', () => {
    const anchors = group.userData.billboardAnchors as THREE.Object3D[];
    expect(Array.isArray(anchors)).toBe(true);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(a).toBeInstanceOf(THREE.Object3D);
  });

  it('has the expected 4-shop, 8m-frontage footprint', () => {
    expect(group.userData.footprint).toEqual([32, 9]);
  });

  it('supports a custom shop count', () => {
    const row6 = buildStorefrontRow(makeRng(2), 6);
    expect(row6.userData.footprint).toEqual([48, 9]);
  });

  it('is deterministic for the same seed', () => {
    const a = buildStorefrontRow(makeRng(9)).userData.footprint;
    const b = buildStorefrontRow(makeRng(9)).userData.footprint;
    expect(a).toEqual(b);
  });
});

describe('buildFancyRestaurant', () => {
  const group = buildFancyRestaurant(makeRng(3));
  contractChecks(group, 'fancyRestaurant', 8);
  seatSanityChecks(group, 10, 'fancyRestaurant');
});

describe('buildRamenShop', () => {
  const group = buildRamenShop(makeRng(4));
  contractChecks(group, 'ramenShop', 8);
  seatSanityChecks(group, 6, 'ramenShop');

  it('has a steamAnchor Object3D parented in the group', () => {
    const anchor = group.userData.steamAnchor as THREE.Object3D;
    expect(anchor).toBeInstanceOf(THREE.Object3D);
    let found = false;
    group.traverse((o) => {
      if (o === anchor) found = true;
    });
    expect(found).toBe(true);
  });
});

describe('buildBar', () => {
  const group = buildBar(makeRng(5));
  contractChecks(group, 'bar', 8);

  it('has ~5 seat anchors (4 stools + 1 standing table)', () => {
    const seats = group.userData.seats as THREE.Object3D[];
    expect(seats.length).toBe(5);
  });

  it('tags the marquee mesh for flicker in userData.flicker', () => {
    const flicker = group.userData.flicker as THREE.Mesh[];
    expect(Array.isArray(flicker)).toBe(true);
    expect(flicker.length).toBeGreaterThan(0);
    for (const m of flicker) expect(m.isMesh).toBe(true);
  });
});
