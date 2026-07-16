import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyNeonMaterials } from '../src/assets/buildings/neocity';
import { makeRng } from '../src/utils/rng';
import { COLORS } from '../src/theme';

/**
 * Build a group with one NEO_EMISSIVE mesh and one NEO_BODY mesh.
 * No geometry needed beyond a bare BufferGeometry — we only test materials.
 */
function makeTestGroup(): THREE.Group {
  const group = new THREE.Group();

  const emissiveMat = new THREE.MeshStandardMaterial({ name: 'NEO_EMISSIVE' });
  const emissiveMesh = new THREE.Mesh(new THREE.BufferGeometry(), emissiveMat);
  emissiveMesh.name = 'lights';
  group.add(emissiveMesh);

  const bodyMat = new THREE.MeshStandardMaterial({ name: 'NEO_BODY' });
  const bodyMesh = new THREE.Mesh(new THREE.BufferGeometry(), bodyMat);
  bodyMesh.name = 'body';
  group.add(bodyMesh);

  return group;
}

describe('applyNeonMaterials — NEO_EMISSIVE / NEO_BODY two-bucket', () => {
  it('NEO_EMISSIVE mesh gets a non-black emissive color', () => {
    const group = makeTestGroup();
    applyNeonMaterials(group, makeRng(1));

    const emissiveMesh = group.children[0] as THREE.Mesh;
    const mat = emissiveMesh.material as THREE.MeshStandardMaterial;

    // Must have actual emissive (not black)
    expect(mat.emissive.getHex()).not.toBe(0x000000);
    // emissiveIntensity must be > 0
    expect(mat.emissiveIntensity).toBeGreaterThan(0);
  });

  it('NEO_EMISSIVE mesh never uses tronCyan (reserved for bike)', () => {
    // Check multiple seeds to be confident tronCyan is never picked
    for (let seed = 0; seed < 20; seed++) {
      const group = makeTestGroup();
      applyNeonMaterials(group, makeRng(seed));

      const emissiveMesh = group.children[0] as THREE.Mesh;
      const mat = emissiveMesh.material as THREE.MeshStandardMaterial;

      expect(mat.emissive.getHex()).not.toBe(COLORS.tronCyan);
    }
  });

  it('NEO_BODY mesh has near-zero emissiveIntensity (dark/non-glowing)', () => {
    const group = makeTestGroup();
    applyNeonMaterials(group, makeRng(1));

    const bodyMesh = group.children[1] as THREE.Mesh;
    const mat = bodyMesh.material as THREE.MeshStandardMaterial;

    expect(mat.emissiveIntensity).toBeLessThanOrEqual(0.05);
  });

  it('NEO_EMISSIVE picks from the allowed neon palette deterministically', () => {
    const allowedNeons = [COLORS.holoTeal, COLORS.signalMagenta, COLORS.sodiumAmber, COLORS.moonlight];

    for (let seed = 0; seed < 10; seed++) {
      const group = makeTestGroup();
      applyNeonMaterials(group, makeRng(seed));

      const emissiveMesh = group.children[0] as THREE.Mesh;
      const mat = emissiveMesh.material as THREE.MeshStandardMaterial;
      const hex = mat.emissive.getHex();

      expect(allowedNeons).toContain(hex);
    }
  });

  it('is deterministic: same seed produces same emissive color', () => {
    const groupA = makeTestGroup();
    applyNeonMaterials(groupA, makeRng(42));

    const groupB = makeTestGroup();
    applyNeonMaterials(groupB, makeRng(42));

    const matA = (groupA.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const matB = (groupB.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;

    expect(matA.emissive.getHex()).toBe(matB.emissive.getHex());
    expect(matA.emissiveIntensity).toBe(matB.emissiveIntensity);
  });

  it('unknown material name falls back to body treatment (dark, non-emissive)', () => {
    const group = new THREE.Group();
    const unknownMat = new THREE.MeshStandardMaterial({ name: 'RANDOM_MATERIAL' });
    const unknownMesh = new THREE.Mesh(new THREE.BufferGeometry(), unknownMat);
    group.add(unknownMesh);

    applyNeonMaterials(group, makeRng(1));

    const mat = unknownMesh.material as THREE.MeshStandardMaterial;
    expect(mat.emissiveIntensity).toBeLessThanOrEqual(0.05);
  });
});
