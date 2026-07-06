import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';
import metroSrc from '../src/assets/metro/metro.ts?raw';

// metro.ts builds canvas textures (windows, destination board, hazard, graffiti) via
// makeCanvasTexture — stub a chainable 2D-context proxy like the other asset tests do.
function makeCtxStub(): CanvasRenderingContext2D {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'createLinearGradient')
          return () => ({ addColorStop: () => undefined });
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

import {
  buildMetro,
  METRO_SPEED,
  METRO_PATH,
  buildMetroTrainDemo,
  RIB_HALF_H,
  GIRDER_BOTTOM
} from '../src/assets/metro/metro';

/** Nearest girder world-y to (x,z) by brute-force sampling METRO_PATH (fine for tests). */
function nearestGirderY(x: number, z: number, samples = 3000): number {
  const p = new THREE.Vector3();
  let bestDist = Infinity;
  let bestY = NaN;
  for (let i = 0; i < samples; i++) {
    METRO_PATH.getPointAt(i / samples, p);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestY = p.y;
    }
  }
  return bestY;
}

const T_SWEEP = [0, 0.05, 0.13, 0.17, 0.25, 0.33, 0.5, 0.63, 0.71, 0.86, 1, 2.4, 7.9];

function assertNoNaN(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    for (const e of o.matrixWorld.elements) {
      expect(Number.isFinite(e)).toBe(true);
    }
  });
}

/** Lowest world-space y of any car body geometry in the consist. */
function lowestCarY(group: THREE.Object3D): number {
  group.updateMatrixWorld(true);
  let lowest = Infinity;
  const box = new THREE.Box3();
  group.traverse((o) => {
    if (o.name === 'carBody') {
      box.setFromObject(o);
      lowest = Math.min(lowest, box.min.y);
    }
  });
  return lowest;
}

describe('metro: buildMetro', () => {
  it('returns { group, update } and exports METRO_SPEED', () => {
    const m = buildMetro(makeRng(1));
    expect(m.group).toBeInstanceOf(THREE.Group);
    expect(typeof m.update).toBe('function');
    expect(typeof METRO_SPEED).toBe('number');
  });

  it('update(t) over a wide sweep produces no NaN in any world matrix', () => {
    const m = buildMetro(makeRng(2));
    for (const t of T_SWEEP) {
      m.update(t);
      assertNoNaN(m.group);
    }
  });

  it('update(t) is DETERMINISTIC in t (same t -> identical train transforms)', () => {
    const m = buildMetro(makeRng(3));
    const pivot = m.group.getObjectByName('carPivot') as THREE.Group;
    const swing = pivot.getObjectByName('carSwing') as THREE.Group;

    m.update(0.17);
    const p1 = pivot.position.clone();
    const q1 = pivot.quaternion.clone();
    const s1 = swing.rotation.x;

    m.update(0.86); // move away
    m.update(0.17); // come back to the same t
    expect(pivot.position.equals(p1)).toBe(true);
    expect(pivot.quaternion.equals(q1)).toBe(true);
    expect(swing.rotation.x).toBe(s1);
  });

  it('train HANGS BELOW the girder: a car body sits under the girder centreline at the same place', () => {
    const m = buildMetro(makeRng(4));
    m.update(0.42);
    // Girder core height everywhere is ~y16; the lowest car body must be well below it.
    const carY = lowestCarY(m.group);
    expect(carY).toBeLessThan(14); // clearly beneath the y16 girder
  });

  it('METRO_PATH is a closed CatmullRom loop threading the city', () => {
    expect(METRO_PATH.closed).toBe(true);
    expect(METRO_PATH.getLength()).toBeGreaterThan(500);
  });
});

describe('metro: source-level house rules', () => {
  it('uses no Math.random', () => {
    expect(metroSrc.includes('Math.random')).toBe(false);
  });

  it('does not use reserved tron-cyan (that colour belongs to the biker)', () => {
    expect(metroSrc.includes('tronCyan')).toBe(false);
    expect(metroSrc.toLowerCase().includes('0x00f0ff')).toBe(false);
  });

  it('exports METRO_SPEED with a TUNE marker in source', () => {
    expect(metroSrc.includes('METRO_SPEED')).toBe(true);
    expect(metroSrc.includes('TUNE')).toBe(true);
  });
});

describe('metro: pylons', () => {
  it('draw-call budget: pylon layer is a handful of InstancedMesh/Points, not one mesh per pylon', () => {
    const m = buildMetro(makeRng(6));
    const track = m.group.getObjectByName('metroTrack') as THREE.Group;
    const pylonNodes = track.children.filter((c) => c.name.startsWith('pylon'));
    expect(pylonNodes.length).toBeGreaterThan(0);
    expect(pylonNodes.length).toBeLessThanOrEqual(10); // single-digit draw calls regardless of pylon count

    const struct = m.group.getObjectByName('pylonStruct') as THREE.InstancedMesh;
    expect(struct).toBeInstanceOf(THREE.InstancedMesh);
    // Many pylons batched into this one draw call (4 box instances per pylon).
    expect(struct.count).toBeGreaterThan(40);

    const hazard = m.group.getObjectByName('pylonHazardBase') as THREE.InstancedMesh;
    expect(hazard).toBeInstanceOf(THREE.InstancedMesh);

    const strobes = m.group.getObjectByName('pylonStrobes') as THREE.Points;
    expect(strobes).toBeInstanceOf(THREE.Points);
  });

  it('T-cap and strobe sit BELOW the girder underside (pylon-height sign-fix pin)', () => {
    const m = buildMetro(makeRng(6));
    const struct = m.group.getObjectByName('pylonStruct') as THREE.InstancedMesh;
    const strobePts = m.group.getObjectByName('pylonStrobes') as THREE.Points;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const mat = new THREE.Matrix4();

    const nPylons = struct.count / 4;
    expect(Number.isInteger(nPylons)).toBe(true);
    let tCapChecked = 0;
    for (let p = 0; p < nPylons; p++) {
      // Instance order per pylon is [column, T-cap, brace, brace] — index 1 is the T-cap.
      struct.getMatrixAt(p * 4 + 1, mat);
      mat.decompose(pos, quat, scale);
      const gy = nearestGirderY(pos.x, pos.z);
      // If the old sign bug (h = gy - GIRDER_BOTTOM) were reintroduced, the T-cap would
      // land ABOVE the girder top instead of just under its underside.
      expect(pos.y).toBeLessThan(gy + RIB_HALF_H);
      expect(pos.y).toBeLessThanOrEqual(gy - RIB_HALF_H + 0.05);
      tCapChecked++;
    }
    expect(tCapChecked).toBeGreaterThan(0);

    // Strobe positions (Points geometry) must also sit below the girder underside.
    const strobePos = strobePts.geometry.getAttribute('position');
    expect(strobePos.count).toBeGreaterThan(0);
    let strobesChecked = 0;
    for (let i = 0; i < strobePos.count; i++) {
      const sx = strobePos.getX(i);
      const sy = strobePos.getY(i);
      const sz = strobePos.getZ(i);
      const gy = nearestGirderY(sx, sz);
      expect(sy).toBeLessThan(gy + RIB_HALF_H);
      strobesChecked++;
    }
    expect(strobesChecked).toBeGreaterThan(0);
  });

  it('pylon column still reaches the ground (y=0) at its base', () => {
    const m = buildMetro(makeRng(6));
    const struct = m.group.getObjectByName('pylonStruct') as THREE.InstancedMesh;
    struct.computeBoundingBox();
    const bb = struct.boundingBox as THREE.Box3;
    expect(bb.min.y).toBeLessThanOrEqual(0.5); // column base sits at/near ground level
  });
});

describe('metro: train demo (viewer close-up)', () => {
  it('has 4 hanging cars whose bodies sit below the girder top', () => {
    const m = buildMetroTrainDemo(makeRng(7));
    m.update(0.3);
    m.group.updateMatrixWorld(true);
    let bodies = 0;
    m.group.traverse((o) => {
      if (o.name === 'carBody') bodies++;
    });
    expect(bodies).toBe(4);
    // demo girder centred at y0; cars hang to negative y
    expect(lowestCarY(m.group)).toBeLessThan(-1);
  });
});
