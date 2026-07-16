import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roadFrame } from './route';
import { COLORS } from '../theme';
import type { Rng } from '../utils/rng';

// ──────────────────────────────────────────────────────────────────────────────
// Constants (exported per brief)
// ──────────────────────────────────────────────────────────────────────────────

/** Half-width of the road surface (3 lanes ≈ 14 m total). */
export const ROAD_HALF_WIDTH = 7;

/** Half-width of the clear corridor reserved for road + sidewalks. */
export const CORRIDOR_HALF = 17;

// Sidewalk occupies the gap between road edge and corridor edge.
const SIDEWALK_WIDTH = CORRIDOR_HALF - ROAD_HALF_WIDTH; // 10 m each side

// Number of longitudinal samples for the quad-strip sweep.
const ROAD_STEPS = 200;

// Ground plane extends this far in each direction from the route bounding box.
const GROUND_MARGIN = 300;

// ──────────────────────────────────────────────────────────────────────────────
// Materials (flat dark neutrals — grey-box palette, no tronCyan)
// ──────────────────────────────────────────────────────────────────────────────

const matAsphalt = new THREE.MeshStandardMaterial({
  color: COLORS.shadowBlue,   // dark asphalt (~0x101426)
  roughness: 0.9,
  metalness: 0.0,
});

const matConcrete = new THREE.MeshStandardMaterial({
  color: 0x1a1e2e,            // slightly lighter than asphalt for sidewalk
  roughness: 0.85,
  metalness: 0.0,
});

const matGround = new THREE.MeshStandardMaterial({
  color: COLORS.void,         // deepest dark for the city floor
  roughness: 1.0,
  metalness: 0.0,
});

// ──────────────────────────────────────────────────────────────────────────────
// Quad-strip builder helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Given two parallel edges (each with an array of Vector3 points along the
 * strip), build a BufferGeometry of quads (two triangles each).
 */
function buildStripGeometry(
  leftEdge: THREE.Vector3[],
  rightEdge: THREE.Vector3[]
): THREE.BufferGeometry {
  const n = leftEdge.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const l = leftEdge[i];
    const r = rightEdge[i];
    // Vertex index base for this slice: 2*i (left), 2*i+1 (right)
    positions.push(l.x, l.y, l.z);
    positions.push(r.x, r.y, r.z);
    normals.push(0, 1, 0, 0, 1, 0); // pointing up (flat road/sidewalk)
  }

  // Build quads between consecutive slices.
  for (let i = 0; i < n - 1; i++) {
    const bl = 2 * i;       // bottom-left
    const br = 2 * i + 1;   // bottom-right
    const tl = 2 * (i + 1); // top-left
    const tr = 2 * (i + 1) + 1; // top-right

    // Triangle 1: bl, tl, br
    indices.push(bl, tl, br);
    // Triangle 2: tl, tr, br
    indices.push(tl, tr, br);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

// ──────────────────────────────────────────────────────────────────────────────
// buildStreets
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Builds the grey-box road ribbon, sidewalks, and ground plane.
 *
 * @param rng - Seeded RNG (accepted per project convention; unused in grey-box
 *              phase since geometry is fully deterministic from the route).
 * @returns A THREE.Group named 'streets' containing:
 *   - road mesh (dark asphalt)
 *   - left sidewalk mesh (concrete)
 *   - right sidewalk mesh (concrete)
 *   - ground plane mesh (void color)
 */
export function buildStreets(_rng: Rng): THREE.Group {
  // ── Sample the route frame at ROAD_STEPS uniform semantic-t intervals ──────
  const roadLeft: THREE.Vector3[] = [];
  const roadRight: THREE.Vector3[] = [];
  const swLeftInner: THREE.Vector3[] = [];
  const swLeftOuter: THREE.Vector3[] = [];
  const swRightInner: THREE.Vector3[] = [];
  const swRightOuter: THREE.Vector3[] = [];

  // Track bounding box for ground plane sizing.
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i <= ROAD_STEPS; i++) {
    const t = i / ROAD_STEPS;
    const frame = roadFrame(t);
    const { pos, binormal } = frame;

    // Road surface sits at the route y (pos.y already encodes ramp heights).
    // For the ground-level sections the road is at y=0; ramps/bridge are elevated.
    // We clamp road strip to y = max(pos.y, 0) so it never goes underground.
    const roadY = Math.max(pos.y, 0);

    const roadBase = new THREE.Vector3(pos.x, roadY, pos.z);

    roadLeft.push(roadBase.clone().addScaledVector(binormal, -ROAD_HALF_WIDTH));
    roadRight.push(roadBase.clone().addScaledVector(binormal, ROAD_HALF_WIDTH));

    swLeftInner.push(roadBase.clone().addScaledVector(binormal, -ROAD_HALF_WIDTH));
    swLeftOuter.push(roadBase.clone().addScaledVector(binormal, -CORRIDOR_HALF));

    swRightInner.push(roadBase.clone().addScaledVector(binormal, ROAD_HALF_WIDTH));
    swRightOuter.push(roadBase.clone().addScaledVector(binormal, CORRIDOR_HALF));

    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minZ = Math.min(minZ, pos.z);
    maxZ = Math.max(maxZ, pos.z);
  }

  // ── Build road geometry ───────────────────────────────────────────────────
  const roadGeom = buildStripGeometry(roadLeft, roadRight);

  // ── Build sidewalk geometries ─────────────────────────────────────────────
  // Left sidewalk: from left road edge outward (swap so normals face up correctly)
  const swLeftGeom = buildStripGeometry(swLeftOuter, swLeftInner);
  const swRightGeom = buildStripGeometry(swRightInner, swRightOuter);

  // Merge the two sidewalk geometries into one mesh to halve draw calls.
  const sidewalkMerged = mergeGeometries([swLeftGeom, swRightGeom]);
  if (!sidewalkMerged) throw new Error('streets: failed to merge sidewalk geometries');

  const roadMesh = new THREE.Mesh(roadGeom, matAsphalt);
  roadMesh.name = 'road';
  roadMesh.receiveShadow = true;

  const sidewalkMesh = new THREE.Mesh(sidewalkMerged, matConcrete);
  sidewalkMesh.name = 'sidewalks';
  sidewalkMesh.receiveShadow = true;

  // ── Ground plane ──────────────────────────────────────────────────────────
  // Large flat plane at y = -0.05 (just below road surface) covering the city.
  const groundW = (maxX - minX) + GROUND_MARGIN * 2;
  const groundD = (maxZ - minZ) + GROUND_MARGIN * 2; // maxZ-minZ may be negative (−Z axis)
  const groundGeom = new THREE.PlaneGeometry(groundW, Math.abs(groundD));
  groundGeom.rotateX(-Math.PI / 2); // lay flat

  const groundMesh = new THREE.Mesh(groundGeom, matGround);
  groundMesh.name = 'ground';
  groundMesh.position.set(
    (minX + maxX) / 2,
    -0.05,
    (minZ + maxZ) / 2
  );
  groundMesh.receiveShadow = true;

  // ── Assemble group ────────────────────────────────────────────────────────
  const group = new THREE.Group();
  group.name = 'streets';
  group.add(roadMesh, sidewalkMesh, groundMesh);

  // Approximate draw-call count: road=1, sidewalks=1, ground=1
  group.userData = { draw: 3 };

  return group;
}
