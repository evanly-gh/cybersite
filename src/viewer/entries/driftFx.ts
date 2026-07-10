/**
 * Task 24 verification — Drift FX viewer entry
 *
 * Three assets registered here for the t-sweep verification:
 *
 * 1. `driftFx` — drift skid marks + tire smoke scene.
 *    A stand-in ground plane + the drift FX group.
 *    `?t=` scrubs through [0, 1]; drift window is [0.30, 0.345].
 *    The drift skids progressively appear and smoke plumes animate.
 *
 * 2. `lightPools` — vehicle light pools demo.
 *    Three dummy vehicles (one "bike" with headAnchor only, two cars with
 *    head + tailAnchor) orbit a circle. Pools track the anchors.
 *    `?t=` drives the orbit.
 *
 * 3. `steamFx` — steam columns demo.
 *    Three anchor Object3Ds at fixed positions; steam rises and loops.
 *    Uses `updateAmbient(sec)` not `update(t)`.
 *
 * 4. `driftScene` — combined scene: ground + drift FX + a stand-in bike
 *    (Object3D with headAnchor) placed along the route drift segment, plus
 *    two steam vents. Demonstrates all three FX together.
 */

import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildDriftFx, buildSteam } from '../../fx/driftFx';
import { buildLightPools } from '../../fx/lightPools';
import { ROUTE, roadFrame, ROUTE_U } from '../../world/route';
import { COLORS } from '../../theme';

// ---------------------------------------------------------------------------
// Stand-in ground plane helper
// ---------------------------------------------------------------------------

function makeGround(): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(80, 80);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a0c14,
    roughness: 0.9,
    metalness: 0.1
  });
  return new THREE.Mesh(geom, mat);
}

// ---------------------------------------------------------------------------
// driftFx: skid marks + smoke, scrubbing the drift window
// ---------------------------------------------------------------------------

registerAsset('driftFx', () => {
  const group = new THREE.Group();
  group.name = 'driftFxScene';

  // Ground
  const ground = makeGround();
  // Center the ground near the Shibuya corner
  const shibuyaPos = ROUTE.getPointAt(ROUTE_U.shibuyaCenter);
  ground.position.set(shibuyaPos.x, 0, shibuyaPos.z);
  group.add(ground);

  // Ambient light so the ground is visible
  const ambient = new THREE.AmbientLight(0x334466, 0.6);
  group.add(ambient);

  // Route tube for orientation reference (thin cyan)
  const tubeGeo = new THREE.TubeGeometry(ROUTE, 256, 0.08, 6, false);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: COLORS.tronCyan,
    emissive: COLORS.tronCyan,
    emissiveIntensity: 1.5
  });
  group.add(new THREE.Mesh(tubeGeo, tubeMat));

  // Drift FX
  const fx = buildDriftFx();
  group.add(fx.group);

  return {
    group,
    update(t: number) {
      fx.update(t);
    }
  };
});

// ---------------------------------------------------------------------------
// lightPools: vehicle light pools tracking dummy anchors
// ---------------------------------------------------------------------------

registerAsset('lightPools', () => {
  const group = new THREE.Group();
  group.name = 'lightPoolsScene';

  const ground = makeGround();
  group.add(ground);

  const ambient = new THREE.AmbientLight(0x112233, 0.3);
  group.add(ambient);

  // Create 3 dummy vehicles:
  //  - vehicle[0]: bike (name='bike', has headAnchor only)
  //  - vehicle[1]: car with head + tail anchors
  //  - vehicle[2]: another car

  const vehicles: THREE.Object3D[] = [];

  function makeVehicle(isBike: boolean, x: number, z: number): THREE.Group {
    const v = new THREE.Group();
    v.name = isBike ? 'bike' : 'car';
    v.position.set(x, 0, z);

    // Visible stand-in box
    const bodyGeo = new THREE.BoxGeometry(
      isBike ? 1.8 : 3.2,
      isBike ? 0.8 : 1.4,
      isBike ? 0.4 : 1.6
    );
    const bodyMat = new THREE.MeshStandardMaterial({
      color: isBike ? COLORS.tronCyan : 0x223344,
      emissive: isBike ? COLORS.tronCyan : 0x000000,
      emissiveIntensity: isBike ? 0.3 : 0
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = isBike ? 0.4 : 0.7;
    v.add(body);

    // Head anchor
    const head = new THREE.Object3D();
    head.name = 'headAnchor';
    head.position.set(isBike ? 1.1 : 1.7, isBike ? 0.5 : 0.7, 0);
    v.add(head);
    v.userData.headAnchor = head;

    if (!isBike) {
      // Tail anchor for cars
      const tail = new THREE.Object3D();
      tail.name = 'tailAnchor';
      tail.position.set(-1.7, 0.7, 0);
      v.add(tail);
      v.userData.tailAnchor = tail;
    }

    return v;
  }

  const bike = makeVehicle(true, 0, 0);
  const car1 = makeVehicle(false, -6, 0);
  const car2 = makeVehicle(false, 6, 0);

  group.add(bike, car1, car2);
  vehicles.push(bike, car1, car2);

  // Light pools
  const pools = buildLightPools(vehicles);
  group.add(pools.group);

  return {
    group,
    update(t: number) {
      // Orbit the bike around a circle, cars stay fixed but point different ways
      const angle = t * Math.PI * 2;
      bike.position.set(Math.cos(angle) * 5, 0, Math.sin(angle) * 5);
      bike.rotation.y = -angle - Math.PI / 2;

      // Cars rotate slowly
      car1.rotation.y = t * Math.PI;
      car2.rotation.y = -t * Math.PI * 0.5;

      // Update world matrices before reading anchors
      bike.updateMatrixWorld(true);
      car1.updateMatrixWorld(true);
      car2.updateMatrixWorld(true);

      pools.update(t);
    }
  };
});

// ---------------------------------------------------------------------------
// steamFx: steam columns from fixed anchors
// ---------------------------------------------------------------------------

registerAsset('steamFx', () => {
  const group = new THREE.Group();
  group.name = 'steamFxScene';

  const ground = makeGround();
  group.add(ground);

  const ambient = new THREE.AmbientLight(0x112244, 0.5);
  group.add(ambient);

  // Three fixed anchor points
  const anchors: THREE.Object3D[] = [];
  for (const [x, z] of [[-6, 0], [0, -4], [5, 2]] as const) {
    const a = new THREE.Object3D();
    a.position.set(x, 0.1, z);
    group.add(a);
    anchors.push(a);

    // Visible vent indicator
    const ventGeo = new THREE.BoxGeometry(1.4, 0.08, 1.0);
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x1a1e2a });
    const vent = new THREE.Mesh(ventGeo, ventMat);
    vent.position.set(x, 0.04, z);
    group.add(vent);
  }

  const steam = buildSteam(anchors);
  group.add(steam.group);

  return {
    group,
    updateAmbient(sec: number) {
      steam.updateAmbient(sec);
    }
  };
});

// ---------------------------------------------------------------------------
// driftScene: combined — ground + route + drift FX + bike stand-in + steam
// ---------------------------------------------------------------------------

registerAsset('driftScene', () => {
  const group = new THREE.Group();
  group.name = 'driftScene';

  // Ground centered near the drift segment
  const ground = makeGround();
  const midU = (ROUTE_U.shibuyaCenter + ROUTE_U.driftExit) / 2;
  const midPos = ROUTE.getPointAt(midU);
  ground.position.set(midPos.x, 0, midPos.z);
  group.add(ground);

  // Lights
  group.add(new THREE.AmbientLight(0x223355, 0.5));
  const pt = new THREE.PointLight(COLORS.tronCyan, 2, 20);
  pt.position.set(midPos.x, 3, midPos.z);
  group.add(pt);

  // Route reference tube (clipped to local area — just the drift segment)
  const tubeGeo = new THREE.TubeGeometry(ROUTE, 256, 0.05, 6, false);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: COLORS.tronCyan,
    emissive: COLORS.tronCyan,
    emissiveIntensity: 1.2
  });
  group.add(new THREE.Mesh(tubeGeo, tubeMat));

  // Drift FX
  const fx = buildDriftFx();
  group.add(fx.group);

  // Bike stand-in: a box with headAnchor, rides the drift segment
  const bikeStandIn = new THREE.Group();
  bikeStandIn.name = 'bike';
  const bikeBoxGeo = new THREE.BoxGeometry(2, 0.8, 0.5);
  const bikeBoxMat = new THREE.MeshStandardMaterial({
    color: 0x021014,
    emissive: COLORS.tronCyan,
    emissiveIntensity: 0.4
  });
  bikeStandIn.add(new THREE.Mesh(bikeBoxGeo, bikeBoxMat));
  const headAnchor = new THREE.Object3D();
  headAnchor.name = 'headAnchor';
  headAnchor.position.set(1.1, 0.4, 0);
  bikeStandIn.add(headAnchor);
  bikeStandIn.userData.headAnchor = headAnchor;
  group.add(bikeStandIn);

  // Light pool for bike stand-in
  const pools = buildLightPools([bikeStandIn]);
  group.add(pools.group);

  // Two steam anchors near the drift segment
  const steamAnchors: THREE.Object3D[] = [];
  for (const offset of [-6, 6]) {
    const sa = new THREE.Object3D();
    sa.position.set(midPos.x + offset, 0.1, midPos.z - 5);
    group.add(sa);
    steamAnchors.push(sa);
    // Vent visible indicator
    const vg = new THREE.BoxGeometry(1.2, 0.06, 0.9);
    const vm = new THREE.MeshStandardMaterial({ color: 0x181c28 });
    const vent = new THREE.Mesh(vg, vm);
    vent.position.copy(sa.position);
    vent.position.y = 0.03;
    group.add(vent);
  }

  const steam = buildSteam(steamAnchors);
  group.add(steam.group);

  return {
    group,
    update(t: number) {
      // Drive the bike stand-in along the drift segment
      const uDrift = ROUTE_U.shibuyaCenter + t * (ROUTE_U.driftExit - ROUTE_U.shibuyaCenter);
      const frame = roadFrame(Math.min(uDrift, 0.9999));
      bikeStandIn.position.copy(frame.pos);
      // Orient: bike +X = tangent
      bikeStandIn.quaternion.setFromUnitVectors(
        new THREE.Vector3(1, 0, 0),
        frame.tangent
      );
      bikeStandIn.updateMatrixWorld(true);

      fx.update(t);
      pools.update(t);
    },
    updateAmbient(sec: number) {
      steam.updateAmbient(sec);
    }
  };
});
