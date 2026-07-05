import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildPerson, buildCrowd } from '../../assets/characters/person';
import { buildDog } from '../../assets/characters/dog';

/**
 * Task 17 verification. All ambient-only (wall-clock `sec`, not scrubbed `t`):
 *  - personWalk / personStand / personSit: single figure per pose.
 *  - dogWalk: single dog.
 *  - crowd: buildCrowd(14) in a 6x6 area — cheap merged/instanced Shibuya-corner crowd.
 *  - streetCast: 3 walkers, 2 standers, 3 sitters on a bench prop, 2 dogs — the
 *    detail-iteration lineup.
 */

registerAsset('personWalk', (rng) => {
  const p = buildPerson(rng, 'walk');
  return { group: p.group, updateAmbient: p.updateAmbient };
});

registerAsset('personStand', (rng) => {
  const p = buildPerson(rng, 'stand');
  return { group: p.group, updateAmbient: p.updateAmbient };
});

registerAsset('personSit', (rng) => {
  const p = buildPerson(rng, 'sit');
  // lift onto a stub 0.45m seat anchor stand-in so the pose reads correctly in isolation.
  const seatProp = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.45, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.9 })
  );
  seatProp.position.set(0, 0.225, 0);
  const group = new THREE.Group();
  p.group.position.y = 0.45;
  group.add(seatProp, p.group);
  return { group, updateAmbient: p.updateAmbient };
});

registerAsset('dogWalk', (rng) => {
  const d = buildDog(rng, 'walk');
  return { group: d.group, updateAmbient: d.updateAmbient };
});

registerAsset('crowd', (rng) => {
  const c = buildCrowd(rng, 14, [6, 6]);
  return { group: c.group, updateAmbient: c.updateAmbient };
});

// Debug-only close-up of the sitting dog pose (not part of the required
// registration list, but useful for the detail-iteration loop).
registerAsset('dogSit', (rng) => {
  const d = buildDog(rng, 'sit');
  return { group: d.group, updateAmbient: d.updateAmbient };
});

// A bench prop for the seated trio — a simple slab + two legs, seat top at 0.45m.
function buildBenchProp(): { group: THREE.Group; seatY: number } {
  const mat = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.85, metalness: 0.2 });
  const group = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.45), mat);
  seat.position.set(0, 0.45, 0);
  group.add(seat);
  for (const x of [-0.95, 0.95]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.4), mat);
    leg.position.set(x, 0.21, 0);
    group.add(leg);
  }
  return { group, seatY: 0.45 };
}

registerAsset('streetCast', (rng) => {
  const group = new THREE.Group();
  const updates: Array<(sec: number) => void> = [];

  // 3 walkers, spread along a sidewalk line — kept in a compact ~7x5m footprint
  // (round-1 iteration: a 12m-wide lineup zoomed the auto-framed camera out so
  // far every figure read as a few dark pixels).
  const walkerX = [-2.8, -1.2, 0.4];
  for (const x of walkerX) {
    const w = buildPerson(rng, 'walk');
    w.group.position.set(x, 0, 1.6);
    w.group.rotation.y = rng.range(-0.2, 0.2);
    group.add(w.group);
    updates.push(w.updateAmbient);
  }

  // 2 standers, loitering near a storefront line
  const standerX = [1.7, 3.0];
  for (const x of standerX) {
    const s = buildPerson(rng, 'stand');
    s.group.position.set(x, 0, -1.1);
    s.group.rotation.y = rng.range(-Math.PI, Math.PI);
    group.add(s.group);
    updates.push(s.updateAmbient);
  }

  // bench + 3 sitters, each parented to a 0.45m hip-height anchor on the bench
  const bench = buildBenchProp();
  bench.group.position.set(-0.8, 0, 3.4);
  group.add(bench.group);
  const seatXs = [-0.8, 0, 0.8];
  for (const sx of seatXs) {
    const anchor = new THREE.Object3D();
    anchor.position.set(sx, bench.seatY, 0);
    anchor.rotation.y = Math.PI / 2;
    bench.group.add(anchor);
    const sit = buildPerson(rng, 'sit');
    anchor.add(sit.group);
    updates.push(sit.updateAmbient);
  }

  // 2 dogs, one paired beside the first walker, one sitting near the standers
  const dogWalking = buildDog(rng, 'walk');
  dogWalking.group.position.set(walkerX[0] + 0.55, 0, 1.9);
  dogWalking.group.rotation.y = rng.range(-0.2, 0.2);
  group.add(dogWalking.group);
  updates.push(dogWalking.updateAmbient);

  const dogSitting = buildDog(rng, 'sit');
  dogSitting.group.position.set(standerX[1] + 0.5, 0, -1.4);
  dogSitting.group.rotation.y = rng.range(0, Math.PI * 2);
  group.add(dogSitting.group);
  updates.push(dogSitting.updateAmbient);

  return {
    group,
    updateAmbient(sec: number): void {
      for (const u of updates) u(sec);
    }
  };
});
