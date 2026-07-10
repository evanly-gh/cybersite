/**
 * Task 25 — BikePath
 *
 * Manages the protagonist bike's position/orientation as a PURE function of scroll t.
 * No accumulation; scrubbing backward or forward produces identical results.
 *
 * ## Speed keys
 * Segments call addSpeedKeys({ t, u }[]) to register a piecewise-linear t→u mapping.
 * u(t) is monotonic non-decreasing by construction.
 *
 * ## Ground state
 * pos = ROUTE.getPointAt(u) + lateral weave clamped to lane
 * heading = tangent + weave derivative → yaw quaternion
 * lean ∝ lateral acceleration (max 35°)
 * wheelSpin accumulated from speed
 *
 * ## Air state (addAir)
 * Ballistic y-arc between (u0, apexY, u1), pitch = flips·2π·easeInOutSine(progress),
 * crouch ramps 0→1→0 (tuck on the way up, open at apex, tuck again on landing).
 */

import * as THREE from 'three';
import { ROUTE, roadFrame } from '../world/route';
import type { BikePose } from '../assets/vehicles/bike';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type { BikePose };

export interface BikeState {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  speed: number;
  airborne: boolean;
  pose: BikePose;
}

interface SpeedKey {
  t: number;
  u: number;
}

interface AirWindow {
  t0: number;
  t1: number;
  u0: number;
  u1: number;
  apexY: number;
  flips: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEAN_MAX = THREE.MathUtils.degToRad(35);
const LANE_HALF_WIDTH = 4.0; // metres — lateral weave clamped to this

// Wheel circumference proxy for spin accumulation (1 unit = 1m of arc-length).
// ROUTE.getLength() is ~1800m, so 1 unit of u ≈ 1800m.
const ROUTE_ARC_LENGTH = 1800; // approx metres per u=1
const WHEEL_RADIUS = 0.64; // matches bike.ts WHEEL_R + WHEEL_TUBE

// Pre-allocated temporaries (no per-call heap allocation in hot path)
const _tmpPos = new THREE.Vector3();
const _tmpTangent = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _tmpUp = new THREE.Vector3(0, 1, 0);
const _tmpQuat = new THREE.Quaternion();
const _tmpAxisAngle = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** easeInOutSine: smooth 0→1 */
function easeInOutSine(x: number): number {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/** Lateral weave offset in metres (pure f(u)) */
function weaveOffset(u: number): number {
  return 0.9 * Math.sin(37 * u) + 0.5 * Math.sin(89 * u + 1.3);
}

/** Derivative of weave offset with respect to u */
function weaveDerivative(u: number): number {
  return 0.9 * 37 * Math.cos(37 * u) + 0.5 * 89 * Math.cos(89 * u + 1.3);
}

/** Piecewise-linear interpolation of sorted (t, u) key pairs */
function plerpU(keys: SpeedKey[], t: number): number {
  if (keys.length === 0) return 0;
  if (keys.length === 1) return keys[0].u;

  if (t <= keys[0].t) return keys[0].u;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].u;

  // Binary search for the bracketing interval
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const k0 = keys[lo];
  const k1 = keys[hi];
  const frac = (t - k0.t) / (k1.t - k0.t);
  return k0.u + frac * (k1.u - k0.u);
}

// ---------------------------------------------------------------------------
// BikePath
// ---------------------------------------------------------------------------

export class BikePath {
  private speedKeys: SpeedKey[] = [];
  private airWindows: AirWindow[] = [];

  /**
   * Register speed keys (t→u mapping segments).
   * Keys within a batch are sorted; batches must not produce overlapping t ranges.
   * Throws if a new key's t range overlaps an already-registered key range.
   */
  addSpeedKeys(keys: { t: number; u: number }[]): void {
    const sorted = [...keys].sort((a, b) => a.t - b.t);

    // Validate no overlap with existing keys
    if (this.speedKeys.length > 0 && sorted.length > 0) {
      const existingMax = this.speedKeys[this.speedKeys.length - 1].t;
      const newMin = sorted[0].t;
      // Allow sharing of boundary t values (e.g., t=0.10 is both the end of
      // intro and start of about keys) — only throw on strict interior overlap.
      if (newMin < existingMax - 1e-9) {
        throw new Error(
          `BikePath.addSpeedKeys: overlapping t range. ` +
          `Existing keys cover up to t=${existingMax}, new keys start at t=${newMin}.`
        );
      }
    }

    this.speedKeys.push(...sorted);
    this.speedKeys.sort((a, b) => a.t - b.t);
  }

  /**
   * Register air window(s) for ballistic arcs (ramp jumps, bike tricks).
   * Multiple windows may not overlap in t.
   */
  addAir(air: AirWindow[]): void {
    for (const w of air) {
      // Check for t overlap with existing windows
      for (const existing of this.airWindows) {
        const overlap = w.t0 < existing.t1 && w.t1 > existing.t0;
        if (overlap) {
          throw new Error(
            `BikePath.addAir: overlapping air windows ` +
            `[${w.t0}, ${w.t1}] and [${existing.t0}, ${existing.t1}]`
          );
        }
      }
      this.airWindows.push(w);
    }
  }

  /**
   * Compute bike state for scroll progress t ∈ [0, 1].
   * Pure function of t — no side effects, no state mutation.
   */
  state(t: number): BikeState {
    const tClamped = Math.max(0, Math.min(1, t));

    // Check if in an air window
    for (const air of this.airWindows) {
      if (tClamped >= air.t0 && tClamped <= air.t1) {
        return this._airState(tClamped, air);
      }
    }

    return this._groundState(tClamped);
  }

  // ---------------------------------------------------------------------------
  // Ground state
  // ---------------------------------------------------------------------------

  private _groundState(t: number): BikeState {
    const u = plerpU(this.speedKeys, t);
    const uClamped = Math.max(0, Math.min(1, u));

    const frame = roadFrame(uClamped);

    // Lateral weave offset (metres along binormal)
    const weave = THREE.MathUtils.clamp(weaveOffset(uClamped), -LANE_HALF_WIDTH, LANE_HALF_WIDTH);

    // Position: road center + weave along binormal
    const pos = frame.pos.clone().addScaledVector(frame.binormal, weave);

    // Heading: tangent rotated by weave derivative (gives the yaw from the weave)
    // The weave derivative tells us how fast the bike is crossing lanes relative to
    // route progress, so the heading is the tangent rotated slightly toward binormal.
    // weaveDerivative is d(weave)/du — we need to normalize for heading direction.
    const dw_du = weaveDerivative(uClamped);

    // Build the forward direction: tangent + dw_du * binormal, normalized
    _tmpTangent.copy(frame.tangent).addScaledVector(frame.binormal, dw_du * 0.01);
    if (_tmpTangent.lengthSq() < 1e-10) _tmpTangent.copy(frame.tangent);
    _tmpTangent.normalize();

    // Quaternion from tangent (forward = +X in bike space, world up = Y)
    // Build rotation matrix: forward, up, right
    _tmpRight.crossVectors(_tmpUp, _tmpTangent).normalize();
    if (_tmpRight.lengthSq() < 1e-8) {
      _tmpRight.set(0, 0, 1);
    }
    const actualUp = _tmpRight.clone().crossVectors(_tmpTangent, _tmpRight).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(_tmpTangent, actualUp, _tmpRight);
    const quat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    // Speed: derive from u(t) derivative
    // Approximate du/dt from piecewise-linear keys
    const du_dt = this._duDt(t);
    const speed = du_dt * ROUTE_ARC_LENGTH; // m/s approx

    // Lateral acceleration proxy: d²(weave)/dt² ≈ weaveDerivative * du/dt * du/dt
    // For lean we just use the instantaneous lateral derivative of weave
    // lean ∝ dw/dt = dw/du * du/dt
    const dw_dt = dw_du * du_dt * ROUTE_ARC_LENGTH;
    // Centripetal acceleration heuristic: lean = atan(dw_dt / 9.81) clamped
    const leanAngle = THREE.MathUtils.clamp(
      Math.atan2(dw_dt * 0.5, 9.81),
      -LEAN_MAX,
      LEAN_MAX
    );

    // Wheel spin: accumulated arc length ÷ wheel circumference
    const arcLength = uClamped * ROUTE_ARC_LENGTH;
    const wheelSpin = arcLength / WHEEL_RADIUS;

    const pose: BikePose = {
      lean: leanAngle,
      pitch: 0,
      crouch: 0.1, // slight tuck while riding
      wheelSpin
    };

    return { pos, quat, speed, airborne: false, pose };
  }

  // ---------------------------------------------------------------------------
  // Air state
  // ---------------------------------------------------------------------------

  private _airState(t: number, air: AirWindow): BikeState {
    const progress = (t - air.t0) / Math.max(air.t1 - air.t0, 1e-9);
    const pClamped = Math.max(0, Math.min(1, progress));

    // u: lerp from u0 to u1 through the air window
    const u = air.u0 + pClamped * (air.u1 - air.u0);
    const uClamped = Math.max(0, Math.min(1, u));

    // World position: ballistic arc
    const frameStart = roadFrame(Math.max(0, Math.min(1, air.u0)));
    const frameEnd = roadFrame(Math.max(0, Math.min(1, air.u1)));

    // Lerp horizontal position from u0→u1 route points
    _tmpPos.lerpVectors(frameStart.pos, frameEnd.pos, pClamped);

    // Ballistic y: parabolic arc from y0 to y1 passing through apexY at p=0.5
    const y0 = frameStart.pos.y;
    const y1 = frameEnd.pos.y;
    // Quadratic: y(p) = y0*(1-p) + y1*p + apexLift * 4*p*(1-p)
    // where apexLift = apexY - (y0+y1)/2
    const yMid = (y0 + y1) / 2;
    const apexLift = air.apexY - yMid;
    const yArc = THREE.MathUtils.lerp(y0, y1, pClamped) + apexLift * 4 * pClamped * (1 - pClamped);

    const pos = new THREE.Vector3(_tmpPos.x, yArc, _tmpPos.z);

    // Heading: interpolate tangent directions
    const tangent = new THREE.Vector3()
      .lerpVectors(frameStart.tangent, frameEnd.tangent, pClamped)
      .normalize();

    // Pitch: flips * 2π * easeInOutSine(progress) (backflip/front flip)
    const pitch = air.flips * Math.PI * 2 * easeInOutSine(pClamped);

    // Build orientation: base from tangent, then apply pitch rotation around local Z (lateral)
    _tmpRight.crossVectors(_tmpUp, tangent).normalize();
    if (_tmpRight.lengthSq() < 1e-8) _tmpRight.set(0, 0, 1);
    const actualUp = new THREE.Vector3().crossVectors(tangent, _tmpRight).normalize();

    const baseRot = new THREE.Matrix4().makeBasis(tangent, actualUp, _tmpRight);
    const baseQuat = new THREE.Quaternion().setFromRotationMatrix(baseRot);

    // Apply pitch about local lateral axis (rider's right = +Z in bike space = _tmpRight world)
    _tmpAxisAngle.setFromAxisAngle(_tmpRight, pitch);
    const quat = _tmpAxisAngle.multiply(baseQuat);

    // u for wheel spin (held at u0 during air)
    const arcLength = uClamped * ROUTE_ARC_LENGTH;
    const wheelSpin = arcLength / WHEEL_RADIUS;

    // Crouch: ramps 0→1 at p=0.5 (tuck), then back → 0 at p=1 (open)
    const crouch = 1 - Math.abs(pClamped * 2 - 1); // triangle: 0→1→0

    const pose: BikePose = {
      lean: 0, // no lean in air
      pitch,
      crouch,
      wheelSpin
    };

    const du_dt = this._duDt(t);
    const speed = du_dt * ROUTE_ARC_LENGTH;

    return { pos, quat, speed, airborne: true, pose };
  }

  // ---------------------------------------------------------------------------
  // du/dt approximation
  // ---------------------------------------------------------------------------

  private _duDt(t: number): number {
    if (this.speedKeys.length < 2) return 0;

    const tClamped = Math.max(0, Math.min(1, t));
    const dt = 1e-4;
    const u1 = plerpU(this.speedKeys, Math.min(1, tClamped + dt));
    const u0 = plerpU(this.speedKeys, Math.max(0, tClamped - dt));
    return (u1 - u0) / (2 * dt);
  }
}
