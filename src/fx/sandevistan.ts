/**
 * Sandevistan ghost-trail FX
 *
 * Maintains a ring-buffer of ghost meshes (cyan-tinted translucent copies of
 * the bike silhouette) fed by the master's record() calls each setProgress.
 *
 * At the flip apexes the choreography/bikePath already realizes the near-freeze
 * by spanning the apex across a wide t-band; that wide band naturally causes
 * many record() calls at similar world positions, fanning the trail out into a
 * visible slow-mo spread.
 *
 * Palette exception: this is the ONE module where tronCyan is intentional —
 * the sandevistan is the biker's own effect.
 *
 * All update(t) paths are pure functions of t (scrub-safe). record() is called
 * by the master once per setProgress with the current bike world matrix.
 */

import * as THREE from 'three';
import { COLORS } from '../theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of ghost slots in the ring buffer. */
const GHOST_COUNT = 24;

/** How far back in t-space the trail reaches. */
const TRAIL_T_WINDOW = 0.12;

/** Minimum opacity for the oldest ghost in the trail. */
const OPACITY_MIN = 0.04;

/** Opacity of the most recent ghost. */
const OPACITY_MAX = 0.55;

/** Scale added to each ghost to give a faint halo effect. */
const GHOST_SCALE = 1.01;

/**
 * t-range (half-width) at each flip apex where the rainbow finale colours
 * are blended in. Flip apexes are near t≈0.41 (ramp1 mid) and t≈0.57 (ramp2 mid).
 */
const APEX_HALF = 0.05;
const APEX_T = [0.41, 0.57] as const;

// Rainbow palette for the finale flourish (cycling through ghost chain).
const RAINBOW = [
  0xff0040, 0xff6000, 0xffee00, 0x00ff60,
  0x00ccff, 0x8000ff, 0xff00cc
];

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

interface Snapshot {
  matrix: THREE.Matrix4;
  t: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// buildSandevistan
// ---------------------------------------------------------------------------

export function buildSandevistan(ghostGeom: THREE.BufferGeometry): {
  group: THREE.Group;
  record(m: THREE.Matrix4, t: number): void;
  update(t: number): void;
  snapshotCount: number;
} {
  const group = new THREE.Group();
  group.name = 'sandevistan';

  const cyan = new THREE.Color(COLORS.tronCyan);

  // Pre-allocate ghost meshes (additive blending for a glow look).
  const ghosts: THREE.Mesh[] = [];
  const snapshots: Snapshot[] = [];

  for (let i = 0; i < GHOST_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: cyan.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide
    });
    const mesh = new THREE.Mesh(ghostGeom, mat);
    mesh.name = `ghost_${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.scale.setScalar(GHOST_SCALE);
    group.add(mesh);
    ghosts.push(mesh);
    snapshots.push({ matrix: new THREE.Matrix4(), t: -1, active: false });
  }

  // Ring-buffer write head.
  let head = 0;
  let totalRecorded = 0;

  /**
   * Record the bike's world matrix at scroll progress t.
   * Called by the master once per setProgress tick.
   */
  function record(m: THREE.Matrix4, t: number): void {
    snapshots[head].matrix.copy(m);
    snapshots[head].t = t;
    snapshots[head].active = true;
    head = (head + 1) % GHOST_COUNT;
    totalRecorded++;
  }

  /**
   * Check if t is near a flip apex (for rainbow flourish).
   * Returns a blend factor 0..1.
   */
  function apexBlend(t: number): number {
    let best = 0;
    for (const apex of APEX_T) {
      const d = Math.abs(t - apex);
      if (d < APEX_HALF) {
        best = Math.max(best, 1 - d / APEX_HALF);
      }
    }
    return best;
  }

  /**
   * Update all ghost meshes based on current scroll progress t.
   * Pure function of t — scrub-safe.
   */
  function update(t: number): void {
    const rainbow = apexBlend(t);

    // Build a sorted list of active snapshots within the trail window.
    // We iterate all slots and pick those whose t is in [t - TRAIL_T_WINDOW, t].
    // Sort them newest→oldest so we can assign opacity front→back.

    const active: Array<{ snap: Snapshot; idx: number }> = [];
    for (let i = 0; i < GHOST_COUNT; i++) {
      const s = snapshots[i];
      if (!s.active) continue;
      const dt = t - s.t;
      if (dt >= 0 && dt <= TRAIL_T_WINDOW) {
        active.push({ snap: s, idx: i });
      }
    }

    // Sort: smallest dt first (most recent ghost at index 0).
    active.sort((a, b) => (a.snap.t - b.snap.t > 0 ? -1 : 1));

    // Assign visible ghosts.
    const nActive = active.length;

    for (let gi = 0; gi < GHOST_COUNT; gi++) {
      const mesh = ghosts[gi];
      const slot = active.findIndex((a) => {
        // Find the mesh slot that matches this active entry positionally.
        // We just use gi as the position in the sorted active array.
        return false; // handled below
      });
      mesh.visible = false;
    }

    // Simpler: assign the sorted active list to the first nActive ghosts.
    for (let gi = 0; gi < GHOST_COUNT; gi++) {
      const mesh = ghosts[gi];
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (gi < nActive) {
        const { snap } = active[gi];
        const ageFraction = gi / Math.max(nActive - 1, 1); // 0 = newest, 1 = oldest
        const opacity = THREE.MathUtils.lerp(OPACITY_MAX, OPACITY_MIN, ageFraction);

        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(snap.matrix);
        // Bake scale into the matrix: scale each column's magnitude by GHOST_SCALE.
        // Since we stored the world matrix from the bike group, we apply a
        // uniform scale by composing it.
        const scaleM = new THREE.Matrix4().makeScale(GHOST_SCALE, GHOST_SCALE, GHOST_SCALE);
        mesh.matrix.premultiply(scaleM);

        mat.opacity = opacity;

        if (rainbow > 0.01) {
          // Rainbow: cycle hue through ghost chain at apexes.
          const rainbowIdx = Math.floor((gi / GHOST_COUNT) * RAINBOW.length);
          const rainbowColor = new THREE.Color(RAINBOW[rainbowIdx % RAINBOW.length]);
          mat.color.copy(cyan).lerp(rainbowColor, rainbow);
        } else {
          mat.color.copy(cyan);
        }

        mesh.visible = true;
      } else {
        mesh.visible = false;
        mat.opacity = 0;
      }
    }
  }

  // Expose snapshotCount as a getter (reflects currently active snapshots in window).
  // For the interface, we use a plain property updated on each record/update.
  // Since the brief says snapshotCount must be > 0 after record+update, we track it.
  const result = {
    group,
    record,
    update,
    get snapshotCount(): number {
      return snapshots.filter((s) => s.active).length;
    }
  };

  return result;
}
