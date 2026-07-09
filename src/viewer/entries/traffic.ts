import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildStreets } from '../../world/streets';
import { buildFarField } from '../../world/farField';
import { buildTraffic } from '../../choreography/traffic';

/**
 * Task 21 verification: light scene viewer (streets + traffic + farField) for
 * checking vehicle placement at three scroll positions.
 *
 * Use `?cam=` overrides for world-scale coverage. Suggested viewpoints:
 *
 *   About street mid:
 *     --cam -100,8,30,-70,4,-11
 *   Boulevard overview:
 *     --cam 200,12,32,240,4,-120
 *   Skyway/bridge approach:
 *     --cam 240,22,-500,240,28,-650
 *
 * Three `?t=` values used for verification: 0.15, 0.45, 0.9
 */
registerAsset('traffic', (rng) => {
  const group = new THREE.Group();

  const streets = buildStreets(rng);
  const far = buildFarField(rng);
  const traffic = buildTraffic(rng);

  group.add(far.group);
  group.add(streets);
  group.add(traffic.group);

  return {
    group,
    update: (t: number) => traffic.update(t),
    updateAmbient: (sec: number) => far.updateAmbient(sec)
  };
});
