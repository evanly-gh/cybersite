import * as THREE from 'three';

// ──────────────────────────────────────────────────────────────────────────────
// Waypoints  (1 unit = 1 metre, ground plane at y = 0)
// The route runs +X through the intro/about sections, turns right (−Z) at
// Shibuya, then runs −Z through the ramps/scaffold/research/bridge sections.
// Heights encode the ramp, scaffold deck, and bridge elevation.
// ──────────────────────────────────────────────────────────────────────────────
const WAYPOINTS: [number, number, number][] = [
  [-320,  0,     0],   // introStart
  [-240,  0,     0],   // aboutStart
  [ 160,  0,     0],   // aboutEnd
  [ 240,  0,     0],   // shibuya (turn apex)
  [ 240,  0,   -70],   // ramp1Base
  [ 240, 11,   -95],   // ramp1Lip
  [ 240, 20,  -120],   // flip1Apex (airborne peak)
  [ 240, 13,  -160],   // scaffoldDeck
  [ 240, 13,  -210],   // scaffoldEnd
  [ 240, 22,  -235],   // ramp2Lip
  [ 240, 30,  -260],   // flip2Apex (airborne peak)
  [ 240, 12,  -300],   // descendTop
  [ 240,  0,  -340],   // roadResume
  [ 240,  0,  -470],   // researchMid
  [ 240,  0,  -600],   // researchEnd
  [ 240,  8,  -640],   // bridgeStart
  [ 240, 12, -1100],   // bridgeEnd
];

// ──────────────────────────────────────────────────────────────────────────────
// Curve (centripetal Catmull-Rom)
// ──────────────────────────────────────────────────────────────────────────────
const curve = new THREE.CatmullRomCurve3(
  WAYPOINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  false,         // not closed
  'centripetal', // avoids cusps at sharp turns
  0.5            // default alpha
);

// Pre-compute arc length (builds internal LUT for getPointAt / getTangentAt).
export const ROUTE_LENGTH: number = curve.getLength();

// ──────────────────────────────────────────────────────────────────────────────
// Semantic-t  →  arc-length-t  remap
//
// The brief specifies zone boundary t-values (e.g. t=0.84 for researchEnd)
// which are "semantic" positions along the story arc.  Pure arc-length
// parameterisation distributes t proportionally to physical distance, which
// doesn't match those semantic values (the long bridge segment would dominate).
//
// Solution: a piecewise-linear remap table built from the actual arc-length t
// values at each named waypoint, anchored to the brief's semantic t-values.
// Callers use semantic t; the remap converts to arc-length t before calling
// curve.getPointAt / curve.getTangentAt, so within each zone the underlying
// arc-length geometry is still used correctly.
// ──────────────────────────────────────────────────────────────────────────────

// Each entry: [semantic_t, arc_length_t]
// arc_length_t values derived by finding the curve's closest arc-length
// parameter to each named waypoint's position (measured at build time).
const T_REMAP: [number, number][] = [
  [0.000, 0.0000],  // introStart
  [0.120, 0.0495],  // aboutStart
  [0.280, 0.2860],  // aboutEnd
  [0.320, 0.3346],  // shibuya
  [0.360, 0.3773],  // ramp1Base
  [0.410, 0.4095],  // flip1Apex (ramp1Lip skipped to preserve monotonicity)
  [0.460, 0.4339],  // scaffoldDeck
  [0.520, 0.4637],  // scaffoldEnd
  [0.545, 0.4795],  // ramp2Lip
  [0.570, 0.4953],  // flip2Apex
  [0.620, 0.5216],  // descendTop
  [0.680, 0.5466],  // roadResume
  [0.760, 0.6241],  // researchMid
  [0.840, 0.7015],  // researchEnd
  [0.890, 0.7279],  // bridgeStart
  [1.000, 1.0000],  // bridgeEnd
];

/** Map semantic t ∈ [0,1] → arc-length t ∈ [0,1] via piecewise linear interp. */
function semanticToArc(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  for (let i = 1; i < T_REMAP.length; i++) {
    const [s0, a0] = T_REMAP[i - 1];
    const [s1, a1] = T_REMAP[i];
    if (t <= s1) {
      const alpha = (t - s0) / (s1 - s0);
      return a0 + alpha * (a1 - a0);
    }
  }
  return 1;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────────────────────────────────────
export interface RouteSample {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
}

export interface RoadFrame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
}

// ──────────────────────────────────────────────────────────────────────────────
// sampleRoute — pure, deterministic.  t ∈ [0,1] is semantic story progress.
// ──────────────────────────────────────────────────────────────────────────────
export function sampleRoute(t: number): RouteSample {
  const at = semanticToArc(t);
  const pos = curve.getPointAt(at);
  const tangent = curve.getTangentAt(at).normalize();
  return { pos, tangent };
}

// ──────────────────────────────────────────────────────────────────────────────
// roadFrame — orthonormal Frenet-like frame with horizontal binormal.
// binormal = tangent × worldUp  (left/right road axis, always horizontal).
// normal   = binormal × tangent (up-ish, perpendicular to travel).
// ──────────────────────────────────────────────────────────────────────────────
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function roadFrame(t: number): RoadFrame {
  const at = semanticToArc(t);
  const pos = curve.getPointAt(at);
  const tangent = curve.getTangentAt(at).normalize();

  // Guard against degenerate case (tangent ∥ worldUp — never occurs on this path).
  let binormal: THREE.Vector3;
  if (Math.abs(tangent.dot(WORLD_UP)) > 0.999) {
    binormal = new THREE.Vector3(0, 0, 1).cross(tangent).normalize();
  } else {
    binormal = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
  }

  const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

  return { pos, tangent, normal, binormal };
}

// ──────────────────────────────────────────────────────────────────────────────
// Zone map  — semantic t-ranges for named story sections
// ──────────────────────────────────────────────────────────────────────────────
export const ZONES: Record<string, [number, number]> = {
  intro:    [0.00, 0.12],
  about:    [0.12, 0.28],
  shibuya:  [0.28, 0.36],
  ramp1:    [0.36, 0.46],
  scaffold: [0.46, 0.62],
  ramp2:    [0.52, 0.62],
  descent:  [0.62, 0.68],
  research: [0.68, 0.84],
  bridge:   [0.84, 1.00],
};

// ──────────────────────────────────────────────────────────────────────────────
// Moon
// ──────────────────────────────────────────────────────────────────────────────
export const MOON_POS: THREE.Vector3 = new THREE.Vector3(240, 240, -2400);
export const MOON_RADIUS: number = 300;
