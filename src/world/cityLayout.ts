/**
 * cityLayout.ts
 *
 * Places KitBash NeoCity building pieces in walls flanking the road along the
 * scroll-ride route and computes display anchors for résumé content.
 *
 * HARD ROAD-CLEARANCE RULE: no building geometry may cross into the road.
 * Every piece's near face must be ≥ MIN_ROAD_CLEARANCE from the road
 * centerline. Enforced via clampOutsideRoad().
 *
 * Draw-call budget: ~300 draw-calls per viewpoint. With ~160 placements at
 * 1-2 draw-calls each this stays well inside budget for the near corridor.
 */

import * as THREE from 'three';
import { roadFrame, ZONES } from './route';
import { CORRIDOR_HALF } from './streets';
import { makeRng } from '../utils/rng';
import type { NeoLibrary } from '../assets/buildings/neocity';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Minimum distance from road centerline to the near face of any placed piece. */
const MIN_ROAD_CLEARANCE = 20; // CORRIDOR_HALF(17) + 3m margin

// ──────────────────────────────────────────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────────────────────────────────────────

export interface DisplayAnchor {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  kind: 'aboutHero' | 'aboutSign' | 'projBig' | 'projSmall' | 'research';
}

export interface City {
  group: THREE.Group;
  anchors: DisplayAnchor[];
  update(t: number): void;
  updateAmbient(sec: number): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// clampOutsideRoad
//
// Ensures a placed piece (whose center is at `pos`) does not intrude into the
// road. `halfW` is the piece's half-extent along the binormal axis (i.e. the
// projected width facing the road after rotation is applied).
//
// Algorithm:
//   signedDist = dot(pos - roadCenter, binormal)  [positive = +binormal side]
//   nearFace   = |signedDist| - halfW
//   If nearFace < MIN_ROAD_CLEARANCE, push pos outward so nearFace == MIN.
// ──────────────────────────────────────────────────────────────────────────────

export function clampOutsideRoad(
  pos: THREE.Vector3,
  binormal: THREE.Vector3,
  halfW: number,
  roadCenter: THREE.Vector3,
): THREE.Vector3 {
  const offset = pos.clone().sub(roadCenter);
  const signedDist = offset.dot(binormal);
  const side = signedDist >= 0 ? 1 : -1;
  const absDist = Math.abs(signedDist);
  const nearFace = absDist - halfW;

  if (nearFace < MIN_ROAD_CLEARANCE) {
    // How far to push: move center so nearFace == MIN_ROAD_CLEARANCE
    const requiredAbsDist = MIN_ROAD_CLEARANCE + halfW;
    const delta = requiredAbsDist - absDist;
    pos.addScaledVector(binormal, side * delta);
  }

  return pos;
}

// ──────────────────────────────────────────────────────────────────────────────
// Piece selection by zone
// ──────────────────────────────────────────────────────────────────────────────

const LARGE_TOWERS = [
  'KB3D_NEC_BldgLG_A_Main',
  'KB3D_NEC_BldgLG_B_Main',
  'KB3D_NEC_BldgLG_C_Main',
] as const;

const MID_BUILDINGS = [
  'KB3D_NEC_BldgMD_A_Main',
  'KB3D_NEC_BldgMD_B_Main',
  'KB3D_NEC_BldgMD_C_Main',
] as const;

const SMALL_BUILDINGS = [
  'KB3D_NEC_BldgSM_A_Main',
  'KB3D_NEC_BldgSM_B_Main',
  'KB3D_NEC_BldgSM_C_Main',
] as const;

// Approximate bboxes [w, h, d] for pieces (used for footprint math when
// pieces[name] isn't populated — e.g. the unit stub in tests).
const FALLBACK_BBOX: Record<string, [number, number, number]> = {
  KB3D_NEC_BldgLG_A_Main: [30, 67, 29],
  KB3D_NEC_BldgLG_B_Main: [55, 201, 45],
  KB3D_NEC_BldgLG_C_Main: [35, 143, 34],
  KB3D_NEC_BldgMD_A_Main: [20, 58, 18],
  KB3D_NEC_BldgMD_B_Main: [18, 42, 16],
  KB3D_NEC_BldgMD_C_Main: [22, 48, 20],
  KB3D_NEC_BldgSM_A_Main: [12, 24, 10],
  KB3D_NEC_BldgSM_B_Main: [14, 18, 12],
  KB3D_NEC_BldgSM_C_Main: [10, 20, 10],
};

type ZoneKind = 'about' | 'research' | 'ramp' | 'generic';

function classifyZone(t: number): ZoneKind {
  if (t >= ZONES.about[0] && t < ZONES.about[1]) return 'about';
  if (t >= ZONES.research[0] && t < ZONES.research[1]) return 'research';
  if (
    (t >= ZONES.ramp1[0] && t < ZONES.ramp1[1]) ||
    (t >= ZONES.ramp2[0] && t < ZONES.ramp2[1])
  ) return 'ramp';
  return 'generic';
}

interface PieceSpec {
  name: string;
  bbox: [number, number, number];
}

function selectPiece(
  lib: NeoLibrary,
  zoneKind: ZoneKind,
  rng: ReturnType<typeof makeRng>,
): PieceSpec {
  let pool: readonly string[];

  switch (zoneKind) {
    case 'about':
    case 'research':
      // Prefer large towers; 70% chance large, else mid
      pool = rng.chance(0.70) ? LARGE_TOWERS : MID_BUILDINGS;
      break;
    case 'ramp':
      // Mix mid and small
      pool = rng.chance(0.50) ? MID_BUILDINGS : SMALL_BUILDINGS;
      break;
    default:
      // Generic: mix all tiers, weighted toward mid
      if (rng.chance(0.25)) pool = LARGE_TOWERS;
      else if (rng.chance(0.50)) pool = MID_BUILDINGS;
      else pool = SMALL_BUILDINGS;
      break;
  }

  const name = rng.pick(pool);
  // Get bbox from the library manifest if available, else fallback
  const piece = lib.pieces[name];
  const bbox: [number, number, number] = piece?.bbox ?? FALLBACK_BBOX[name] ?? [20, 40, 20];
  return { name, bbox };
}

// ──────────────────────────────────────────────────────────────────────────────
// placePiece
//
// Place one NeoCity piece on one side of the road at route parameter t.
// Returns the placed Group (already added to parentGroup) or null if lib.get
// returns null (graceful: loader might not have the piece yet).
//
// Rotation: pieces face the road — they are rotated so their local +Z axis
// points inward toward the road. The binormal points left (+) or right (−)
// from road centerline; a piece on the +binormal side should face −binormal.
//
// Rotated footprint for clearance:
//   - If rotationY ≡ 0 or π: piece presents its width (bbox[0]) to the road.
//   - If rotationY ≡ ±π/2: piece presents its depth (bbox[2]) to the road.
//   - We always orient the piece to face the road (yaw = π for +side, 0 for −side)
//     so the face axis is bbox[2] (depth) — no, actually pieces are box-like
//     so we place them with the facing edge being half of whichever dimension
//     is perpendicular to binormal. Since we rotate them so the local Z faces
//     the road, the half-extent presented toward the road is bbox[2]/2 (depth).
//
// After placement, clampOutsideRoad is applied using that half-extent.
// ──────────────────────────────────────────────────────────────────────────────

function placePiece(
  lib: NeoLibrary,
  parentGroup: THREE.Group,
  t: number,
  side: 1 | -1,
  spec: PieceSpec,
  gap: number,
  rng: ReturnType<typeof makeRng>,
): THREE.Group | null {
  const frame = roadFrame(t);
  const { pos: roadPos, tangent, binormal } = frame;

  // The half-extent presented toward the road: piece oriented so local +Z faces
  // the road (rotated by π on the +binormal side). In that orientation, bbox[2]
  // is depth (along road-facing direction), so half-depth is bbox[2]/2.
  const halfDepth = spec.bbox[2] / 2;

  // Initial placement: center at CORRIDOR_HALF + gap + halfDepth from road center
  const initialOffset = CORRIDOR_HALF + gap + halfDepth;
  const pieceCenter = roadPos.clone().addScaledVector(binormal, side * initialOffset);

  // Slight random longitudinal scatter (along tangent) to break up regularity
  const scatter = rng.range(-4, 4);
  pieceCenter.addScaledVector(tangent, scatter);

  // Keep height at ground (y=0) for most pieces, but allow y from route pos
  // (pieces sit on the ground regardless of ramp height — they are buildings)
  pieceCenter.y = 0;

  // Apply road clearance guarantee using halfDepth as the extent facing the road.
  const roadCenterXZ = new THREE.Vector3(roadPos.x, 0, roadPos.z);
  const clampedCenter = clampOutsideRoad(
    new THREE.Vector3(pieceCenter.x, 0, pieceCenter.z),
    binormal,
    halfDepth,
    roadCenterXZ,
  );
  pieceCenter.x = clampedCenter.x;
  pieceCenter.z = clampedCenter.z;

  // Orientation: face the road. The piece should present its facade toward
  // −binormal*side (i.e. pointing inward to the road).
  // We construct a quaternion that rotates local +Z to point toward the road:
  //   faceDir = −binormal*side  (inward, horizontally)
  //   upDir = Y
  // THREE.Quaternion.setFromUnitVectors doesn't work well for arbitrary axes,
  // so we build a rotation matrix from (right, up, forward) basis vectors.
  const faceDir = binormal.clone().multiplyScalar(-side); // inward
  // Slight random yaw variation for visual interest (±10°)
  const yawVariation = rng.range(-Math.PI / 18, Math.PI / 18);
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawVariation);
  faceDir.applyQuaternion(yawQuat).normalize();

  const upDir = new THREE.Vector3(0, 1, 0);
  const rightDir = new THREE.Vector3().crossVectors(upDir, faceDir).normalize();

  const rotMat = new THREE.Matrix4().makeBasis(rightDir, upDir, faceDir);
  const quat = new THREE.Quaternion().setFromRotationMatrix(rotMat);

  // Fetch the piece (clone with neon materials applied)
  const pieceGroup = lib.get(spec.name);
  if (!pieceGroup) return null;

  pieceGroup.position.copy(pieceCenter);
  pieceGroup.quaternion.copy(quat);
  pieceGroup.name = `${spec.name}_t${t.toFixed(3)}_s${side > 0 ? 'R' : 'L'}`;

  parentGroup.add(pieceGroup);
  return pieceGroup;
}

// ──────────────────────────────────────────────────────────────────────────────
// buildCity
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Builds the city corridor: NeoCity pieces flanking the road, plus display
 * anchors for résumé content.
 *
 * @param lib  - NeoLibrary (real or stub)
 * @param seed - Deterministic seed (no Math.random used internally)
 */
export function buildCity(lib: NeoLibrary, seed: number): City {
  const rng = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'city';

  // ── Walk the route and place buildings ──────────────────────────────────────

  // Zones with their t-step density.
  // We use coarser steps on distant sections (ramp/scaffold) and denser on
  // the about/research walls where the camera lingers.
  interface ZonePlacementConfig {
    tStart: number;
    tEnd: number;
    step: number;
  }

  const placementZones: ZonePlacementConfig[] = [
    { tStart: ZONES.intro[0],    tEnd: ZONES.intro[1],    step: 0.025 },
    { tStart: ZONES.about[0],    tEnd: ZONES.about[1],    step: 0.015 },
    { tStart: ZONES.turn[0],     tEnd: ZONES.turn[1],     step: 0.025 },
    { tStart: ZONES.ramp1[0],    tEnd: ZONES.ramp1[1],    step: 0.030 },
    { tStart: ZONES.scaffold[0], tEnd: ZONES.scaffold[1], step: 0.035 },
    { tStart: ZONES.ramp2[0],    tEnd: ZONES.ramp2[1],    step: 0.030 },
    { tStart: ZONES.descend[0],  tEnd: ZONES.descend[1],  step: 0.025 },
    { tStart: ZONES.research[0], tEnd: ZONES.research[1], step: 0.015 },
    { tStart: ZONES.lift[0],     tEnd: ZONES.lift[1],     step: 0.030 },
    { tStart: ZONES.bridge[0],   tEnd: ZONES.bridge[1],   step: 0.040 },
  ];

  // Base gap from CORRIDOR_HALF edge to piece near face (additional safety)
  const BASE_GAP = 3;

  for (const zone of placementZones) {
    const zoneKind = classifyZone(zone.tStart + 0.001);
    let t = zone.tStart;
    while (t < zone.tEnd - 0.001) {
      for (const side of [1, -1] as const) {
        const spec = selectPiece(lib, zoneKind, rng);
        // Small random gap variation
        const gap = BASE_GAP + rng.range(0, 5);
        placePiece(lib, group, t, side, spec, gap, rng);
      }
      t += zone.step;
    }
  }

  // ── Compute display anchors ─────────────────────────────────────────────────

  const anchors: DisplayAnchor[] = [];

  // Helper: build a quaternion for an anchor that faces the road from `side`.
  function anchorQuat(t: number, side: 1 | -1): THREE.Quaternion {
    const { tangent, binormal } = roadFrame(t);
    // Anchor faces inward toward the road
    const faceDir = binormal.clone().multiplyScalar(-side);
    const upDir = new THREE.Vector3(0, 1, 0);
    const rightDir = new THREE.Vector3().crossVectors(upDir, faceDir).normalize();
    const rotMat = new THREE.Matrix4().makeBasis(rightDir, upDir, faceDir);
    return new THREE.Quaternion().setFromRotationMatrix(rotMat);
  }

  // Helper: pos offset from the road frame at t, on side, at height y.
  function anchorPos(t: number, side: 1 | -1, lateralOffset: number, y: number): THREE.Vector3 {
    const { pos, binormal } = roadFrame(t);
    return new THREE.Vector3(
      pos.x + binormal.x * side * lateralOffset,
      y,
      pos.z + binormal.z * side * lateralOffset,
    );
  }

  // aboutHero — 1 anchor, +binormal side, t≈0.20, pos.y≈14
  {
    const t = 0.20;
    const side = 1;
    anchors.push({
      pos: anchorPos(t, side, MIN_ROAD_CLEARANCE + 8, 14),
      quat: anchorQuat(t, side),
      kind: 'aboutHero',
    });
  }

  // aboutSign — 2–3 anchors near aboutHero (bio + 2 misc), slightly lower/spaced
  {
    const t = 0.20;
    const side = 1;
    const baseH = 8;
    const lateralBase = MIN_ROAD_CLEARANCE + 6;
    // Sign 1: slightly back along route
    anchors.push({
      pos: anchorPos(t - 0.012, side, lateralBase, baseH),
      quat: anchorQuat(t - 0.012, side),
      kind: 'aboutSign',
    });
    // Sign 2: at t
    anchors.push({
      pos: anchorPos(t + 0.012, side, lateralBase, baseH + 2),
      quat: anchorQuat(t + 0.012, side),
      kind: 'aboutSign',
    });
    // Sign 3: slightly forward
    anchors.push({
      pos: anchorPos(t + 0.025, side, lateralBase + 3, baseH),
      quat: anchorQuat(t + 0.025, side),
      kind: 'aboutSign',
    });
  }

  // projBig — 2 anchors flanking flip1Apex (t≈0.41), at apex height (~18-22m),
  // offset ±binormal so they frame the airborne bike.
  {
    const t = 0.41;
    const lateralOff = MIN_ROAD_CLEARANCE + 10;
    const y = 20;
    for (const side of [1, -1] as const) {
      anchors.push({
        pos: anchorPos(t, side, lateralOff, y),
        quat: anchorQuat(t, side),
        kind: 'projBig',
      });
    }
  }

  // projSmall — 3 anchors around flip2Apex (t≈0.57)
  {
    const t = 0.57;
    const lateralOff = MIN_ROAD_CLEARANCE + 8;
    const y = 18;
    // Left, center-left, right
    anchors.push({
      pos: anchorPos(t - 0.015, -1, lateralOff, y),
      quat: anchorQuat(t - 0.015, -1),
      kind: 'projSmall',
    });
    anchors.push({
      pos: anchorPos(t, 1, lateralOff, y + 4),
      quat: anchorQuat(t, 1),
      kind: 'projSmall',
    });
    anchors.push({
      pos: anchorPos(t + 0.015, -1, lateralOff, y),
      quat: anchorQuat(t + 0.015, -1),
      kind: 'projSmall',
    });
  }

  // research — 2 anchors HIGH (pos.y≈22) on canyon walls within research zone
  // (0.68–0.84), one per side, tilted down toward the low upward-looking camera.
  {
    const tResearch = 0.76; // researchMid
    const lateralOff = MIN_ROAD_CLEARANCE + 12;
    const y = 22;
    for (const side of [1, -1] as const) {
      // Tilt the anchor down slightly: apply a small pitch rotation
      const baseQuat = anchorQuat(tResearch, side);
      const pitchAxis = new THREE.Vector3(1, 0, 0); // local right (before rotation)
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(pitchAxis, Math.PI / 10);
      baseQuat.multiply(pitchQuat);

      anchors.push({
        pos: anchorPos(tResearch, side, lateralOff, y),
        quat: baseQuat,
        kind: 'research',
      });
    }
  }

  // ── City object ─────────────────────────────────────────────────────────────

  return {
    group,
    anchors,
    update(_t: number): void {
      // Stub: metro + window flicker come in a later task.
    },
    updateAmbient(_sec: number): void {
      // Stub: ambient animation (billboard flicker, etc.) comes later.
    },
  };
}
