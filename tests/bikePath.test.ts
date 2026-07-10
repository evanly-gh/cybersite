/**
 * Task 25 TDD: BikePath tests.
 * Must FAIL before BikePath is implemented, then PASS after.
 *
 * Tests:
 *  1. u(t) monotonic non-decreasing over 500 samples given intro+about speed keys
 *  2. state(0.2).pos within About street world bounds
 *  3. airborne flag true only inside registered air windows
 *  4. quat has no NaN through a full flip
 *  5. addSpeedKeys throws on overlapping t range
 *  6. addSpeedKeys allows shared boundary t (intro→about handoff)
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BikePath } from '../src/choreography/bikePath';
import { ROUTE_U, WAYPOINTS } from '../src/world/route';

// ---- helpers ---------------------------------------------------------------

function isFinite3(q: THREE.Quaternion): boolean {
  return isFinite(q.x) && isFinite(q.y) && isFinite(q.z) && isFinite(q.w);
}

// Intro+about speed keys matching what segments/intro.ts will register
function makeIntroAboutKeys() {
  return [
    { t: 0, u: ROUTE_U.introStart },
    { t: 0.10, u: ROUTE_U.aboutStart + 0.02 }
  ];
}

// ---- tests -----------------------------------------------------------------

describe('BikePath', () => {
  it('u(t) is monotonic non-decreasing over 500 samples — via uAt(t)', () => {
    const bp = new BikePath();
    bp.addSpeedKeys(makeIntroAboutKeys());

    // Use the exposed uAt() method to directly verify u is non-decreasing.
    let prevU = -Infinity;
    for (let i = 0; i <= 500; i++) {
      const t = i / 500;
      const u = bp.uAt(t);
      expect(u).toBeGreaterThanOrEqual(prevU - 1e-12); // monotonic non-decreasing (tolerance for float)
      prevU = u;
    }
  });

  it('u(t) samples are monotonic: each successive u >= previous', () => {
    const bp = new BikePath();
    bp.addSpeedKeys(makeIntroAboutKeys());

    // Sample 500 evenly spaced t values via uAt() and verify u is non-decreasing.
    let prevU = -Infinity;
    for (let i = 0; i <= 500; i++) {
      const t = i / 500;
      const u = bp.uAt(t);
      expect(u).toBeGreaterThanOrEqual(prevU - 1e-12);
      prevU = u;
    }
  });

  it('state(0.2).pos is within About street x bounds [-280, 220]', () => {
    // About street runs from WAYPOINTS.aboutStart.x (-260) to WAYPOINTS.aboutEnd.x (200)
    // t=0.2 is past the intro segment (which ends at t=0.10), so we need about keys too.
    // With only intro keys, t > 0.10 holds the last u. Let's register about+intro keys.
    const bp = new BikePath();
    bp.addSpeedKeys([
      { t: 0,    u: ROUTE_U.introStart },
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
      { t: 0.28, u: ROUTE_U.aboutEnd }
    ]);

    const state = bp.state(0.2);
    // About street x range: WAYPOINTS.aboutStart.x (-260) to WAYPOINTS.aboutEnd.x (200)
    // With some headroom: [-280, 220]
    expect(state.pos.x).toBeGreaterThanOrEqual(-280);
    expect(state.pos.x).toBeLessThanOrEqual(220);
  });

  it('airborne flag is true only inside registered air windows', () => {
    const bp = new BikePath();
    bp.addSpeedKeys([
      { t: 0,    u: ROUTE_U.introStart },
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
      { t: 0.28, u: ROUTE_U.aboutEnd },
      { t: 0.38, u: ROUTE_U.ramp1Base },
      { t: 0.45, u: ROUTE_U.ramp1Land },
      { t: 0.55, u: ROUTE_U.ramp2Base },
      { t: 0.62, u: ROUTE_U.ramp2Land }
    ]);

    // Register a single air window
    const AIR_T0 = 0.39;
    const AIR_T1 = 0.43;
    bp.addAir([{
      t0: AIR_T0,
      t1: AIR_T1,
      u0: ROUTE_U.ramp1Base,
      u1: ROUTE_U.ramp1Land,
      apexY: 18,
      flips: 1
    }]);

    // Should be airborne inside the window
    expect(bp.state((AIR_T0 + AIR_T1) / 2).airborne).toBe(true);

    // Should NOT be airborne outside the window
    expect(bp.state(0.10).airborne).toBe(false);
    expect(bp.state(0.50).airborne).toBe(false);
    expect(bp.state(AIR_T0 - 0.01).airborne).toBe(false);
    expect(bp.state(AIR_T1 + 0.01).airborne).toBe(false);
  });

  it('quat has no NaN through a full flip (pitch = 2π)', () => {
    const bp = new BikePath();
    bp.addSpeedKeys([
      { t: 0,    u: ROUTE_U.introStart },
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
      { t: 0.28, u: ROUTE_U.aboutEnd },
      { t: 0.38, u: ROUTE_U.ramp1Base },
      { t: 0.45, u: ROUTE_U.ramp1Land }
    ]);

    bp.addAir([{
      t0: 0.39,
      t1: 0.44,
      u0: ROUTE_U.ramp1Base,
      u1: ROUTE_U.ramp1Land,
      apexY: 20,
      flips: 1
    }]);

    // Sample densely through the flip window
    for (let i = 0; i <= 200; i++) {
      const t = 0.39 + (i / 200) * (0.44 - 0.39);
      const state = bp.state(t);
      expect(isFinite3(state.quat)).toBe(true);
      expect(isFinite(state.pos.x)).toBe(true);
      expect(isFinite(state.pos.y)).toBe(true);
      expect(isFinite(state.pos.z)).toBe(true);
    }
  });

  it('BikePose fields are finite at t=0 and t=1 (ground state)', () => {
    const bp = new BikePath();
    bp.addSpeedKeys([
      { t: 0,    u: ROUTE_U.introStart },
      { t: 1.0,  u: ROUTE_U.bridgeEnd }
    ]);

    for (const t of [0, 0.5, 1.0]) {
      const state = bp.state(t);
      expect(isFinite(state.pose.lean)).toBe(true);
      expect(isFinite(state.pose.pitch)).toBe(true);
      expect(isFinite(state.pose.crouch)).toBe(true);
      expect(isFinite(state.pose.wheelSpin)).toBe(true);
    }
  });

  // ---- overlap guard tests -----------------------------------------------

  it('addSpeedKeys throws when a second batch t-range overlaps an existing batch (interior)', () => {
    const bp = new BikePath();
    // Register intro keys: t=[0, 0.10]
    bp.addSpeedKeys([
      { t: 0, u: ROUTE_U.introStart },
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 }
    ]);
    // Try to register overlapping about keys starting at t=0.05 (interior overlap)
    expect(() => {
      bp.addSpeedKeys([
        { t: 0.05, u: ROUTE_U.aboutStart },
        { t: 0.28, u: ROUTE_U.aboutEnd }
      ]);
    }).toThrow(/overlapping t range/i);
  });

  it('addSpeedKeys does NOT throw when second batch starts at exact boundary t (shared boundary)', () => {
    const bp = new BikePath();
    // Register intro keys ending at t=0.10
    bp.addSpeedKeys([
      { t: 0, u: ROUTE_U.introStart },
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 }
    ]);
    // Register about keys starting at t=0.10 (shared boundary) — must NOT throw
    expect(() => {
      bp.addSpeedKeys([
        { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
        { t: 0.28, u: ROUTE_U.aboutEnd }
      ]);
    }).not.toThrow();
  });

  it('addSpeedKeys: non-overlapping sequential batches assemble correctly', () => {
    const bp = new BikePath();
    bp.addSpeedKeys([
      { t: 0, u: ROUTE_U.introStart },
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 }
    ]);
    bp.addSpeedKeys([
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
      { t: 0.28, u: ROUTE_U.aboutEnd }
    ]);
    // uAt should progress smoothly from introStart through aboutEnd
    expect(bp.uAt(0)).toBeCloseTo(ROUTE_U.introStart, 5);
    expect(bp.uAt(0.10)).toBeCloseTo(ROUTE_U.aboutStart + 0.02, 5);
    expect(bp.uAt(0.28)).toBeCloseTo(ROUTE_U.aboutEnd, 5);
  });

  it('airborne BikeState.quat is an independent object (not a module-level alias)', () => {
    // Fix 1: ensures cloning so successive calls don't corrupt prior results.
    const bp = new BikePath();
    bp.addSpeedKeys([
      { t: 0,    u: ROUTE_U.introStart },
      { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
      { t: 0.38, u: ROUTE_U.ramp1Base },
      { t: 0.45, u: ROUTE_U.ramp1Land }
    ]);
    bp.addAir([{
      t0: 0.39,
      t1: 0.44,
      u0: ROUTE_U.ramp1Base,
      u1: ROUTE_U.ramp1Land,
      apexY: 20,
      flips: 1
    }]);

    // Take a snapshot of quat from first call
    const s1 = bp.state(0.41);
    const snap = { x: s1.quat.x, y: s1.quat.y, z: s1.quat.z, w: s1.quat.w };

    // Second call should NOT mutate s1.quat
    bp.state(0.43);

    // s1.quat must still equal the snapshot
    expect(s1.quat.x).toBeCloseTo(snap.x, 10);
    expect(s1.quat.y).toBeCloseTo(snap.y, 10);
    expect(s1.quat.z).toBeCloseTo(snap.z, 10);
    expect(s1.quat.w).toBeCloseTo(snap.w, 10);
  });

  // ---- drift override tests (Task 27) ----------------------------------------

  describe('addDriftWindow', () => {
    function makeDriftBike() {
      const bp = new BikePath();
      bp.addSpeedKeys([
        { t: 0,    u: ROUTE_U.introStart },
        { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
        { t: 0.28, u: ROUTE_U.aboutEnd },
        { t: 0.38, u: ROUTE_U.ramp1Base }
      ]);
      return bp;
    }

    it('state(t) returns airborne=false and no NaN inside drift window', () => {
      const bp = makeDriftBike();
      bp.addDriftWindow({
        t0: 0.30, t1: 0.345,
        oversteerDeg: 28,
        leanDeg: 33,
        slideM: 0.4,
        wobbleCycles: 2,
        wobbleDuration: 0.02
      });

      for (let i = 0; i <= 20; i++) {
        const t = 0.30 + (i / 20) * (0.345 - 0.30);
        const s = bp.state(t);
        expect(s.airborne).toBe(false);
        expect(isFinite(s.pos.x)).toBe(true);
        expect(isFinite(s.pos.y)).toBe(true);
        expect(isFinite(s.pos.z)).toBe(true);
        expect(isFinite3(s.quat)).toBe(true);
        expect(isFinite(s.pose.lean)).toBe(true);
      }
    });

    it('drift override applies extra yaw (quat differs from ground state) inside window', () => {
      const bp = makeDriftBike();
      bp.addDriftWindow({
        t0: 0.30, t1: 0.345,
        oversteerDeg: 28,
        leanDeg: 33,
        slideM: 0.4,
        wobbleCycles: 2
      });

      // At t=0.30 (start of window), oversteer should peak — quat should differ from base.
      // We compare the y-component of the quat which encodes yaw.
      // Build a reference BikePath without drift override.
      const bpBase = makeDriftBike();
      const base = bpBase.state(0.305);
      const withDrift = bp.state(0.305);

      // The quats must differ (oversteer adds yaw rotation)
      const dot = base.quat.dot(withDrift.quat);
      // dot = cos(halfAngle between quats); if they were identical, dot=1.0
      expect(Math.abs(dot)).toBeLessThan(1.0 - 1e-6);
    });

    it('drift override: lean is forced inside window and returns toward base after wobble settles', () => {
      const bp = makeDriftBike();
      const DRIFT_T0 = 0.30;
      const DRIFT_T1 = 0.345;
      const WOBBLE_DUR = 0.02;
      bp.addDriftWindow({
        t0: DRIFT_T0, t1: DRIFT_T1,
        oversteerDeg: 28,
        leanDeg: 33,
        slideM: 0.4,
        wobbleCycles: 2,
        wobbleDuration: WOBBLE_DUR
      });

      // Inside drift window: lean should be significant (>10°) near the middle
      const midState = bp.state((DRIFT_T0 + DRIFT_T1) / 2);
      const midLeanDeg = Math.abs(midState.pose.lean) * (180 / Math.PI);
      expect(midLeanDeg).toBeGreaterThan(10);

      // Well after the wobble settles: lean should be close to ground-state lean
      const tAfter = DRIFT_T1 + WOBBLE_DUR + 0.005;
      const afterState = bp.state(tAfter);
      const bpBase2 = makeDriftBike();
      const baseAfter = bpBase2.state(tAfter);
      // Lean should be within 2° of base after wobble (wobble has exp(-5) ≈ 0.007 decay)
      const leanDiff = Math.abs(afterState.pose.lean - baseAfter.pose.lean) * (180 / Math.PI);
      expect(leanDiff).toBeLessThan(2);
    });

    it('state(t) is NaN-free through the full drift + wobble region', () => {
      const bp = makeDriftBike();
      bp.addDriftWindow({
        t0: 0.30, t1: 0.345,
        oversteerDeg: 28,
        leanDeg: 33,
        slideM: 0.4,
        wobbleCycles: 2,
        wobbleDuration: 0.02
      });

      // Sample densely from before drift through after wobble
      for (let i = 0; i <= 100; i++) {
        const t = 0.28 + (i / 100) * (0.38 - 0.28);
        const s = bp.state(t);
        expect(isFinite(s.pos.x)).toBe(true);
        expect(isFinite(s.pos.y)).toBe(true);
        expect(isFinite(s.pos.z)).toBe(true);
        expect(isFinite3(s.quat)).toBe(true);
        expect(isFinite(s.pose.lean)).toBe(true);
      }
    });

    it('addDriftWindow throws on overlapping windows', () => {
      const bp = makeDriftBike();
      bp.addDriftWindow({ t0: 0.30, t1: 0.345, oversteerDeg: 28, leanDeg: 33, slideM: 0.4, wobbleCycles: 2 });
      expect(() => {
        bp.addDriftWindow({ t0: 0.34, t1: 0.36, oversteerDeg: 10, leanDeg: 10, slideM: 0.1, wobbleCycles: 1 });
      }).toThrow(/overlapping drift windows/i);
    });

    it('addDriftWindow does NOT throw for non-overlapping windows', () => {
      const bp = makeDriftBike();
      bp.addDriftWindow({ t0: 0.30, t1: 0.345, oversteerDeg: 28, leanDeg: 33, slideM: 0.4, wobbleCycles: 2, wobbleDuration: 0.01 });
      // Second window well after the wobble tail ends at 0.355
      expect(() => {
        bp.addDriftWindow({ t0: 0.36, t1: 0.38, oversteerDeg: 10, leanDeg: 10, slideM: 0.1, wobbleCycles: 1 });
      }).not.toThrow();
    });
  });
});
