import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { makeRng } from '../src/utils/rng';

// buildBillboard defaults to makeAd(), which draws to a DOM canvas. Stub the minimal
// surface under node: a "chain" proxy that is callable, returns itself for any
// property, accepts any set, and coerces to 0 — enough for gradients, measureText,
// font setters, etc. Safe despite import hoisting: billboards.ts only touches
// `document` inside buildBillboard(), never at module-evaluation time.
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain),
  set: () => true,
  apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};

import { buildBillboard, DEFAULT_WIDTH_M } from '../src/assets/billboards/billboards';
import { AD_SIZES, type AdFormat } from '../src/content/adGenerator';
import type { BillboardMount } from '../src/assets/billboards/billboards';

const FORMATS: AdFormat[] = ['landscape', 'portrait', 'square', 'strip', 'vcard'];
const MOUNTS: BillboardMount[] = ['stand', 'wall', 'roof'];

function meshesOf(group: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

describe('billboards', () => {
  it('every format x mount combo stays within the 4-draw-call budget', () => {
    const rng = makeRng(7);
    for (const format of FORMATS) {
      for (const mount of MOUNTS) {
        const bb = buildBillboard(rng, { format, mount });
        const meshes = meshesOf(bb.group);
        expect(meshes.length).toBeGreaterThanOrEqual(3);
        expect(meshes.length).toBeLessThanOrEqual(4);
        // one real draw call per mesh: material must not be an array
        for (const mesh of meshes) {
          expect(Array.isArray(mesh.material)).toBe(false);
        }
      }
    }
  });

  it('screen plane uses the default width per format (and follows ad aspect)', () => {
    const rng = makeRng(3);
    for (const format of FORMATS) {
      const bb = buildBillboard(rng, { format, mount: 'stand' });
      const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
      expect(screen).toBeTruthy();
      const params = (screen.geometry as THREE.PlaneGeometry).parameters;
      expect(params.width).toBeCloseTo(DEFAULT_WIDTH_M[format], 5);
      const [tw, th] = AD_SIZES[format];
      expect(params.height).toBeCloseTo((DEFAULT_WIDTH_M[format] * th) / tw, 5);
    }
  });

  it('honors widthM override', () => {
    const bb = buildBillboard(makeRng(3), { format: 'square', mount: 'wall', widthM: 8 });
    const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
    expect((screen.geometry as THREE.PlaneGeometry).parameters.width).toBeCloseTo(8, 5);
  });

  it('is deterministic for a given seed', () => {
    const a = buildBillboard(makeRng(11), { format: 'landscape', mount: 'roof' });
    const b = buildBillboard(makeRng(11), { format: 'landscape', mount: 'roof' });
    const ma = meshesOf(a.group);
    const mb = meshesOf(b.group);
    expect(ma.length).toBe(mb.length);
    for (let i = 0; i < ma.length; i++) {
      expect(ma[i].geometry.getAttribute('position').count).toBe(
        mb[i].geometry.getAttribute('position').count
      );
    }
  });

  it('setTexture swaps the screen emissive map', () => {
    const bb = buildBillboard(makeRng(5), { format: 'portrait', mount: 'wall' });
    const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
    const mat = screen.material as THREE.MeshStandardMaterial;
    const replacement = new THREE.Texture();
    bb.setTexture(replacement);
    expect(mat.emissiveMap).toBe(replacement);
  });

  it('setTexture disposes the previously owned default texture, and a second call does not throw', () => {
    const bb = buildBillboard(makeRng(5), { format: 'portrait', mount: 'wall' });
    const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
    const mat = screen.material as THREE.MeshStandardMaterial;
    const original = mat.emissiveMap as THREE.Texture;
    const disposeSpy = vi.spyOn(original, 'dispose');
    const first = new THREE.Texture();
    bb.setTexture(first);
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    const second = new THREE.Texture();
    const firstDisposeSpy = vi.spyOn(first, 'dispose');
    expect(() => bb.setTexture(second)).not.toThrow();
    // `first` was caller-provided (via setTexture), so it must not be disposed.
    expect(firstDisposeSpy).not.toHaveBeenCalled();
  });

  it('uses a provided texture instead of makeAd', () => {
    const tex = new THREE.Texture();
    const bb = buildBillboard(makeRng(5), { format: 'square', mount: 'stand', texture: tex });
    const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
    expect((screen.material as THREE.MeshStandardMaterial).emissiveMap).toBe(tex);
  });

  it('roughly 50% of strips get UV scroll (userData.scroll)', () => {
    const rng = makeRng(42);
    let scrolls = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const bb = buildBillboard(rng, { format: 'strip', mount: 'roof' });
      if (bb.group.userData.scroll === true) scrolls++;
    }
    expect(scrolls).toBeGreaterThan(n * 0.35);
    expect(scrolls).toBeLessThan(n * 0.65);
    // non-strips never scroll
    const bb = buildBillboard(rng, { format: 'landscape', mount: 'stand' });
    expect(bb.group.userData.scroll).toBe(false);
  });

  it('scrolling strips advance texture offset in updateAmbient', () => {
    const rng = makeRng(42);
    for (let i = 0; i < 50; i++) {
      const bb = buildBillboard(rng, { format: 'strip', mount: 'stand' });
      if (!bb.group.userData.scroll) continue;
      const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
      const tex = (screen.material as THREE.MeshStandardMaterial).emissiveMap!;
      bb.updateAmbient(10);
      expect(tex.offset.x).toBeCloseTo(0.2, 5);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
      return;
    }
    throw new Error('no scrolling strip found in 50 builds');
  });

  it('content displays (caller-supplied texture) never flicker', () => {
    const rng = makeRng(9999);
    const tex = new THREE.Texture();
    for (let i = 0; i < 200; i++) {
      const bb = buildBillboard(rng, { format: 'square', mount: 'stand', texture: tex });
      expect(bb.group.userData.flickers).toBe(false);
    }
    // emissiveIntensity must stay constant (no updateAmbient modulation)
    const bb = buildBillboard(makeRng(7), { format: 'landscape', mount: 'wall', texture: tex });
    const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
    const mat = screen.material as THREE.MeshStandardMaterial;
    const base = mat.emissiveIntensity;
    for (let s = 0; s < 40; s++) {
      bb.updateAmbient(s * 0.31);
      expect(mat.emissiveIntensity).toBeCloseTo(base, 5);
    }
  });

  it('~8% of builds flicker, and flicker actually modulates emissiveIntensity', () => {
    const rng = makeRng(1234);
    let flickerers = 0;
    const n = 400;
    let checkedModulation = false;
    for (let i = 0; i < n; i++) {
      const bb = buildBillboard(rng, { format: 'square', mount: 'stand' });
      if (bb.group.userData.flickers !== true) continue;
      flickerers++;
      if (!checkedModulation) {
        const screen = bb.group.getObjectByName('screen') as THREE.Mesh;
        const mat = screen.material as THREE.MeshStandardMaterial;
        const seen = new Set<string>();
        for (let s = 0; s < 40; s++) {
          bb.updateAmbient(s * 0.31);
          seen.add(mat.emissiveIntensity.toFixed(4));
        }
        expect(seen.size).toBeGreaterThan(3);
        checkedModulation = true;
      }
    }
    expect(flickerers).toBeGreaterThan(n * 0.03);
    expect(flickerers).toBeLessThan(n * 0.15);
    expect(checkedModulation).toBe(true);
  });

  it('halo/spill glow stays subtle: additive, no depth write, low vertex alpha', () => {
    const bb = buildBillboard(makeRng(9), { format: 'landscape', mount: 'stand' });
    const glow = bb.group.getObjectByName('glow') as THREE.Mesh;
    expect(glow).toBeTruthy();
    const mat = glow.material as THREE.MeshBasicMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    const colorAttr = glow.geometry.getAttribute('color');
    expect(colorAttr.itemSize).toBe(4);
    let maxA = 0;
    for (let i = 0; i < colorAttr.count; i++) maxA = Math.max(maxA, colorAttr.getW(i));
    expect(maxA).toBeLessThanOrEqual(0.17);
    expect(maxA).toBeGreaterThan(0.05);
  });

  it('wall mounts have no downward spill plane, stand/roof do', () => {
    // spill adds a second glow sub-geometry; compare glow vertex counts
    const wall = buildBillboard(makeRng(2), { format: 'square', mount: 'wall' });
    const stand = buildBillboard(makeRng(2), { format: 'square', mount: 'stand' });
    const gWall = (wall.group.getObjectByName('glow') as THREE.Mesh).geometry;
    const gStand = (stand.group.getObjectByName('glow') as THREE.Mesh).geometry;
    expect(gStand.getAttribute('position').count).toBeGreaterThan(
      gWall.getAttribute('position').count
    );
  });
});
