import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';
import {
  buildHatchback,
  buildKeiVan,
  buildSedan,
  buildCrossover,
  type CarAsset
} from '../src/assets/vehicles/cars';

const BUILDERS = {
  hatchback: buildHatchback,
  keiVan: buildKeiVan,
  sedan: buildSedan,
  crossover: buildCrossover
} as const;

// Per-tier draw-call budgets: cheap ≤3–4, average ≤5.
const BUDGET: Record<keyof typeof BUILDERS, number> = {
  hatchback: 3,
  // kei van: 4 draw calls (3 cheap body materials + wheels) — controller-approved
  // over the ≤3 cheap guideline; mismatched panel + roof rack justify the extra material
  keiVan: 4,
  sedan: 5,
  crossover: 5
};

function drawCalls(car: CarAsset): number {
  let calls = 0;
  car.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const groups = mesh.geometry.groups;
    calls += groups && groups.length > 0 ? groups.length : 1;
  });
  return calls;
}

function findWheels(car: CarAsset): THREE.InstancedMesh {
  const w = car.group.getObjectByName('wheels');
  if (!w) throw new Error('no wheels');
  return w as THREE.InstancedMesh;
}

describe.each(Object.entries(BUILDERS))('build%s', (name, build) => {
  const key = name as keyof typeof BUILDERS;

  it('exposes the CarAsset interface + light anchors', () => {
    const car = build(makeRng(1));
    expect(car.group).toBeInstanceOf(THREE.Group);
    expect(typeof car.update).toBe('function');
    expect(car.group.userData.headAnchor).toBeInstanceOf(THREE.Object3D);
    expect(car.group.userData.tailAnchor).toBeInstanceOf(THREE.Object3D);
    // anchors are actually parented into the group (so getWorldPosition works)
    expect(car.group.getObjectByName('headAnchor')).toBe(car.group.userData.headAnchor);
    expect(car.group.getObjectByName('tailAnchor')).toBe(car.group.userData.tailAnchor);
  });

  it('has 4 wheels as a single InstancedMesh', () => {
    const wheels = findWheels(build(makeRng(2)));
    expect(wheels.isInstancedMesh).toBe(true);
    expect(wheels.count).toBe(4);
  });

  it('update(t) spins the wheels about their axle', () => {
    const car = build(makeRng(3));
    const wheels = findWheels(car);
    const m0 = new THREE.Matrix4();
    wheels.getMatrixAt(0, m0);
    const q0 = new THREE.Quaternion().setFromRotationMatrix(m0);

    car.update(0.5);
    const m1 = new THREE.Matrix4();
    wheels.getMatrixAt(0, m1);
    const q1 = new THREE.Quaternion().setFromRotationMatrix(m1);

    expect(q1.angleTo(q0)).toBeGreaterThan(0.05); // rotation actually changed
    // spin obeys userData.speed (angle = t · speed)
    car.group.userData.speed = 0;
    car.update(1);
    const m2 = new THREE.Matrix4();
    wheels.getMatrixAt(0, m2);
    const q2 = new THREE.Quaternion().setFromRotationMatrix(m2);
    expect(q2.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it(`stays within the ${BUDGET[key]}-draw-call budget`, () => {
    expect(drawCalls(build(makeRng(4)))).toBeLessThanOrEqual(BUDGET[key]);
  });

  it('is deterministic for the same seed', () => {
    const a = build(makeRng(9)).group.getObjectByName('carBody') as THREE.Mesh;
    const b = build(makeRng(9)).group.getObjectByName('carBody') as THREE.Mesh;
    const pa = a.geometry.getAttribute('position').array as Float32Array;
    const pb = b.geometry.getAttribute('position').array as Float32Array;
    expect(pa.length).toBe(pb.length);
    expect(pa[500]).toBe(pb[500]);
  });

  it('sits on the ground (min y ≈ 0) and points +X forward', () => {
    const car = build(makeRng(5));
    car.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(car.group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02);
    // longer along X (forward) than along Z (width)
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(size.z);
    // head anchor is forward (+X) of tail anchor
    const head = car.group.userData.headAnchor as THREE.Object3D;
    const tail = car.group.userData.tailAnchor as THREE.Object3D;
    expect(head.position.x).toBeGreaterThan(tail.position.x);
  });
});
