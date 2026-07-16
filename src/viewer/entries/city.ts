/**
 * City viewer entry
 *
 * Loads the real NeoLibrary via loadNeoCity, then calls buildCity to assemble
 * the full corridor of NeoCity buildings flanking the route. The group is
 * populated lazily (async load) using the same placeholder pattern as the
 * neocity viewer entry.
 *
 * Usage: `npm run shoot -- --viewer city`
 */

import * as THREE from 'three';
import { registerAsset } from '../registry';
import { loadNeoCity } from '../../assets/buildings/neocity';
import { buildCity } from '../../world/cityLayout';
import type { Rng } from '../../utils/rng';

// Seed for the deterministic layout — fixed for the portfolio build.
const CITY_SEED = 0xc1_1337;

registerAsset('city', (rng: Rng) => {
  const holderGroup = new THREE.Group();
  holderGroup.name = 'city_holder';

  // Add placeholder ambient light so the scene isn't black while loading.
  const ambient = new THREE.AmbientLight(0x223355, 1.5);
  holderGroup.add(ambient);

  // A few neon point lights to illuminate the corridor while models load.
  const neonColors = [0xb7f5e9, 0xff2bd6, 0xffb347];
  for (let i = 0; i < 3; i++) {
    const pt = new THREE.PointLight(neonColors[i % neonColors.length], 4, 60);
    pt.position.set(-20 + i * 30, 10, 0);
    holderGroup.add(pt);
  }

  // State for update/updateAmbient delegates (filled once async load resolves).
  let cityUpdate: ((t: number) => void) | null = null;
  let cityUpdateAmbient: ((sec: number) => void) | null = null;

  // Kick off async load; populate group when ready.
  loadNeoCity().then((lib) => {
    const city = buildCity(lib, CITY_SEED);
    holderGroup.add(city.group);
    cityUpdate = (t) => city.update(t);
    cityUpdateAmbient = (sec) => city.updateAmbient(sec);

    // Log anchor summary for debugging
    const counts = city.anchors.reduce<Record<string, number>>((acc, a) => {
      acc[a.kind] = (acc[a.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.info('[city viewer] loaded. Anchors:', counts);
    console.info('[city viewer] total pieces in group:', city.group.children.length);
  }).catch((err) => {
    console.warn('[city viewer] loadNeoCity failed:', err);
  });

  return {
    group: holderGroup,
    update(t: number) {
      cityUpdate?.(t);
    },
    updateAmbient(sec: number) {
      cityUpdateAmbient?.(sec);
    },
  };
});
