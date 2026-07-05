import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';
import { buildBike, type BikePose } from '../src/assets/vehicles/bike';

const deg = THREE.MathUtils.degToRad;

function findByName(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`no object named "${name}"`);
  return found;
}

function worldPos(root: THREE.Object3D, name: string): THREE.Vector3 {
  return findByName(root, name).getWorldPosition(new THREE.Vector3());
}

const EXTREME_POSES: BikePose[] = [
  { lean: 0, pitch: 0, crouch: 0, wheelSpin: 0 },
  { lean: deg(35), pitch: 0, crouch: 1, wheelSpin: 123.4 },
  { lean: deg(-35), pitch: deg(180), crouch: 0.5, wheelSpin: -50 },
  { lean: deg(35), pitch: deg(360), crouch: 1, wheelSpin: 1e4 },
  { lean: deg(-35), pitch: deg(720 + 45), crouch: 0, wheelSpin: 0 },
  // out-of-range crouch must clamp, not explode
  { lean: 0, pitch: deg(-540), crouch: 5, wheelSpin: 1 },
  { lean: deg(60), pitch: 0, crouch: -3, wheelSpin: 2 }
];

describe('buildBike', () => {
  it('builds and exposes the binding interface', () => {
    const bike = buildBike(makeRng(1));
    expect(bike.group).toBeInstanceOf(THREE.Group);
    expect(typeof bike.pose).toBe('function');
    expect(bike.ghostGeometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(bike.group.userData.headAnchor).toBeInstanceOf(THREE.Object3D);
    // brief hierarchy: root → chassisTilt → … → {bikeBody, riderRig}
    const chassis = findByName(bike.group, 'chassisTilt');
    expect(chassis.getObjectByName('bikeBody')).toBeTruthy();
    expect(chassis.getObjectByName('riderRig')).toBeTruthy();
  });

  it('is deterministic for the same seed', () => {
    const a = buildBike(makeRng(7));
    const b = buildBike(makeRng(7));
    const pa = a.group.getObjectByName('bikeStatic') as THREE.Mesh;
    const pb = b.group.getObjectByName('bikeStatic') as THREE.Mesh;
    const arrA = pa.geometry.getAttribute('position').array as Float32Array;
    const arrB = pb.geometry.getAttribute('position').array as Float32Array;
    expect(arrA.length).toBe(arrB.length);
    expect(arrA[100]).toBe(arrB[100]);
  });

  it('pose() with extreme values produces no NaN in any world matrix', () => {
    const bike = buildBike(makeRng(2));
    for (const p of EXTREME_POSES) {
      bike.pose(p);
      bike.group.updateMatrixWorld(true);
      bike.group.traverse((o) => {
        for (const e of o.matrixWorld.elements) {
          expect(Number.isFinite(e)).toBe(true);
        }
      });
    }
  });

  it('hands stay locked to grips and feet to pegs across the pose envelope', () => {
    const bike = buildBike(makeRng(3));
    const sweep: BikePose[] = [];
    for (let i = 0; i <= 10; i++) {
      sweep.push({
        lean: deg(-35 + 7 * i),
        pitch: deg(36 * i),
        crouch: i / 10,
        wheelSpin: i * 3
      });
    }
    for (const p of sweep) {
      bike.pose(p);
      bike.group.updateMatrixWorld(true);
      for (const [end, target] of [
        ['handL', 'gripL'],
        ['handR', 'gripR'],
        ['footL', 'ankleL'],
        ['footR', 'ankleR']
      ] as const) {
        const d = worldPos(bike.group, end).distanceTo(worldPos(bike.group, target));
        expect(d).toBeLessThan(0.03);
      }
    }
  });

  it('ghostGeometry is a merged low-poly silhouette (~300 tris, ≤400)', () => {
    const bike = buildBike(makeRng(4));
    const g = bike.ghostGeometry;
    expect(g.getIndex()).toBeNull();
    const tris = g.getAttribute('position').count / 3;
    expect(tris).toBeGreaterThan(100);
    expect(tris).toBeLessThanOrEqual(400);
  });

  it('stays within the 8-draw-call budget (sum of material groups over meshes)', () => {
    const bike = buildBike(makeRng(5));
    let calls = 0;
    bike.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const groups = mesh.geometry.groups;
      calls += groups && groups.length > 0 ? groups.length : 1;
    });
    expect(calls).toBeLessThanOrEqual(8);
  });

  it('wheelSpin rotates the hub discs, not the hoop rims', () => {
    const bike = buildBike(makeRng(6));
    bike.pose({ lean: 0, pitch: 0, crouch: 0, wheelSpin: 1.5 });
    const hubF = findByName(bike.group, 'hubFront');
    const hubR = findByName(bike.group, 'hubRear');
    expect(hubF.rotation.z).toBeCloseTo(-1.5);
    expect(hubR.rotation.z).toBeCloseTo(-1.5);
    const staticMesh = findByName(bike.group, 'bikeStatic');
    expect(staticMesh.rotation.z).toBe(0);
  });

  it('lean shifts the rider hips into the turn', () => {
    const bike = buildBike(makeRng(8));
    bike.pose({ lean: 0, pitch: 0, crouch: 0.5, wheelSpin: 0 });
    bike.group.updateMatrixWorld(true);
    // hips bone is the root bone of the rig
    const rig = findByName(bike.group, 'riderRig');
    const hips = rig.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone;
    const zNeutral = hips.position.z;
    bike.pose({ lean: deg(35), pitch: 0, crouch: 0.5, wheelSpin: 0 });
    expect(hips.position.z - zNeutral).toBeCloseTo(0.1, 3);
    bike.pose({ lean: deg(-35), pitch: 0, crouch: 0.5, wheelSpin: 0 });
    expect(hips.position.z - zNeutral).toBeCloseTo(-0.1, 3);
  });
});
