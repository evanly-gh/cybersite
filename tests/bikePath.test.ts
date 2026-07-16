// tests/bikePath.test.ts
import { describe, it, expect } from 'vitest';
import { BikePath } from '../src/choreography/bikePath';

describe('BikePath', () => {
  const bp = new BikePath();

  it('is deterministic (scrub-safe)', () => {
    const a = bp.state(0.55);
    const b = bp.state(0.55);
    expect(a.pos.x).toBe(b.pos.x);
    expect(a.pose.pitch).toBe(b.pose.pitch);
  });

  it('does a full backflip in each ramp zone', () => {
    const before1 = bp.state(0.36).pose.pitch;
    const after1 = bp.state(0.46).pose.pitch;
    expect(Math.abs(after1 - before1)).toBeCloseTo(2 * Math.PI, 1);
    const before2 = bp.state(0.52).pose.pitch;
    const after2 = bp.state(0.62).pose.pitch;
    expect(Math.abs(after2 - before2)).toBeCloseTo(2 * Math.PI, 1);
  });

  it('leans through the Shibuya turn, straight elsewhere', () => {
    expect(Math.abs(bp.state(0.15).pose.lean)).toBeLessThan(0.05);
    expect(Math.abs(bp.state(0.32).pose.lean)).toBeGreaterThan(0.1);
  });

  it('wheelSpin is monotonic', () => {
    expect(bp.state(0.6).pose.wheelSpin).toBeGreaterThan(bp.state(0.3).pose.wheelSpin);
  });

  it('crouch returns to baseline outside ramp zones (no latch bug)', () => {
    // t=0.75 is deep in research zone, well past both ramp zones
    const crouchResearch = bp.state(0.75).pose.crouch;
    expect(crouchResearch).toBeLessThan(0.3);
  });

  it('crouch is elevated near flip apex (ramp1 midpoint t≈0.41)', () => {
    // ramp1 is [0.36, 0.46], midpoint at 0.41
    const crouchApex = bp.state(0.41).pose.crouch;
    expect(crouchApex).toBeGreaterThan(0.5);
  });
});
