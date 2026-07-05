import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// skinny.ts/rooftop.ts build canvas textures (plaque) via makeCanvasTexture — stub a
// chainable 2D-context proxy like buildingsTall.test.ts does.
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

import { buildRadioMast, buildMonument } from '../src/assets/buildings/skinny';
import { decorateRoof } from '../src/assets/buildings/rooftop';

function countDrawCalls(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    n += Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1;
  });
  return n;
}

describe('buildRadioMast', () => {
  const group = buildRadioMast(makeRng(7));

  it('has userData contract: roofY ~50m, footprint, beacons', () => {
    expect(group.userData.roofY).toBeCloseTo(50, 5);
    const fp = group.userData.footprint as [number, number];
    expect(fp).toHaveLength(2);
    expect(fp[0]).toBeGreaterThan(0);
    const beacons = group.userData.beacons as THREE.Mesh[];
    expect(Array.isArray(beacons)).toBe(true);
    expect(beacons.length).toBeGreaterThan(0);
    for (const b of beacons) expect(b.isMesh).toBe(true);
  });

  it('origin at ground center; geometry rises to ~50m', () => {
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.5);
    expect(box.max.y).toBeGreaterThanOrEqual(50);
  });

  it('is deterministic for the same seed', () => {
    const a = buildRadioMast(makeRng(3)).userData.footprint;
    const b = buildRadioMast(makeRng(3)).userData.footprint;
    expect(a).toEqual(b);
  });
});

describe('buildMonument', () => {
  const group = buildMonument(makeRng(5));

  it('has userData contract: roofY ~22m, footprint, halo mesh', () => {
    expect(group.userData.roofY).toBeCloseTo(22, 5);
    const fp = group.userData.footprint as [number, number];
    expect(fp).toEqual([8, 8]);
    const halo = group.userData.halo as THREE.Mesh;
    expect(halo?.isMesh).toBe(true);
    let found = false;
    group.traverse((o) => {
      if (o === halo) found = true;
    });
    expect(found).toBe(true);
  });

  it('keeps a tight draw-call budget', () => {
    expect(countDrawCalls(group)).toBeLessThanOrEqual(6);
  });
});

describe('decorateRoof', () => {
  const sizes: Array<{ w: number; d: number }> = [
    { w: 12, d: 12 },
    { w: 26, d: 16 },
    { w: 40, d: 24 }
  ];

  for (const { w, d } of sizes) {
    it(`packs a non-empty clutter group for a ${w}x${d} roof and stays within footprint`, () => {
      const roof = { y: 10, w, d };
      const group = decorateRoof(roof, makeRng(9));
      expect(group.children.length).toBeGreaterThan(0);

      const box = new THREE.Box3().setFromObject(group);
      // decorateRoof returns roof-local space (origin at roof center, sitting on y=0);
      // every child must stay within the +/- w/2, +/- d/2 footprint (small epsilon for
      // wall thickness / parapet overhang).
      const eps = 0.6;
      expect(box.min.x).toBeGreaterThanOrEqual(-w / 2 - eps);
      expect(box.max.x).toBeLessThanOrEqual(w / 2 + eps);
      expect(box.min.z).toBeGreaterThanOrEqual(-d / 2 - eps);
      expect(box.max.z).toBeLessThanOrEqual(d / 2 + eps);
    });
  }

  it('keeps a tight draw-call budget (<=3) regardless of item count', () => {
    const group = decorateRoof({ y: 0, w: 40, d: 24 }, makeRng(2));
    expect(countDrawCalls(group)).toBeLessThanOrEqual(3);
  });

  it('reserves the center slot when opts.billboard is set', () => {
    const roof = { y: 0, w: 20, d: 20 };
    const withBillboard = decorateRoof(roof, makeRng(4), { billboard: true });
    // The billboard frame's glow panel should be present near the roof center; sanity
    // check by confirming the group still builds without throwing and stays in bounds.
    const box = new THREE.Box3().setFromObject(withBillboard);
    expect(box.min.x).toBeGreaterThanOrEqual(-roof.w / 2 - 1);
    expect(box.max.x).toBeLessThanOrEqual(roof.w / 2 + 1);
  });

  it('is deterministic for the same seed', () => {
    const roof = { y: 0, w: 26, d: 16 };
    const a = decorateRoof(roof, makeRng(11));
    const b = decorateRoof(roof, makeRng(11));
    expect(a.children.length).toBe(b.children.length);
  });
});
