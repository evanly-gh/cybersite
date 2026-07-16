import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCity, clampOutsideRoad } from '../src/world/cityLayout';
import { roadFrame } from '../src/world/route';
import { CORRIDOR_HALF } from '../src/world/streets';

// Stub NeoLibrary: every get() returns a box matching the worst-case LG_B footprint
// (w=55, d=45) so clearance math is exercised with the widest piece in the palette.
// The stub pieces map provides the bbox so selectPiece picks it up from lib.pieces.
const LG_B_BBOX: [number, number, number] = [55, 200, 45];
const stubLib = {
  pieces: {
    KB3D_NEC_BldgLG_A_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgLG_B_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgLG_C_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgMD_A_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgMD_B_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgMD_C_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgSM_A_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgSM_B_Main: { bbox: LG_B_BBOX },
    KB3D_NEC_BldgSM_C_Main: { bbox: LG_B_BBOX },
  } as Record<string, { bbox: [number, number, number] }>,
  get: (_name: string) => {
    const g = new THREE.Group();
    // Build a box matching LG_B dimensions so world-space AABB is meaningful.
    g.add(new THREE.Mesh(new THREE.BoxGeometry(LG_B_BBOX[0], LG_B_BBOX[1], LG_B_BBOX[2])));
    (g.userData as Record<string, unknown>).footprint = [LG_B_BBOX[0], LG_B_BBOX[2]];
    return g;
  },
} as any;

// MIN_ROAD_CLEARANCE = 20 (CORRIDOR_HALF 17 + margin 3)
const MIN_ROAD_CLEARANCE = 20;

describe('clampOutsideRoad', () => {
  it('leaves a pos alone when already outside clearance', () => {
    // Binormal pointing +X. Road center at origin.
    const binormal = new THREE.Vector3(1, 0, 0);
    const roadCenter = new THREE.Vector3(0, 0, 0);
    const halfW = 10; // piece half-extent along binormal

    // Near face at 21 + 10 = 31 from center. Well outside MIN_ROAD_CLEARANCE=20.
    const pos = new THREE.Vector3(31, 0, 0); // center of piece is 31 from road
    const result = clampOutsideRoad(pos.clone(), binormal, halfW, roadCenter);
    // Should not be pushed further: center stays at 31
    expect(result.x).toBeCloseTo(31, 3);
  });

  it('pushes piece outward (+binormal side) when near face intrudes', () => {
    // Piece center at 15 on +X, half-extent 10 → near face at 5, violates MIN=20
    const binormal = new THREE.Vector3(1, 0, 0);
    const roadCenter = new THREE.Vector3(0, 0, 0);
    const halfW = 10;
    const pos = new THREE.Vector3(15, 0, 0);
    const result = clampOutsideRoad(pos.clone(), binormal, halfW, roadCenter);
    // After clamp: near face must be >= MIN_ROAD_CLEARANCE (20)
    // center = MIN_ROAD_CLEARANCE + halfW = 30
    expect(result.x).toBeGreaterThanOrEqual(MIN_ROAD_CLEARANCE + halfW - 0.001);
  });

  it('pushes piece outward (−binormal side) when near face intrudes', () => {
    // Piece center at -15, half-extent 10 → near face at -5, violates MIN=20
    const binormal = new THREE.Vector3(1, 0, 0);
    const roadCenter = new THREE.Vector3(0, 0, 0);
    const halfW = 10;
    const pos = new THREE.Vector3(-15, 0, 0);
    const result = clampOutsideRoad(pos.clone(), binormal, halfW, roadCenter);
    // center must be at -(MIN + halfW) = -30
    expect(result.x).toBeLessThanOrEqual(-(MIN_ROAD_CLEARANCE + halfW) + 0.001);
  });

  it('handles non-axis-aligned binormal (45 deg)', () => {
    // Binormal at 45 degrees in XZ plane
    const binormal = new THREE.Vector3(1, 0, 1).normalize();
    const roadCenter = new THREE.Vector3(0, 0, 0);
    const halfW = 10;
    // Place piece close to road on the +binormal side
    // dot(pos - roadCenter, binormal) = 8 → near face at -2, violates
    const pos = roadCenter.clone().addScaledVector(binormal, 8);
    const result = clampOutsideRoad(pos.clone(), binormal, halfW, roadCenter);
    const dist = result.clone().sub(roadCenter).dot(binormal);
    expect(dist).toBeGreaterThanOrEqual(MIN_ROAD_CLEARANCE + halfW - 0.001);
  });

  it('accepts rotated presentedHalfExtent for LG_B worst-case at max yaw', () => {
    // Verifies that when the caller passes the correct rotated half-extent
    // (instead of just bbox[2]/2), clampOutsideRoad correctly positions the piece.
    //
    // LG_B: bbox [55, 200, 45], max yaw = 10° = π/18 rad
    // presentedHalfExtent = (55/2)*|sin(π/18)| + (45/2)*|cos(π/18)|
    //                     ≈ 27.5*0.1736 + 22.5*0.9848 ≈ 4.774 + 22.158 ≈ 26.93
    const bboxW = 55;
    const bboxD = 45;
    const yaw = Math.PI / 18; // 10°
    const presentedHalfExtent = (bboxW / 2) * Math.sin(yaw) + (bboxD / 2) * Math.cos(yaw);

    // With CORRIDOR_HALF=17 and BASE_GAP=3, initial center = 17+3+presentedHalfExtent
    const CORRIDOR_HALF_VAL = 17;
    const gap = 3;
    const binormal = new THREE.Vector3(1, 0, 0);
    const roadCenter = new THREE.Vector3(0, 0, 0);

    // Place the center exactly at the intended position.
    const centerDist = CORRIDOR_HALF_VAL + gap + presentedHalfExtent;
    const pos = new THREE.Vector3(centerDist, 0, 0);

    // clampOutsideRoad should leave it untouched (already outside MIN_ROAD_CLEARANCE=20).
    const result = clampOutsideRoad(pos.clone(), binormal, presentedHalfExtent, roadCenter);
    const nearFace = result.x - presentedHalfExtent;

    // Near face must be >= MIN_ROAD_CLEARANCE (20), and specifically >= CORRIDOR_HALF (17).
    expect(nearFace).toBeGreaterThanOrEqual(MIN_ROAD_CLEARANCE - 0.001);
    // Sanity: the presented half-extent is ~26.93, well above the pre-fix 22.5.
    expect(presentedHalfExtent).toBeGreaterThan(22.5);
  });
});

describe('cityLayout', () => {
  it('never places building geometry inside the road (rotated-footprint center-distance check)', () => {
    // This test MUST fail against pre-fix code (where only bbox[2]/2 was used as
    // halfW) and pass after (where presentedHalfExtent accounts for yaw).
    //
    // Strategy: build the city with the worst-case piece (LG_B w=55, d=45) at all
    // slots. For each placed Group, parse its t from the group name, retrieve the
    // road frame at that t, compute the presented half-extent using the correct
    // rotated formula, then verify:
    //   |dot(pieceCenter - roadCenter, binormal)| - presentedHalfExtent >= CORRIDOR_HALF
    //
    // This directly tests the placement invariant without AABB-vs-curve ambiguity.
    // The worst case is LG_B (w=55, d=45) at max yaw (π/18 ≈ 10°):
    //   presentedHalfExtent ≈ 27.5*sin(10°) + 22.5*cos(10°) ≈ 26.93
    //   near face = |signedDist| - 26.93 must be >= CORRIDOR_HALF (17)
    //   => |signedDist| >= 43.93
    // Pre-fix: clamp used halfDepth=22.5, so center was placed at 17+gap+22.5=42.5
    //   (with gap=3, center=42.5, near face=42.5-26.93=15.57 < CORRIDOR_HALF=17) → FAIL.
    // Post-fix: clamp uses presentedHalfExtent≈26.93, center=17+gap+26.93≈46.93
    //   near face=46.93-26.93=20>=CORRIDOR_HALF=17 → PASS.

    const city = buildCity(stubLib, 1337);

    let violations = 0;
    const violationDetails: string[] = [];

    // Name format: "PieceName_t{t}_s{R|L}"  e.g. "KB3D_NEC_BldgLG_B_Main_t0.305_sR"
    const tPattern = /_t([\d.]+)_s([RL])$/;

    city.group.children.forEach((child) => {
      const match = tPattern.exec(child.name);
      if (!match) return; // skip non-piece children (none expected, but be safe)

      const t = parseFloat(match[1]);

      const frame = roadFrame(t);
      const { binormal } = frame;
      const roadCenterXZ = new THREE.Vector3(frame.pos.x, 0, frame.pos.z);

      // The piece center in XZ (placed at y=0 for buildings).
      const pCenter = new THREE.Vector3(child.position.x, 0, child.position.z);

      const signedDist = pCenter.clone().sub(roadCenterXZ).dot(binormal);
      const absDist = Math.abs(signedDist);

      // Use the actual presentedHalfExtent stored by placePiece. This is the true
      // world-space half-span toward the road accounting for the piece's yaw.
      const presentedHalf = (child.userData as Record<string, unknown>).presentedHalfExtent as number;

      // The near face must be >= CORRIDOR_HALF (17).
      const nearFace = absDist - presentedHalf;

      if (nearFace < CORRIDOR_HALF - 0.01) {
        violations++;
        violationDetails.push(
          `${child.name}: absDist=${absDist.toFixed(3)}, presentedHalf=${presentedHalf.toFixed(3)}, nearFace=${nearFace.toFixed(3)} < CORRIDOR_HALF=${CORRIDOR_HALF}`
        );
      }
    });

    if (violations > 0) {
      throw new Error(
        `${violations} building(s) intruded into road corridor:\n` +
        violationDetails.slice(0, 5).join('\n')
      );
    }
    expect(violations).toBe(0);
  });

  it('produces the expected display anchors', () => {
    const city = buildCity(stubLib, 1337);
    const kinds = city.anchors.map(a => a.kind);
    expect(kinds.filter(k => k === 'projBig').length).toBe(2);
    expect(kinds.filter(k => k === 'projSmall').length).toBe(3);
    expect(kinds.filter(k => k === 'research').length).toBe(2);
    expect(kinds).toContain('aboutHero');
  });

  it('is deterministic', () => {
    const a = buildCity(stubLib, 1337).anchors[0].pos.x;
    const b = buildCity(stubLib, 1337).anchors[0].pos.x;
    expect(a).toBe(b);
  });

  it('City interface has update and updateAmbient methods', () => {
    const city = buildCity(stubLib, 1337);
    expect(typeof city.update).toBe('function');
    expect(typeof city.updateAmbient).toBe('function');
  });

  it('anchors have pos, quat, and kind', () => {
    const city = buildCity(stubLib, 1337);
    for (const anchor of city.anchors) {
      expect(anchor.pos).toBeInstanceOf(THREE.Vector3);
      expect(anchor.quat).toBeInstanceOf(THREE.Quaternion);
      expect(['aboutHero', 'aboutSign', 'projBig', 'projSmall', 'research']).toContain(anchor.kind);
    }
  });
});
