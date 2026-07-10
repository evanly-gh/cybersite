/**
 * Task 25 — CameraRig
 *
 * Authored camera keyframes interpolated by scroll progress t ∈ [0, 1].
 * Segments append their keys; the rig piecewise-interpolates between them using
 * eased Catmull-Rom splines on pos/look and linear lerp on fov/roll.
 *
 * Camera roll: applied via camera.rotateZ(roll) after lookAt since lookAt
 * resets the camera's internal up vector to world up and zeroes roll.
 * rotateZ applies in camera-local space, so it correctly tilts the viewport.
 *
 * ## Registration
 * addKeys() is called once per segment at boot time. Overlapping t ranges
 * (interior overlap, not shared boundary) throw to catch registration bugs.
 *
 * ## evaluate(t)
 * Pure function of t. Sets camera.position, calls camera.lookAt, then applies
 * roll and fov. Does not allocate on the hot path (pre-allocated temporaries).
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface CamPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll: number; // radians; positive = CCW when viewed from front
}

interface CamKey {
  t: number;
  pose: CamPose;
  ease: (x: number) => number;
}

// ---------------------------------------------------------------------------
// Ease helpers
// ---------------------------------------------------------------------------

const LINEAR: (x: number) => number = (x) => x;

// ---------------------------------------------------------------------------
// Pre-allocated temporaries for hot path
// ---------------------------------------------------------------------------

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _p3 = new THREE.Vector3();
const _resultPos = new THREE.Vector3();
const _resultLook = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Catmull-Rom interpolation (piecewise per segment)
// ---------------------------------------------------------------------------

/**
 * Catmull-Rom spline interpolation between v1 and v2 using v0 and v3 as
 * neighboring control points. Alpha = 0.5 (centripetal) for reduced cusps.
 * t ∈ [0, 1] within the v1→v2 segment.
 */
function catmullRom(
  out: THREE.Vector3,
  v0: THREE.Vector3,
  v1: THREE.Vector3,
  v2: THREE.Vector3,
  v3: THREE.Vector3,
  t: number
): void {
  const t2 = t * t;
  const t3 = t2 * t;

  // Standard Catmull-Rom with tension 0.5
  out.set(
    0.5 * (2 * v1.x + (-v0.x + v2.x) * t + (2 * v0.x - 5 * v1.x + 4 * v2.x - v3.x) * t2 + (-v0.x + 3 * v1.x - 3 * v2.x + v3.x) * t3),
    0.5 * (2 * v1.y + (-v0.y + v2.y) * t + (2 * v0.y - 5 * v1.y + 4 * v2.y - v3.y) * t2 + (-v0.y + 3 * v1.y - 3 * v2.y + v3.y) * t3),
    0.5 * (2 * v1.z + (-v0.z + v2.z) * t + (2 * v0.z - 5 * v1.z + 4 * v2.z - v3.z) * t2 + (-v0.z + 3 * v1.z - 3 * v2.z + v3.z) * t3)
  );
}

// ---------------------------------------------------------------------------
// CameraRig
// ---------------------------------------------------------------------------

export class CameraRig {
  private keys: CamKey[] = [];

  /**
   * Register camera keyframes.
   * Keys are sorted by t; overlapping ranges (strict interior) throw.
   * Call once per segment at boot time.
   */
  addKeys(keys: { t: number; pose: CamPose; ease?: (x: number) => number }[]): void {
    const sorted = keys.map((k) => ({
      t: k.t,
      pose: k.pose,
      ease: k.ease ?? LINEAR
    })).sort((a, b) => a.t - b.t);

    // Validate no overlap with existing keys
    if (this.keys.length > 0 && sorted.length > 0) {
      const existingMax = this.keys[this.keys.length - 1].t;
      const newMin = sorted[0].t;
      if (newMin < existingMax - 1e-9) {
        throw new Error(
          `CameraRig.addKeys: overlapping t range. ` +
          `Existing keys cover up to t=${existingMax}, new keys start at t=${newMin}.`
        );
      }
    }

    this.keys.push(...sorted);
    this.keys.sort((a, b) => a.t - b.t);
  }

  /**
   * Evaluate the camera rig at scroll t ∈ [0, 1] and apply to `out` camera.
   * Pure function of t (no side effects beyond modifying `out`).
   */
  evaluate(t: number, out: THREE.PerspectiveCamera): void {
    const keys = this.keys;
    if (keys.length === 0) return;

    const tClamped = Math.max(0, Math.min(1, t));

    // Single key: hold constant
    if (keys.length === 1) {
      this._applyPose(keys[0].pose, out);
      return;
    }

    // Before first key: hold first key
    if (tClamped <= keys[0].t) {
      this._applyPose(keys[0].pose, out);
      return;
    }

    // After last key: hold last key
    if (tClamped >= keys[keys.length - 1].t) {
      this._applyPose(keys[keys.length - 1].pose, out);
      return;
    }

    // Find bracketing keys
    let lo = 0;
    let hi = keys.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (keys[mid].t <= tClamped) lo = mid;
      else hi = mid;
    }

    const k0 = keys[lo];
    const k1 = keys[hi];

    // Local t within the segment, then apply the segment's easing
    const segLen = k1.t - k0.t;
    const localT = segLen > 1e-9 ? (tClamped - k0.t) / segLen : 0;
    const easedT = k1.ease(localT);

    // Control points for Catmull-Rom: use neighbors or extrapolate at boundaries
    const km1 = lo > 0 ? keys[lo - 1] : keys[lo];
    const k2 = hi < keys.length - 1 ? keys[hi + 1] : keys[hi];

    _p0.copy(km1.pose.pos);
    _p1.copy(k0.pose.pos);
    _p2.copy(k1.pose.pos);
    _p3.copy(k2.pose.pos);
    catmullRom(_resultPos, _p0, _p1, _p2, _p3, easedT);

    _p0.copy(km1.pose.look);
    _p1.copy(k0.pose.look);
    _p2.copy(k1.pose.look);
    _p3.copy(k2.pose.look);
    catmullRom(_resultLook, _p0, _p1, _p2, _p3, easedT);

    const fov = THREE.MathUtils.lerp(k0.pose.fov, k1.pose.fov, easedT);
    const roll = THREE.MathUtils.lerp(k0.pose.roll, k1.pose.roll, easedT);

    out.position.copy(_resultPos);
    // lookAt resets the internal up/rotation fully; we then apply roll manually
    out.lookAt(_resultLook);
    if (Math.abs(roll) > 1e-6) {
      out.rotateZ(roll);
    }
    if (out.fov !== fov) {
      out.fov = fov;
      out.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _applyPose(pose: CamPose, out: THREE.PerspectiveCamera): void {
    out.position.copy(pose.pos);
    out.lookAt(pose.look);
    if (Math.abs(pose.roll) > 1e-6) {
      out.rotateZ(pose.roll);
    }
    if (out.fov !== pose.fov) {
      out.fov = pose.fov;
      out.updateProjectionMatrix();
    }
  }
}
