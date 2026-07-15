import * as THREE from 'three';

/**
 * The fixed city route the bike rides through the whole site. Every downstream system
 * (streets, buildings, traffic, camera rig, moon) keys off this single authored spline —
 * treat waypoint coordinates as load-bearing constants, not tuning knobs.
 *
 * Path shape: +X along "About street" from introStart to shibuyaCenter, a hard right
 * turn onto -Z through the Shibuya-style crossing, two skate ramps (ramp1/ramp2),
 * a ground-level research canyon, then a long bridge run out toward the moon.
 */
export const WAYPOINTS = {
  introStart: new THREE.Vector3(-300, 0, 0),
  aboutStart: new THREE.Vector3(-260, 0, 0),
  aboutEnd: new THREE.Vector3(200, 0, 0),
  shibuyaCenter: new THREE.Vector3(240, 0, 0),
  driftExit: new THREE.Vector3(240, 0, -30),
  ramp1Base: new THREE.Vector3(240, 0, -90),
  ramp1Land: new THREE.Vector3(240, 0, -170),
  ramp2Base: new THREE.Vector3(240, 0, -260),
  ramp2Land: new THREE.Vector3(240, 0, -330),
  researchEntry: new THREE.Vector3(240, 0, -420),
  researchMid: new THREE.Vector3(240, 0, -600),
  researchEnd: new THREE.Vector3(240, 0, -800),
  bridgeApproach: new THREE.Vector3(240, 3, -835),
  bridgeStart: new THREE.Vector3(240, 14, -860),
  bridgeEnd: new THREE.Vector3(240, 12, -1400)
} as const;

type WaypointName = keyof typeof WAYPOINTS;

// Object.keys preserves insertion order for string keys — this is also the ride order.
const WAYPOINT_ORDER = Object.keys(WAYPOINTS) as WaypointName[];

export const ROUTE = new THREE.CatmullRomCurve3(
  WAYPOINT_ORDER.map((name) => WAYPOINTS[name]),
  false,
  'centripetal'
);

const U_SAMPLE_COUNT = 4096;

/**
 * Maps each named waypoint to its arc-length parameter u on ROUTE, found by sampling
 * the curve at U_SAMPLE_COUNT even steps and taking the nearest sample to the waypoint's
 * authored position. Computed once at module load since ROUTE never changes at runtime.
 */
function computeRouteU(): Record<WaypointName, number> {
  const samples: THREE.Vector3[] = [];
  for (let i = 0; i <= U_SAMPLE_COUNT; i++) {
    samples.push(ROUTE.getPointAt(i / U_SAMPLE_COUNT));
  }

  const result = {} as Record<WaypointName, number>;
  for (const name of WAYPOINT_ORDER) {
    const target = WAYPOINTS[name];
    let bestIndex = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i <= U_SAMPLE_COUNT; i++) {
      const distSq = samples[i].distanceToSquared(target);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIndex = i;
      }
    }
    result[name] = bestIndex / U_SAMPLE_COUNT;
  }
  return result;
}

export const ROUTE_U: Record<WaypointName, number> = computeRouteU();

export const MOON_POS = new THREE.Vector3(240, 260, -2600);
export const MOON_RADIUS = 320;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_UP = new THREE.Vector3(1, 0, 0);

export interface RoadFrame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
}

/**
 * Y-up-projected Frenet-like frame at arc-length parameter u. Unlike ROUTE's built-in
 * Frenet frames (which roll around the tangent and are unstable on straight sections),
 * this frame is derived directly from the world up vector so it stays level: binormal =
 * tangent x up (re-normalized), normal = binormal x tangent. Used by streets, traffic
 * lanes, and the bike path to place geometry "across" and "above" the road consistently.
 */
export function roadFrame(u: number): RoadFrame {
  const clampedU = THREE.MathUtils.clamp(u, 0, 1);
  const pos = ROUTE.getPointAt(clampedU);
  const tangent = ROUTE.getTangentAt(clampedU).normalize();

  let binormal = new THREE.Vector3().crossVectors(tangent, WORLD_UP);
  if (binormal.lengthSq() < 1e-8) {
    // Tangent is (near) parallel to world up — fall back to a fixed horizontal axis so
    // binormal stays well-defined instead of collapsing to zero.
    binormal = new THREE.Vector3().crossVectors(tangent, FALLBACK_UP);
  }
  binormal.normalize();

  const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

  return { pos, tangent, normal, binormal };
}
