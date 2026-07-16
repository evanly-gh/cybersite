/**
 * Drift Smoke FX — Shibuya 90° right turn
 *
 * Emits soft quad-based smoke puffs at the ZONES.turn band (t 0.28..0.36).
 * Each puff is a billboard quad (always facing +Y camera) positioned
 * deterministically from its slot index — no Math.random at runtime, no
 * wall-clock accumulation.
 *
 * Palette: neutral warm smoke (desaturated amber/white) — NOT tron-cyan,
 * keeping city ambiance non-cyan per the palette rule.
 *
 * update(t) is a pure function of t — scrub-safe.
 */

import * as THREE from 'three';
import { ZONES, sampleRoute } from '../world/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const [TURN_START, TURN_END] = ZONES.turn;
const TURN_MID = (TURN_START + TURN_END) / 2;

/** Smoke puff disc radius (half-extent of the billboard quad). */
const PUFF_RADIUS = 1.4;

/** Maximum vertical rise of a puff from its spawn point. */
const PUFF_RISE = 3.0;

/** Maximum horizontal spread radius of puffs around the spawn point. */
const PUFF_SPREAD_XZ = 2.5;

/** Maximum opacity of a fresh puff. */
const PUFF_OPACITY_MAX = 0.28;

/**
 * How wide a t-band each puff is visible across (fraction of the full turn
 * band). Larger = puffs linger longer.
 */
const PUFF_LIFE_T = 0.04;

/** Smoke colour: warm near-white with a faint amber tint. */
const SMOKE_COLOR = new THREE.Color(0xd8c8a0);

// ---------------------------------------------------------------------------
// Deterministic pseudo-random helpers (seeded from slot index, no runtime RNG)
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random float in [-1, 1] from two integers. */
function prng(a: number, b: number): number {
  // Simple hash via bit manipulation — no Math.random.
  let h = (a * 1664525 + b * 22695477 + 1013904223) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h & 0x7fffffff) / 0x7fffffff * 2 - 1; // [-1, 1]
}

// ---------------------------------------------------------------------------
// buildDriftFx
// ---------------------------------------------------------------------------

export function buildDriftFx(maxSmoke: number): {
  group: THREE.Group;
  update(t: number): void;
} {
  const group = new THREE.Group();
  group.name = 'driftFx';

  // Shared puff geometry: a unit circle (flat disc) in XZ plane.
  const puffGeom = new THREE.CircleGeometry(PUFF_RADIUS, 10);
  // Rotate so the circle lies horizontally (billboard facing up/camera).
  puffGeom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

  // Pre-compute each puff's spawn t within the turn band and its positional
  // offsets (deterministic from slot index).
  interface PuffSpec {
    spawnT: number;           // t at which this puff "emits"
    offsetX: number;          // XZ spread from route position (route-local X)
    offsetZ: number;          // XZ spread from route position (route-local Z)
  }

  const specs: PuffSpec[] = Array.from({ length: maxSmoke }, (_, i) => {
    // Spread spawn t across the turn band.
    const spawnT = TURN_START + (i / Math.max(maxSmoke - 1, 1)) * (TURN_END - TURN_START);
    const offsetX = prng(i, 1) * PUFF_SPREAD_XZ;
    const offsetZ = prng(i, 2) * PUFF_SPREAD_XZ;
    return { spawnT, offsetX, offsetZ };
  });

  // Sample route positions for each puff's spawn t (fixed, not changing per frame).
  const spawnPositions: THREE.Vector3[] = specs.map((s) => sampleRoute(s.spawnT).pos.clone());

  // Pre-allocate puff meshes.
  const puffs: THREE.Mesh[] = Array.from({ length: maxSmoke }, (_, i) => {
    const mat = new THREE.MeshBasicMaterial({
      color: SMOKE_COLOR.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(puffGeom, mat);
    mesh.name = `smokePuff_${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;

    // Apply deterministic XZ offset to the mesh position (relative to its spawn point).
    mesh.position.x += specs[i].offsetX;
    mesh.position.z += specs[i].offsetZ;

    group.add(mesh);
    return mesh;
  });

  /**
   * Update all smoke puffs based on scroll progress t.
   * Pure function of t — scrub-safe.
   */
  function update(t: number): void {
    // Global turn envelope: fade in at TURN_START, full through TURN_MID, fade out at TURN_END.
    // Puffs only appear when t is in the vicinity of the turn band (with slight overhang).
    const turnActive = t >= TURN_START - PUFF_LIFE_T && t <= TURN_END + PUFF_LIFE_T;

    for (let i = 0; i < maxSmoke; i++) {
      const mesh = puffs[i];
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const { spawnT } = specs[i];

      if (!turnActive) {
        mesh.visible = false;
        mat.opacity = 0;
        continue;
      }

      // Puff life: active when t is in [spawnT, spawnT + PUFF_LIFE_T].
      const age = t - spawnT; // positive when puff has "emitted"
      if (age < 0 || age > PUFF_LIFE_T) {
        mesh.visible = false;
        mat.opacity = 0;
        continue;
      }

      // life fraction [0, 1]: 0 = just spawned, 1 = fully faded.
      const life = age / PUFF_LIFE_T;

      // Opacity: rise to max at life=0.3, then fade to 0 at life=1.
      const rawOpacity =
        life < 0.3
          ? PUFF_OPACITY_MAX * (life / 0.3)
          : PUFF_OPACITY_MAX * (1 - (life - 0.3) / 0.7);
      mat.opacity = Math.max(0, rawOpacity);

      // Position: spawn position + XZ offset + upward drift proportional to life.
      const base = spawnPositions[i];
      mesh.position.set(
        base.x + specs[i].offsetX,
        base.y + life * PUFF_RISE,
        base.z + specs[i].offsetZ
      );

      // Scale puff out as it rises (expands as smoke disperses).
      const s = 1 + life * 1.5;
      mesh.scale.setScalar(s);

      mesh.visible = mat.opacity > 0.005;
    }
  }

  return { group, update };
}
