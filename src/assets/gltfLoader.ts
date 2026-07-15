import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Singleton loader instances
// ---------------------------------------------------------------------------

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// ---------------------------------------------------------------------------
// Cache: URL → Promise<GLTF>  (shared across all callers)
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<GLTF>>();

// ---------------------------------------------------------------------------
// loadModel
// ---------------------------------------------------------------------------

/**
 * Loads a .glb / .gltf file and returns a deep-cloned scene graph.
 * The parsed GLTF is cached so repeated calls for the same URL do not
 * re-fetch — each call returns a fresh clone of the cached scene.
 *
 * On load failure a fallback magenta box is returned and a warning is logged.
 */
export function loadModel(url: string): Promise<THREE.Group> {
  if (!cache.has(url)) {
    const promise = new Promise<GLTF>((resolve, reject) => {
      gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (err) => reject(err),
      );
    });
    cache.set(url, promise);
  }

  return cache.get(url)!.then(
    (gltf) => {
      // Deep-clone: preserves materials / skins on each call
      return gltf.scene.clone(true) as THREE.Group;
    },
    (err: unknown) => {
      console.warn(`[gltfLoader] Failed to load "${url}":`, err);
      return makeFallback();
    },
  );
}

// ---------------------------------------------------------------------------
// preloadModels
// ---------------------------------------------------------------------------

/**
 * Parallel preload of multiple models.
 * Populates the cache so subsequent `loadModel` calls resolve immediately.
 */
export async function preloadModels(urls: string[]): Promise<void> {
  await Promise.all(urls.map((url) => loadModel(url)));
}

// ---------------------------------------------------------------------------
// mergeModelMeshes
// ---------------------------------------------------------------------------

/**
 * Traverses a loaded model's scene graph, collects all Mesh geometries with
 * their world transforms applied, and merges them into a single BufferGeometry
 * using `mergeGeometries`.  Returns a single Mesh with a basic material.
 *
 * This reduces draw calls from N meshes → 1.
 */
export function mergeModelMeshes(group: THREE.Group): THREE.Mesh {
  const geometries: THREE.BufferGeometry[] = [];

  group.updateWorldMatrix(true, true);

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geom = child.geometry.clone() as THREE.BufferGeometry;
    geom.applyMatrix4(child.matrixWorld);
    geometries.push(geom);
  });

  if (geometries.length === 0) {
    console.warn('[gltfLoader] mergeModelMeshes: no meshes found in group');
    return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
  }

  const merged = mergeGeometries(geometries, false);
  if (!merged) {
    throw new Error('[gltfLoader] mergeGeometries returned null');
  }

  // Dispose temporary clones
  for (const g of geometries) g.dispose();

  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial());
}

// ---------------------------------------------------------------------------
// normalizeModel
// ---------------------------------------------------------------------------

/**
 * Centers the model at the origin and scales it uniformly so its largest
 * dimension equals `targetSize` metres.  Sets `frustumCulled = true`
 * recursively on all objects.
 */
export function normalizeModel(group: THREE.Group, targetSize: number): THREE.Group {
  // Compute bounding box in world space
  const box = new THREE.Box3().setFromObject(group);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  // Translate to origin
  group.position.sub(center);

  // Uniform scale so the largest dimension = targetSize
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = targetSize / maxDim;
    group.scale.setScalar(scale);
  }

  // Enable frustum culling recursively
  group.traverse((child) => {
    child.frustumCulled = true;
  });

  return group;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeFallback(): THREE.Group {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }),
    ),
  );
  return group;
}
