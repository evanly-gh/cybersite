import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildCrane } from '../../assets/props/crane';
import { buildGasStation } from '../../assets/props/gasStation';
import { buildPowerRun } from '../../assets/props/powerlines';
import {
  buildTrafficLight,
  buildStreetLamp,
  buildSteamVent,
  buildVendingMachine,
  buildHydrant,
  buildTrashHeap
} from '../../assets/props/streetProps';

/**
 * Task 18 verification viewers. Cranes animate their hanging load via updateAmbient;
 * everything else is static. `propYard` lines all the props up on a grid so the
 * detail-iteration loop can shoot the whole kit at once.
 */

registerAsset('crane', (rng) => buildCrane(rng, false));
registerAsset('craneSwinging', (rng) => buildCrane(rng, true));
registerAsset('gasStation', (rng) => buildGasStation(rng));

registerAsset('powerRun', (rng) =>
  buildPowerRun(rng, new THREE.Vector3(-30, 0, 0), new THREE.Vector3(30, 0, 0), 4)
);

registerAsset('streetLamp', (rng) => buildStreetLamp(rng));
registerAsset('trafficLight', (rng) => buildTrafficLight(rng));
registerAsset('steamVent', (rng) => buildSteamVent(rng));
registerAsset('vendingMachine', (rng) => buildVendingMachine(rng));
registerAsset('hydrant', (rng) => buildHydrant(rng));
registerAsset('trashHeap', (rng) => buildTrashHeap(rng));

/**
 * The whole street-furniture kit arranged over a ~30x18m yard so a single turntable
 * sweep frames every prop. The crane sits at the back (it's tall), the small props line
 * two sidewalk rows in front, a power run crosses behind, and the gas station anchors
 * one corner. One "unlucky" street lamp flickers (spec: dying sodium tube).
 */
registerAsset('propYard', (rng) => {
  const group = new THREE.Group();
  const updates: Array<(sec: number) => void> = [];

  // gas station in the back-left corner
  const gas = buildGasStation(rng);
  gas.position.set(-16, 0, -6);
  group.add(gas);

  // crane behind, back-right
  const crane = buildCrane(rng, true);
  crane.group.position.set(14, 0, -10);
  crane.group.rotation.y = Math.PI * 0.85;
  group.add(crane.group);
  updates.push(crane.updateAmbient);

  // power run crossing the very back
  const power = buildPowerRun(rng, new THREE.Vector3(-18, 0, -16), new THREE.Vector3(18, 0, -16), 4);
  group.add(power);

  // front sidewalk row: lamps + small props at even spacing
  const rowZ = 4;
  const lamps: THREE.Group[] = [];
  const lampXs = [-12, -4, 4, 12];
  for (const x of lampXs) {
    const lamp = buildStreetLamp(rng);
    lamp.position.set(x, 0, rowZ);
    group.add(lamp);
    lamps.push(lamp);
  }

  // scatter the small kit between the lamps
  const traffic = buildTrafficLight(rng);
  traffic.position.set(-8, 0, 1);
  group.add(traffic);

  const vent = buildSteamVent(rng);
  vent.position.set(0, 0, 2);
  group.add(vent);

  const vend = buildVendingMachine(rng);
  vend.position.set(6, 0, 3);
  vend.rotation.y = -0.3;
  group.add(vend);

  const hydrant = buildHydrant(rng);
  hydrant.position.set(-2, 0, 5);
  group.add(hydrant);

  const trash = buildTrashHeap(rng);
  trash.position.set(9, 0, 1);
  group.add(trash);

  // one unlucky flickering lamp (spec: dying sodium tube)
  const unlucky = rng.pick(lamps);
  const flickerGlow = unlucky.userData.glow as
    | { head: THREE.Mesh; cone: THREE.Mesh; pool: THREE.Mesh }
    | undefined;
  updates.push((sec: number) => {
    if (!flickerGlow) return;
    // irregular flicker: mostly on, occasional dropouts
    const n = Math.sin(sec * 21) * 0.5 + Math.sin(sec * 47 + 1.3) * 0.5;
    const on = n > -0.35 ? 1 : 0.15;
    const headMat = flickerGlow.head.material as THREE.MeshStandardMaterial;
    headMat.emissiveIntensity = 3 * on;
    (flickerGlow.cone.material as THREE.MeshBasicMaterial).opacity = 0.16 * on;
    (flickerGlow.pool.material as THREE.MeshBasicMaterial).opacity = on;
  });

  return {
    group,
    updateAmbient(sec: number): void {
      for (const u of updates) u(sec);
    }
  };
});
