import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WAYPOINTS, ROUTE, ROUTE_U, MOON_POS, MOON_RADIUS, roadFrame } from '../src/world/route';

describe('route', () => {
  it('total route length is within [1650, 1950] meters', () => {
    const length = ROUTE.getLength();
    expect(length).toBeGreaterThanOrEqual(1650);
    expect(length).toBeLessThanOrEqual(1950);
  });

  it('shibuyaCenter sample point lands within 8m of (240, 0, 0)', () => {
    const p = ROUTE.getPointAt(ROUTE_U.shibuyaCenter);
    const target = new THREE.Vector3(240, 0, 0);
    expect(p.distanceTo(target)).toBeLessThanOrEqual(8);
  });

  it('y at researchEnd u is within 1m of 0 (ground-level canyon, not elevated skyway)', () => {
    const p = ROUTE.getPointAt(ROUTE_U.researchEnd);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
  });

  it('roadFrame binormal is unit-length and perpendicular to tangent across 20 sampled u', () => {
    for (let i = 0; i < 20; i++) {
      const u = i / 19;
      const { tangent, binormal } = roadFrame(u);
      expect(binormal.length()).toBeCloseTo(1, 5);
      expect(tangent.dot(binormal)).toBeCloseTo(0, 4);
    }
  });

  it('exposes named waypoints, moon constants matching brief', () => {
    expect(WAYPOINTS.introStart.equals(new THREE.Vector3(-300, 0, 0))).toBe(true);
    expect(WAYPOINTS.bridgeEnd.equals(new THREE.Vector3(240, 12, -1400))).toBe(true);
    expect(MOON_POS.equals(new THREE.Vector3(240, 260, -2600))).toBe(true);
    expect(MOON_RADIUS).toBe(320);
  });
});
