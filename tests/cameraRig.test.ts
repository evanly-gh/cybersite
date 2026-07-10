/**
 * Task 25 TDD: CameraRig tests.
 *
 * Tests:
 *  1. addKeys throws when a second batch's t-range overlaps an existing batch (interior)
 *  2. addKeys does NOT throw on shared boundary t (intro→about handoff at t=0.10)
 *  3. evaluate produces finite pos/look/fov at various t values
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/choreography/cameraRig';

// ---- helpers ---------------------------------------------------------------

function makePose(px: number, py: number, pz: number): {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll: number;
} {
  return {
    pos: new THREE.Vector3(px, py, pz),
    look: new THREE.Vector3(0, 0, 0),
    fov: 60,
    roll: 0
  };
}

// ---- tests -----------------------------------------------------------------

describe('CameraRig', () => {
  it('addKeys throws when second batch t-range overlaps existing (interior overlap)', () => {
    const rig = new CameraRig();
    // Register intro camera keys: t=[0, 0.08]
    rig.addKeys([
      { t: 0, pose: makePose(120, 190, -60) },
      { t: 0.04, pose: makePose(20, 40, -18) },
      { t: 0.08, pose: makePose(-272, 2, -6) }
    ]);
    // Attempt to register keys with t starting at 0.05 (interior overlap with existing)
    expect(() => {
      rig.addKeys([
        { t: 0.05, pose: makePose(-270, 2, -6) },
        { t: 0.28, pose: makePose(-200, 5, -10) }
      ]);
    }).toThrow(/overlapping t range/i);
  });

  it('addKeys does NOT throw when second batch starts at exact boundary t (shared boundary)', () => {
    const rig = new CameraRig();
    // Register intro camera keys ending at t=0.08
    rig.addKeys([
      { t: 0, pose: makePose(120, 190, -60) },
      { t: 0.04, pose: makePose(20, 40, -18) },
      { t: 0.08, pose: makePose(-272, 2, -6) }
    ]);
    // Register about keys starting at t=0.08 (shared boundary) — must NOT throw
    expect(() => {
      rig.addKeys([
        { t: 0.08, pose: makePose(-272, 2, -6) },
        { t: 0.28, pose: makePose(-200, 5, -10) }
      ]);
    }).not.toThrow();
  });

  it('CameraRig.addKeys: non-overlapping sequential batches (intro [0,0.10] then about [0.10,0.28])', () => {
    const rig = new CameraRig();
    // Simulate intro ending at t=0.10 and about starting at t=0.10
    rig.addKeys([
      { t: 0, pose: makePose(120, 190, -60) },
      { t: 0.10, pose: makePose(-272, 2, -6) }
    ]);
    expect(() => {
      rig.addKeys([
        { t: 0.10, pose: makePose(-272, 2, -6) },
        { t: 0.28, pose: makePose(-200, 5, -10) }
      ]);
    }).not.toThrow();
  });

  it('evaluate produces finite pos and fov at various t values', () => {
    const rig = new CameraRig();
    rig.addKeys([
      { t: 0, pose: makePose(120, 190, -60) },
      { t: 0.04, pose: makePose(20, 40, -18) },
      { t: 0.08, pose: makePose(-272, 2, -6) },
      { t: 0.28, pose: makePose(-200, 5, -10) }
    ]);

    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
    for (const t of [0, 0.02, 0.04, 0.06, 0.08, 0.15, 0.28, 1.0]) {
      rig.evaluate(t, cam);
      expect(isFinite(cam.position.x)).toBe(true);
      expect(isFinite(cam.position.y)).toBe(true);
      expect(isFinite(cam.position.z)).toBe(true);
      expect(isFinite(cam.fov)).toBe(true);
    }
  });

  it('addKeys overlap guard: strictly-interior overlap throws even with multiple existing keys', () => {
    const rig = new CameraRig();
    rig.addKeys([
      { t: 0, pose: makePose(0, 0, 0) },
      { t: 0.10, pose: makePose(1, 0, 0) }
    ]);
    rig.addKeys([
      { t: 0.10, pose: makePose(1, 0, 0) },
      { t: 0.28, pose: makePose(2, 0, 0) }
    ]);
    // Now overlap with second batch (start at 0.20, inside [0.10, 0.28])
    expect(() => {
      rig.addKeys([
        { t: 0.20, pose: makePose(3, 0, 0) },
        { t: 0.50, pose: makePose(4, 0, 0) }
      ]);
    }).toThrow(/overlapping t range/i);
  });
});
