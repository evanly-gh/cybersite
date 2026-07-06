import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeCityLayout, type BlockRect } from '../src/world/cityLayout';

// Pure-data tests: computeCityLayout does no GPU/canvas work at all (no THREE geometry,
// no textures), so these run with zero stubbing.
describe('computeCityLayout (pure data)', () => {
  const layout = computeCityLayout(1337);

  it('is deterministic for a given seed', () => {
    const again = computeCityLayout(1337);
    expect(again.buildings.length).toBe(layout.buildings.length);
    expect(again.buildings).toEqual(layout.buildings);
    expect(again.billboards).toEqual(layout.billboards);
  });

  it('places no two building rects overlapping', () => {
    const rects: BlockRect[] = layout.buildings.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d, zone: b.zone }));
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapX = Math.abs(a.x - b.x) * 2 < a.w + b.w;
        const overlapZ = Math.abs(a.z - b.z) * 2 < a.d + b.d;
        if (overlapX && overlapZ) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('places at least 100 billboards', () => {
    expect(layout.billboards.length).toBeGreaterThanOrEqual(100);
  });

  it('flags at least 80% of buildings with roof clutter (non-flat roof)', () => {
    const withClutter = layout.buildings.filter((b) => b.hasRoofClutter).length;
    expect(withClutter / layout.buildings.length).toBeGreaterThanOrEqual(0.8);
  });

  it('has a reasonable number of buildings across all zones', () => {
    expect(layout.buildings.length).toBeGreaterThan(40);
    const zones = new Set(layout.buildings.map((b) => b.zone));
    expect(zones.has('aboutWall')).toBe(true);
    expect(zones.has('projectsWall')).toBe(true);
    expect(zones.has('shibuya')).toBe(true);
    expect(zones.has('skywayFlank')).toBe(true);
  });

  it('places exactly one monolith, radio mast, monument, restaurant, bar, and two ramen shops', () => {
    const kinds = layout.buildings.map((b) => b.kind);
    expect(kinds.filter((k) => k === 'monolith').length).toBe(1);
    expect(kinds.filter((k) => k === 'radioMast').length).toBe(1);
    expect(kinds.filter((k) => k === 'monument').length).toBe(1);
    expect(kinds.filter((k) => k === 'restaurant').length).toBe(1);
    expect(kinds.filter((k) => k === 'bar').length).toBe(1);
    expect(kinds.filter((k) => k === 'ramen').length).toBe(2);
  });

  it('positions display anchors sensibly (About wall on the -Z side, projects wall on the +X side)', () => {
    expect(layout.anchors.aboutWall.length).toBeGreaterThan(0);
    expect(layout.anchors.projectsWall.length).toBeGreaterThan(0);
    expect(layout.anchors.researchSky.length).toBeGreaterThan(0);
    for (const a of layout.anchors.aboutWall) expect(a.z).toBeLessThan(0);
    for (const a of layout.anchors.projectsWall) expect(a.x).toBeGreaterThan(240);
  });
});

// Mesh-assembly test: buildCity() calls real builders, which draw canvas textures via
// makeCanvasTexture — stub the minimal DOM canvas surface (same pattern as
// streets.test.ts / farField.test.ts) so it runs under node without a GPU.
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

describe('buildCity (mesh assembly)', () => {
  it('fills every venue seat anchor with a person', async () => {
    const { buildCity } = await import('../src/world/cityLayout');
    const city = buildCity(1337);

    // Every venue building's seat/stand anchors should have exactly one child parented
    // (the seated/standing person) once buildCity has run.
    let venueGroups: THREE.Object3D[] = [];
    city.group.traverse((o) => {
      if (o.name === 'fancyRestaurant' || o.name === 'ramenShop' || o.name === 'bar') venueGroups.push(o);
    });
    expect(venueGroups.length).toBeGreaterThan(0);
    for (const v of venueGroups) {
      const seats = (v.userData.seats as THREE.Object3D[] | undefined) ?? [];
      for (const seat of seats) {
        expect(seat.children.length).toBeGreaterThanOrEqual(1);
      }
      const stands = (v.userData.standAnchors as THREE.Object3D[] | undefined) ?? [];
      for (const stand of stands) {
        expect(stand.children.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('exposes the DisplayAnchors contract', async () => {
    const { buildCity } = await import('../src/world/cityLayout');
    const city = buildCity(1337);
    expect(city.anchors.aboutWall.length).toBeGreaterThan(0);
    expect(city.anchors.projectsWall.length).toBeGreaterThan(0);
    expect(city.anchors.researchSky.length).toBeGreaterThan(0);
    expect(city.anchors.introOverhead).toBeInstanceOf(THREE.Object3D);
  });

  it('does not throw on update/updateAmbient', async () => {
    const { buildCity } = await import('../src/world/cityLayout');
    const city = buildCity(1337);
    expect(() => city.update(0.5)).not.toThrow();
    expect(() => city.updateAmbient(2)).not.toThrow();
  });

  it('update(t) is not inert: it drives the metro train transform', async () => {
    const { buildCity } = await import('../src/world/cityLayout');
    const city = buildCity(1337);
    let metro: THREE.Object3D | undefined;
    city.group.traverse((o) => {
      if (o.name === 'metro') metro = o;
    });
    expect(metro).toBeDefined();

    function snapshotMeshWorldMatrices(): number[] {
      metro!.updateMatrixWorld(true);
      const sig: number[] = [];
      metro!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) sig.push(...o.matrixWorld.elements);
      });
      return sig;
    }

    city.update(0);
    const sig0 = snapshotMeshWorldMatrices();
    city.update(0.5);
    const sig1 = snapshotMeshWorldMatrices();

    expect(sig0.length).toBeGreaterThan(0);
    expect(sig1).not.toEqual(sig0);
  });

  it('updateAmbient(sec) spins rooftop fan instances', async () => {
    const { buildCity } = await import('../src/world/cityLayout');
    const city = buildCity(1337);
    let fillerGroup: THREE.Object3D | undefined;
    city.group.traverse((o) => {
      if (!fillerGroup && o.name.startsWith('filler:') && (o.userData as { spinFans?: unknown }).spinFans) {
        fillerGroup = o;
      }
    });
    expect(fillerGroup).toBeDefined();

    let fanInst: THREE.InstancedMesh | undefined;
    fillerGroup!.traverse((o) => {
      if (!fanInst && (o as THREE.InstancedMesh).isInstancedMesh) fanInst = o as THREE.InstancedMesh;
    });
    // Locate the specific fan InstancedMesh among this filler group's instanced meshes —
    // fall back to comparing ALL of them since only the fan one should change.
    const insts: THREE.InstancedMesh[] = [];
    fillerGroup!.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) insts.push(o as THREE.InstancedMesh);
    });
    expect(insts.length).toBeGreaterThan(0);

    const before = insts.map((inst) => {
      const m = new THREE.Matrix4();
      inst.getMatrixAt(0, m);
      return m.elements.slice();
    });
    city.updateAmbient(2);
    const after = insts.map((inst) => {
      const m = new THREE.Matrix4();
      inst.getMatrixAt(0, m);
      return m.elements.slice();
    });

    const anyChanged = before.some((b, i) => !b.every((v, j) => v === after[i][j]));
    expect(anyChanged).toBe(true);
  });
});
