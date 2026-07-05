import * as THREE from 'three';
import { registerAsset } from '../registry';
import {
  buildHatchback,
  buildKeiVan,
  buildSedan,
  buildCrossover,
  type CarAsset
} from '../../assets/vehicles/cars';

/**
 * Task 14 verification: cheap (hatchback, kei van) + average (sedan, crossover)
 * ground traffic. `?t=` drives wheel spin (angle = t · userData.speed).
 */
registerAsset('hatchback', (rng) => wrap(buildHatchback(rng)));
registerAsset('keiVan', (rng) => wrap(buildKeiVan(rng)));
registerAsset('sedan', (rng) => wrap(buildSedan(rng)));
registerAsset('crossover', (rng) => wrap(buildCrossover(rng)));

function wrap(car: CarAsset): { group: THREE.Object3D; update: (t: number) => void } {
  return { group: car.group, update: (t) => car.update(t) };
}

/** All four in a row (cheap → average, left to right), sharing one wheel-spin clock. */
registerAsset('carLineup', (rng) => {
  const builders = [buildHatchback, buildKeiVan, buildSedan, buildCrossover];
  const cars = builders.map((b) => b(rng));
  const row = new THREE.Group();
  row.name = 'carLineup';
  const spacing = 5.5;
  cars.forEach((car, i) => {
    car.group.position.z = (i - (cars.length - 1) / 2) * spacing;
    row.add(car.group);
  });
  return {
    group: row,
    update: (t: number) => cars.forEach((c) => c.update(t))
  };
});
