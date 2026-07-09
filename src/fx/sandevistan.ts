/**
 * Task 22 — Sandevistan afterimage trail
 *
 * Signature visual motif: the "sandevistan time-stutter" — RGB-split ghost afterimages
 * trailing the Tron bike (Edgerunners reference).
 *
 * ## Interface
 * `buildSandevistan(ghostGeom: THREE.BufferGeometry): SandevistanTrail`
 * - `group`  : add to scene
 * - `record(worldMatrix, t)` : call each frame/tick with the bike's world matrix and scroll t
 * - `setMode('ride'|'finale')` : ride = 12 ghosts, finale = all 24
 * - `update(t)` : call after record; selects visible ghost set
 * - `reset()` : clears all accumulated state (call before a forced full rebuild)
 *
 * ## Material strategy
 * We use additive blending with `instanceColor` to encode both hue and brightness/opacity.
 * Additive blending means: color value 0 = invisible, 1 = fully bright. By scaling the
 * per-instance color's magnitude down, we get a dim/transparent-looking ghost without
 * needing alpha. This is the simplest robust approach — no custom shader required, and
 * it integrates naturally with UnrealBloom (brighter = more bloom).
 *
 * ## Scrub-safety
 * `record(worldMatrix, t)` is a pure function of the (worldMatrix, t) feed sequence.
 * When t decreases (backward scrub), we clear all accumulated state so that a subsequent
 * forward replay from the start produces identical distance-keyed snapshots. This makes
 * the visible ghost set a pure function of the current position / t value.
 *
 * `update(t)` renders from the snapshot buffer built by record(). The snapshot buffer
 * maintains an ordered array of active distance indices so the visible set is found in
 * O(visibleCount) rather than O(currentDistIndex).
 */

import * as THREE from 'three';
import { COLORS } from '../theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_GHOSTS = 24;
const SNAPSHOT_INTERVAL = 1.6; // metres between ghost snapshots
const RIDE_COUNT = 12;
const FINALE_COUNT = 24;

// RGB-split: 2 echo meshes for the first 3 ghosts each, pure R and pure B
const ECHO_GHOST_COUNT = 3;
const ECHO_LATERAL_OFFSET = 0.08; // metres screen-lateral

// Ride mode colour stops: tron-cyan → signal-magenta → violet
// opacity head→tail: 0.55 → 0.05 (encoded as colour magnitude with additive blending)
const RIDE_COLORS: THREE.Color[] = [
  new THREE.Color(COLORS.tronCyan),     // newest ghost
  new THREE.Color(COLORS.signalMagenta), // mid
  new THREE.Color(0x8800ff)             // violet, oldest visible
];

// Finale mode: full HSL rainbow, opacity 0.7→0.08
// (computed dynamically per-ghost based on index/count)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract world position from a Matrix4 */
function matrixPosition(m: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
  out.setFromMatrixPosition(m);
  return out;
}

/**
 * Interpolate colour along the RIDE_COLORS gradient.
 * t=0 → newest (tronCyan), t=1 → oldest (violet)
 */
function rideColor(t: number): THREE.Color {
  const c = RIDE_COLORS;
  if (t <= 0.5) {
    return c[0].clone().lerp(c[1], t * 2);
  } else {
    return c[1].clone().lerp(c[2], (t - 0.5) * 2);
  }
}

/**
 * HSL rainbow colour for finale mode.
 * t=0 → newest, t=1 → oldest
 */
function finaleColor(t: number): THREE.Color {
  const hue = t; // 0..1 → full spectrum
  return new THREE.Color().setHSL(hue, 1.0, 0.6);
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

interface Snapshot {
  distIndex: number;          // quantized distance slot (floor(dist / SNAPSHOT_INTERVAL))
  matrix: THREE.Matrix4;      // full world matrix at snapshot time
}

// ---------------------------------------------------------------------------
// buildSandevistan
// ---------------------------------------------------------------------------

export interface SandevistanTrail {
  group: THREE.Group;
  /** Feed the bike's current world matrix and scroll t. Call each frame before update(). */
  record(worldMatrix: THREE.Matrix4, t: number): void;
  /** Switch between ride (12 ghosts) and finale (24 ghosts, rainbow, bigger). */
  setMode(m: 'ride' | 'finale'): void;
  /** Refresh which ghosts are visible based on current t. Call after record(). */
  update(t: number): void;
  /** Clear all accumulated state. Call when forcing a full rebuild (e.g. large scrub jump). */
  reset(): void;
}

export function buildSandevistan(ghostGeom: THREE.BufferGeometry): SandevistanTrail {
  // -------------------------------------------------------------------------
  // Material: additive, depthWrite off, vertex colours (instanceColor)
  // -------------------------------------------------------------------------
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,  // enables instanceColor on InstancedMesh
    transparent: true,
    side: THREE.FrontSide
  });

  // -------------------------------------------------------------------------
  // Primary InstancedMesh (24 ghost slots)
  // -------------------------------------------------------------------------
  const mesh = new THREE.InstancedMesh(ghostGeom, mat, MAX_GHOSTS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0; // start with 0 visible

  // -------------------------------------------------------------------------
  // RGB-split echo meshes: 2 instanced copies of ECHO_GHOST_COUNT ghosts each
  // Red echo (offset +lateral) and Blue echo (offset -lateral).
  // color: 0xffffff so the per-instance color (set via setColorAt) carries
  // the pure R / pure B tint without double-applying the material color.
  // -------------------------------------------------------------------------
  const echoMatR = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    transparent: true,
    side: THREE.FrontSide
  });
  const echoMatB = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    transparent: true,
    side: THREE.FrontSide
  });

  const echoMeshR = new THREE.InstancedMesh(ghostGeom, echoMatR, ECHO_GHOST_COUNT);
  echoMeshR.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  echoMeshR.frustumCulled = false;
  echoMeshR.count = 0;

  const echoMeshB = new THREE.InstancedMesh(ghostGeom, echoMatB, ECHO_GHOST_COUNT);
  echoMeshB.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  echoMeshB.frustumCulled = false;
  echoMeshB.count = 0;

  // -------------------------------------------------------------------------
  // Group
  // -------------------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'sandevistan';
  group.add(mesh, echoMeshR, echoMeshB);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let mode: 'ride' | 'finale' = 'ride';

  /**
   * Distance-keyed snapshot store. Key = distIndex (integer).
   * At most MAX_GHOSTS * 2 entries kept — we evict old keys beyond the window.
   */
  const snapshots = new Map<number, Snapshot>();

  /**
   * Ordered array of active distIndex values, newest last (ascending).
   * Used for O(visibleCount) lookup in update() — avoid the unbounded backward scan.
   */
  const snapshotOrder: number[] = [];

  let prevPos = new THREE.Vector3();
  let accumulatedDist = 0;
  let hasFirstPos = false;
  let currentDistIndex = -1;

  /** Last t value seen by record(). Used to detect backward scrubs. */
  let lastRecordedT = -1;

  // Reusable temporaries
  const tmpPos = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpColor = new THREE.Color();

  // -------------------------------------------------------------------------
  // reset() — clear all accumulated state
  // -------------------------------------------------------------------------
  function reset(): void {
    snapshots.clear();
    snapshotOrder.length = 0;
    accumulatedDist = 0;
    hasFirstPos = false;
    currentDistIndex = -1;
    lastRecordedT = -1;
  }

  // -------------------------------------------------------------------------
  // record()
  // -------------------------------------------------------------------------
  function record(worldMatrix: THREE.Matrix4, t: number): void {
    // Scrub-safety: if t decreased (backward scrub) or this is the first call,
    // clear all accumulated state so a forward replay rebuilds identically.
    if (t < lastRecordedT) {
      reset();
    }
    lastRecordedT = t;

    matrixPosition(worldMatrix, tmpPos);

    if (!hasFirstPos) {
      prevPos.copy(tmpPos);
      hasFirstPos = true;
    }

    const stepDist = tmpPos.distanceTo(prevPos);
    accumulatedDist += stepDist;
    prevPos.copy(tmpPos);

    const newDistIndex = Math.floor(accumulatedDist / SNAPSHOT_INTERVAL);

    // Store snapshot if we've reached a new distance slot
    if (newDistIndex > currentDistIndex) {
      currentDistIndex = newDistIndex;
      snapshots.set(newDistIndex, {
        distIndex: newDistIndex,
        matrix: worldMatrix.clone()
      });
      snapshotOrder.push(newDistIndex);

      // Prune snapshots that are too far back to ever be displayed (keep MAX_GHOSTS * 2 for safety)
      const keepFrom = newDistIndex - MAX_GHOSTS * 2;
      // Remove from ordered array (prune from front)
      while (snapshotOrder.length > 0 && snapshotOrder[0] < keepFrom) {
        const evicted = snapshotOrder.shift()!;
        snapshots.delete(evicted);
      }
    }
  }

  // -------------------------------------------------------------------------
  // setMode()
  // -------------------------------------------------------------------------
  function setMode(m: 'ride' | 'finale'): void {
    mode = m;
  }

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  function update(_t: number): void {
    const visibleCount = mode === 'ride' ? RIDE_COUNT : FINALE_COUNT;
    const isFinale = mode === 'finale';

    // Collect the most recent snapshots up to currentDistIndex, newest-first.
    // snapshotOrder is ascending (oldest first), so read from the end.
    // This is O(visibleCount) — no unbounded backward scan.
    const orderLen = snapshotOrder.length;
    const availableIndices: number[] = [];
    for (let i = orderLen - 1; i >= 0 && availableIndices.length < visibleCount; i--) {
      availableIndices.push(snapshotOrder[i]);
    }

    const count = availableIndices.length;
    mesh.count = count;

    for (let i = 0; i < count; i++) {
      const idx = availableIndices[i];
      const snap = snapshots.get(idx)!;
      const tGhost = count > 1 ? i / (count - 1) : 0; // 0 = newest, 1 = oldest

      // Compute instance matrix, optionally with lateral offset and scale
      tmpMat.copy(snap.matrix);

      if (isFinale) {
        // Scale: 1.0 at head, 1.06 at tail (growing tailward)
        const scale = THREE.MathUtils.lerp(1.0, 1.06, tGhost);
        applyScaleToMatrix(tmpMat, scale);
      }

      // Lateral offset: alternating ±0.05m (ride) or 0 (finale uses echo only)
      if (!isFinale) {
        const lateralOffset = (i % 2 === 0 ? 1 : -1) * 0.05;
        applyLateralOffsetToMatrix(tmpMat, lateralOffset);
      }

      mesh.setMatrixAt(i, tmpMat);

      // Per-instance colour encodes hue + brightness (additive = magnitude = opacity)
      if (isFinale) {
        const brightness = THREE.MathUtils.lerp(0.7, 0.08, tGhost);
        tmpColor.copy(finaleColor(tGhost)).multiplyScalar(brightness * 2.5); // boost for bloom
        mesh.setColorAt(i, tmpColor);
      } else {
        // ride: gradient cyan→magenta→violet, opacity 0.55→0.05
        const brightness = THREE.MathUtils.lerp(0.55, 0.05, tGhost);
        tmpColor.copy(rideColor(tGhost)).multiplyScalar(brightness * 3.0); // boost for bloom
        mesh.setColorAt(i, tmpColor);
      }
    }

    // Fill unused slots with invisible identity (or just leave count set)
    // Three.js respects mesh.count, so no need to zero-out higher slots.

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // ---
    // RGB-split echo: apply to the first ECHO_GHOST_COUNT ghosts (newest = i=0..2)
    const echoCount = Math.min(ECHO_GHOST_COUNT, count);
    echoMeshR.count = echoCount;
    echoMeshB.count = echoCount;

    for (let i = 0; i < echoCount; i++) {
      const idx = availableIndices[i];
      const snap = snapshots.get(idx)!;
      const tGhost = count > 1 ? i / (count - 1) : 0;

      // Red echo: +ECHO_LATERAL_OFFSET
      const matR = snap.matrix.clone();
      applyLateralOffsetToMatrix(matR, ECHO_LATERAL_OFFSET);
      echoMeshR.setMatrixAt(i, matR);

      // Blue echo: -ECHO_LATERAL_OFFSET
      const matB = snap.matrix.clone();
      applyLateralOffsetToMatrix(matB, -ECHO_LATERAL_OFFSET);
      echoMeshB.setMatrixAt(i, matB);

      // Echo brightness: scaled from main ghost brightness.
      // Per-instance color carries pure R / pure B — echoMat{R,B} color is 0xffffff (neutral).
      const brightness = isFinale
        ? THREE.MathUtils.lerp(0.7, 0.08, tGhost) * 0.5
        : THREE.MathUtils.lerp(0.55, 0.05, tGhost) * 0.5;

      const redColor = new THREE.Color(brightness * 2.0, 0, 0);
      const blueColor = new THREE.Color(0, 0, brightness * 2.0);
      echoMeshR.setColorAt(i, redColor);
      echoMeshB.setColorAt(i, blueColor);
    }

    echoMeshR.instanceMatrix.needsUpdate = true;
    echoMeshB.instanceMatrix.needsUpdate = true;
    if (echoMeshR.instanceColor) echoMeshR.instanceColor.needsUpdate = true;
    if (echoMeshB.instanceColor) echoMeshB.instanceColor.needsUpdate = true;
  }

  return { group, record, setMode, update, reset };
}

// ---------------------------------------------------------------------------
// Matrix helpers
// ---------------------------------------------------------------------------

/**
 * Apply uniform scale to a world matrix in-place.
 * Scales the upper-left 3×3 (orientation + scale) without touching translation.
 */
function applyScaleToMatrix(m: THREE.Matrix4, scale: number): void {
  const e = m.elements;
  // Columns 0..2 (rows 0..2) are the orientation+scale part
  for (let col = 0; col < 3; col++) {
    const base = col * 4;
    e[base] *= scale;
    e[base + 1] *= scale;
    e[base + 2] *= scale;
  }
}

/**
 * Offset the world matrix translation along the matrix's local Z-axis (screen-lateral).
 * +offset = toward local +Z (rider's right), -offset = local -Z (rider's left).
 */
function applyLateralOffsetToMatrix(m: THREE.Matrix4, offsetZ: number): void {
  const e = m.elements;
  // Local Z-axis is column 2 of the rotation part (indices 8,9,10)
  const localZx = e[8];
  const localZy = e[9];
  const localZz = e[10];
  // Normalise (in case matrix has scale from finale mode)
  const len = Math.sqrt(localZx * localZx + localZy * localZy + localZz * localZz);
  const s = len > 1e-6 ? offsetZ / len : 0;
  // Translation column is column 3 (indices 12,13,14)
  e[12] += localZx * s;
  e[13] += localZy * s;
  e[14] += localZz * s;
}
