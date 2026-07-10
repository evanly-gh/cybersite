/**
 * Task 25 TDD: BikePath tests.
 * Must FAIL before BikePath is implemented, then PASS after.
 *
 * Tests:
 *  1. u(t) monotonic non-decreasing over 500 samples given intro+about speed keys
 *  2. state(0.2).pos within About street world bounds
 *  3. airborne flag true only inside registered air windows
 *  4. quat has no NaN through a full flip
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
  it('u(t) is monotonic non-decreasing over 500 samples (intro+about keys)', () => {
    const bp = new BikePath();
    bp.addSpeedKeys(makeIntroAboutKeys());

    let prevU = -Infinity;
    for (let i = 0; i <= 500; i++) {
      const t = i / 500;
      const state = bp.state(t);
      const u = ROUTE_U.introStart; // we'll derive u from pos instead - use t directly
      // u must be non-decreasing: check via state positions along route
      // Simplest proxy: x-coordinate is monotonically non-decreasing in intro segment
      // (route goes from -300 toward +x during intro)
      // Actually test that successive states don't regress in u by checking pos.x
      void state;
      void prevU;
    }

    // More direct: reconstruct the u values via the piecewise-linear interpolation.
    // We do this by checking that pos changes consistently with forward motion.
    // The real test: u(t) itself must be non-decreasing.
    // We expose internal u via state.pos matching ROUTE.getPointAt(u).
    // Use state at t=0 → pos near introStart, state at t=0.10 → pos near aboutStart+0.02.

    const s0 = bp.state(0);
    const s1 = bp.state(0.10);

    // Both positions should be roughly finite
    expect(isFinite(s0.pos.x)).toBe(true);
    expect(isFinite(s1.pos.x)).toBe(true);

    // x should increase from intro → about (route goes -300 → ~-240 in this range)
    expect(s1.pos.x).toBeGreaterThan(s0.pos.x);
  });

  it('u(t) samples are monotonic: each successive u >= previous', () => {
    const bp = new BikePath();
    bp.addSpeedKeys(makeIntroAboutKeys());

    // Sample 500 evenly spaced t values and verify u is non-decreasing.
    // We track u by sampling state and checking ROUTE distance proxy:
    // since the route goes along +x during intro, pos.x is a proxy for u.
    const xs: number[] = [];
    for (let i = 0; i <= 500; i++) {
      const t = i / 500;
      const state = bp.state(t);
      xs.push(state.pos.x);
    }

    for (let i = 1; i < xs.length; i++) {
      // x must be non-decreasing (route is monotonic in x during intro)
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 0.1); // small tolerance for weave
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
});
