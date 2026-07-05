import * as THREE from 'three';
import { registerAsset, type AssetEntry } from '../registry';
import { buildRadioMast, buildMonument } from '../../assets/buildings/skinny';
import { decorateRoof } from '../../assets/buildings/rooftop';
import type { Rng } from '../../utils/rng';

/**
 * Task 12 viewer entries: radioMast, monument, roofDemo (3 different-size roof slabs,
 * each decorated by `decorateRoof`, to sanity-check the packing logic across sizes).
 * Same ambient-blink/halo-precession wrapper as buildingsTall.ts's withAmbient, so
 * beacons/halos read as lit in fixed-`?sec=` screenshots.
 */
function withAmbient(group: THREE.Group): AssetEntry {
  const beacons: THREE.Mesh[] = [];
  const halos: THREE.Object3D[] = [];
  const fans: THREE.Mesh[] = [];
  group.traverse((o) => {
    const g = o as THREE.Group;
    if (Array.isArray(g.userData?.beacons)) beacons.push(...(g.userData.beacons as THREE.Mesh[]));
    if (g.userData?.halo) halos.push(g.userData.halo as THREE.Object3D);
    if (Array.isArray(g.userData?.fans)) fans.push(...(g.userData.fans as THREE.Mesh[]));
  });
  const uniqueBeacons = [...new Set(beacons)];
  const uniqueHalos = [...new Set(halos)];
  const uniqueFans = [...new Set(fans)];

  return {
    group,
    updateAmbient(sec: number) {
      uniqueBeacons.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.6 + 1.6 * (0.5 + 0.5 * Math.sin(sec * 4 + i * 1.3));
      });
      uniqueHalos.forEach((halo, i) => {
        halo.rotation.y = sec * 0.15 + i;
      });
      uniqueFans.forEach((fan, i) => {
        fan.rotation.y = sec * 6 + i;
      });
    }
  };
}

registerAsset('radioMast', (rng: Rng) => withAmbient(buildRadioMast(rng)));
registerAsset('monument', (rng: Rng) => withAmbient(buildMonument(rng)));

// 3 differently-sized roofs, each decorated by decorateRoof, side by side.
registerAsset('roofDemo', (rng: Rng) => {
  const group = new THREE.Group();
  const roofs: Array<{ w: number; d: number; y: number }> = [
    { w: 12, d: 12, y: 6 },
    { w: 26, d: 16, y: 10 },
    { w: 40, d: 24, y: 14 }
  ];
  let xOffset = 0;
  const gap = 8;
  roofs.forEach((roof, i) => {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(roof.w, roof.y, roof.d),
      new THREE.MeshStandardMaterial({ color: 0x0a0c16, roughness: 0.85 })
    );
    const cx = xOffset + roof.w / 2;
    slab.position.set(cx, roof.y / 2, 0);
    group.add(slab);

    const clutter = decorateRoof(roof, rng, { billboard: i === 1 });
    clutter.position.set(cx, roof.y, 0);
    group.add(clutter);

    xOffset += roof.w + gap;
  });
  return withAmbient(group);
});
