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
// arc_length_t values are computed at module load from the actual waypoints by
// sampling the curve at many uniform raw-parameter steps, accumulating chord
// lengths, then interpolating each waypoint's fraction of the total arc length.
// This ensures the remap stays correct if waypoints ever change.

/** Build a cumulative chord-length table at N uniform raw-parameter samples. */
function buildArcTable(n: number): { u: number; s: number }[] {
  const table: { u: number; s: number }[] = [{ u: 0, s: 0 }];
  let prev = curve.getPoint(0);
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const pt = curve.getPoint(u);
    total += prev.distanceTo(pt);
    table.push({ u, s: total });
    prev = pt;
  }
  return table;
}

/** Interpolate arc-length fraction for a given raw parameter u ∈ [0,1]. */
function arcFractionAt(u: number, table: { u: number; s: number }[]): number {
  const total = table[table.length - 1].s;
  if (total === 0) return 0;
  for (let i = 1; i < table.length; i++) {
    if (u <= table[i].u) {
      const t0 = table[i - 1], t1 = table[i];
      const alpha = (u - t0.u) / (t1.u - t0.u);
      return (t0.s + alpha * (t1.s - t0.s)) / total;
    }
  }
  return 1;
}

// Compute arc-length fractions for each waypoint index at module load.
const _arcTable = buildArcTable(2000);
const _n = WAYPOINTS.length - 1; // number of intervals

function _arcAt(idx: number): number {
  return arcFractionAt(idx / _n, _arcTable);
}

// Waypoint indices used as remap anchors:
//   introStart=0, aboutStart=1, aboutEnd=2, shibuya=3, ramp1Base=4,
//   flip1Apex=6 (ramp1Lip idx=5 has no semantic-t anchor — it is a shape
//               waypoint only), scaffoldDeck=7, scaffoldEnd=8, ramp2Lip=9,
//   flip2Apex=10, descendTop=11, roadResume=12, researchMid=13,
//   researchEnd=14, bridgeStart=15, bridgeEnd=16.
const T_REMAP: [number, number][] = (() => {
  const table: [number, number][] = [
    [0.000, _arcAt(0)],   // introStart
    [0.120, _arcAt(1)],   // aboutStart
    [0.280, _arcAt(2)],   // aboutEnd
    [0.320, _arcAt(3)],   // shibuya
    [0.360, _arcAt(4)],   // ramp1Base
    [0.410, _arcAt(6)],   // flip1Apex (ramp1Lip idx=5 has no semantic-t anchor)
    [0.460, _arcAt(7)],   // scaffoldDeck
    [0.520, _arcAt(8)],   // scaffoldEnd
    [0.545, _arcAt(9)],   // ramp2Lip
    [0.570, _arcAt(10)],  // flip2Apex
    [0.620, _arcAt(11)],  // descendTop
    [0.680, _arcAt(12)],  // roadResume
    [0.760, _arcAt(13)],  // researchMid
    [0.840, _arcAt(14)],  // researchEnd
    [0.890, _arcAt(15)],  // bridgeStart
    [1.000, _arcAt(16)],  // bridgeEnd
  ];
  // Guarantee monotonicity of the arc-length column.
  for (let i = 1; i < table.length; i++) {
    if (table[i][1] <= table[i - 1][1]) {
      throw new Error(
        `T_REMAP arc-length column is not monotonically increasing at index ${i}: ` +
        `${table[i - 1][1]} → ${table[i][1]}`
      );
    }
  }
  return table;
})();

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
  turn:     [0.28, 0.36],   // Shibuya 90° right turn
  ramp1:    [0.36, 0.46],   // projects-ramp1 (backflip 1, 2 big projects)
  scaffold: [0.46, 0.52],   // scaffold-ride
  ramp2:    [0.52, 0.62],   // projects-ramp2 (backflip 2, 3 small projects)
  descend:  [0.62, 0.68],
  research: [0.68, 0.84],
  lift:     [0.84, 0.89],   // buffer/lift onto bridge
  bridge:   [0.89, 1.00],   // bridge/finale
};

// ──────────────────────────────────────────────────────────────────────────────
// Moon
// ──────────────────────────────────────────────────────────────────────────────
export const MOON_POS: THREE.Vector3 = new THREE.Vector3(240, 240, -2400);
export const MOON_RADIUS: number = 300;
