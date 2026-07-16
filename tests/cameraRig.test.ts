// tests/cameraRig.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/choreography/cameraRig';

describe('CameraRig', () => {
  it('interpolates between keys', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0, 0, 0), target: new THREE.Vector3(1, 0, 0), fov: 50 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(10, 0, 0), target: new THREE.Vector3(1, 0, 0), fov: 70 });
    const mid = rig.sample(0.5);
    expect(mid.pos.x).toBeGreaterThan(0);
    expect(mid.pos.x).toBeLessThan(10);
    expect(mid.fov).toBeCloseTo(60, 0);
  });

  it('is deterministic', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0,0,0), target: new THREE.Vector3(0,0,-1), fov: 55 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(5,5,5), target: new THREE.Vector3(0,0,-1), fov: 55 });
    expect(rig.sample(0.3).pos.x).toBe(rig.sample(0.3).pos.x);
  });

  it('applies to a camera', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
    rig.apply(cam, 0.5);
    expect(cam.fov).toBeCloseTo(55, 1);
    expect(cam.position.z).toBeCloseTo(8, 1);
  });
});
