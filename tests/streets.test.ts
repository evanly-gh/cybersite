// tests/streets.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildStreets, ROAD_HALF_WIDTH } from '../src/world/streets';
import { makeRng } from '../src/utils/rng';

describe('streets', () => {
  it('builds a streets group with meshes', () => {
    const g = buildStreets(makeRng(1));
    expect(g.name).toBe('streets');
    let meshes = 0;
    g.traverse((o) => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(3); // road + 2 sidewalks + ground
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
