// tests/route.test.ts
import { describe, it, expect } from 'vitest';
import { sampleRoute, roadFrame, ZONES, MOON_POS, ROUTE_LENGTH } from '../src/world/route';

describe('route', () => {
  it('samples endpoints', () => {
    const a = sampleRoute(0);
    const b = sampleRoute(1);
    expect(a.pos.x).toBeCloseTo(-320, 0);
    expect(b.pos.z).toBeCloseTo(-1100, -1); // within ~10m
  });

  it('turns right: +X travel before Shibuya, -Z travel after', () => {
    const before = sampleRoute(0.15).tangent; // heading +X
    const after = sampleRoute(0.7).tangent;    // heading -Z
    expect(before.x).toBeGreaterThan(0.5);
    expect(after.z).toBeLessThan(-0.5);
  });

  it('road frame is orthonormal', () => {
    const f = roadFrame(0.5);
    expect(f.tangent.length()).toBeCloseTo(1, 3);
    expect(f.binormal.length()).toBeCloseTo(1, 3);
    expect(f.tangent.dot(f.binormal)).toBeCloseTo(0, 3);
  });

  it('ramp/scaffold heights are encoded', () => {
    expect(sampleRoute(0.46).pos.y).toBeGreaterThan(8);  // scaffold deck
    expect(sampleRoute(0.84).pos.y).toBeCloseTo(0, 0);   // research ground
    expect(sampleRoute(1).pos.y).toBeGreaterThan(8);      // bridge deck
  });

  it('exposes zones and moon', () => {
    expect(ZONES.about[0]).toBeCloseTo(0.12, 2);
    expect(MOON_POS.y).toBeGreaterThan(100);
    expect(ROUTE_LENGTH).toBeGreaterThan(1500);
  });
});
