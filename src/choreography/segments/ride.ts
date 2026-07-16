import * as THREE from 'three';
import { CameraRig } from '../cameraRig';
import { BikePath } from '../bikePath';
import { roadFrame, ZONES, MOON_POS } from '../../world/route';
import type { DisplayAnchor } from '../../world/cityLayout';

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

/**
 * Compute the centroid of a set of DisplayAnchor positions.
 * Returns null if the list is empty.
 */
function anchorCentroid(anchors: DisplayAnchor[]): THREE.Vector3 | null {
  if (anchors.length === 0) return null;
  const sum = new THREE.Vector3();
  for (const a of anchors) sum.add(a.pos);
  sum.divideScalar(anchors.length);
  return sum;
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
 * @param anchors - Optional DisplayAnchor array from buildCity(). When provided,
 *   the flip-apex and research camera keys frame the real anchor positions.
 *   When absent, grey-box fallback poses are used (backward-compatible).
 *
 * Pure/deterministic: only reads from bike.state, roadFrame, and anchors, no
 * random or wall-clock calls.
 */
export function registerRideSegments(
  rig: CameraRig,
  bike: BikePath,
  anchors?: DisplayAnchor[],
): void {

  // Pre-filter anchors by kind for easy lookup.
  const projBigAnchors   = anchors?.filter(a => a.kind === 'projBig')   ?? [];
  const projSmallAnchors = anchors?.filter(a => a.kind === 'projSmall') ?? [];
  const researchAnchors  = anchors?.filter(a => a.kind === 'research')  ?? [];

  // ── intro (0.00 – 0.12) ─────────────────────────────────────────────────
  // Standard chase across the straight intro road.
  for (const t of [0.00, 0.06, 0.12]) {
    rig.addKey(chaseKey(t, bike));
  }

  // ── about (0.12 – 0.28) ─────────────────────────────────────────────────
  // Swing camera out along +binormal to frame the hero wall on the side.
  // At ~0.20 the swing is at its peak; ease in at 0.12 and out at 0.28.
  //
  // aboutHero anchor sits at +binormal side, lateralOffset=28m, y=14.
  // Camera floats 10m out (–binormal from anchor) and 4m below the anchor.
  // Target is the anchor position so the hero billboard fills the frame.
  {
    // Filter aboutHero anchors for direct targeting.
    const aboutHeroAnchors = anchors?.filter(a => a.kind === 'aboutHero') ?? [];
    const aboutHeroCentroid = anchorCentroid(aboutHeroAnchors);

    // Zone start — standard chase to give a smooth approach.
    rig.addKey(chaseKey(0.12, bike));

    // Swing-out midpoint (t = 0.20).
    const t = 0.20;
    const { pos: bikePos } = bike.state(t);
    const { tangent, normal, binormal } = roadFrame(t);

    // Camera: position inside the corridor (binormal*4) at mid-height, looking
    // sideways and slightly forward toward the aboutHero billboard which sits
    // at binormal*19, y=14 (just outside the road edge, in front of buildings).
    // The camera is at binormal*4 so there are 15m of clear air between it and
    // the billboard — enough to read the portrait content at fov=58.
    // Moving forward 10m along tangent puts the billboard slightly behind-right,
    // giving a cinematic angle-of-view rather than a flat head-on shot.
    const pos = bikePos.clone()
      .addScaledVector(tangent, 10)    // slightly ahead of anchor t
      .addScaledVector(binormal, 4)    // inside corridor, looking sideways
      .add(new THREE.Vector3(0, 8, 0)); // camera below billboard centre for upward look

    // Target: the real aboutHero anchor (binormal*19, y=14) or fallback.
    const target = aboutHeroCentroid
      ? aboutHeroCentroid.clone()
      : bikePos.clone()
          .addScaledVector(tangent, 10)
          .addScaledVector(binormal, 19)
          .add(new THREE.Vector3(0, 14, 0));

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
    // Flip apex 1 at t ≈ 0.41 — camera beside the bike, targeting projBig anchors.
    const t = 0.41;
    const { pos: bikePos } = bike.state(t);
    const { normal, binormal } = roadFrame(t);
    const pos = bikePos.clone()
      .addScaledVector(binormal, 10)
      .addScaledVector(normal, 2);

    // Target: midpoint of projBig anchors if available, else bike position.
    const projBigCentroid = anchorCentroid(projBigAnchors);
    const target = projBigCentroid ?? bikePos.clone();

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
    // Flip apex 2 at t ≈ 0.57 — camera beside the bike, targeting projSmall anchors.
    const t = 0.57;
    const { pos: bikePos } = bike.state(t);
    const { normal, binormal } = roadFrame(t);
    const pos = bikePos.clone()
      .addScaledVector(binormal, 10)
      .addScaledVector(normal, 2);

    // Target: centroid of projSmall anchors if available, else bike position.
    const projSmallCentroid = anchorCentroid(projSmallAnchors);
    const target = projSmallCentroid ?? bikePos.clone();

    rig.addKey({ t, pos, target, fov: 55 });
  }

  rig.addKey(chaseKey(0.62, bike));

  // ── descend (0.62 – 0.68) ───────────────────────────────────────────────
  for (const t of [0.62, 0.65, 0.68]) {
    rig.addKey(chaseKey(t, bike));
  }

  // ── research (0.68 – 0.84) ──────────────────────────────────────────────
  // Research anchors are placed on the −binormal canyon wall (side=−1) at
  // y=22 and lateralOffset=19m, facing +binormal.  The camera sits on the
  // +binormal side at y≈3 and looks across the road toward both signs, with
  // the bike visible in the lower portion of the frame between camera and signs.
  //
  // binormal = +X throughout this zone (route travels −Z).  Camera at
  // bikePos.x + 12 (inside the corridor, +X side), looking toward x − 31
  // (= 240 − 19 = 221, the anchor face position).
  {
    const researchCentroid = anchorCentroid(researchAnchors);

    for (const t of [0.68, 0.72, 0.76, 0.80, 0.84]) {
      const { pos: bikePos } = bike.state(t);
      const { tangent, binormal } = roadFrame(t);

      // Camera: +binormal side of road (x = road.x + 6), low (y=4).
      // Both anchors are at the same z as researchMid (t=0.76), so camera
      // and anchors share z-position → look direction has no Z component.
      // Anchors on −binormal side at lateral=19m: at x = road.x − 19.
      // Anchors stacked at y=20 and y=32, centroid y=26.
      const pos = bikePos.clone()
        .addScaledVector(binormal, 6)    // +binormal inside corridor
        .add(new THREE.Vector3(0, 4, 0)); // low

      // Centroid of both anchors: same x (road.x-19), same z, y=26.
      // Lower the target slightly toward y=18 so the lower portion of the
      // FOV includes the bike (at y=0 on the road, slightly below screen center).
      const target = researchCentroid
        ? researchCentroid.clone().add(new THREE.Vector3(0, -6, 0)) // shift down to y≈20
        : bikePos.clone()
            .addScaledVector(binormal, -19)
            .add(new THREE.Vector3(0, 18, 0));

      // fov=68: widen slightly so the bike (low) and upper billboard (high) both fit.
      rig.addKey({ t, pos, target, fov: 68 });
    }
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
