import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// medium.ts builds canvas textures (window facades, deck oil-stains, ads) via
// makeCanvasTexture — stub a chainable 2D-context proxy like buildingsTall.test.ts does.
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

import { buildApartment, buildOfficeHolo, buildParking } from '../src/assets/buildings/medium';
import { FLOOR_H } from '../src/assets/buildings/tall';

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
  it(`${name}: userData contract (roofY, footprint)`, () => {
    expect(group.userData.roofY).toBeCloseTo(expectedRoofY, 5);
    const fp = group.userData.footprint as [number, number];
    expect(fp).toHaveLength(2);
    expect(fp[0]).toBeGreaterThan(0);
    expect(fp[1]).toBeGreaterThan(0);
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
    expect(box.max.y).toBeGreaterThanOrEqual(group.userData.roofY as number);
  });
}

describe('buildApartment', () => {
  const group = buildApartment(makeRng(21));
  contractChecks(group, 12 * FLOOR_H, 'apartment');

  it('has the 22x14 footprint', () => {
    expect(group.userData.footprint).toEqual([22, 14]);
  });

  it('tags a blinking beacon', () => {
    const beacons = group.userData.beacons as THREE.Mesh[];
    expect(Array.isArray(beacons)).toBe(true);
    expect(beacons.length).toBeGreaterThan(0);
    for (const b of beacons) expect(b.isMesh).toBe(true);
  });

  it('is deterministic for the same seed', () => {
    const a = buildApartment(makeRng(4)).userData.footprint as [number, number];
    const b = buildApartment(makeRng(4)).userData.footprint as [number, number];
    expect(a).toEqual(b);
  });
});

describe('buildOfficeHolo', () => {
  const group = buildOfficeHolo(makeRng(9));
  contractChecks(group, 14 * FLOOR_H, 'officeHolo');

  it('has the 26x18 footprint', () => {
    expect(group.userData.footprint).toEqual([26, 18]);
  });

  it('tags the wraparound ticker mesh (in-group, UV-scrollable)', () => {
    const ticker = group.userData.ticker as THREE.Mesh;
    expect(ticker?.isMesh).toBe(true);
    let found = false;
    group.traverse((o) => {
      if (o === ticker) found = true;
    });
    expect(found).toBe(true);
  });
});

describe('buildParking', () => {
  const group = buildParking(makeRng(14));
  contractChecks(group, 7 * FLOOR_H, 'parking');

  it('has the 34x22 elongated footprint', () => {
    expect(group.userData.footprint).toEqual([34, 22]);
  });

  it('tags a blinking rooftop beacon', () => {
    const beacons = group.userData.beacons as THREE.Mesh[];
    expect(Array.isArray(beacons)).toBe(true);
    expect(beacons.length).toBeGreaterThan(0);
  });

  it('respects a custom deck count', () => {
    const p = buildParking(makeRng(14), 5);
    expect(p.userData.roofY).toBeCloseTo(5 * FLOOR_H, 5);
  });
});
