import * as THREE from 'three';
import { sampleRoute, roadFrame, ZONES } from '../world/route';
import type { BikePose } from '../assets/vehicles/bike';

// ──────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────────────────────────────────────

export interface BikeState {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  pose: BikePose;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** smoothstep(0,1,x) — clamps x to [0,1] then applies cubic ease. */
function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * Map semantic t into a [0,1] zone fraction using smoothstep.
 * Returns 0 before the zone, smoothstep within it, 1 at/after the end.
 */
function zoneFraction(t: number, zone: [number, number]): number {
  const [a, b] = zone;
  return smoothstep((t - a) / (b - a));
}

/** Clamp value to [-max, max]. */
function clamp(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}

// ──────────────────────────────────────────────────────────────────────────────
// Lean computation (horizontal curvature)
// ──────────────────────────────────────────────────────────────────────────────

const LEAN_CLAMP = 0.61; // ±35°
const LEAN_EPS = 0.004;  // finite-difference step
const LEAN_GAIN = 4.0;   // amplify small curvature angles into perceptible lean

/**
 * Estimate lean from horizontal curvature: take the angle between the
 * horizontal projections of the tangent at t-ε and t+ε.
 * Sign: positive lean = turn to the right (+binormal direction).
 */
function computeLean(t: number): number {
  const tA = Math.max(0, t - LEAN_EPS);
  const tB = Math.min(1, t + LEAN_EPS);
  const tanA = sampleRoute(tA).tangent;
  const tanB = sampleRoute(tB).tangent;

  // Project onto horizontal plane (XZ).
  const hA = new THREE.Vector2(tanA.x, tanA.z).normalize();
  const hB = new THREE.Vector2(tanB.x, tanB.z).normalize();

  // Signed angle: cross product (2D) gives sin of angle; atan2 is more robust.
  const cross = hA.x * hB.y - hA.y * hB.x; // sin(angle) * |hA| * |hB|, already unit
  const dot   = hA.dot(hB);
  const angle = Math.atan2(cross, dot); // positive = CCW turn (left); negative = CW (right)

  // Route turns right (CW in XZ) through Shibuya; CW → negative angle → negate to get
  // positive lean into the turn (lean right = positive lean in bike.ts convention).
  const lean = clamp(-angle * LEAN_GAIN, LEAN_CLAMP);
  return lean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pitch computation (backflips)
// ──────────────────────────────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI;

/**
 * Pitch for a single ramp zone: 0 before zone, smoothstep 0→2π across zone,
 * then 0 again after the zone (the flip completes at zone end).
 *
 * Per bike.ts: +pitch = nose up. A backflip rotates nose up then over, so
 * we ramp from 0 → +2π across the zone.
 */
function rampPitch(t: number, zone: [number, number]): number {
  const f = zoneFraction(t, zone);
  // f goes 0→1 across zone. At zone start f=0 → pitch=0; at zone end f=1 → pitch=2π.
  return f * TWO_PI;
}

function computePitch(t: number): number {
  const [r1s, r1e] = ZONES.ramp1;
  const [r2s, r2e] = ZONES.ramp2;

  if (t >= r1s && t <= r1e) {
    return rampPitch(t, ZONES.ramp1 as [number, number]);
  }
  if (t >= r2s && t <= r2e) {
    return rampPitch(t, ZONES.ramp2 as [number, number]);
  }
  return 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Crouch computation
// ──────────────────────────────────────────────────────────────────────────────

const CROUCH_DEFAULT = 0.2;
const CROUCH_FLIP    = 0.6;

function computeCrouch(t: number): number {
  const f1 = zoneFraction(t, ZONES.ramp1 as [number, number]);
  const f2 = zoneFraction(t, ZONES.ramp2 as [number, number]);
  // Blend crouch up during each flip (both arcs sum, but only one is nonzero at a time).
  const flipBlend = Math.min(1, f1 + f2);
  return THREE.MathUtils.lerp(CROUCH_DEFAULT, CROUCH_FLIP, flipBlend);
}

// ──────────────────────────────────────────────────────────────────────────────
// Orientation quaternion from road frame
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a quaternion that orients the bike so its local +X axis (forward)
 * aligns with the route tangent, and its local +Y axis (up) aligns with the
 * route normal.
 *
 * The road frame from route.ts is:
 *   tangent  = forward direction along path
 *   normal   = up-ish (perpendicular to tangent, above road surface)
 *   binormal = tangent × worldUp (horizontal left/right axis)
 *
 * Bike local axes: +X = forward, +Y = up, +Z = right.
 * So the column mapping is:
 *   world column for +X (forward) = tangent
 *   world column for +Y (up)      = normal
 *   world column for +Z (right)   = binormal (tangent × worldUp → right of travel when
 *                                   the route goes +X initially; confirmed by route.ts)
 *
 * THREE.Matrix4.makeBasis(xAxis, yAxis, zAxis) builds a rotation matrix with
 * those columns. We then extract the quaternion from it.
 */
function computeQuat(t: number): THREE.Quaternion {
  const frame = roadFrame(t);
  const mat = new THREE.Matrix4().makeBasis(
    frame.tangent,   // bike local +X → tangent (forward)
    frame.normal,    // bike local +Y → normal (up-ish)
    frame.binormal   // bike local +Z → binormal (right)
  );
  return new THREE.Quaternion().setFromRotationMatrix(mat);
}

// ──────────────────────────────────────────────────────────────────────────────
// BikePath — pure, deterministic, scrub-safe
// ──────────────────────────────────────────────────────────────────────────────

export class BikePath {
  /**
   * Compute the full bike state at semantic scroll progress t ∈ [0,1].
   * Pure function: no side effects, no shared mutable state, deterministic.
   */
  state(t: number): BikeState {
    const { pos } = sampleRoute(t);
    const quat    = computeQuat(t);

    const pose: BikePose = {
      wheelSpin: t * 300,
      lean:      computeLean(t),
      pitch:     computePitch(t),
      crouch:    computeCrouch(t),
    };

    return { pos, quat, pose };
  }
}
