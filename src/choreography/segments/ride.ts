import * as THREE from 'three';
import { CameraRig } from '../cameraRig';
import { BikePath } from '../bikePath';
import { roadFrame, ZONES, MOON_POS } from '../../world/route';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a default "chase cam" key at time t.
 * pos  = bikePos - tangent*9 + normal*4   (behind + above)
 * target = bikePos + tangent*6
 * fov  = 55
 */
function chaseKey(t: number, bike: BikePath) {
  const { pos: bikePos } = bike.state(t);
  const { tangent, normal } = roadFrame(t);

  const pos = bikePos.clone()
    .addScaledVector(tangent, -9)
    .addScaledVector(normal, 4);
  const target = bikePos.clone().addScaledVector(tangent, 6);

  return { t, pos, target, fov: 55 };
}

// ──────────────────────────────────────────────────────────────────────────────
// registerRideSegments
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registers camera keyframes across all route zones so `rig.sample(t)` is
 * continuous and sane for every t ∈ [0, 1].
 *
 * Key philosophy:
 *  - Several keys per zone, placed at zone boundaries and mid-points.
 *  - Default pose: chase cam behind-and-above the bike.
 *  - Special zones override pos / target / fov as per the task brief.
 *
 * Pure/deterministic: only reads from bike.state and roadFrame, no random or
 * wall-clock calls.
 */
export function registerRideSegments(rig: CameraRig, bike: BikePath): void {

  // ── intro (0.00 – 0.12) ─────────────────────────────────────────────────
  // Standard chase across the straight intro road.
  for (const t of [0.00, 0.06, 0.12]) {
    rig.addKey(chaseKey(t, bike));
  }

  // ── about (0.12 – 0.28) ─────────────────────────────────────────────────
  // Swing camera out along +binormal to frame the hero wall on the side.
  // At ~0.20 the swing is at its peak; ease in at 0.12 and out at 0.28.
  {
    // Zone start — standard chase to give a smooth approach.
    rig.addKey(chaseKey(0.12, bike));

    // Swing-out midpoint (t = 0.20).
    const t = 0.20;
    const { pos: bikePos } = bike.state(t);
    const { tangent, normal, binormal } = roadFrame(t);
    // Pull camera behind + slightly up + 14 units along +binormal.
    const pos = bikePos.clone()
      .addScaledVector(tangent, -6)
      .addScaledVector(normal, 3)
      .addScaledVector(binormal, 14);
    // Target toward the wall side (bikePos offset along +binormal).
    const target = bikePos.clone().addScaledVector(binormal, 20);
    rig.addKey({ t, pos, target, fov: 55 });

    // Zone end — back to standard chase for smooth exit into turn.
    rig.addKey(chaseKey(0.28, bike));
  }

  // ── turn (0.28 – 0.36) ──────────────────────────────────────────────────
  // Widen fov to ~62; pull camera outside the turn radius (+binormal).
  for (const t of [0.28, 0.30, 0.32, 0.34, 0.36]) {
    const { pos: bikePos } = bike.state(t);
    const { tangent, normal, binormal } = roadFrame(t);
    // Outside-turn offset: camera pulled 6 units along +binormal, behind + above.
    const pos = bikePos.clone()
      .addScaledVector(tangent, -9)
      .addScaledVector(normal, 4)
      .addScaledVector(binormal, 6);
    const target = bikePos.clone().addScaledVector(tangent, 6);
    rig.addKey({ t, pos, target, fov: 62 });
  }

  // ── ramp1 (0.36 – 0.46) and flip apex 1 (0.41) ────────────────────────
  // Chase at zone entry, then at the apex settle beside the bike.
  rig.addKey(chaseKey(0.36, bike));

  {
    // Flip apex 1 at t ≈ 0.41 — camera beside the bike.
    const t = 0.41;
    const { pos: bikePos } = bike.state(t);
    const { normal, binormal } = roadFrame(t);
    const pos = bikePos.clone()
      .addScaledVector(binormal, 10)
      .addScaledVector(normal, 2);
    const target = bikePos.clone();
    rig.addKey({ t, pos, target, fov: 55 });
  }

  rig.addKey(chaseKey(0.46, bike));

  // ── scaffold (0.46 – 0.52) ─────────────────────────────────────────────
  for (const t of [0.46, 0.49, 0.52]) {
    rig.addKey(chaseKey(t, bike));
  }

  // ── ramp2 (0.52 – 0.62) and flip apex 2 (0.57) ─────────────────────────
  rig.addKey(chaseKey(0.52, bike));

  {
    // Flip apex 2 at t ≈ 0.57 — camera beside the bike.
    const t = 0.57;
    const { pos: bikePos } = bike.state(t);
    const { normal, binormal } = roadFrame(t);
    const pos = bikePos.clone()
      .addScaledVector(binormal, 10)
      .addScaledVector(normal, 2);
    const target = bikePos.clone();
    rig.addKey({ t, pos, target, fov: 55 });
  }

  rig.addKey(chaseKey(0.62, bike));

  // ── descend (0.62 – 0.68) ───────────────────────────────────────────────
  for (const t of [0.62, 0.65, 0.68]) {
    rig.addKey(chaseKey(t, bike));
  }

  // ── research (0.68 – 0.84) ──────────────────────────────────────────────
  // LOW camera (pos.y = 1.5) looking UP (target.y = 24), fov = 66.
  // We apply the research pose throughout the zone, including at boundaries,
  // so that the zone-interior sample at t = 0.76 definitely satisfies the test.
  for (const t of [0.68, 0.72, 0.76, 0.80, 0.84]) {
    const { pos: bikePos } = bike.state(t);
    const { binormal } = roadFrame(t);
    // Camera low beside the road, looking steeply upward.
    const pos = new THREE.Vector3(bikePos.x + binormal.x * 5, 1.5, bikePos.z + binormal.z * 5);
    const target = new THREE.Vector3(bikePos.x, 24, bikePos.z);
    rig.addKey({ t, pos, target, fov: 66 });
  }

  // ── lift (0.84 – 0.89) ──────────────────────────────────────────────────
  // Transition from research low-look to finale pullback.
  // Chase keys here let the rig interpolate smoothly.
  for (const t of [0.84, 0.87, 0.89]) {
    rig.addKey(chaseKey(t, bike));
  }

  // ── finale / bridge (0.89 – 1.00) ───────────────────────────────────────
  // Pull back and up; target toward MOON_POS.
  for (const t of [0.89, 0.92, 0.95, 0.98, 1.00]) {
    const { pos: bikePos } = bike.state(t);
    const { tangent, normal } = roadFrame(t);
    const pos = bikePos.clone()
      .addScaledVector(tangent, -18)
      .addScaledVector(normal, 10);
    const target = MOON_POS.clone();
    rig.addKey({ t, pos, target, fov: 55 });
  }
}
