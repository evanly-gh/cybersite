import * as THREE from 'three';
import { registerAsset, type AssetEntry } from '../registry';
import { buildApartment, buildOfficeHolo, buildParking } from '../../assets/buildings/medium';
import type { Rng } from '../../utils/rng';

/**
 * Task 10 viewer entries: apartment, officeHolo, parking, plus the mediumTrio composite.
 * Mirrors buildingsTall.ts's withAmbient wrapper — the real city assembly owns beacon
 * blink + ticker UV-scroll, this replicates a minimal version so screenshots show
 * beacons lit and the ticker mid-scroll.
 */
function withAmbient(group: THREE.Group): AssetEntry {
  const beacons: THREE.Mesh[] = [];
  const tickers: THREE.Mesh[] = [];
  group.traverse((o) => {
    const g = o as THREE.Group;
    if (Array.isArray(g.userData?.beacons)) beacons.push(...(g.userData.beacons as THREE.Mesh[]));
    if (g.userData?.ticker) tickers.push(g.userData.ticker as THREE.Mesh);
  });
  const uniqueBeacons = [...new Set(beacons)];
  const uniqueTickers = [...new Set(tickers)];

  return {
    group,
    updateAmbient(sec: number) {
      uniqueBeacons.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.6 + 1.6 * (0.5 + 0.5 * Math.sin(sec * 4 + i * 1.3));
      });
      uniqueTickers.forEach((mesh) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.emissiveMap) {
          mat.emissiveMap.offset.x = (sec * 0.06) % 1;
        }
      });
    }
  };
}

registerAsset('apartment', (rng: Rng) => withAmbient(buildApartment(rng)));
registerAsset('officeHolo', (rng: Rng) => withAmbient(buildOfficeHolo(rng)));
registerAsset('parking', (rng: Rng) => withAmbient(buildParking(rng)));

// Composite: all three, 40m apart, for silhouette-variety + night-mood checks.
registerAsset('mediumTrio', (rng: Rng) => {
  const group = new THREE.Group();
  const apartment = buildApartment(rng);
  apartment.position.x = -40;
  const office = buildOfficeHolo(rng);
  const parking = buildParking(rng);
  parking.position.x = 40;
  group.add(apartment, office, parking);
  return withAmbient(group);
});
