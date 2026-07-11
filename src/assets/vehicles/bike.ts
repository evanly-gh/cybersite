import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';

/**
 * Task 16 — the PROTAGONIST: black-suited courier on a Tron-style light cycle
 * (GTA "Shotaro" reference). Forward = +X, up = +Y, +Z = rider's right.
 *
 * Palette rule (INVERTED for this asset): tron-cyan belongs to the bike/rider —
 * this is the only asset allowed to glow cyan. Suit is matte near-black with
 * thin cyan seam piping.
 *
 * Hierarchy: root → chassisTilt(lean, pivot at ground line)
 *                 → pitchPivot(pitch, pivot at bike center y≈0.66)
 *                 → { bikeBody, riderRig }
 *
 * Draw calls (budget ≤ 8): merged static bike mesh with 4 material groups
 * (dark metal / cyan glow / white-cyan headlight / red tail) + 2 spinning hub
 * discs + rider SkinnedMesh with 2 groups (matte suit / cyan piping) = 8.
 *
 * The rider is a single SkinnedMesh: 11 rigid-bound bones. Hands/feet stay
 * locked to grips/pegs through every pose because arms and legs are solved
 * with analytic two-bone IK against fixed grip/peg targets each pose() call.
 */

/** Pose inputs — angles in RADIANS. */
export interface BikePose {
  /** Roll about the forward axis; ±35° is the choreography range. +lean = toward rider's right (+Z). */
  lean: number;
  /** Rotation about the lateral axis. Full rotation allowed (backflips); +pitch = nose up. */
  pitch: number;
  /** 0 = race tuck, 1 = standing-ish; interpolates spine/elbow/knee via IK. */
  crouch: number;
  /** Accumulated wheel rotation (radians); spins both hoop hub discs (hoop rims are static). */
  wheelSpin: number;
}

export interface BikeAsset {
  group: THREE.Group;
  pose(p: BikePose): void;
  /** Simplified merged bike+rider (~300 tris), neutral pose, for the sandevistan trail. */
  ghostGeometry: THREE.BufferGeometry;
}

// ---------------------------------------------------------------------------
// Dimensions (1 unit = 1 m)
// ---------------------------------------------------------------------------

const WHEEL_R = 0.55;
const WHEEL_TUBE = 0.09;
const WHEEL_OUTER = WHEEL_R + WHEEL_TUBE; // 0.64 → axle height so tire kisses y=0
const AXLE_X = 0.66; // hoops clear each other: 2*0.66 > 2*0.64
const AXLE_Y = WHEEL_OUTER;
const BODY_HALF_W = 0.14;
const PITCH_PIVOT_Y = 0.66;

const LEAN_MAX = THREE.MathUtils.degToRad(35);

// Rider rig
const ARM_A = 0.3; // upper arm
const ARM_B = 0.3; // forearm
const LEG_A = 0.4; // thigh
const LEG_B = 0.44; // calf
const SHOULDER_UP = 0.32; // shoulder offset above spine bone, along spine
const SHOULDER_OUT = 0.185;
const SPINE_UP = 0.1; // spine bone above hips bone

// Contact points (bikeBody/riderRig local space, ground at y=0)
const GRIP = new THREE.Vector3(0.3, 0.96, 0.18);
const PEG = new THREE.Vector3(-0.18, 0.4, 0.17);
const ANKLE_LIFT = 0.05; // ankle sits just above the peg

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface Part {
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  mat: number;
  bone?: number;
}

function xform(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
}

/**
 * Merges parts into one geometry with ONE material group per material (parts
 * are sorted by material and contiguous runs coalesced) — unlike a naive
 * group-per-part merge this keeps the draw-call count equal to the number of
 * distinct materials, which is what the ≤8-call budget is measured against.
 * Optionally emits rigid skinIndex/skinWeight attributes (bone per part).
 */
function mergeParts(parts: Part[], skinned: boolean): THREE.BufferGeometry {
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
  if (!merged) throw new Error('bike: geometry merge failed');
  merged.clearGroups();
  let start = 0;
  for (const r of runs) {
    merged.addGroup(start, r.count, r.mat);
    start += r.count;
  }
  return merged;
}

/** Thin emissive strip (box) between two side-profile points at depth z. */
function strip(
  p1: [number, number],
  p2: [number, number],
  z: number,
  thick = 0.02,
  depth = 0.014
): { geom: THREE.BufferGeometry; matrix: THREE.Matrix4 } {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  return {
    geom: new THREE.BoxGeometry(len, thick, depth),
    matrix: xform((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, z, 0, 0, Math.atan2(dy, dx))
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Analytic two-bone IK. Returns unit directions for the upper and lower
 * segments; the reach is clamped so the chain end always lands exactly on the
 * (possibly clamped) target — this is what keeps hands welded to the bars and
 * feet to the pegs through the whole crouch/lean envelope.
 */
function solveTwoBone(
  root: THREE.Vector3,
  target: THREE.Vector3,
  a: number,
  b: number,
  pole: THREE.Vector3
): { upper: THREE.Vector3; lower: THREE.Vector3 } {
  const t = target.clone().sub(root);
  const d = THREE.MathUtils.clamp(t.length(), Math.abs(a - b) + 0.01, a + b - 0.005);
  const th = t.lengthSq() > 1e-10 ? t.normalize() : new THREE.Vector3(1, 0, 0);

  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);

  let side = pole.clone().sub(th.clone().multiplyScalar(pole.dot(th)));
  if (side.lengthSq() < 1e-8) {
    side = new THREE.Vector3(0, 0, 1).sub(th.clone().multiplyScalar(th.z));
  }
  side.normalize();

  const upper = th.clone().multiplyScalar(cosA).add(side.multiplyScalar(sinA));
  const mid = root.clone().add(upper.clone().multiplyScalar(a));
  const end = root.clone().add(th.multiplyScalar(d));
  const lower = end.sub(mid).normalize();
  return { upper, lower };
}

/** Quaternion rotating the bind direction (DOWN for limbs) onto a world dir. */
function aim(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

// ---------------------------------------------------------------------------
// Bike body (static merged mesh)
// ---------------------------------------------------------------------------

// Dagger side profile (CCW): belly → nose tip → console peak → seat trough →
// tail cowl kick-up → rear underside.
const PROFILE: Array<[number, number]> = [
  [-0.4, 0.54],
  [-0.1, 0.52],
  [0.45, 0.55],
  [0.95, 0.62],
  [1.18, 0.7], // dagger nose tip
  [0.75, 0.95],
  [0.42, 1.0], // console peak
  [0.15, 0.82],
  [-0.1, 0.78], // rider trough (seat)
  [-0.35, 0.92], // tail cowl hump
  [-0.62, 0.8], // tail tip
  [-0.55, 0.62]
];

// Top edge (tail → nose) traced by the cyan light channels.
const TOP_EDGE: Array<[number, number]> = [
  [-0.62, 0.8],
  [-0.35, 0.92],
  [-0.1, 0.78],
  [0.15, 0.82],
  [0.42, 1.0],
  [0.75, 0.95],
  [1.18, 0.7]
];
// Nose underside accent.
const NOSE_EDGE: Array<[number, number]> = [
  [1.18, 0.7],
  [0.95, 0.62],
  [0.45, 0.55]
];

const M = { metal: 0, glow: 1, head: 2, tail: 3 } as const;

function buildBikeStatic(rng: Rng): Part[] {
  const parts: Part[] = [];

  // --- main body spar: extruded dagger profile ---
  const shape = new THREE.Shape(PROFILE.map(([x, y]) => new THREE.Vector2(x, y)));
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: BODY_HALF_W * 2,
    bevelEnabled: false
  });
  parts.push({ geom: body, matrix: xform(0, 0, -BODY_HALF_W), mat: M.metal });

  // --- hoop wheels: static rim torus + inner emissive cyan ring ---
  for (const s of [1, -1]) {
    const ax = s * AXLE_X;
    parts.push({
      geom: new THREE.TorusGeometry(WHEEL_R, WHEEL_TUBE, 14, 40),
      matrix: xform(ax, AXLE_Y, 0),
      mat: M.metal
    });
    parts.push({
      geom: new THREE.TorusGeometry(WHEEL_R - WHEEL_TUBE - 0.02, 0.02, 8, 40),
      matrix: xform(ax, AXLE_Y, 0),
      mat: M.glow
    });
    // cyan wheel arcs on both faces, centered over the top of the hoop
    for (const z of [1, -1]) {
      parts.push({
        geom: new THREE.TorusGeometry(WHEEL_R - 0.045, 0.013, 6, 24, 1.9),
        matrix: xform(ax, AXLE_Y, z * (WHEEL_TUBE + 0.022), 0, 0, Math.PI / 2 - 0.95),
        mat: M.glow
      });
    }
    // faint red brake ring at the hub (glows softly through the disc gap)
    for (const z of [1, -1]) {
      parts.push({
        geom: new THREE.TorusGeometry(0.17, 0.012, 6, 24),
        matrix: xform(ax, AXLE_Y, z * 0.11),
        mat: M.tail
      });
      // cyan hub-center "eye" dot (Tron wheel look)
      parts.push({
        geom: new THREE.CylinderGeometry(0.045, 0.045, 0.01, 14),
        matrix: xform(ax, AXLE_Y, z * 0.115, Math.PI / 2, 0, 0),
        mat: M.glow
      });
    }
  }

  // --- hoop-holder side blades (Shotaro fork/swingarm covers) ---
  for (const z of [1, -1]) {
    parts.push({
      geom: new THREE.BoxGeometry(0.74, 0.32, 0.03),
      matrix: xform(0.6, 0.68, z * 0.145, 0, 0, -0.18),
      mat: M.metal
    });
    parts.push({
      geom: new THREE.BoxGeometry(0.66, 0.28, 0.03),
      matrix: xform(-0.56, 0.66, z * 0.145, 0, 0, 0.15),
      mat: M.metal
    });
    // blade edge light channels
    const b1 = strip([0.28, 0.82], [0.92, 0.7], z * 0.163, 0.016);
    parts.push({ ...b1, mat: M.glow });
    const b2 = strip([-0.88, 0.72], [-0.26, 0.82], z * 0.163, 0.016);
    parts.push({ ...b2, mat: M.glow });
    // fork struts: body flank → hub axle centers (kills the "floating hoop" read)
    for (const ax of [AXLE_X, -AXLE_X]) {
      const from: [number, number] = [ax > 0 ? 0.55 : -0.5, 0.66];
      const s = strip(from, [ax, AXLE_Y], z * 0.15, 0.05, 0.05);
      parts.push({ ...s, mat: M.metal });
    }
  }

  // --- body edge light channels, both flanks ---
  for (const z of [1, -1]) {
    for (let i = 0; i < TOP_EDGE.length - 1; i++) {
      const s = strip(TOP_EDGE[i], TOP_EDGE[i + 1], z * (BODY_HALF_W + 0.006));
      parts.push({ ...s, mat: M.glow });
    }
    for (let i = 0; i < NOSE_EDGE.length - 1; i++) {
      const s = strip(NOSE_EDGE[i], NOSE_EDGE[i + 1], z * (BODY_HALF_W + 0.006), 0.016);
      parts.push({ ...s, mat: M.glow });
    }
    // angled flank vent slits (cyan) behind the console
    for (let i = 0; i < 3; i++) {
      parts.push({
        geom: new THREE.BoxGeometry(0.09, 0.014, 0.01),
        matrix: xform(0.14 + i * 0.13, 0.64, z * (BODY_HALF_W + 0.004), 0, 0, -0.45),
        mat: M.glow
      });
    }
  }

  // --- headlight slit + flare glints (merged quads, no extra draw call) ---
  parts.push({
    geom: new THREE.BoxGeometry(0.02, 0.05, 0.2),
    matrix: xform(1.14, 0.7, 0),
    mat: M.head
  });
  parts.push({
    geom: new THREE.PlaneGeometry(0.05, 0.34),
    matrix: xform(1.165, 0.7, 0, 0, Math.PI / 2, 0),
    mat: M.head
  });
  parts.push({
    geom: new THREE.PlaneGeometry(0.4, 0.035),
    matrix: xform(1.165, 0.7, 0, 0, Math.PI / 2, 0),
    mat: M.head
  });

  // --- tail slit (red) + twin cyan tail fins flanking the cowl ---
  parts.push({
    geom: new THREE.BoxGeometry(0.015, 0.045, 0.18),
    matrix: xform(-0.635, 0.79, 0),
    mat: M.tail
  });
  for (const z of [1, -1]) {
    parts.push({
      geom: new THREE.BoxGeometry(0.16, 0.11, 0.016),
      matrix: xform(-0.5, 0.9, z * 0.1, 0, 0, 0.35),
      mat: M.metal
    });
    const fin = strip([-0.58, 0.86], [-0.42, 0.96], z * 0.11, 0.016);
    parts.push({ ...fin, mat: M.glow });
  }

  // --- handlebars: clip-on bar, risers, glowing bar-end caps ---
  parts.push({
    geom: new THREE.CylinderGeometry(0.02, 0.02, 0.46, 10),
    matrix: xform(0.3, 0.96, 0, Math.PI / 2, 0, 0),
    mat: M.metal
  });
  for (const z of [1, -1]) {
    parts.push({
      geom: new THREE.CylinderGeometry(0.016, 0.02, 0.12, 8),
      matrix: xform(0.33, 0.9, z * 0.1, 0, 0, 0.3),
      mat: M.metal
    });
    parts.push({
      geom: new THREE.CylinderGeometry(0.024, 0.024, 0.025, 10),
      matrix: xform(0.3, 0.96, z * 0.235, Math.PI / 2, 0, 0),
      mat: M.glow
    });
    // mirror stubs
    parts.push({
      geom: new THREE.CylinderGeometry(0.011, 0.011, 0.09, 6),
      matrix: xform(0.34, 1.0, z * 0.16, z * -0.7, 0, 0.4),
      mat: M.metal
    });
    parts.push({
      geom: new THREE.BoxGeometry(0.012, 0.032, 0.055),
      matrix: xform(0.355, 1.035, z * 0.19, 0, 0, 0.3),
      mat: M.metal
    });
  }

  // --- small windscreen, raked back over the console ---
  parts.push({
    geom: new THREE.BoxGeometry(0.018, 0.2, 0.22),
    matrix: xform(0.55, 1.03, 0, 0, 0, 0.5),
    mat: M.metal
  });

  // --- seat pad + belly keel ---
  parts.push({
    geom: new THREE.BoxGeometry(0.3, 0.045, 0.24),
    matrix: xform(-0.14, 0.79, 0),
    mat: M.metal
  });
  parts.push({
    geom: new THREE.BoxGeometry(0.5, 0.1, 0.024),
    matrix: xform(0.12, 0.49, 0),
    mat: M.metal
  });
  // underbelly ground-glow strip (down-facing cyan bar — the Tron floor wash)
  parts.push({
    geom: new THREE.BoxGeometry(0.66, 0.012, 0.05),
    matrix: xform(0.1, 0.445, 0),
    mat: M.glow
  });
  // nose chevron: cyan V accent on the dagger tip, both flanks
  for (const z of [1, -1]) {
    const c1 = strip([0.86, 0.58], [1.14, 0.7], z * (BODY_HALF_W + 0.006), 0.018);
    parts.push({ ...c1, mat: M.glow });
    const c2 = strip([0.86, 0.82], [1.14, 0.7], z * (BODY_HALF_W + 0.006), 0.018);
    parts.push({ ...c2, mat: M.glow });
  }

  // --- footpegs ---
  for (const z of [1, -1]) {
    parts.push({
      geom: new THREE.BoxGeometry(0.05, 0.025, 0.12),
      matrix: xform(PEG.x, PEG.y - 0.012, z * (PEG.z - 0.02)),
      mat: M.metal
    });
  }

  // --- chain-side greeble (right side, rng-varied cluster) ---
  parts.push({
    geom: new THREE.CylinderGeometry(0.1, 0.1, 0.028, 16),
    matrix: xform(-0.34, 0.56, -0.155, Math.PI / 2, 0, 0),
    mat: M.metal
  });
  const nGreeble = rng.int(3, 5);
  for (let i = 0; i < nGreeble; i++) {
    parts.push({
      geom: new THREE.BoxGeometry(rng.range(0.06, 0.14), rng.range(0.03, 0.07), 0.02),
      matrix: xform(rng.range(-0.25, 0.15), rng.range(0.5, 0.6), -0.15, 0, 0, rng.range(-0.2, 0.2)),
      mat: M.metal
    });
  }

  return parts;
}

/** Spoke-less hub disc (spins with wheelSpin): disc + turbine blades + cap. */
function buildHubGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [
    {
      geom: new THREE.CylinderGeometry(0.4, 0.4, 0.045, 28),
      matrix: xform(0, 0, 0, Math.PI / 2, 0, 0),
      mat: 0
    },
    {
      geom: new THREE.CylinderGeometry(0.09, 0.09, 0.075, 14),
      matrix: xform(0, 0, 0, Math.PI / 2, 0, 0),
      mat: 0
    }
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push({
      geom: new THREE.BoxGeometry(0.24, 0.05, 0.062),
      matrix: xform(Math.cos(a) * 0.21, Math.sin(a) * 0.21, 0, 0, 0, a + 0.35),
      mat: 0
    });
  }
  return mergeParts(parts, false);
}

// ---------------------------------------------------------------------------
// Rider (single SkinnedMesh, rigid-bound bones, 2 material groups)
// ---------------------------------------------------------------------------

// Bone indices
const B = {
  hips: 0,
  spine: 1,
  head: 2,
  shL: 3,
  foL: 4,
  shR: 5,
  foR: 6,
  thL: 7,
  caL: 8,
  thR: 9,
  caR: 10
} as const;

const RM = { suit: 0, pipe: 1 } as const;

/**
 * Rider geometry in bind pose: hips bone at rig origin, torso straight up,
 * arms hanging straight down from the shoulders, legs straight down. Never
 * rendered as-is — pose() immediately solves the riding posture.
 */
function buildRiderParts(): Part[] {
  const p: Part[] = [];
  const HEAD_Y = SPINE_UP + 0.38; // head bone world y (bind)

  // pelvis
  p.push({ geom: new THREE.BoxGeometry(0.2, 0.16, 0.26), matrix: xform(0, 0.03, 0), mat: RM.suit, bone: B.hips });
  // torso: lower + chest
  p.push({ geom: new THREE.BoxGeometry(0.22, 0.24, 0.26), matrix: xform(0, 0.22, 0), mat: RM.suit, bone: B.spine });
  p.push({ geom: new THREE.BoxGeometry(0.24, 0.22, 0.3), matrix: xform(0.02, 0.4, 0), mat: RM.suit, bone: B.spine });
  // spine ridge plate (back armor hump)
  p.push({ geom: new THREE.BoxGeometry(0.05, 0.26, 0.14), matrix: xform(-0.13, 0.32, 0), mat: RM.suit, bone: B.spine });

  // helmet: sphere + chin guard + low fin
  p.push({ geom: new THREE.SphereGeometry(0.115, 20, 14), matrix: xform(0, HEAD_Y + 0.135, 0), mat: RM.suit, bone: B.head });
  p.push({ geom: new THREE.BoxGeometry(0.1, 0.06, 0.13), matrix: xform(0.065, HEAD_Y + 0.07, 0), mat: RM.suit, bone: B.head });
  p.push({ geom: new THREE.BoxGeometry(0.16, 0.05, 0.014), matrix: xform(-0.045, HEAD_Y + 0.225, 0), mat: RM.suit, bone: B.head });
  // cyan visor stripe wrap (band of the helmet sphere, slightly proud)
  p.push({
    geom: new THREE.SphereGeometry(0.121, 24, 4, 0, Math.PI * 2, 1.22, 0.34),
    matrix: xform(0, HEAD_Y + 0.135, 0, 0, 0, -0.1),
    mat: RM.pipe,
    bone: B.head
  });

  // collar seam ring
  p.push({
    geom: new THREE.TorusGeometry(0.085, 0.01, 6, 18),
    matrix: xform(0, 0.5, 0, Math.PI / 2, 0, 0),
    mat: RM.pipe,
    bone: B.spine
  });
  // chest center seam
  p.push({ geom: new THREE.BoxGeometry(0.012, 0.38, 0.016), matrix: xform(0.135, 0.3, 0), mat: RM.pipe, bone: B.spine });

  // chest sigil "EL" (tiny mono, boxes on the chest plate)
  const sig = (w: number, h: number, y: number, z: number): Part => ({
    geom: new THREE.BoxGeometry(0.008, h, w),
    matrix: xform(0.146, 0.4 + y, z),
    mat: RM.pipe,
    bone: B.spine
  });
  // E (strokes) at z=+0.045, L at z=-0.005 — reads left→right when viewed from +X
  p.push(sig(0.008, 0.05, 0, 0.062)); // E vertical
  p.push(sig(0.026, 0.007, 0.022, 0.048)); // E top
  p.push(sig(0.02, 0.007, 0, 0.051)); // E mid
  p.push(sig(0.026, 0.007, -0.022, 0.048)); // E bottom
  p.push(sig(0.008, 0.05, 0, 0.02)); // L vertical
  p.push(sig(0.024, 0.007, -0.022, 0.005)); // L bottom

  for (const [sh, fo, th, ca, s] of [
    [B.shL, B.foL, B.thL, B.caL, 1],
    [B.shR, B.foR, B.thR, B.caR, -1]
  ] as const) {
    const sy = SPINE_UP + SHOULDER_UP; // shoulder bind world y = 0.42
    const sz = s * SHOULDER_OUT;
    // shoulder cap + cyan pauldron accent dot
    p.push({ geom: new THREE.SphereGeometry(0.068, 12, 8), matrix: xform(0, sy, sz), mat: RM.suit, bone: sh });
    p.push({ geom: new THREE.BoxGeometry(0.03, 0.012, 0.05), matrix: xform(0, sy + 0.06, sz + s * 0.02), mat: RM.pipe, bone: sh });
    // upper arm + seam
    p.push({ geom: new THREE.CapsuleGeometry(0.052, 0.2, 4, 10), matrix: xform(0, sy - 0.15, sz), mat: RM.suit, bone: sh });
    p.push({ geom: new THREE.BoxGeometry(0.012, 0.24, 0.012), matrix: xform(0, sy - 0.15, sz + s * 0.052), mat: RM.pipe, bone: sh });
    // forearm + hand + seam
    const ey = sy - ARM_A; // elbow bind y
    p.push({ geom: new THREE.CapsuleGeometry(0.047, 0.2, 4, 10), matrix: xform(0, ey - 0.15, sz), mat: RM.suit, bone: fo });
    p.push({ geom: new THREE.BoxGeometry(0.065, 0.1, 0.07), matrix: xform(0.01, ey - 0.315, sz), mat: RM.suit, bone: fo });
    p.push({ geom: new THREE.BoxGeometry(0.012, 0.2, 0.012), matrix: xform(0, ey - 0.13, sz + s * 0.048), mat: RM.pipe, bone: fo });
    // forearm gauntlet cuff (cyan ring near the wrist)
    p.push({ geom: new THREE.TorusGeometry(0.052, 0.008, 6, 14), matrix: xform(0, ey - 0.25, sz, 0, 0, Math.PI / 2), mat: RM.pipe, bone: fo });

    const hz = s * 0.1; // hip joint z
    // thigh + seam
    p.push({ geom: new THREE.CapsuleGeometry(0.074, 0.26, 4, 10), matrix: xform(0, -0.22, hz), mat: RM.suit, bone: th });
    p.push({ geom: new THREE.BoxGeometry(0.012, 0.3, 0.012), matrix: xform(0, -0.2, hz + s * 0.072), mat: RM.pipe, bone: th });
    // calf + boot + buckles + knee pad
    const ky = -0.02 - LEG_A; // knee bind y
    p.push({ geom: new THREE.CapsuleGeometry(0.058, 0.3, 4, 10), matrix: xform(0, ky - 0.21, hz), mat: RM.suit, bone: ca });
    // armored knee pad (suit) with a cyan cap dot (pipe) at the top of the calf bone
    p.push({ geom: new THREE.BoxGeometry(0.1, 0.09, 0.1), matrix: xform(0.03, ky - 0.02, hz), mat: RM.suit, bone: ca });
    p.push({ geom: new THREE.BoxGeometry(0.02, 0.03, 0.03), matrix: xform(0.085, ky - 0.02, hz), mat: RM.pipe, bone: ca });
    p.push({ geom: new THREE.BoxGeometry(0.24, 0.09, 0.095), matrix: xform(0.055, ky - LEG_B + 0.01, hz), mat: RM.suit, bone: ca });
    for (const bx of [0.02, 0.09]) {
      p.push({
        geom: new THREE.BoxGeometry(0.018, 0.02, 0.012),
        matrix: xform(bx, ky - LEG_B + 0.035, hz + s * 0.052),
        mat: RM.pipe,
        bone: ca
      });
    }
  }

  return p;
}

interface RiderRig {
  rig: THREE.Group;
  bones: THREE.Bone[];
}

function buildRider(suitMat: THREE.Material, pipeMat: THREE.Material): RiderRig {
  const bones: THREE.Bone[] = Array.from({ length: 11 }, () => new THREE.Bone());
  const pos: Array<[number, number, number, number]> = [
    // [parent, x, y, z] — parent -1 = root
    [-1, 0, 0, 0], // hips
    [B.hips, 0, SPINE_UP, 0], // spine
    [B.spine, 0, 0.38, 0], // head
    [B.spine, 0, SHOULDER_UP, SHOULDER_OUT], // shL
    [B.shL, 0, -ARM_A, 0], // foL
    [B.spine, 0, SHOULDER_UP, -SHOULDER_OUT], // shR
    [B.shR, 0, -ARM_A, 0], // foR
    [B.hips, 0, -0.02, 0.1], // thL
    [B.thL, 0, -LEG_A, 0], // caL
    [B.hips, 0, -0.02, -0.1], // thR
    [B.thR, 0, -LEG_A, 0] // caR
  ];
  pos.forEach(([parent, x, y, z], i) => {
    bones[i].position.set(x, y, z);
    if (parent >= 0) bones[parent].add(bones[i]);
  });

  // debug/test anchors at the chain ends (hand = forearm end, foot = calf end)
  const mk = (name: string, parent: THREE.Object3D, x: number, y: number, z: number): void => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
  };
  mk('handL', bones[B.foL], 0, -ARM_B, 0);
  mk('handR', bones[B.foR], 0, -ARM_B, 0);
  mk('footL', bones[B.caL], 0, -LEG_B, 0);
  mk('footR', bones[B.caR], 0, -LEG_B, 0);

  const geom = mergeParts(buildRiderParts(), true);
  // Bind-pose bbox has legs hanging to y≈-0.9; the posed rider lives around
  // y 0.3..1.6. Hand-author bounds so Box3.setFromObject (viewer framing)
  // doesn't think the rider dangles below the ground.
  geom.boundingBox = new THREE.Box3(new THREE.Vector3(-0.7, 0.25, -0.5), new THREE.Vector3(0.7, 1.7, 0.5));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.1);

  const mesh = new THREE.SkinnedMesh(geom, [suitMat, pipeMat]);
  mesh.frustumCulled = false;
  mesh.name = 'riderMesh';

  const rig = new THREE.Group();
  rig.name = 'riderRig';
  rig.add(bones[B.hips]);
  rig.add(mesh);
  rig.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  return { rig, bones };
}

// ---------------------------------------------------------------------------
// Ghost geometry (~300 tris, neutral tuck pose, merged bike+rider silhouette)
// ---------------------------------------------------------------------------

function buildGhostGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const add = (geom: THREE.BufferGeometry, matrix: THREE.Matrix4): void => {
    parts.push({ geom, matrix, mat: 0 });
  };

  // Wheel hoops — rotated 90 degrees around the Y axis so the torus ring lies in
  // the YZ plane (perpendicular to the bike's forward axis +X). This makes the
  // wheels appear as circles when the camera looks from behind or in front
  // (the typical finale chase angle). Without this rotation the default XY-plane
  // torus renders as a thin sliver from the ±X directions.
  // Keep radialSegments=4, tubularSegments=10 to stay within the 400-tri budget.
  for (const s of [1, -1]) {
    add(
      new THREE.TorusGeometry(WHEEL_R, WHEEL_TUBE, 4, 10),
      xform(s * AXLE_X, AXLE_Y, 0, 0, Math.PI / 2, 0)
    );
  }

  // Body spar: side-view profile extruded in Z (readable from the side).
  const shape = new THREE.Shape(PROFILE.map(([x, y]) => new THREE.Vector2(x, y)));
  add(new THREE.ExtrudeGeometry(shape, { depth: BODY_HALF_W * 2, bevelEnabled: false }), xform(0, 0, -BODY_HALF_W));

  // Body volume box — gives the ghost a recognisable block mass from any cardinal
  // angle, especially from behind (the finale chase-from-behind camera view).
  // 12 triangles only; sits over the bike body profile centroid.
  add(new THREE.BoxGeometry(1.8, 0.5, 0.22), xform(0.28, 0.76, 0));

  // Rider silhouette in tuck: pelvis+torso, helmet, arm slabs, leg slabs.
  // BoxGeometry and IcosahedronGeometry are inherently 3-D so they read from any angle.
  add(new THREE.BoxGeometry(0.3, 0.44, 0.32), xform(-0.06, 1.02, 0, 0, 0, -0.9));
  add(new THREE.IcosahedronGeometry(0.13, 0), xform(0.2, 1.24, 0));
  for (const s of [1, -1]) {
    add(new THREE.BoxGeometry(0.34, 0.09, 0.09), xform(0.16, 1.02, s * 0.2, 0, 0, -0.5));
    add(new THREE.BoxGeometry(0.1, 0.42, 0.12), xform(-0.16, 0.62, s * 0.14, 0, 0, 0.35));
  }

  const merged = mergeParts(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------
// buildBike
// ---------------------------------------------------------------------------

export function buildBike(rng: Rng): BikeAsset {
  // Materials — cyan is derived from theme; the red tail is signalMagenta
  // pulled toward pure red (no red token exists in the palette).
  const cyan = new THREE.Color(COLORS.tronCyan);
  const headlightColor = new THREE.Color(COLORS.tronCyan).lerp(new THREE.Color(COLORS.moonlight), 0.55);
  const tailRed = new THREE.Color(COLORS.signalMagenta);
  tailRed.g *= 0.4;
  tailRed.b *= 0.15;

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x1c202c,
    metalness: 0.9,
    roughness: 0.3
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x021014,
    emissive: cyan,
    emissiveIntensity: 1.0
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x0a1416,
    emissive: headlightColor,
    emissiveIntensity: 1.5,
    side: THREE.DoubleSide
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x120608,
    emissive: tailRed,
    emissiveIntensity: 0.9
  });
  const suitMat = new THREE.MeshStandardMaterial({
    color: 0x14161f,
    metalness: 0.15,
    roughness: 0.85
  });
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0x021014,
    emissive: cyan,
    emissiveIntensity: 0.8
  });

  // --- hierarchy ---
  const group = new THREE.Group();
  group.name = 'bike';
  const chassisTilt = new THREE.Group();
  chassisTilt.name = 'chassisTilt';
  group.add(chassisTilt);
  const pitchPivot = new THREE.Group();
  pitchPivot.name = 'pitchPivot';
  pitchPivot.position.y = PITCH_PIVOT_Y;
  chassisTilt.add(pitchPivot);

  const bikeBody = new THREE.Group();
  bikeBody.name = 'bikeBody';
  bikeBody.position.y = -PITCH_PIVOT_Y;
  pitchPivot.add(bikeBody);

  // static merged bike (4 material groups = 4 draw calls)
  const staticMesh = new THREE.Mesh(mergeParts(buildBikeStatic(rng), false), [
    metalMat,
    glowMat,
    headMat,
    tailMat
  ]);
  staticMesh.name = 'bikeStatic';
  bikeBody.add(staticMesh);

  // spinning hub discs (1 draw call each)
  const hubGeom = buildHubGeometry();
  const hubF = new THREE.Mesh(hubGeom, metalMat);
  hubF.name = 'hubFront';
  hubF.position.set(AXLE_X, AXLE_Y, 0);
  const hubR = new THREE.Mesh(hubGeom, metalMat);
  hubR.name = 'hubRear';
  hubR.position.set(-AXLE_X, AXLE_Y, 0);
  bikeBody.add(hubF, hubR);

  // headlight anchor for light pools
  const headAnchor = new THREE.Object3D();
  headAnchor.name = 'headAnchor';
  headAnchor.position.set(1.15, 0.7, 0);
  bikeBody.add(headAnchor);
  group.userData.headAnchor = headAnchor;

  // grip/peg target anchors (tests verify hands/feet stay locked to these)
  for (const [name, v] of [
    ['gripL', new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z)],
    ['gripR', new THREE.Vector3(GRIP.x, GRIP.y, -GRIP.z)],
    ['ankleL', new THREE.Vector3(PEG.x, PEG.y + ANKLE_LIFT, PEG.z)],
    ['ankleR', new THREE.Vector3(PEG.x, PEG.y + ANKLE_LIFT, -PEG.z)]
  ] as const) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.copy(v);
    bikeBody.add(o);
  }

  // rider (2 draw calls)
  const { rig, bones } = buildRider(suitMat, pipeMat);
  rig.position.y = -PITCH_PIVOT_Y;
  pitchPivot.add(rig);

  // --- pose ---
  const tmpQ = new THREE.Quaternion();

  function poseRider(lean: number, crouch: number): void {
    const c = THREE.MathUtils.clamp(crouch, 0, 1);
    const leanN = THREE.MathUtils.clamp(lean / LEAN_MAX, -1, 1);

    // hips: tuck low & rearward → standing higher & forward; shift 0.1m into the turn
    const hip = new THREE.Vector3(
      THREE.MathUtils.lerp(-0.18, -0.1, c),
      THREE.MathUtils.lerp(0.84, 1.02, c),
      0.1 * leanN
    );
    bones[B.hips].position.copy(hip);
    bones[B.hips].quaternion.identity();

    // spine: forward pitch 64°(tuck)→36°(standing), rolled into the turn (inside shoulder dips)
    const a = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(64, 36, c));
    const dip = THREE.MathUtils.degToRad(9) * leanN;
    const spineQ = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), dip)
      .multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a));
    bones[B.spine].quaternion.copy(spineQ);

    // head: pitched less than the spine so the visor looks down the road
    const headQ = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), dip * 0.6)
      .multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a * 0.35));
    bones[B.head].quaternion.copy(spineQ.clone().invert().multiply(headQ));

    // world-space joint roots
    const spineW = hip.clone().add(new THREE.Vector3(0, SPINE_UP, 0));

    for (const [sh, fo, th, ca, s] of [
      [B.shL, B.foL, B.thL, B.caL, 1],
      [B.shR, B.foR, B.thR, B.caR, -1]
    ] as const) {
      // arm IK: shoulder → grip
      const shoulderW = spineW
        .clone()
        .add(new THREE.Vector3(0, SHOULDER_UP, s * SHOULDER_OUT).applyQuaternion(spineQ));
      const grip = new THREE.Vector3(GRIP.x, GRIP.y, s * GRIP.z);
      const arm = solveTwoBone(shoulderW, grip, ARM_A, ARM_B, new THREE.Vector3(-0.2, -1, s * 0.7));
      const shQ = aim(DOWN, arm.upper);
      bones[sh].quaternion.copy(spineQ.clone().invert().multiply(shQ));
      bones[fo].quaternion.copy(shQ.clone().invert().multiply(aim(DOWN, arm.lower)));

      // leg IK: hip joint → ankle above peg; knees bend forward
      const hipJointW = hip.clone().add(new THREE.Vector3(0, -0.02, s * 0.1));
      const ankle = new THREE.Vector3(PEG.x, PEG.y + ANKLE_LIFT, s * PEG.z);
      const leg = solveTwoBone(hipJointW, ankle, LEG_A, LEG_B, new THREE.Vector3(1, 0.3, 0));
      const thQ = aim(DOWN, leg.upper);
      bones[th].quaternion.copy(thQ);
      bones[ca].quaternion.copy(thQ.clone().invert().multiply(aim(DOWN, leg.lower)));
    }
  }

  function pose(p: BikePose): void {
    chassisTilt.rotation.x = p.lean;
    pitchPivot.rotation.z = p.pitch;
    hubF.rotation.z = -p.wheelSpin;
    hubR.rotation.z = -p.wheelSpin;
    poseRider(p.lean, p.crouch);
  }

  // neutral riding pose so the asset never renders in bind pose
  pose({ lean: 0, pitch: 0, crouch: 0.25, wheelSpin: 0 });

  return { group, pose, ghostGeometry: buildGhostGeometry() };
}
