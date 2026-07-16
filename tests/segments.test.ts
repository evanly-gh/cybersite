// tests/segments.test.ts
import { describe, it, expect } from 'vitest';
import { CameraRig } from '../src/choreography/cameraRig';
import { BikePath } from '../src/choreography/bikePath';
import { registerRideSegments } from '../src/choreography/segments/ride';

describe('ride segments', () => {
  it('covers the whole ride with keys', () => {
    const rig = new CameraRig();
    registerRideSegments(rig, new BikePath());
    // sample at many t — should never throw and fov stays sane
    for (let t = 0; t <= 1; t += 0.05) {
      const p = rig.sample(t);
      expect(p.fov).toBeGreaterThan(30);
      expect(p.fov).toBeLessThan(100);
    }
  });

  it('research camera looks up (target above camera)', () => {
    const rig = new CameraRig();
    registerRideSegments(rig, new BikePath());
    const p = rig.sample(0.76);
    expect(p.target.y).toBeGreaterThan(p.pos.y + 5);
  });
});
