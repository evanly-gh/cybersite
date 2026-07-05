import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildBike } from '../../assets/vehicles/bike';

/**
 * Task 16 verification: protagonist biker + Tron bike.
 * `?t=` pose sweep per the task brief:
 *   t 0→0.5  : lean −35° → +35° (pitch 0)
 *   t 0.5→1  : full pitch flip 0 → 360° (lean 0)
 *   crouch   = sin(t·π)   (tuck at the ends, standing mid-sweep)
 *   wheelSpin = t·20
 */
registerAsset('bike', (rng) => {
  const bike = buildBike(rng);
  return {
    group: bike.group,
    update: (t: number) => {
      const lean =
        t <= 0.5 ? THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-35, 35, t / 0.5)) : 0;
      const pitch = t <= 0.5 ? 0 : ((t - 0.5) / 0.5) * Math.PI * 2;
      bike.pose({
        lean,
        pitch,
        crouch: Math.sin(t * Math.PI),
        wheelSpin: t * 20
      });
    }
  };
});
