/**
 * Sandevistan viewer entry — Task 16
 *
 * Shows the sandevistan ghost-trail, light pools, and drift smoke together
 * with the bike riding the route.
 *
 * Sweep `?t=` (0→1) to scrub:
 *   - Ghost trail fans out around flip apexes (t≈0.41, 0.57) with rainbow flourish
 *   - Drift smoke appears at the Shibuya turn (t≈0.28..0.36)
 *   - Light pools follow the bike continuously
 *
 * Suggested camera:
 *   ?viewer=sandevistan&t=0.41   ← flip1 apex rainbow fan
 *   ?viewer=sandevistan&t=0.32   ← Shibuya drift smoke
 */
import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildBike } from '../../assets/vehicles/bike';
import { BikePath } from '../../choreography/bikePath';
import { buildSandevistan } from '../../fx/sandevistan';
import { buildLightPools } from '../../fx/lightPools';
import { buildDriftFx } from '../../fx/driftFx';

/** Number of smoke puffs for the Shibuya turn. */
const MAX_SMOKE = 18;

registerAsset('sandevistan', (rng) => {
  const bike = buildBike(rng);
  const path = new BikePath();
  const trail = buildSandevistan(bike.ghostGeometry);
  const drift = buildDriftFx(MAX_SMOKE);

  // Use the bike group itself as the light pool source.
  const pools = buildLightPools([bike.group]);

  // Root group: bike + trail + pools + drift.
  const root = new THREE.Group();
  root.name = 'sandevistanRoot';
  root.add(bike.group);
  root.add(trail.group);
  root.add(pools.group);
  root.add(drift.group);

  // Scratch objects for matrix extraction.
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3(1, 1, 1);
  const _mat = new THREE.Matrix4();

  function update(t: number): void {
    // Advance the bike to its position/pose at t.
    const state = path.state(t);
    bike.group.position.copy(state.pos);
    bike.group.quaternion.copy(state.quat);
    bike.pose(state.pose);

    // Force world matrix update so getWorldPosition works for pools.
    bike.group.updateMatrixWorld(true);

    // Build world matrix for the trail ghost record.
    _pos.copy(state.pos);
    _quat.copy(state.quat);
    _mat.compose(_pos, _quat, _scale);

    // Record into the trail (the master does this once per setProgress).
    trail.record(_mat, t);

    // Update all FX.
    trail.update(t);
    pools.update(t);
    drift.update(t);
  }

  return { group: root, update };
});
