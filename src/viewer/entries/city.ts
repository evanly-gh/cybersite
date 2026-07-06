import { registerAsset } from '../registry';
import { buildCity } from '../../world/cityLayout';
import { buildStreets } from '../../world/streets';
import { buildFarField } from '../../world/farField';
import * as THREE from 'three';

/**
 * Task 20 verification: the whole assembled city (buildCity(1337) + streets + farField)
 * as one viewer asset, so `npm run shoot -- --viewer city --cam ...` can hit any of the
 * 6 debug viewpoints below. `?cam=` (Task 8) is required here — the city spans ~1800m,
 * far past what the default auto-framing camera logic can usefully frame.
 *
 * Debug viewpoints (world-space `--cam x,y,z,tx,ty,tz`), authored to match the brief's
 * Step 5 list. All 6 measured < 260 draw calls (Step 6 audit — see task-20-report.md):
 *   aboutWall:  --cam -70,6,25,-70,10,-11        (254 draws)
 *   shibuya:    --cam 200,10,32,255,10,-8         (247 draws — raised sidewalk view over
 *               the scramble crossing, framed to avoid clipping through a corner tower)
 *   boulevard:  --cam 240,2.5,-60,240,4,-300      (249 draws, low angle down the boulevard)
 *   skyway:     --cam 240,20,-500,240,28,-650     (69 draws)
 *   bridge:     --cam 240,6,-900,240,260,-2600    (31 draws, the farField "money shot")
 *   overhead:   --cam 240,150,-40,240,0,-120      (226 draws)
 */
registerAsset('city', (rng) => {
  const group = new THREE.Group();
  const city = buildCity(1337);
  const streets = buildStreets(rng);
  const far = buildFarField(rng);
  group.add(far.group, streets, city.group);

  return {
    group,
    update: (t: number) => city.update(t),
    updateAmbient: (sec: number) => {
      city.updateAmbient(sec);
      far.updateAmbient(sec);
    }
  };
});
