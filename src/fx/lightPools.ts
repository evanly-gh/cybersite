/**
 * Task 24 — Vehicle light pools
 *
 * Gradient-textured ground quads that track vehicle headlights / taillights
 * by reading anchor world positions each frame. Since vehicles move as f(t),
 * pools are a pure function of t (just reads current anchor transforms).
 *
 * Spec (from brief):
 *  - headAnchor  → warm-white, trapezoid 8×5 m, ahead of vehicle
 *  - tailAnchor  → red, 3×2 m, behind vehicle
 *  - Bike-specific: adds stronger cyan cone + 10×6 m pool on the headAnchor
 *
 * The bike headAnchor is detected by a simple heuristic: if the root Object3D has
 * `vehicle.name === 'bike' || vehicle.userData.isBike === true` it is treated as
 * "the bike" and gets the extra cyan cone. Regular cars get the warm-white head pool only.
 *
 * Additive blending, depthWrite: false (bloom-friendly, no z-fighting).
 */

import * as THREE from 'three';
import { COLORS } from '../theme';

// ---------------------------------------------------------------------------
// Texture helpers
// ---------------------------------------------------------------------------

/** Directional glow texture: strong at one end (near headlight), fades toward far end. */
function headlightPoolTex(colorHex: number, width = 128, height = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Gradient runs top-to-bottom; top = bright (near light source), bottom = fade
  const grad = ctx.createLinearGradient(0, 0, 0, height);

  // Parse hex color to rgba-compatible string
  const r = (colorHex >> 16) & 0xff;
  const g = (colorHex >> 8) & 0xff;
  const b = colorHex & 0xff;

  grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.5)`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},0.15)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

  // Also apply a horizontal radial fade to simulate the cone shape
  // We do this by drawing a wide-oval radial fade over the linear gradient
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Multiply-erase the sides to get a trapezoid / cone shape
  const horizGrad = ctx.createLinearGradient(0, 0, width, 0);
  horizGrad.addColorStop(0, 'rgba(0,0,0,0.7)');
  horizGrad.addColorStop(0.2, 'rgba(0,0,0,0)');
  horizGrad.addColorStop(0.8, 'rgba(0,0,0,0)');
  horizGrad.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = horizGrad;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  return new THREE.CanvasTexture(canvas);
}

/** Simple radial glow for tail lights / small pools. */
function radialPoolTex(colorHex: number): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const r = (colorHex >> 16) & 0xff;
  const g = (colorHex >> 8) & 0xff;
  const b = colorHex & 0xff;
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},0.4)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Pool quad helpers
// ---------------------------------------------------------------------------

/**
 * A flat ground-plane quad (PlaneGeometry lying in XZ at Y≈0.01).
 * width = lateral extent, depth = forward extent.
 * Positioned so that the quad's near edge sits at the anchor, extending `depth`
 * units forward.
 */
function makePoolQuad(width: number, depth: number, tex: THREE.Texture): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(width, depth);
  // PlaneGeometry lies in XY; rotate to XZ
  geom.rotateX(-Math.PI / 2);
  // Shift so pivot is at near edge (center is depth/2 forward)
  geom.translate(0, 0, -depth / 2);

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'lightPool';
  return mesh;
}

// ---------------------------------------------------------------------------
// buildLightPools
// ---------------------------------------------------------------------------

export interface LightPools {
  group: THREE.Group;
  update(t: number): void;
}

/** Warm-white headlight pool color (~5500 K, slightly cyan-warm). */
const HEAD_COLOR = 0xe8f0ff;
/** Red tail color (derived from signalMagenta toward pure red). */
const TAIL_COLOR = 0xff1a1a;
/** Bike cyan pool color. */
const BIKE_CYAN = COLORS.tronCyan;

// Shared textures (created once)
const headTex = headlightPoolTex(HEAD_COLOR);
const headTexBike = headlightPoolTex(BIKE_CYAN);
const tailTex = radialPoolTex(TAIL_COLOR);

/**
 * Builds vehicle light pools that track `userData.headAnchor / tailAnchor`
 * on each vehicle Object3D in `vehicles`. The pools are positioned each frame
 * by reading the anchor's world transform, making them a pure f(t) (since the
 * vehicles themselves move as f(t)).
 *
 * The bike is detected by `vehicle.name === 'bike' || vehicle.userData.isBike === true`.
 * (Task 25 will give the bike a stable identity; the name heuristic is intentional here.)
 *
 * @precondition Caller must ensure vehicle world matrices are current
 * (scene.updateMatrixWorld or a prior render) before calling update(t).
 */
export function buildLightPools(vehicles: THREE.Object3D[]): LightPools {
  const group = new THREE.Group();
  group.name = 'lightPools';

  interface PoolEntry {
    headPool: THREE.Mesh | null;
    bikePool: THREE.Mesh | null;     // extra 10×6 m cyan pool, bike only
    tailPool: THREE.Mesh | null;
    headAnchor: THREE.Object3D | null;
    tailAnchor: THREE.Object3D | null;
    isBike: boolean;
  }

  const entries: PoolEntry[] = [];

  const _tmpPos = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();
  const _tmpScale = new THREE.Vector3();

  for (const vehicle of vehicles) {
    const headAnchor = (vehicle.userData.headAnchor as THREE.Object3D | undefined) ?? null;
    const tailAnchor = (vehicle.userData.tailAnchor as THREE.Object3D | undefined) ?? null;

    // Detect bike by group name or explicit userData flag
    const isBike =
      vehicle.name === 'bike' ||
      vehicle.userData.isBike === true;

    let headPool: THREE.Mesh | null = null;
    let bikePool: THREE.Mesh | null = null;
    let tailPool: THREE.Mesh | null = null;

    if (headAnchor) {
      if (isBike) {
        // Bike: stronger cyan 10×6 m cone
        bikePool = makePoolQuad(10, 6, headTexBike);
        bikePool.name = 'bikeHeadPool';
        group.add(bikePool);
      } else {
        // Regular vehicles: warm-white 8×5 m trapezoid
        headPool = makePoolQuad(8, 5, headTex);
        headPool.name = 'headPool';
        group.add(headPool);
      }
    }

    if (tailAnchor) {
      tailPool = makePoolQuad(3, 2, tailTex);
      tailPool.name = 'tailPool';
      group.add(tailPool);
    }

    entries.push({ headPool, bikePool, tailPool, headAnchor, tailAnchor, isBike });
  }

  /**
   * Position a pool quad so its near edge sits at the anchor, extending in the
   * anchor's local -Z direction (forward convention differs per asset).
   * We read the anchor's world matrix, extract position + forward direction,
   * then place the quad at a small Y offset from ground.
   *
   * The "forward" for the pool is the world forward of the vehicle, i.e. the
   * direction in which the light cone extends (head: forward, tail: backward).
   */
  function placePool(mesh: THREE.Mesh, anchor: THREE.Object3D, forward: boolean): void {
    anchor.matrixWorld.decompose(_tmpPos, _tmpQuat, _tmpScale);

    // Ground the pool at Y = 0.01 (just above road surface)
    mesh.position.set(_tmpPos.x, 0.01, _tmpPos.z);

    // Orient the quad to face in the vehicle's forward (or backward) direction.
    // The vehicle is oriented so +X is forward (bike convention). We extract the
    // +X world direction from the anchor's matrixWorld column 0.
    const fwdX = anchor.matrixWorld.elements[0];
    const fwdZ = anchor.matrixWorld.elements[2];
    const angle = forward
      ? Math.atan2(fwdX, fwdZ) - Math.PI // pool extends ahead
      : Math.atan2(fwdX, fwdZ);          // tail pool extends behind

    mesh.rotation.set(0, angle, 0);
  }

  function update(_t: number): void {
    for (const e of entries) {
      if (e.headAnchor) {
        const pool = e.isBike ? e.bikePool : e.headPool;
        if (pool) placePool(pool, e.headAnchor, true);
      }
      if (e.tailAnchor && e.tailPool) {
        placePool(e.tailPool, e.tailAnchor, false);
      }
    }
  }

  return { group, update };
}
