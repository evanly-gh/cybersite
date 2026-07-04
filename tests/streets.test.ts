import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// streets.ts builds CanvasTextures for its road/crossing materials via makeCanvasTexture,
// which needs a DOM canvas. Stub the minimal surface it touches (createElement ->
// width/height + a 2D context whose every method/property access is a no-op) so the
// builders run under node. Safe despite import hoisting: streets.ts only touches
// `document` inside buildStreets(), never at module-evaluation time.
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => new Proxy({}, { get: () => () => ({}), set: () => true })
  })
};

import { buildStreets, STREET_WIDTH, SIDEWALK_W } from '../src/world/streets';

function meshesOf(group: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

describe('streets', () => {
  it('exposes street dimension constants matching the brief', () => {
    expect(STREET_WIDTH).toBe(14);
    expect(SIDEWALK_W).toBe(3);
  });

  it('buildStreets returns a Group with at most 25 meshes (draw-call budget)', () => {
    const group = buildStreets(makeRng(1));
    expect(group).toBeInstanceOf(THREE.Group);
    const meshes = meshesOf(group);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(25);
    // Each mesh must be a single real draw call: three.js only splits a mesh into
    // per-group draw calls when its material is an array.
    for (const mesh of meshes) {
      expect(Array.isArray(mesh.material)).toBe(false);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = buildStreets(makeRng(1));
    const b = buildStreets(makeRng(1));
    const meshesA = meshesOf(a);
    const meshesB = meshesOf(b);
    expect(meshesA.length).toBe(meshesB.length);
    const vertsA = meshesA[0].geometry.getAttribute('position').count;
    const vertsB = meshesB[0].geometry.getAttribute('position').count;
    expect(vertsA).toBe(vertsB);
  });

  it('has a road surface at (240, ~0, -25) — regression: plaza-boulevard gap', () => {
    // The plaza slab covers z in [-20, +20]; the boulevard used to start at driftExit
    // (z = -30), leaving a 10m hole on the ride path at z in (-30, -20). Raycast straight
    // down through the middle of that former hole and expect road at y ~= 0.
    const group = buildStreets(makeRng(1));
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(240, 5, -25), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(group, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.abs(hits[0].point.y)).toBeLessThanOrEqual(0.1);
  });

  it('keeps About-street markings out of the plaza footprint — regression: stripe through crossing', () => {
    // Markings top out at y = 0.025, above the plaza slab top (y = 0.02). Raycast down at
    // a point inside the plaza on the old About-street centerline path (x = 230, z = 0,
    // where the centerline used to run through) and require the topmost opaque hit to be
    // the plaza surface, not a marking box. The crossing decal (transparent overlay plane
    // at y = 0.03) is excluded — raycasts ignore material transparency.
    const group = buildStreets(makeRng(1));
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(230, 5, 0), new THREE.Vector3(0, -1, 0));
    const hits = ray
      .intersectObject(group, true)
      .filter((h) => !((h.object as THREE.Mesh).material as THREE.Material).transparent);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.y).toBeLessThanOrEqual(0.021);
  });
});
