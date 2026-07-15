import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// farField.ts builds canvas textures (moon crater speckle, beacon/glow gradients) via
// makeCanvasTexture, which needs a DOM canvas 2D context. Node has neither, so stub a
// context whose every property access returns a function that (when called) returns the
// same stub proxy again -- this makes chained calls like
// `ctx.createRadialGradient(...).addColorStop(...)` safe, unlike a context stub whose
// methods return plain `{}` (streets.test.ts's stub doesn't need gradients).
function makeCtxStub(): CanvasRenderingContext2D {
  const proxy: unknown = new Proxy(
    {},
    {
      get: () => () => proxy,
      set: () => true
    }
  );
  return proxy as CanvasRenderingContext2D;
}

(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => makeCtxStub()
  })
};

import {
  buildFarField,
  CITY_CENTER,
  SKYLINE_INNER_R,
  SKYLINE_OUTER_R,
  SKYLINE_COUNT,
  FAR_SKYLINE_INNER_R,
  FAR_SKYLINE_OUTER_R,
  FAR_SKYLINE_COUNT,
  BEACON_COUNT,
  STAR_COUNT,
  OCEAN_Z,
  WEDGE_HALF_DEG
} from '../src/world/farField';

function findMeshByName(group: THREE.Group, name: string): THREE.InstancedMesh {
  let mesh: THREE.InstancedMesh | undefined;
  group.traverse((o) => {
    if (o.name === name && (o as THREE.InstancedMesh).isInstancedMesh) mesh = o as THREE.InstancedMesh;
  });
  if (!mesh) throw new Error(`no InstancedMesh named "${name}" found`);
  return mesh;
}

function assertInAnnulus(
  mesh: THREE.InstancedMesh,
  innerR: number,
  outerR: number,
  wedgeHalfRad: number
): void {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    pos.setFromMatrixPosition(m);
    const dx = pos.x - CITY_CENTER.x;
    const dz = pos.z - CITY_CENTER.z;
    const r = Math.hypot(dx, dz);
    expect(r).toBeGreaterThanOrEqual(innerR - 1e-6);
    expect(r).toBeLessThanOrEqual(outerR + 1e-6);

    if (pos.z < OCEAN_Z) {
      const angle = Math.atan2(dx, -dz);
      expect(Math.abs(angle)).toBeGreaterThanOrEqual(wedgeHalfRad);
    }
  }
}
import { MOON_POS, MOON_RADIUS } from '../src/world/route';

function findByName(group: THREE.Group, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  group.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

describe('farField', () => {
  it('builds an InstancedMesh skyline with SKYLINE_COUNT instances', () => {
    const { group } = buildFarField(makeRng(1));
    const mesh = findMeshByName(group, 'skyline');
    expect(mesh.count).toBe(SKYLINE_COUNT);
    // huge annulus vs. tiny unit-box geometry -- must not be frustum-culled as one blob.
    expect(mesh.frustumCulled).toBe(false);
  });

  it('builds a second, dimmer far skyline ring (Round-2 depth iteration) with FAR_SKYLINE_COUNT instances', () => {
    const { group } = buildFarField(makeRng(1));
    const mesh = findMeshByName(group, 'skylineFar');
    expect(mesh.count).toBe(FAR_SKYLINE_COUNT);
    expect(mesh.frustumCulled).toBe(false);
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uDim.value).toBeLessThan(1);
  });

  it('places every skyline instance in the annulus and outside the ocean wedge', () => {
    const { group } = buildFarField(makeRng(1));
    const mesh = findMeshByName(group, 'skyline');
    const wedgeHalfRad = THREE.MathUtils.degToRad(WEDGE_HALF_DEG);
    assertInAnnulus(mesh, SKYLINE_INNER_R, SKYLINE_OUTER_R, wedgeHalfRad);
  });

  it('places every far-ring instance in its own (farther) annulus and outside the ocean wedge', () => {
    const { group } = buildFarField(makeRng(1));
    const mesh = findMeshByName(group, 'skylineFar');
    const wedgeHalfRad = THREE.MathUtils.degToRad(WEDGE_HALF_DEG);
    assertInAnnulus(mesh, FAR_SKYLINE_INNER_R, FAR_SKYLINE_OUTER_R, wedgeHalfRad);
  });

  it('is deterministic for a given seed (instance transforms + beacon count match)', () => {
    const a = buildFarField(makeRng(7));
    const b = buildFarField(makeRng(7));

    for (const name of ['skyline', 'skylineFar']) {
      const meshA = findMeshByName(a.group, name);
      const meshB = findMeshByName(b.group, name);
      expect(meshA.count).toBe(meshB.count);

      const arrA = (meshA.instanceMatrix.array as Float32Array).slice();
      const arrB = (meshB.instanceMatrix.array as Float32Array).slice();
      expect(arrA).toEqual(arrB);
    }

    const beaconsA = findByName(a.group, 'beacons') as THREE.Group;
    const beaconsB = findByName(b.group, 'beacons') as THREE.Group;
    expect(beaconsA.children.length).toBe(BEACON_COUNT);
    expect(beaconsA.children.length).toBe(beaconsB.children.length);
  });

  it('places the moon sphere at MOON_POS with radius MOON_RADIUS', () => {
    const { group } = buildFarField(makeRng(1));
    const moonGroup = findByName(group, 'moon') as THREE.Group;
    expect(moonGroup).toBeDefined();
    // The moon is now several meshes (body sphere + Fresnel-rim sphere + glow
    // sprites). Find the main body: the sphere-geometry mesh whose radius is
    // exactly MOON_RADIUS.
    let body: THREE.Mesh | undefined;
    moonGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry as THREE.SphereGeometry;
      if (geo?.parameters?.radius === MOON_RADIUS) body = m;
    });
    expect(body).toBeDefined();
    expect(body!.position.distanceTo(MOON_POS)).toBeLessThan(1e-6);
    const geo = body!.geometry as THREE.SphereGeometry;
    expect(geo.parameters.radius).toBe(MOON_RADIUS);
  });

  it('places the ocean plane at y=-0.5 covering z < -830', () => {
    const { group } = buildFarField(makeRng(1));
    const ocean = findByName(group, 'ocean') as THREE.Mesh;
    expect(ocean).toBeDefined();
    expect(ocean.position.y).toBeCloseTo(-0.5, 5);
    ocean.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ocean);
    expect(box.max.z).toBeLessThanOrEqual(OCEAN_Z + 1e-6);
  });

  it('builds STAR_COUNT star points above 15deg elevation', () => {
    const { group } = buildFarField(makeRng(1));
    const stars = findByName(group, 'stars') as THREE.Points;
    expect(stars).toBeDefined();
    const positions = stars.geometry.getAttribute('position');
    expect(positions.count).toBe(STAR_COUNT);
    const minSin = Math.sin(THREE.MathUtils.degToRad(15)) - 1e-4;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const r = Math.hypot(x, y, z);
      expect(y / r).toBeGreaterThanOrEqual(minSin);
    }
  });

  it('updateAmbient drives skyline/glitter uTime and beacon opacity without throwing', () => {
    const { group, updateAmbient } = buildFarField(makeRng(3));
    const skylineMat = findMeshByName(group, 'skyline').material as THREE.ShaderMaterial;
    const farSkylineMat = findMeshByName(group, 'skylineFar').material as THREE.ShaderMaterial;
    let glitterMat: THREE.ShaderMaterial | undefined;
    group.traverse((o) => {
      if (o.name === 'moonGlitter') glitterMat = (o as THREE.Mesh).material as THREE.ShaderMaterial;
    });
    expect(() => updateAmbient(12.3)).not.toThrow();
    expect(skylineMat.uniforms.uTime.value).toBeCloseTo(12.3, 5);
    expect(farSkylineMat.uniforms.uTime.value).toBeCloseTo(12.3, 5);
    expect(glitterMat!.uniforms.uTime.value).toBeCloseTo(12.3, 5);

    const beacons = findByName(group, 'beacons') as THREE.Group;
    for (const child of beacons.children) {
      const mat = (child as THREE.Sprite).material as THREE.SpriteMaterial;
      expect(mat.opacity).toBeGreaterThanOrEqual(0);
      expect(mat.opacity).toBeLessThanOrEqual(1);
    }
  });
});
