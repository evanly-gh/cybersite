import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// props modules build canvas textures (price board, walking-man glyph, ad screens,
// radial pool decals) via makeCanvasTexture — stub a chainable 2D context like the
// other asset tests do.
function makeCtxStub(): CanvasRenderingContext2D {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return () => ({ addColorStop: () => {} });
        }
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

import { buildCrane } from '../src/assets/props/crane';
import { buildGasStation } from '../src/assets/props/gasStation';
import { buildPowerRun } from '../src/assets/props/powerlines';
import {
  buildTrafficLight,
  buildStreetLamp,
  buildSteamVent,
  buildVendingMachine,
  buildHydrant,
  buildTrashHeap
} from '../src/assets/props/streetProps';

import craneSrc from '../src/assets/props/crane.ts?raw';
import gasSrc from '../src/assets/props/gasStation.ts?raw';
import powerSrc from '../src/assets/props/powerlines.ts?raw';
import streetSrc from '../src/assets/props/streetProps.ts?raw';

function everyMatrixFinite(root: THREE.Object3D): boolean {
  root.updateMatrixWorld(true);
  let ok = true;
  root.traverse((o) => {
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) ok = false;
  });
  return ok;
}

function totalVerts(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as any).isMesh) return;
    const pos = m.geometry.getAttribute('position');
    if (pos) n += pos.count;
  });
  return n;
}

function hasMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if ((o as any).isMesh) found = true;
  });
  return found;
}

describe('street prop builders return valid groups', () => {
  const cases: Array<[string, () => THREE.Group]> = [
    ['gasStation', () => buildGasStation(makeRng(1))],
    ['powerRun', () => buildPowerRun(makeRng(1), new THREE.Vector3(-30, 0, 0), new THREE.Vector3(30, 0, 0), 4)],
    ['trafficLight', () => buildTrafficLight(makeRng(1))],
    ['streetLamp', () => buildStreetLamp(makeRng(1))],
    ['steamVent', () => buildSteamVent(makeRng(1))],
    ['vendingMachine', () => buildVendingMachine(makeRng(1))],
    ['hydrant', () => buildHydrant(makeRng(1))],
    ['trashHeap', () => buildTrashHeap(makeRng(1))]
  ];
  for (const [name, make] of cases) {
    it(`${name}: is a Group with meshes and finite matrices`, () => {
      const g = make();
      expect(g).toBeInstanceOf(THREE.Group);
      expect(hasMesh(g)).toBe(true);
      expect(everyMatrixFinite(g)).toBe(true);
    });
  }
});

describe('buildCrane', () => {
  it('returns { group, updateAmbient } with a valid group', () => {
    const c = buildCrane(makeRng(1), false);
    expect(c.group).toBeInstanceOf(THREE.Group);
    expect(typeof c.updateAmbient).toBe('function');
    expect(hasMesh(c.group)).toBe(true);
    expect(everyMatrixFinite(c.group)).toBe(true);
  });

  it('swinging variant moves the hanging load; static does not', () => {
    const c = buildCrane(makeRng(3), true);
    // the load pivot is the parent of the mesh named 'load'
    let pivot: THREE.Object3D | null = null;
    c.group.traverse((o) => {
      if (o.name === 'load' && o.parent) pivot = o.parent;
    });
    expect(pivot).not.toBeNull();
    c.updateAmbient(0.0);
    const a = (pivot as unknown as THREE.Object3D).rotation.z;
    c.updateAmbient(1.1);
    const b = (pivot as unknown as THREE.Object3D).rotation.z;
    expect(a).not.toBe(b);

    const stat = buildCrane(makeRng(3), false);
    let sp: THREE.Object3D | null = null;
    stat.group.traverse((o) => {
      if (o.name === 'load' && o.parent) sp = o.parent;
    });
    stat.updateAmbient(0.0);
    const s0 = (sp as unknown as THREE.Object3D).rotation.z;
    stat.updateAmbient(1.1);
    expect((sp as unknown as THREE.Object3D).rotation.z).toBe(s0);
  });
});

describe('buildSteamVent', () => {
  it('exposes userData.steamAnchor as an Object3D above the grate', () => {
    const g = buildSteamVent(makeRng(1));
    const anchor = g.userData.steamAnchor as THREE.Object3D;
    expect(anchor).toBeInstanceOf(THREE.Object3D);
    expect(anchor.position.y).toBeGreaterThan(0);
    // anchor is parented into the group
    expect(anchor.parent).toBe(g);
  });
});

describe('determinism', () => {
  it('same seed → identical vertex totals', () => {
    expect(totalVerts(buildGasStation(makeRng(9)))).toBe(totalVerts(buildGasStation(makeRng(9))));
    expect(totalVerts(buildCrane(makeRng(9), true).group)).toBe(totalVerts(buildCrane(makeRng(9), true).group));
    expect(totalVerts(buildTrashHeap(makeRng(9)))).toBe(totalVerts(buildTrashHeap(makeRng(9))));
  });
});

describe('house rules', () => {
  const sources: Array<[string, string]> = [
    ['crane', craneSrc],
    ['gasStation', gasSrc],
    ['powerlines', powerSrc],
    ['streetProps', streetSrc]
  ];
  for (const [name, src] of sources) {
    it(`${name}: no Math.random`, () => {
      expect(src.includes('Math.random')).toBe(false);
    });
    it(`${name}: no tron-cyan (reserved for the biker)`, () => {
      expect(src.includes('tronCyan')).toBe(false);
    });
  }
});
