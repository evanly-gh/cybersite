import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// --- DOM canvas stub — must come before any import that touches document ---
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain),
  set: () => true,
  apply: () => chain,
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain }),
};

import { buildDisplays } from '../src/world/displays';
import type { DisplayAnchor } from '../src/world/cityLayout';

const anchors: DisplayAnchor[] = [
  { pos: new THREE.Vector3(240, 14, -50),  quat: new THREE.Quaternion(), kind: 'aboutHero' },
  { pos: new THREE.Vector3(230, 20, -120), quat: new THREE.Quaternion(), kind: 'projBig' },
  { pos: new THREE.Vector3(0,   22,  -80), quat: new THREE.Quaternion(), kind: 'research' },
  { pos: new THREE.Vector3(10,  18, -200), quat: new THREE.Quaternion(), kind: 'projSmall' },
  { pos: new THREE.Vector3(20,   8,  -60), quat: new THREE.Quaternion(), kind: 'aboutSign' },
];

describe('displays', () => {
  it('builds a surface per anchor', () => {
    const d = buildDisplays(anchors);
    let meshes = 0;
    d.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(anchors.length);
  });

  it('group contains at least one child per anchor', () => {
    const d = buildDisplays(anchors);
    // The group has sub-groups (one per anchor), so children.length >= anchors.length
    let subgroups = 0;
    d.group.children.forEach((c) => {
      if (c instanceof THREE.Group || c.children?.length > 0 || (c as THREE.Mesh).isMesh) {
        subgroups++;
      }
    });
    expect(subgroups).toBeGreaterThanOrEqual(anchors.length);
  });

  it('updateAmbient runs without error', () => {
    const d = buildDisplays(anchors);
    expect(() => d.updateAmbient(0)).not.toThrow();
    expect(() => d.updateAmbient(5.5)).not.toThrow();
    expect(() => d.updateAmbient(100)).not.toThrow();
  });

  it('works with empty anchor list', () => {
    const d = buildDisplays([]);
    expect(d.group).toBeInstanceOf(THREE.Group);
    expect(() => d.updateAmbient(0)).not.toThrow();
  });

  it('correctly handles aboutHero anchor producing solid billboard meshes', () => {
    const d = buildDisplays([
      { pos: new THREE.Vector3(0, 10, 0), quat: new THREE.Quaternion(), kind: 'aboutHero' },
    ]);
    let meshes = 0;
    d.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    // buildBillboard produces 3-4 meshes
    expect(meshes).toBeGreaterThanOrEqual(3);
  });

  it('projBig anchor produces a holographic panel with at least one mesh', () => {
    const d = buildDisplays([
      { pos: new THREE.Vector3(0, 20, 0), quat: new THREE.Quaternion(), kind: 'projBig' },
    ]);
    let meshes = 0;
    d.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    // holo panel = 1 content plane + 4 frame edges = 5 meshes (at minimum 2)
    expect(meshes).toBeGreaterThanOrEqual(2);
  });
});
