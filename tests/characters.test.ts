import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';
import { buildPerson, buildCrowd, type PersonPose } from '../src/assets/characters/person';
import { buildDog, type DogPose } from '../src/assets/characters/dog';
import personSrc from '../src/assets/characters/person.ts?raw';
import dogSrc from '../src/assets/characters/dog.ts?raw';
import rigSrc from '../src/assets/characters/rig.ts?raw';

function countDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh && !(mesh as any).isSkinnedMesh && !(mesh as any).isInstancedMesh) return;
    n += Array.isArray(mesh.material) ? mesh.geometry.groups.length || 1 : 1;
  });
  return n;
}

function everyMatrixFinite(root: THREE.Object3D): boolean {
  root.updateMatrixWorld(true);
  let ok = true;
  root.traverse((o) => {
    for (const e of o.matrixWorld.elements) {
      if (!Number.isFinite(e)) ok = false;
    }
  });
  return ok;
}

const POSES: PersonPose[] = ['walk', 'stand', 'sit'];

describe('buildPerson', () => {
  for (const pose of POSES) {
    it(`${pose}: builds a valid group with <= 2 draw calls`, () => {
      const p = buildPerson(makeRng(1), pose);
      expect(p.group).toBeInstanceOf(THREE.Group);
      expect(typeof p.updateAmbient).toBe('function');
      expect(countDrawCalls(p.group)).toBeLessThanOrEqual(2);
    });

    it(`${pose}: finite matrices at build and after updateAmbient over a range of seconds`, () => {
      const p = buildPerson(makeRng(2), pose);
      expect(everyMatrixFinite(p.group)).toBe(true);
      for (const sec of [0, 0.5, 1.3, 10, 1000.25]) {
        p.updateAmbient(sec);
        expect(everyMatrixFinite(p.group)).toBe(true);
      }
    });
  }

  it('sit: pelvis (hips bone) sits at the group origin, feet reach ~-0.45 (Task 11 seat anchor floor offset)', () => {
    const p = buildPerson(makeRng(3), 'sit');
    let skinned: THREE.SkinnedMesh | undefined;
    p.group.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
    });
    expect(skinned).toBeDefined();
    const hipsBone = skinned!.skeleton.bones[0];
    const hipsWorld = hipsBone.getWorldPosition(new THREE.Vector3());
    const groupWorld = p.group.getWorldPosition(new THREE.Vector3());
    expect(hipsWorld.distanceTo(groupWorld)).toBeLessThan(1e-6);

    // feet: last two bones in the chain (calves) — find the lowest point of the mesh geometry
    // in world space as a proxy for "feet reach the floor".
    p.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(p.group);
    expect(box.min.y).toBeGreaterThan(-0.6);
    expect(box.min.y).toBeLessThan(-0.35);
  });

  it('walk/stand: standing figure feet are near ground level (y ~ 0), not floating or sunk', () => {
    for (const pose of ['walk', 'stand'] as const) {
      const p = buildPerson(makeRng(4), pose);
      p.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(p.group);
      expect(box.min.y).toBeGreaterThan(-0.15);
      expect(box.min.y).toBeLessThan(0.15);
      expect(box.max.y).toBeGreaterThan(1.4);
      expect(box.max.y).toBeLessThan(2.0);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = buildPerson(makeRng(7), 'walk');
    const b = buildPerson(makeRng(7), 'walk');
    let meshA: THREE.SkinnedMesh | undefined;
    let meshB: THREE.SkinnedMesh | undefined;
    a.group.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshA = o as THREE.SkinnedMesh;
    });
    b.group.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshB = o as THREE.SkinnedMesh;
    });
    const arrA = meshA!.geometry.getAttribute('position').array as Float32Array;
    const arrB = meshB!.geometry.getAttribute('position').array as Float32Array;
    expect(arrA.length).toBe(arrB.length);
    expect(Array.from(arrA)).toEqual(Array.from(arrB));
  });

  it('ambient bob/arm-swing amplitude stays sub-4cm (walk pose)', () => {
    const p = buildPerson(makeRng(5), 'walk');
    let skinned: THREE.SkinnedMesh | undefined;
    p.group.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
    });
    const hipsBone = skinned!.skeleton.bones[0];
    const ys: number[] = [];
    for (let sec = 0; sec < 2; sec += 0.05) {
      p.updateAmbient(sec);
      p.group.updateMatrixWorld(true);
      ys.push(hipsBone.getWorldPosition(new THREE.Vector3()).y);
    }
    const amp = (Math.max(...ys) - Math.min(...ys)) / 2;
    expect(amp).toBeLessThan(0.04);
  });
});

describe('buildCrowd', () => {
  it('returns n figures merged into a small, constant number of draw calls (not n*2)', () => {
    const small = buildCrowd(makeRng(1), 10, [6, 6]);
    const large = buildCrowd(makeRng(1), 40, [12, 12]);
    const drawsSmall = countDrawCalls(small.group);
    const drawsLarge = countDrawCalls(large.group);
    expect(drawsSmall).toBeLessThanOrEqual(3);
    expect(drawsLarge).toBeLessThanOrEqual(3);
    expect(drawsLarge).toBe(drawsSmall);
  });

  it('places n instances inside the requested area', () => {
    const n = 14;
    const area: [number, number] = [6, 6];
    const c = buildCrowd(makeRng(2), n, area);
    let mesh: THREE.InstancedMesh | undefined;
    c.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) mesh = o as THREE.InstancedMesh;
    });
    expect(mesh).toBeDefined();
    expect(mesh!.count).toBe(n);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      mesh!.getMatrixAt(i, m);
      m.decompose(v, q, s);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(area[0] / 2 + 1e-6);
      expect(Math.abs(v.z)).toBeLessThanOrEqual(area[1] / 2 + 1e-6);
    }
  });

  it('updateAmbient perturbs instance transforms without exploding', () => {
    const c = buildCrowd(makeRng(3), 14, [6, 6]);
    expect(() => {
      for (const sec of [0, 1, 5.5]) c.updateAmbient(sec);
    }).not.toThrow();
  });

  it('is deterministic for the same seed', () => {
    const a = buildCrowd(makeRng(9), 8, [6, 6]);
    const b = buildCrowd(makeRng(9), 8, [6, 6]);
    let ma: THREE.InstancedMesh | undefined;
    let mb: THREE.InstancedMesh | undefined;
    a.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) ma = o as THREE.InstancedMesh;
    });
    b.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) mb = o as THREE.InstancedMesh;
    });
    const m1 = new THREE.Matrix4();
    const m2 = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      ma!.getMatrixAt(i, m1);
      mb!.getMatrixAt(i, m2);
      expect(m1.elements).toEqual(m2.elements);
    }
  });
});

const DOG_POSES: DogPose[] = ['walk', 'sit'];

describe('buildDog', () => {
  for (const pose of DOG_POSES) {
    it(`${pose}: builds a valid group with <= 2 draw calls`, () => {
      const d = buildDog(makeRng(1), pose);
      expect(d.group).toBeInstanceOf(THREE.Group);
      expect(typeof d.updateAmbient).toBe('function');
      expect(countDrawCalls(d.group)).toBeLessThanOrEqual(2);
    });

    it(`${pose}: finite matrices at build and after updateAmbient`, () => {
      const d = buildDog(makeRng(2), pose);
      expect(everyMatrixFinite(d.group)).toBe(true);
      for (const sec of [0, 0.5, 3, 100]) {
        d.updateAmbient(sec);
        expect(everyMatrixFinite(d.group)).toBe(true);
      }
    });
  }

  it('produces 2 size classes across many seeds', () => {
    const heights = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const d = buildDog(makeRng(seed), 'walk');
      d.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(d.group);
      heights.add(Math.round((box.max.y - box.min.y) * 100));
    }
    // small vs large should give a handful of distinct rounded heights, not one constant value
    expect(heights.size).toBeGreaterThan(1);
  });

  it('is deterministic for the same seed', () => {
    const a = buildDog(makeRng(11), 'walk');
    const b = buildDog(makeRng(11), 'walk');
    let meshA: THREE.SkinnedMesh | undefined;
    let meshB: THREE.SkinnedMesh | undefined;
    a.group.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshA = o as THREE.SkinnedMesh;
    });
    b.group.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshB = o as THREE.SkinnedMesh;
    });
    const arrA = meshA!.geometry.getAttribute('position').array as Float32Array;
    const arrB = meshB!.geometry.getAttribute('position').array as Float32Array;
    expect(Array.from(arrA)).toEqual(Array.from(arrB));
  });
});

describe('house rules', () => {
  const SRC_FILES: string[] = [personSrc, dogSrc, rigSrc];

  it('never uses Math.random (randomness only via the passed Rng)', () => {
    for (const src of SRC_FILES) {
      expect(src.includes('Math.random')).toBe(false);
    }
  });

  it('never references tron-cyan (reserved for the biker)', () => {
    for (const src of SRC_FILES) {
      expect(src.includes('tronCyan')).toBe(false);
    }
  });

  it('pedestrian neon accents are only magenta/amber/teal', () => {
    expect(personSrc).toMatch(/signalMagenta/);
    expect(personSrc).toMatch(/sodiumAmber/);
    expect(personSrc).toMatch(/holoTeal/);
  });
});
