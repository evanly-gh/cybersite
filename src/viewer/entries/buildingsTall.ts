import * as THREE from 'three';
import { registerAsset, type AssetEntry } from '../registry';
import { buildTallStepped, buildTallSlab } from '../../assets/buildings/tall';
import { buildMonolith } from '../../assets/buildings/special';
import type { Rng } from '../../utils/rng';

/**
 * Task 9 viewer entries: tallStepped, tallSlab, monolith, plus the tallTrio composite
 * for silhouette-variety / night-mood checks. The real city assembly owns beacon
 * blinking + halo rotation; this wrapper replicates a minimal version so screenshots
 * (fixed `?sec=`) show beacons lit and the halo mid-precession.
 */
function withAmbient(group: THREE.Group): AssetEntry {
  const beacons: THREE.Mesh[] = [];
  const halos: THREE.Object3D[] = [];
  group.traverse((o) => {
    const g = o as THREE.Group;
    if (Array.isArray(g.userData?.beacons)) beacons.push(...(g.userData.beacons as THREE.Mesh[]));
    if (g.userData?.halo) halos.push(g.userData.halo as THREE.Object3D);
  });
  // The group itself also carries userData (traverse visits it), so de-dupe.
  const uniqueBeacons = [...new Set(beacons)];
  const uniqueHalos = [...new Set(halos)];

  return {
    group,
    updateAmbient(sec: number) {
      uniqueBeacons.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        // Soft sine blink, phase-staggered; never fully dark so stills always show them.
        mat.emissiveIntensity = 1.6 + 1.6 * (0.5 + 0.5 * Math.sin(sec * 4 + i * 1.3));
      });
      uniqueHalos.forEach((halo, i) => {
        halo.rotation.y = sec * 0.15 + i;
      });
    }
  };
}

registerAsset('tallStepped', (rng: Rng) => withAmbient(buildTallStepped(rng)));
registerAsset('tallSlab', (rng: Rng) => withAmbient(buildTallSlab(rng)));
registerAsset('monolith', (rng: Rng) => withAmbient(buildMonolith(rng)));

// Composite: all three side by side for silhouette-variety + night-mood compliance.
registerAsset('tallTrio', (rng: Rng) => {
  const group = new THREE.Group();
  const stepped = buildTallStepped(rng);
  stepped.position.x = -48;
  const slab = buildTallSlab(rng);
  const monolith = buildMonolith(rng);
  monolith.position.x = 52;
  group.add(stepped, slab, monolith);
  return withAmbient(group);
});
