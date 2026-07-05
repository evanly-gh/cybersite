import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';
import carsSrc from '../src/assets/vehicles/cars.ts?raw';
import hoverSrc from '../src/assets/vehicles/hover.ts?raw';

// hover.ts builds a canvas texture for the "TAXI 空" holo sign via makeCanvasTexture —
// stub a chainable 2D-context proxy like buildingsTall.test.ts does.
function makeCtxStub(): CanvasRenderingContext2D {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 });
        return () => proxy;
      },
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

import { buildLamboWedge, buildGTCoupe } from '../src/assets/vehicles/cars';
import { buildHoverA, buildHoverB } from '../src/assets/vehicles/hover';

const T_SWEEP = [0, 0.05, 0.13, 0.25, 0.37, 0.5, 0.63, 0.71, 0.83, 1, 2.4, 7.9];

function drawCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = mesh.geometry.groups;
    calls += mats && mats.length > 0 ? mats.length : 1;
  });
  return calls;
}

function assertNoNaN(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    for (const e of o.matrixWorld.elements) {
      expect(Number.isFinite(e)).toBe(true);
    }
  });
}

describe('cars: buildLamboWedge / buildGTCoupe', () => {
  for (const [name, build] of [
    ['lambo', buildLamboWedge],
    ['gt', buildGTCoupe]
  ] as const) {
    it(`${name}: exposes {group, update} with head/tail anchors`, () => {
      const car = build(makeRng(1));
      expect(car.group).toBeInstanceOf(THREE.Group);
      expect(typeof car.update).toBe('function');
      expect(car.group.userData.headAnchor).toBeInstanceOf(THREE.Object3D);
      expect(car.group.userData.tailAnchor).toBeInstanceOf(THREE.Object3D);
    });

    it(`${name}: update(t) over a wide sweep produces no NaN in any world matrix`, () => {
      const car = build(makeRng(2));
      for (const t of T_SWEEP) {
        car.update(t);
        assertNoNaN(car.group);
      }
    });

    it(`${name}: wheel set spins as a function of t (not static)`, () => {
      const car = build(makeRng(3));
      const wheel = car.group.getObjectByName('wheelSet') as THREE.InstancedMesh;
      expect(wheel).toBeTruthy();
      const m0 = new THREE.Matrix4();
      wheel.getMatrixAt(0, m0);
      car.update(3);
      const m1 = new THREE.Matrix4();
      wheel.getMatrixAt(0, m1);
      expect(m0.equals(m1)).toBe(false);
    });

    it(`${name}: stays within the 7-draw-call budget`, () => {
      const car = build(makeRng(4));
      expect(drawCalls(car.group)).toBeLessThanOrEqual(7);
    });

    it(`${name}: is deterministic for the same seed`, () => {
      const a = build(makeRng(9));
      const b = build(makeRng(9));
      const staticA = a.group.children.find((c) => c.name.endsWith('Static')) as THREE.Mesh;
      const staticB = b.group.children.find((c) => c.name.endsWith('Static')) as THREE.Mesh;
      const arrA = staticA.geometry.getAttribute('position').array as Float32Array;
      const arrB = staticB.geometry.getAttribute('position').array as Float32Array;
      expect(arrA.length).toBe(arrB.length);
      expect(arrA[50]).toBe(arrB[50]);
    });
  }
});

describe('hover: buildHoverA / buildHoverB', () => {
  for (const [name, build] of [
    ['hoverA', buildHoverA],
    ['hoverB', buildHoverB]
  ] as const) {
    it(`${name}: exposes {group, update} with userData.bobSeed`, () => {
      const hover = build(makeRng(1));
      expect(hover.group).toBeInstanceOf(THREE.Group);
      expect(typeof hover.update).toBe('function');
      expect(typeof hover.group.userData.bobSeed).toBe('number');
    });

    it(`${name}: has no wheels`, () => {
      const hover = build(makeRng(1));
      expect(hover.group.getObjectByName('wheelSet')).toBeUndefined();
    });

    it(`${name}: update(t) over a wide sweep produces no NaN`, () => {
      const hover = build(makeRng(2));
      for (const t of T_SWEEP) {
        hover.update(t);
        assertNoNaN(hover.group);
      }
    });

    it(`${name}: bob is deterministic in t (same t -> same y, repeated calls agree)`, () => {
      const hover = build(makeRng(5));
      hover.update(0.37);
      const y1 = hover.group.position.y;
      hover.update(0.9);
      hover.update(0.37);
      const y2 = hover.group.position.y;
      expect(y2).toBe(y1);
    });

    it(`${name}: bob amplitude stays within +/-0.4m`, () => {
      const hover = build(makeRng(6));
      for (let i = 0; i <= 200; i++) {
        const t = i * 0.1;
        hover.update(t);
        expect(Math.abs(hover.group.position.y)).toBeLessThanOrEqual(0.401);
      }
    });

    it(`${name}: two different seeds bob differently (bobSeed actually varies phase/freq)`, () => {
      const h1 = build(makeRng(10));
      const h2 = build(makeRng(20));
      h1.update(0.42);
      h2.update(0.42);
      expect(h1.group.position.y).not.toBe(h2.group.position.y);
    });
  }
});

describe('palette rule: tron-cyan is reserved for the biker', () => {
  it('cars.ts never references COLORS.tronCyan', () => {
    expect(carsSrc).not.toMatch(/tronCyan/);
  });

  it('hover.ts never references COLORS.tronCyan', () => {
    expect(hoverSrc).not.toMatch(/tronCyan/);
  });
});
