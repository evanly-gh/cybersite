// tests/master.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { initMaster } from '../src/choreography/master';
import { CameraRig } from '../src/choreography/cameraRig';
import { BikePath } from '../src/choreography/bikePath';

function fakeBikeAsset() {
  const group = new THREE.Group();
  return { group, pose: vi.fn(), ghostGeometry: new THREE.BufferGeometry() };
}

describe('master', () => {
  it('setProgress positions the bike and calls updatables', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    const bikeAsset = fakeBikeAsset();
    const u = { update: vi.fn() };
    const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 5000);
    const h = initMaster({
      rig, bike: new BikePath(), bikeAsset, camera,
      scene: new THREE.Scene(), updatables: [u], isReducedMotion: true
    });
    h.setProgress(0.5);
    expect(bikeAsset.pose).toHaveBeenCalled();
    expect(u.update).toHaveBeenCalledWith(0.5);
  });
});
