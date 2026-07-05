import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildLamboWedge, buildGTCoupe } from '../../assets/vehicles/cars';
import { buildHoverA, buildHoverB } from '../../assets/vehicles/hover';

/**
 * Task 15 viewer entries: lamboWedge, gtCoupe, hoverA, hoverB, plus a luxuryLineup
 * composite (all four side by side) for the showpiece detail-review shots.
 * `?t=` drives wheel spin (cars) / bob + thruster pulse (hovers).
 */

registerAsset('lamboWedge', (rng) => {
  const car = buildLamboWedge(rng);
  return { group: car.group, update: car.update };
});

registerAsset('gtCoupe', (rng) => {
  const car = buildGTCoupe(rng);
  return { group: car.group, update: car.update };
});

registerAsset('hoverA', (rng) => {
  const hover = buildHoverA(rng);
  return { group: hover.group, update: hover.update };
});

registerAsset('hoverB', (rng) => {
  const hover = buildHoverB(rng);
  return { group: hover.group, update: hover.update };
});

registerAsset('luxuryLineup', (rng) => {
  const group = new THREE.Group();
  const lambo = buildLamboWedge(rng);
  lambo.group.position.z = -5;
  const gt = buildGTCoupe(rng);
  gt.group.position.z = -1.5;
  // Hover update() sets group.position.y directly (bob), so the flight-height
  // offset for the lineup goes on a wrapper parent, not the hover group itself.
  const hoverA = buildHoverA(rng);
  const hoverAMount = new THREE.Group();
  hoverAMount.position.set(0, 1.6, 2.2);
  hoverAMount.add(hoverA.group);
  const hoverB = buildHoverB(rng);
  const hoverBMount = new THREE.Group();
  hoverBMount.position.set(0, 1.6, 5.5);
  hoverBMount.add(hoverB.group);
  group.add(lambo.group, gt.group, hoverAMount, hoverBMount);
  return {
    group,
    update(t: number) {
      lambo.update(t);
      gt.update(t);
      hoverA.update(t);
      hoverB.update(t);
    }
  };
});
