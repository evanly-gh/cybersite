// tests/streets.test.ts

// buildShibuya → buildBillboard → makeAd → canvas. Stub the minimal DOM surface
// under Node: a "chain" proxy that is callable, returns itself for any property,
// accepts any set, and coerces to 0 — enough for gradients, measureText, font
// setters, etc. Safe despite import hoisting: billboards.ts only touches
// `document` inside buildBillboard(), never at module-evaluation time.
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain),
  set: () => true,
  apply: () => chain,
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain }),
};

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildStreets, buildShibuya, buildScaffolding, ROAD_HALF_WIDTH } from '../src/world/streets';
import { makeRng } from '../src/utils/rng';

describe('streets', () => {
  it('builds a streets group with meshes', () => {
    const g = buildStreets(makeRng(1));
    expect(g.name).toBe('streets');
    let meshes = 0;
    g.traverse((o) => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(3); // road + sidewalks + ground
  });

  it('road ribbon follows the route into -Z after the turn', () => {
    const g = buildStreets(makeRng(1));
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.z).toBeLessThan(-900);  // reaches the bridge end
    expect(box.max.x).toBeGreaterThan(230); // reaches Shibuya x
  });

  it('road half width constant', () => {
    expect(ROAD_HALF_WIDTH).toBe(7);
  });
});

describe('buildShibuya', () => {
  it('returns a group with several meshes (crosswalk + billboards)', () => {
    const g = buildShibuya(makeRng(42));
    expect(g).toBeInstanceOf(THREE.Group);
    let meshes = 0;
    g.traverse((o) => { if ((o as any).isMesh) meshes++; });
    // Crosswalk floor + stop lines + bollards + billboard structure/screen/glow/accents
    expect(meshes).toBeGreaterThan(5);
  });

  it('group is named "shibuya"', () => {
    const g = buildShibuya(makeRng(1));
    expect(g.name).toBe('shibuya');
  });

  it('contains billboard screens (emissive materials)', () => {
    const g = buildShibuya(makeRng(7));
    let hasBillboardScreen = false;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mat = (o as THREE.Mesh).material;
        if (!Array.isArray(mat) && (mat as THREE.MeshStandardMaterial).emissiveMap) {
          hasBillboardScreen = true;
        }
      }
    });
    expect(hasBillboardScreen).toBe(true);
  });

  it('is positioned near the Shibuya turn (x≈240, z≈0)', () => {
    const g = buildShibuya(makeRng(3));
    const box = new THREE.Box3().setFromObject(g);
    const center = new THREE.Vector3();
    box.getCenter(center);
    // center should be in the general Shibuya area (x ~200-300, z within ±100 of the turn)
    expect(center.x).toBeGreaterThan(150);
    expect(center.x).toBeLessThan(350);
    expect(Math.abs(center.z)).toBeLessThan(200);
  });

  it('is deterministic for a given seed', () => {
    const g1 = buildShibuya(makeRng(99));
    const g2 = buildShibuya(makeRng(99));
    let count1 = 0; let count2 = 0;
    g1.traverse((o) => { if ((o as any).isMesh) count1++; });
    g2.traverse((o) => { if ((o as any).isMesh) count2++; });
    expect(count1).toBe(count2);
  });
});

describe('buildScaffolding', () => {
  it('returns a group named "scaffolding"', () => {
    const g = buildScaffolding(makeRng(5));
    expect(g.name).toBe('scaffolding');
  });

  it('deck surface is elevated (bbox.max.y > 10)', () => {
    const g = buildScaffolding(makeRng(5));
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.y).toBeGreaterThan(10);
  });

  it('scaffold deck top is elevated (bbox.max.y > 9 and structure extends upward)', () => {
    const g = buildScaffolding(makeRng(5));
    const box = new THREE.Box3().setFromObject(g);
    // Deck sits at y≈13; rails, work lights, poles may push max.y higher.
    // The important check is that the scaffold is clearly elevated off the ground.
    expect(box.max.y).toBeGreaterThan(9);
  });

  it('poles are world-vertical: bbox.max.y is near deck + small rail height, not inflated by lean', () => {
    const g = buildScaffolding(makeRng(5));
    const box = new THREE.Box3().setFromObject(g);
    // Deck is at y≈13; top rails add ~1.1m, work lights ~0.3m → max.y should be
    // roughly 14–15, never the ~26 produced when poles lean from a tilted alignQuat.
    // This assertion FAILS against the pre-fix geometry (bbox.max.y≈26)
    // and PASSES after the fix (bbox.max.y≈14-16).
    expect(box.max.y).toBeLessThan(20);
  });

  it('has structural meshes (poles, planks, netting)', () => {
    const g = buildScaffolding(makeRng(5));
    let meshes = 0;
    g.traverse((o) => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(3);
  });

  it('is positioned along the scaffold zone (-Z corridor)', () => {
    const g = buildScaffolding(makeRng(5));
    const box = new THREE.Box3().setFromObject(g);
    // scaffold zone is at z≈-160 to -210 per route waypoints
    expect(box.min.z).toBeLessThan(-50);
  });

  it('is deterministic for a given seed', () => {
    const g1 = buildScaffolding(makeRng(77));
    const g2 = buildScaffolding(makeRng(77));
    let count1 = 0; let count2 = 0;
    g1.traverse((o) => { if ((o as any).isMesh) count1++; });
    g2.traverse((o) => { if ((o as any).isMesh) count2++; });
    expect(count1).toBe(count2);
  });
});
