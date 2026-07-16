/**
 * Light Pools FX
 *
 * Renders additive ground-disc glows under each source object (bike + traffic
 * vehicles). Each source gets a disc at y≈0.05 that follows the source's world
 * XZ position every update(t) call.
 *
 * Palette: bike pool may use a teal/cyan wash; traffic pools use sodiumAmber
 * for a warm city-ambiance read (not hard-cyan — that would violate the rule
 * that cyan belongs only to the bike/rider FX).
 *
 * All update(t) paths are pure repositions — scrub-safe.
 */

import * as THREE from 'three';
import { COLORS } from '../theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ground plane y for the disc centres. */
const POOL_Y = 0.05;

/** Disc geometry parameters. */
const DISC_RADIUS = 2.2;
const DISC_SEGMENTS = 20;

/** Opacity of each pool disc (additive blending so it accumulates). */
const POOL_OPACITY = 0.18;

// Two pool color presets.
// Index 0 = first source (bike): teal-cyan wash.
// Index 1+ = other sources (traffic): warm sodium-amber.
const COLOR_BIKE = new THREE.Color(COLORS.tronCyan).multiplyScalar(0.6);
const COLOR_TRAFFIC = new THREE.Color(COLORS.sodiumAmber).multiplyScalar(0.45);

// ---------------------------------------------------------------------------
// buildLightPools
// ---------------------------------------------------------------------------

export function buildLightPools(sources: THREE.Object3D[]): {
  group: THREE.Group;
  update(t: number): void;
} {
  const group = new THREE.Group();
  group.name = 'lightPools';

  // One plane geometry shared across all discs (different materials per disc for
  // the colour split).
  const discGeom = new THREE.CircleGeometry(DISC_RADIUS, DISC_SEGMENTS);
  // Rotate to lie flat on the ground (default CircleGeometry is in XY plane).
  discGeom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

  // Pre-allocate one disc mesh per source.
  const discs: THREE.Mesh[] = sources.map((_, idx) => {
    const color = idx === 0 ? COLOR_BIKE.clone() : COLOR_TRAFFIC.clone();
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: POOL_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(discGeom, mat);
    mesh.name = `lightPool_${idx}`;
    mesh.frustumCulled = false;
    mesh.position.y = POOL_Y;
    group.add(mesh);
    return mesh;
  });

  // Scratch vector for world-position queries.
  const _worldPos = new THREE.Vector3();

  /**
   * Reposition each disc under its source object's current world XZ.
   * Pure repositioning — no side effects other than mesh.position.
   *
   * Ordering contract: this must be called AFTER the master has positioned all
   * source objects (bike + traffic) for the current frame/t-value. The master
   * drives sources to their t-positions via setProgress() before calling
   * pools.update(t), so getWorldPosition() reads the correct scrub-consistent
   * positions and the composed result is deterministic: same t → same source
   * positions → same pool positions.
   */
  function update(_t: number): void {
    for (let i = 0; i < sources.length; i++) {
      sources[i].getWorldPosition(_worldPos);
      discs[i].position.set(_worldPos.x, POOL_Y, _worldPos.z);
    }
  }

  return { group, update };
}
