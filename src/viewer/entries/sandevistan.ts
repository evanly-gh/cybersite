/**
 * Task 22 — Sandevistan afterimage trail viewer entry
 *
 * Demonstrates the trail with a scripted figure-8 / arc matrix feed so the
 * ghost fan is visible before bikePath (Task 25) exists.
 *
 * `?t=` maps to the arc position (0..1):
 *   - Builds the Tron bike, grabs `ghostGeometry`
 *   - Drives the bike along an arc/figure-8 path of world matrices
 *   - At 5 t values the snapshot buffer is seeded with 20 ghosts at 1.6m spacing
 *   - `?mode=finale` switches to finale mode (default: ride)
 *
 * The scripted feed calls `record()` in a pre-pass from t=0..currentT in small
 * steps, seeding the distance-keyed buffer. Then `update(currentT)` selects
 * the visible ghost set.
 *
 * This lets you see:
 *   - Ghost fan fanning out behind the bike
 *   - Cyan→magenta→violet gradient (ride mode)
 *   - HSL rainbow (finale mode via ?mode=finale)
 *   - RGB-split echo on the first 3 ghosts
 */

import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildBike } from '../../assets/vehicles/bike';
import { buildSandevistan } from '../../fx/sandevistan';
import { makeRng } from '../../utils/rng';

// ---------------------------------------------------------------------------
// Figure-8 path: world matrix at a given path t ∈ [0, 1]
// The bike rides a 16m × 8m figure-8 in the XZ plane.
// Forward (+X in bike-local) always tangent to the path.
// ---------------------------------------------------------------------------

const PATH_SCALE_X = 16;
const PATH_SCALE_Z = 8;

/** Figure-8 world position at path parameter u ∈ [0, 1] */
function pathPos(u: number): THREE.Vector3 {
  const angle = u * Math.PI * 2;
  return new THREE.Vector3(
    Math.sin(angle) * PATH_SCALE_X,
    0,
    Math.sin(angle * 2) * PATH_SCALE_Z * 0.5
  );
}

/** Figure-8 tangent direction (normalised) at path parameter u */
function pathTangent(u: number): THREE.Vector3 {
  // Numerical derivative
  const eps = 0.001;
  const a = pathPos(u - eps);
  const b = pathPos(u + eps);
  const dir = b.sub(a);
  if (dir.lengthSq() < 1e-10) return new THREE.Vector3(1, 0, 0);
  return dir.normalize();
}

/** World matrix for the bike at path parameter u */
function bikeWorldMatrix(u: number): THREE.Matrix4 {
  const pos = pathPos(u);
  const forward = pathTangent(u); // bike +X
  const up = new THREE.Vector3(0, 1, 0);
  // right = forward × up (but up is global +Y so we need forward in XZ, no pitch)
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const trueUp = new THREE.Vector3().crossVectors(right, forward).normalize();

  // Build rotation matrix: columns are (forward, trueUp, right)
  // Three.js Matrix4 is column-major
  const m = new THREE.Matrix4();
  m.makeBasis(forward, trueUp, right);
  m.setPosition(pos);
  return m;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerAsset('sandevistan', (rng) => {
  const params = new URLSearchParams(
    typeof location !== 'undefined' ? location.search : ''
  );
  const mode = (params.get('mode') ?? 'ride') as 'ride' | 'finale';

  // Build bike for ghostGeometry
  const bikeRng = makeRng(42);
  const bike = buildBike(bikeRng);

  // Build trail
  const trail = buildSandevistan(bike.ghostGeometry);
  trail.setMode(mode);

  // Also add the bike itself so we can see it at the head
  const bikeGroup = bike.group;

  const group = new THREE.Group();
  group.name = 'sandevistanScene';
  group.add(trail.group);
  group.add(bikeGroup);

  // Framing hint: an invisible mesh that encompasses the current bike position and
  // the recent ghost trail extent (~20m behind). The viewer's Box3.setFromObject
  // does not account for InstancedMesh instance matrices, so without this hint
  // the camera frames only to the ghost geometry local bounds near origin.
  // We update its position in update() to sit at the trail midpoint (10m behind bike).
  // Size: 22m long (covers bike + 21m behind) × 3m tall × 6m wide.
  const hintMat = new THREE.MeshBasicMaterial({ visible: false });
  const framingHint = new THREE.Mesh(
    new THREE.BoxGeometry(22, 3, 6),
    hintMat
  );
  framingHint.name = 'framingHint';
  group.add(framingHint);

  return {
    group,
    update: (t: number) => {
      // Seed the distance-keyed snapshot buffer by replaying the path from 0 to t
      // in 200 steps (each ~0.5% of the path length, roughly 0.26m for a 50m perimeter path)
      // This ensures the buffer has ghosts at every 1.6m up to the current t.
      const steps = 200;
      for (let i = 0; i <= steps; i++) {
        const u = (i / steps) * t;
        const wm = bikeWorldMatrix(u);
        trail.record(wm, u);
      }

      // Pose the actual bike at the current t position
      const currentU = t;
      const worldMat = bikeWorldMatrix(currentU);
      const bikePos = new THREE.Vector3().setFromMatrixPosition(worldMat);
      bikeGroup.position.copy(bikePos);
      bikeGroup.rotation.setFromRotationMatrix(worldMat);

      // Position the framing hint at the bike's world position so the viewer's
      // auto-framer (Box3.setFromObject) can frame the ghost trail.
      // The hint box (22m long) centred on the bike straddles the full trail span.
      framingHint.position.copy(bikePos);
      framingHint.position.y = 0.8; // lift to vertical centre of trail

      // Pose the rider based on t (lean into turns, etc.)
      const angle = currentU * Math.PI * 2;
      bike.pose({
        lean: Math.sin(angle * 2) * THREE.MathUtils.degToRad(20),
        pitch: 0,
        crouch: 0.25,
        wheelSpin: t * 40
      });

      trail.update(t);
    }
  };
});
