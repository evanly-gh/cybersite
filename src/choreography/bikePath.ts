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

/**
 * Drift override window.  All values produce pure f(t) overrides applied on
 * top of the base ground-state heading / lean / position.
 *
 * Within [t0, t1]:
 *   - Heading (yaw) is over-rotated by `oversteerDeg` * decay(t) degrees,
 *     where decay = 1 − smoothstep(t0, t1, t).
 *   - Lean is forced to `leanDeg` (signed: negative = left-lean into a
 *     right turn).
 *   - The rear-wheel lateral slide: the bike position is offset by
 *     `slideM` metres along the world binormal, decaying with the same curve.
 *
 * After t1 (wobble):
 *   A damped sine counter-lean is added: amplitude * damping * sin(2π * freq * dt)
 *   where dt = t − t1, amplitude = leanDeg * wobbleAmp, freq derived from
 *   wobbleCycles and wobbleDuration.  The wobble fully settles by
 *   t1 + wobbleDuration.
 */
export interface DriftWindowOpts {
  t0: number;
  t1: number;
  /** Yaw over-rotation at peak, degrees.  Positive = front points outward (right-turn oversteer). */
  oversteerDeg: number;
  /** Peak lean into the turn, degrees.  Positive value → lean applied toward turn inside. */
  leanDeg: number;
  /** Rear-wheel lateral slide offset at peak, metres (positive = toward outside of turn). */
  slideM: number;
  /** Number of damped counter-lean oscillations after exit. */
  wobbleCycles: number;
  /** Duration of the wobble (in t units) after t1. */
  wobbleDuration?: number; // default 0.02
  /** Fraction of leanDeg used as wobble amplitude. */
  wobbleAmp?: number; // default 0.4
}

interface DriftWindow {
  t0: number;
  t1: number;
  oversteerRad: number;
  leanRad: number;
  slideM: number;
  wobbleCycles: number;
  wobbleDuration: number;
  wobbleAmp: number;
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
const _tmpAxisAngle = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** easeInOutSine: smooth 0→1 */
function easeInOutSine(x: number): number {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/** GLSL-style smoothstep: 0 below edge0, 1 above edge1, smooth Hermite in between */
function _smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 1e-9)));
  return t * t * (3 - 2 * t);
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
  private driftWindows: DriftWindow[] = [];

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
   * Register a drift override window.
   *
   * Within [t0, t1] the base ground-state heading, lean, and position are
   * augmented:
   *  - Heading (yaw): extra over-rotation of `oversteerDeg`, decaying linearly
   *    to 0 at t1 (front of bike slides outward through the corner).
   *  - Lean: forced to `leanDeg` (toward turn inside), blending from base lean
   *    at t0 to full `leanDeg` over the first 20% of the window, held, then
   *    releasing back toward base lean at t1.
   *  - Position: lateral slide of `slideM` metres (rear wheel pushes outward),
   *    decaying with the same envelope as oversteer.
   *
   * After t1 (wobble region, lasting `wobbleDuration` in t units):
   *  A damped-sine counter-lean is added:
   *    lean_extra = −leanRad * wobbleAmp * exp(−5*p) * sin(2π * wobbleCycles * p)
   *  where p = (t − t1) / wobbleDuration ∈ [0, 1].
   *  This is a pure f(t) — scrub-safe.
   *
   * Multiple drift windows must not overlap (checked at registration).
   * Task 28 may call this method again with different parameters.
   */
  addDriftWindow(opts: DriftWindowOpts): void {
    const { t0, t1, oversteerDeg, leanDeg, slideM, wobbleCycles } = opts;
    const wobbleDuration = opts.wobbleDuration ?? 0.02;
    const wobbleAmp = opts.wobbleAmp ?? 0.4;

    // Check overlap with existing drift windows
    for (const existing of this.driftWindows) {
      const tEnd = existing.t1 + existing.wobbleDuration;
      if (t0 < tEnd && t1 > existing.t0) {
        throw new Error(
          `BikePath.addDriftWindow: overlapping drift windows ` +
          `[${t0}, ${t1}] and [${existing.t0}, ${existing.t1}]`
        );
      }
    }

    this.driftWindows.push({
      t0,
      t1,
      oversteerRad: THREE.MathUtils.degToRad(oversteerDeg),
      leanRad: THREE.MathUtils.degToRad(leanDeg),
      slideM,
      wobbleCycles,
      wobbleDuration,
      wobbleAmp
    });
  }

  /**
   * Returns the arc-length parameter u at scroll progress t.
   * u is monotonic non-decreasing by construction of the piecewise-linear speed keys.
   * Exposed for testability.
   */
  uAt(t: number): number {
    return plerpU(this.speedKeys, Math.max(0, Math.min(1, t)));
  }

  /**
   * Compute bike state for scroll progress t ∈ [0, 1].
   * Pure function of t — no side effects, no state mutation.
   *
   * If a drift window is registered and t is within [t0, t1 + wobbleDuration],
   * the ground state is post-processed by _applyDriftOverride() which adds the
   * yaw over-rotation, forced lean, lateral slide, and exit counter-lean wobble.
   */
  state(t: number): BikeState {
    const tClamped = Math.max(0, Math.min(1, t));

    // Check if in an air window
    for (const air of this.airWindows) {
      if (tClamped >= air.t0 && tClamped <= air.t1) {
        return this._airState(tClamped, air);
      }
    }

    const groundState = this._groundState(tClamped);

    // Apply drift override if t is in a drift window or its wobble tail
    for (const drift of this.driftWindows) {
      const tWobbleEnd = drift.t1 + drift.wobbleDuration;
      if (tClamped >= drift.t0 && tClamped <= tWobbleEnd) {
        return this._applyDriftOverride(groundState, tClamped, drift);
      }
    }

    return groundState;
  }

  // ---------------------------------------------------------------------------
  // Drift override — post-processes a ground BikeState within a drift window
  // ---------------------------------------------------------------------------

  /**
   * Apply drift physics overrides (yaw, lean, lateral slide, exit wobble) to
   * an already-computed ground state.  Returns a NEW BikeState — never mutates
   * the input.
   *
   * All computations are pure f(t) — scrub-safe, no accumulation.
   */
  private _applyDriftOverride(base: BikeState, t: number, drift: DriftWindow): BikeState {
    const { t0, t1, oversteerRad, leanRad, slideM, wobbleCycles, wobbleDuration, wobbleAmp } = drift;

    let extraYaw = 0;
    let forcedLean = 0;
    let lateralSlide = 0;

    if (t <= t1) {
      // Inside the drift window [t0, t1]
      // Progress 0→1 through the window
      const winLen = Math.max(t1 - t0, 1e-9);
      const p = (t - t0) / winLen;

      // Oversteer: peak at t0, decays linearly to 0 at t1
      // Use smoothstep so it's not a sudden spike at entry but still covers full window
      const oversteerDecay = 1 - _smoothstep(0, 1, p);
      extraYaw = oversteerRad * oversteerDecay;

      // Lean: ramp 0→1 over first 20%, hold, release last 20%
      const leanEnvelope = _smoothstep(0, 0.2, p) * (1 - _smoothstep(0.8, 1, p));
      forcedLean = leanRad * leanEnvelope;

      // Lateral slide: same decay as oversteer (rear-end slides, decays as grip returns)
      lateralSlide = slideM * oversteerDecay;
    } else {
      // In the wobble tail [t1, t1 + wobbleDuration]
      const wobLen = Math.max(wobbleDuration, 1e-9);
      const p = (t - t1) / wobLen; // 0→1 over the wobble duration

      // Damped-sine: exp(-5*p) * sin(2π * wobbleCycles * p)
      // Counter-lean direction: negative of leanRad (lean reverses after exit snap)
      const damped = Math.exp(-5 * p) * Math.sin(2 * Math.PI * wobbleCycles * p);
      forcedLean = -leanRad * wobbleAmp * damped;

      // No extra yaw or slide after exit
      extraYaw = 0;
      lateralSlide = 0;
    }

    // --- Apply yaw over-rotation to quat ---
    // Rotate around world Y axis by extraYaw (positive = front slides right = outward for right turn)
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(_tmpUp, extraYaw);
    const newQuat = yawQuat.multiply(base.quat.clone());

    // --- Apply lean override ---
    // Lean is applied around the forward (tangent) axis in bike space.
    // We extract the right-axis from the base quat and rotate around it.
    // The lean in pose is just overwritten; the visual tilt is expressed in pose.lean.
    const newPose: BikePose = {
      lean: forcedLean !== 0 ? forcedLean : base.pose.lean,
      pitch: base.pose.pitch,
      crouch: base.pose.crouch,
      wheelSpin: base.pose.wheelSpin
    };

    // --- Apply lateral slide offset ---
    // Offset pos along the route binormal at this u
    let newPos = base.pos.clone();
    if (Math.abs(lateralSlide) > 1e-6) {
      const u = this.uAt(t);
      const frame = roadFrame(Math.max(0, Math.min(1, u)));
      newPos.addScaledVector(frame.binormal, lateralSlide);
    }

    return {
      pos: newPos,
      quat: newQuat,
      speed: base.speed,
      airborne: false,
      pose: newPose
    };
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
    // Clone into a fresh Quaternion so BikeState.quat is never an alias of the module-level temp.
    _tmpAxisAngle.setFromAxisAngle(_tmpRight, pitch);
    const quat = _tmpAxisAngle.clone().multiply(baseQuat);

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
