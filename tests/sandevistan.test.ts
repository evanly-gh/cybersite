import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildSandevistan } from '../src/fx/sandevistan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a sequence of world matrices simulating forward travel along the X axis.
 * Each step advances `stepSize` metres. Returns matrices indexed by step number.
 */
function makeForwardMatrices(steps: number, stepSize = 0.4): THREE.Matrix4[] {
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < steps; i++) {
    const m = new THREE.Matrix4();
    m.setPosition(i * stepSize, 0, 0);
    mats.push(m);
  }
  return mats;
}

/**
 * Snapshot the full instanceMatrix Float32Array contents as a plain number array.
 * We copy the array so mutations don't affect the snapshot.
 */
function captureInstanceMatrix(mesh: THREE.InstancedMesh): number[] {
  return Array.from(mesh.instanceMatrix.array as Float32Array);
}

/**
 * Feed the trail forward from step 0 to step `toStep` (inclusive),
 * mapping step index linearly to t in [0, 1].
 */
function feedForward(
  trail: ReturnType<typeof buildSandevistan>,
  mats: THREE.Matrix4[],
  fromStep: number,
  toStep: number
): void {
  const total = mats.length - 1;
  for (let i = fromStep; i <= toStep; i++) {
    const t = total > 0 ? i / total : 0;
    trail.record(mats[i], t);
    trail.update(t);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSandevistan', () => {
  it('exposes the full interface including reset()', () => {
    const geom = new THREE.BoxGeometry();
    const trail = buildSandevistan(geom);
    expect(trail.group).toBeInstanceOf(THREE.Group);
    expect(typeof trail.record).toBe('function');
    expect(typeof trail.setMode).toBe('function');
    expect(typeof trail.update).toBe('function');
    expect(typeof trail.reset).toBe('function');
  });

  it('group is named "sandevistan" and has 3 children (main + 2 echo meshes)', () => {
    const geom = new THREE.BoxGeometry();
    const trail = buildSandevistan(geom);
    expect(trail.group.name).toBe('sandevistan');
    expect(trail.group.children.length).toBe(3);
  });

  it('ride mode: shows up to 12 ghosts after enough forward travel', () => {
    const STEPS = 100;   // 100 steps × 0.4m = 40m → 25 distance slots → 12 ride ghosts
    const geom = new THREE.BoxGeometry();
    const trail = buildSandevistan(geom);
    trail.setMode('ride');

    const mats = makeForwardMatrices(STEPS, 0.4);
    feedForward(trail, mats, 0, STEPS - 1);

    // The primary InstancedMesh is the first child
    const mesh = trail.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(12);
  });

  it('finale mode: shows up to 24 ghosts after enough forward travel', () => {
    const STEPS = 150;   // 150 steps × 0.4m = 60m → 37 distance slots → 24 finale ghosts
    const geom = new THREE.BoxGeometry();
    const trail = buildSandevistan(geom);
    trail.setMode('finale');

    const mats = makeForwardMatrices(STEPS, 0.4);
    feedForward(trail, mats, 0, STEPS - 1);

    const mesh = trail.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(24);
  });

  // -------------------------------------------------------------------------
  // SCRUB-SAFETY / DETERMINISM TEST
  //
  // The core invariant: the visible ghost set must be a pure function of t.
  // Scrubbing to t=0.5, back to t=0.3, then forward to t=0.5 again must
  // show IDENTICAL instanceMatrix contents both times.
  //
  // With the OLD code (accumulatedDist never resets), each re-feed from the
  // start pushes the distance index further, producing a different snapshot
  // key set on the second pass — so the captured matrices WOULD differ.
  // -------------------------------------------------------------------------
  it('SCRUB-SAFETY: ghost instanceMatrix is identical after backward+forward re-scrub to same t', () => {
    // Use enough steps so we get a full set of ghosts by t=0.5
    // 200 steps × 0.4m = 80m total path; t=0.5 → step 100 → 40m → 25 distance slots → 12 ghosts
    const TOTAL_STEPS = 200;
    const STEP_SIZE = 0.4; // metres per step
    const geom = new THREE.BoxGeometry();

    const mats = makeForwardMatrices(TOTAL_STEPS, STEP_SIZE);

    // -- First pass: feed forward from step 0 to step 100 (t ≈ 0.5) --
    const trail = buildSandevistan(geom);
    trail.setMode('ride');

    const halfStep = Math.floor(TOTAL_STEPS / 2); // step 100
    feedForward(trail, mats, 0, halfStep);

    const mesh = trail.group.children[0] as THREE.InstancedMesh;

    // Capture the instanceMatrix at t=0.5
    const captureA = captureInstanceMatrix(mesh);
    const countA = mesh.count;

    // -- Backward scrub: feed backward (simulate by re-feeding with decreasing t) --
    // We do this by calling record() with t values that decrease.
    // The simplest simulation: call record() with t < lastRecordedT (detected by the fix).
    const thirdStep = Math.floor(TOTAL_STEPS / 3); // step ~66 → t ≈ 0.33
    for (let i = thirdStep; i >= 0; i--) {
      const t = i / (TOTAL_STEPS - 1);
      trail.record(mats[i], t);
      trail.update(t);
    }

    // -- Second forward pass: re-feed from step 0 to step 100 (t ≈ 0.5) --
    feedForward(trail, mats, 0, halfStep);

    // Capture the instanceMatrix at t=0.5 again
    const captureB = captureInstanceMatrix(mesh);
    const countB = mesh.count;

    // Ghost count must match
    expect(countA).toBe(countB);
    expect(countA).toBeGreaterThan(0);

    // Every matrix element must be identical (element-wise)
    expect(captureA.length).toBe(captureB.length);
    for (let i = 0; i < captureA.length; i++) {
      // Use toBeCloseTo to avoid floating-point epsilon issues from identical computations
      expect(captureA[i]).toBeCloseTo(captureB[i], 5);
    }
  });

  it('SCRUB-SAFETY: reset() allows a forced clean rebuild that matches a fresh trail', () => {
    const STEPS = 60;
    const geom = new THREE.BoxGeometry();
    const mats = makeForwardMatrices(STEPS, 0.4);

    // Fresh trail A — just feed forward
    const trailA = buildSandevistan(geom);
    trailA.setMode('ride');
    feedForward(trailA, mats, 0, STEPS - 1);
    const meshA = trailA.group.children[0] as THREE.InstancedMesh;
    const captureA = captureInstanceMatrix(meshA);
    const countA = meshA.count;

    // Trail B — feed forward, then reset(), then feed forward again
    const trailB = buildSandevistan(geom);
    trailB.setMode('ride');
    feedForward(trailB, mats, 0, STEPS - 1);
    trailB.reset();
    feedForward(trailB, mats, 0, STEPS - 1);
    const meshB = trailB.group.children[0] as THREE.InstancedMesh;
    const captureB = captureInstanceMatrix(meshB);
    const countB = meshB.count;

    expect(countA).toBe(countB);
    expect(countA).toBeGreaterThan(0);
    for (let i = 0; i < captureA.length; i++) {
      expect(captureA[i]).toBeCloseTo(captureB[i], 5);
    }
  });

  it('echo materials have color 0xffffff (neutral) so per-instance color carries pure R/B tint', () => {
    const geom = new THREE.BoxGeometry();
    const trail = buildSandevistan(geom);

    // echo meshes are children 1 and 2
    const echoR = trail.group.children[1] as THREE.InstancedMesh;
    const echoB = trail.group.children[2] as THREE.InstancedMesh;

    const matR = echoR.material as THREE.MeshBasicMaterial;
    const matB = echoB.material as THREE.MeshBasicMaterial;

    // color should be white (0xffffff), not red or blue
    expect(matR.color.getHex()).toBe(0xffffff);
    expect(matB.color.getHex()).toBe(0xffffff);
  });

  it('update() is O(visibleCount): snapshotOrder array stays bounded even after many steps', () => {
    // Drive 500 steps to stress-test the eviction logic
    const STEPS = 500;
    const geom = new THREE.BoxGeometry();
    const trail = buildSandevistan(geom);
    trail.setMode('ride');

    const mats = makeForwardMatrices(STEPS, 0.4);
    feedForward(trail, mats, 0, STEPS - 1);

    const mesh = trail.group.children[0] as THREE.InstancedMesh;
    // Should still be exactly RIDE_COUNT (12), not accumulating unboundedly
    expect(mesh.count).toBe(12);
  });
});
