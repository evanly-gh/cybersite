import * as THREE from 'three';
import { registerAsset, type AssetEntry } from '../registry';
import { buildStorefrontRow, buildFancyRestaurant, buildRamenShop, buildBar } from '../../assets/buildings/short';
import type { Rng } from '../../utils/rng';

/**
 * Task 11 viewer entries: storefrontRow, fancyRestaurant, ramenShop, bar, plus a
 * shortStrip composite (all four side by side) for street-life-density / night-mood
 * checks. Mirrors buildingsTall.ts's `withAmbient` wrapper: the real city assembly owns
 * neon flicker, this replicates a minimal version so fixed-`?sec=` screenshots show the
 * marquee mid-flicker instead of always at full brightness.
 */
function withAmbient(group: THREE.Group): AssetEntry {
  const flicker: THREE.Mesh[] = [];
  group.traverse((o) => {
    const g = o as THREE.Object3D;
    if (Array.isArray(g.userData?.flicker)) flicker.push(...(g.userData.flicker as THREE.Mesh[]));
  });
  const uniqueFlicker = [...new Set(flicker)];

  return {
    group,
    updateAmbient(sec: number) {
      uniqueFlicker.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        // Sharper on/off flicker than the tall towers' beacon sine — reads as neon
        // signage misbehaving rather than a smooth aviation blink.
        const noisy = Math.sin(sec * 11 + i * 2.1) + 0.6 * Math.sin(sec * 27 + i);
        mat.emissiveIntensity = noisy > -0.3 ? 1.9 : 0.35;
      });
    }
  };
}

registerAsset('storefrontRow', (rng: Rng) => withAmbient(buildStorefrontRow(rng)));
registerAsset('fancyRestaurant', (rng: Rng) => withAmbient(buildFancyRestaurant(rng)));
registerAsset('ramenShop', (rng: Rng) => withAmbient(buildRamenShop(rng)));
registerAsset('bar', (rng: Rng) => withAmbient(buildBar(rng)));

// Composite: all four side by side for street-life density / night-mood compliance.
registerAsset('shortStrip', (rng: Rng) => {
  const group = new THREE.Group();
  const row = buildStorefrontRow(rng);
  row.position.x = -60;
  const restaurant = buildFancyRestaurant(rng);
  restaurant.position.x = -22;
  const ramen = buildRamenShop(rng);
  ramen.position.x = 6;
  const bar = buildBar(rng);
  bar.position.x = 24;
  group.add(row, restaurant, ramen, bar);
  return withAmbient(group);
});
