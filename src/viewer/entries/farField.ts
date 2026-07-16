/**
 * farField viewer entries — Task 14
 *
 * `farField`  — the full ring of cheap silhouette towers.
 *               View with: ?viewer=farField
 *               Pass ?t= to drive twinkle (sec = t * 60).
 *
 * `moon`      — the large detailed moon at MOON_POS.
 *               Best seen with a camera aimed at (240,240,-2400):
 *               ?viewer=moon&cam=240,240,-1800,240,240,-2400
 *
 * `farFieldFull` — skyline + moon together for combined review.
 */

import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildFarField, buildMoon } from '../../world/farField';

registerAsset('farField', (rng) => {
  const ff = buildFarField(rng, 1);
  return {
    group: ff.group,
    updateAmbient: ff.updateAmbient,
  };
});

registerAsset('moon', (rng) => {
  const moonGroup = buildMoon(rng);

  // Add a subtle ambient so the scene is not pitch black when viewed in isolation
  const group = new THREE.Group();
  const ambient = new THREE.AmbientLight(0x1a1c30, 1.0);
  group.add(ambient, moonGroup);

  return {
    group,
    updateAmbient(_sec: number) {
      // Moon itself has no per-frame animation; glow is static
    },
  };
});

registerAsset('farFieldFull', (rng) => {
  const ff   = buildFarField(rng, 1);
  const moon = buildMoon(rng);

  const group = new THREE.Group();
  group.add(ff.group, moon);

  return {
    group,
    updateAmbient(sec: number) {
      ff.updateAmbient(sec);
    },
  };
});
