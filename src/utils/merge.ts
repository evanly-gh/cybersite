import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Part definition for merging
 */
export interface GeometryPart {
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  mat: number;
}

/**
 * Merges multiple geometries with material groups preserved
 * Uses BufferGeometryUtils.mergeGeometries with per-part matrices applied
 * and material groups set according to each part's material index
 * @param parts - Array of geometry parts with matrices and material indices
 * @param mats - Array of materials corresponding to material indices
 * @returns A THREE.Mesh with merged geometry and material groups
 */
export function mergeStatic(
  parts: GeometryPart[],
  mats: THREE.Material[]
): THREE.Mesh {
  const geometries: THREE.BufferGeometry[] = [];
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  let vertexOffset = 0;

  // Apply matrices and track group ranges
  for (const part of parts) {
    const geom = part.geom.clone();
    geom.applyMatrix4(part.matrix);
    geometries.push(geom);

    // Calculate vertex count for this geometry
    const positionAttr = geom.getAttribute('position');
    const vertexCount = positionAttr ? (positionAttr.array as ArrayLike<number>).length / 3 : 0;
    const indexArray = geom.getIndex();
    const indexCount = indexArray ? indexArray.count : vertexCount;

    // Add group for this part's material
    groups.push({
      start: vertexOffset,
      count: indexCount,
      materialIndex: part.mat,
    });

    vertexOffset += indexCount;
  }

  // Merge all geometries
  const merged = mergeGeometries(geometries);
  if (!merged) throw new Error('Failed to merge geometries');

  // Clear any existing groups and add our calculated ones
  merged.groups = [];
  for (const group of groups) {
    merged.addGroup(group.start, group.count, group.materialIndex);
  }

  // Create mesh with material array
  return new THREE.Mesh(merged, mats);
}
