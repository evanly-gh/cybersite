import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Small shared helpers for the character rigs (person.ts, dog.ts). Mirrors the
 * technique used by the bike/rider (src/assets/vehicles/bike.ts): a handful of
 * static parts, each rigidly bound to one bone, merged into a single
 * SkinnedMesh so a fully-posed articulated figure costs exactly one draw call
 * per material group instead of one draw call per body part.
 */

export interface RigPart {
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  mat: number;
  bone?: number;
}

export function xform(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
}

/**
 * Merges rigidly-bound parts into one geometry, coalescing material groups so
 * the draw-call count equals the number of distinct materials rather than the
 * number of parts. Set `skinned` to emit rigid skinIndex/skinWeight attributes
 * (bone index per part, weight 1) for use in a THREE.SkinnedMesh.
 */
export function mergeParts(parts: RigPart[], skinned: boolean): THREE.BufferGeometry {
  const sorted = [...parts].sort((a, b) => a.mat - b.mat);
  const geoms: THREE.BufferGeometry[] = [];
  const runs: Array<{ mat: number; count: number }> = [];

  for (const p of sorted) {
    let g = p.geom.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(p.matrix);
    const n = g.getAttribute('position').count;
    if (skinned) {
      const idx = new Uint16Array(n * 4);
      const wgt = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        idx[i * 4] = p.bone ?? 0;
        wgt[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
    }
    geoms.push(g);
    const last = runs[runs.length - 1];
    if (last && last.mat === p.mat) last.count += n;
    else runs.push({ mat: p.mat, count: n });
  }

  const merged = mergeGeometries(geoms);
  if (!merged) throw new Error('rig: geometry merge failed');
  merged.clearGroups();
  let start = 0;
  for (const r of runs) {
    merged.addGroup(start, r.count, r.mat);
    start += r.count;
  }
  return merged;
}

const DOWN = new THREE.Vector3(0, -1, 0);

/** Quaternion rotating the bind direction DOWN onto a world direction. */
export function aimDown(to: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(DOWN, to.clone().normalize());
}
