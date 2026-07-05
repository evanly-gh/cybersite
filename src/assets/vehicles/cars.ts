import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { makeCanvasTexture } from '../../utils/canvasText';

/**
 * Task 15 — luxury cars: Lamborghini-wedge + long GT coupe.
 * Forward = +X, up = +Y, +Z = car's right. Origin at ground center.
 *
 * Palette rule: tron-cyan is RESERVED for the biker (src/assets/vehicles/bike.ts).
 * These cars glow magenta/teal/amber only — never cyan.
 *
 * Contract mirrors Task 14's simple cars: `{ group; update(t) }`, wheels spin as a
 * function of `t` (driven by the traffic system / viewer `?t=`), userData exposes
 * `headAnchor` / `tailAnchor` for headlight/taillight light-pool projection.
 */

export interface CarAsset {
  group: THREE.Group;
  update: (t: number) => void;
}

// ---------------------------------------------------------------------------
// Shared small helpers (local copies — this module has no shared-file deps)
// ---------------------------------------------------------------------------

interface Part {
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  mat: number;
}

function xform(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
}

/** Merge parts into one geometry, one contiguous material group per material index. */
function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const sorted = [...parts].sort((a, b) => a.mat - b.mat);
  const geoms: THREE.BufferGeometry[] = [];
  const runs: Array<{ mat: number; count: number }> = [];

  for (const p of sorted) {
    let g = p.geom.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(p.matrix);
    const n = g.getAttribute('position').count;
    geoms.push(g);
    const last = runs[runs.length - 1];
    if (last && last.mat === p.mat) last.count += n;
    else runs.push({ mat: p.mat, count: n });
  }

  const merged = mergeGeometries(geoms);
  if (!merged) throw new Error('cars: geometry merge failed');
  merged.clearGroups();
  let start = 0;
  for (const r of runs) {
    merged.addGroup(start, r.count, r.mat);
    start += r.count;
  }
  return merged;
}

/** Thin box strip between two 2D points at a given depth (z or local axis). */
function strip(p1: [number, number], p2: [number, number], z: number, thick = 0.02, depth = 0.012): Part['geom'] {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  return new THREE.BoxGeometry(len, thick, depth);
}
function stripXform(p1: [number, number], p2: [number, number], z: number): THREE.Matrix4 {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return xform((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, z, 0, 0, Math.atan2(dy, dx));
}

/** Repeating hex-grid canvas texture (used for the intake mesh + neon flank strip). */
function makeHexTexture(hex: number): THREE.CanvasTexture {
  const c = new THREE.Color(hex);
  const css = `#${c.getHexString()}`;
  const tex = makeCanvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = css;
    ctx.lineWidth = 2;
    const r = 14;
    const hStep = r * 1.5;
    const vStep = r * Math.sqrt(3);
    for (let row = -1; row < 128 / vStep + 1; row++) {
      for (let col = -1; col < 128 / hStep + 1; col++) {
        const cx = col * hStep;
        const cy = row * vStep + (col % 2 === 0 ? 0 : vStep / 2);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = cx + r * Math.cos(a);
          const py = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Wheels — shared builder: Y-spoke (lambo) or wire-look (GT), rim-ring accent
// ---------------------------------------------------------------------------

interface WheelGeom {
  geom: THREE.BufferGeometry;
  mats: THREE.Material[];
}

function buildYSpokeWheel(r: number, spokeMat: THREE.Material, ringMat: THREE.Material): WheelGeom {
  const parts: Part[] = [];
  // hub disc
  parts.push({ geom: new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.5, 12), matrix: xform(0, 0, 0, Math.PI / 2, 0, 0), mat: 0 });
  // Y-spokes ×3, tripled for a 6-spoke look
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    for (const off of [-0.35, 0.35]) {
      parts.push({
        geom: new THREE.BoxGeometry(r * 1.05, r * 0.16, r * 0.22),
        matrix: xform(0, 0, 0, 0, 0, a + off).multiply(xform(r * 0.5, 0, 0)),
        mat: 0
      });
    }
  }
  // outer rim (metal)
  parts.push({ geom: new THREE.TorusGeometry(r * 0.92, r * 0.1, 8, 24), matrix: xform(0, 0, 0), mat: 0 });
  // teal rim ring accent (thin, proud of the rim — dimmer than the bike's cyan)
  parts.push({ geom: new THREE.TorusGeometry(r * 0.78, r * 0.035, 6, 24), matrix: xform(0, 0, 0), mat: 1 });
  return { geom: mergeParts(parts), mats: [spokeMat, ringMat] };
}

function buildWireWheel(r: number, spokeMat: THREE.Material, hubMat: THREE.Material): WheelGeom {
  const parts: Part[] = [];
  parts.push({ geom: new THREE.CylinderGeometry(r * 0.16, r * 0.16, r * 0.5, 10), matrix: xform(0, 0, 0, Math.PI / 2, 0, 0), mat: 1 });
  const nSpokes = 16;
  for (let i = 0; i < nSpokes; i++) {
    const a = (i / nSpokes) * Math.PI * 2;
    parts.push({
      geom: new THREE.CylinderGeometry(r * 0.012, r * 0.012, r * 0.9, 4),
      matrix: xform(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, 0, 0, 0, a + Math.PI / 2),
      mat: 0
    });
  }
  parts.push({ geom: new THREE.TorusGeometry(r * 0.95, r * 0.05, 8, 24), matrix: xform(0, 0, 0), mat: 0 });
  return { geom: mergeParts(parts), mats: [spokeMat, hubMat] };
}

/** Builds an InstancedMesh (4 wheels) at explicit corner positions — 1 draw call per material group. */
function buildWheelSetAt(wg: WheelGeom, wheelPositions: THREE.Vector3[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(wg.geom, wg.mats, 4);
  mesh.name = 'wheelSet';
  const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const m = new THREE.Matrix4();
  wheelPositions.forEach((p, i) => {
    m.compose(p, base, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function spinWheelSet(mesh: THREE.InstancedMesh, positions: THREE.Vector3[], angle: number): void {
  const m = new THREE.Matrix4();
  const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -angle);
  const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  positions.forEach((p, i) => {
    m.compose(p, base.clone().multiply(spin), new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

const SPIN_RATE = 9; // rad of wheel rotation per unit t (viewer ?t= sweep)

// ---------------------------------------------------------------------------
// Lambo wedge
// ---------------------------------------------------------------------------

const LAMBO_HALF_W = 0.95;
const LAMBO_WHEEL_R = 0.34;
const LAMBO_FRONT_AXLE = 1.55;
const LAMBO_REAR_AXLE = -1.4;
const LAMBO_TRACK = 0.82;

// Low wedge side profile: sharp low nose (right, +X), high fastback tail (left, -X).
const LAMBO_PROFILE: Array<[number, number]> = [
  [-2.15, 0.3],
  [-2.05, 0.62],
  [-1.55, 0.78], // trunk deck / spoiler mount
  [-0.75, 0.92], // fastback roofline
  [0.05, 0.95], // roof peak
  [0.55, 0.8], // windshield base
  [0.95, 0.62], // hood cowl
  [1.55, 0.42],
  [2.05, 0.28],
  [2.2, 0.16], // sharp nose tip
  [2.05, 0.08],
  [1.5, 0.06],
  [-1.9, 0.06] // flat belly
];

// Top edge (tail → nose) traced by the animated neon accent — this is what makes the
// wedge silhouette read clearly even under the viewer's low ambient lighting.
const LAMBO_TOP_EDGE: Array<[number, number]> = [
  [-2.05, 0.62],
  [-1.55, 0.78],
  [-0.75, 0.92],
  [0.05, 0.95],
  [0.55, 0.8],
  [0.95, 0.62],
  [1.55, 0.42],
  [2.05, 0.28]
];

const LM = { paint: 0, blade: 1, underglow: 2, glass: 3, detail: 4 } as const;

function buildLamboStatic(rng: Rng, underglowIsTeal: boolean): Part[] {
  const parts: Part[] = [];

  // --- main wedge body: extruded side profile ---
  const shape = new THREE.Shape(LAMBO_PROFILE.map(([x, y]) => new THREE.Vector2(x, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: LAMBO_HALF_W * 2, bevelEnabled: false });
  parts.push({ geom: body, matrix: xform(0, 0, -LAMBO_HALF_W), mat: LM.paint });

  // --- scissor-door seam lines (both flanks) ---
  for (const z of [1, -1]) {
    const seamZ = z * (LAMBO_HALF_W + 0.003);
    for (const [p1, p2] of [
      [[-0.75, 0.9] as [number, number], [-0.7, 0.1] as [number, number]],
      [[0.55, 0.78] as [number, number], [0.5, 0.1] as [number, number]],
      [[-0.7, 0.1] as [number, number], [0.5, 0.1] as [number, number]]
    ]) {
      parts.push({ geom: strip(p1, p2, seamZ, 0.012, 0.006), matrix: stripXform(p1, p2, seamZ), mat: LM.paint });
    }
    // door handle recess
    parts.push({ geom: new THREE.BoxGeometry(0.16, 0.03, 0.02), matrix: xform(-0.1, 0.55, seamZ), mat: LM.paint });
  }

  // --- greenhouse glass ---
  parts.push({
    geom: new THREE.BoxGeometry(1.15, 0.16, LAMBO_HALF_W * 1.9),
    matrix: xform(-0.15, 0.86, 0, 0, 0, -0.05),
    mat: LM.glass
  });

  // --- rear diffuser + spoiler ---
  parts.push({ geom: new THREE.BoxGeometry(0.55, 0.14, LAMBO_HALF_W * 1.95), matrix: xform(-2.0, 0.16, 0), mat: LM.paint });
  for (let i = 0; i < 5; i++) {
    const fz = -LAMBO_HALF_W + 0.1 + i * (LAMBO_HALF_W * 2 - 0.2) / 4;
    parts.push({ geom: new THREE.BoxGeometry(0.5, 0.05, 0.03), matrix: xform(-2.0, 0.16, fz), mat: LM.paint });
  }
  // spoiler: two struts + wing plane
  for (const z of [1, -1]) {
    parts.push({
      geom: new THREE.BoxGeometry(0.03, 0.28, 0.03),
      matrix: xform(-1.75, 1.0, z * 0.55),
      mat: LM.paint
    });
  }
  parts.push({ geom: new THREE.BoxGeometry(0.42, 0.03, LAMBO_HALF_W * 1.5), matrix: xform(-1.72, 1.14, 0), mat: LM.paint });

  // --- hex intake mesh (flank, behind door) + animated neon roofline accent trace ---
  for (const z of [1, -1]) {
    parts.push({
      geom: new THREE.PlaneGeometry(0.5, 0.3),
      matrix: xform(-1.15, 0.5, z * (LAMBO_HALF_W + 0.004), 0, z > 0 ? Math.PI / 2 : -Math.PI / 2, 0),
      mat: LM.detail
    });
    parts.push({
      geom: new THREE.PlaneGeometry(2.6, 0.05),
      matrix: xform(0.0, 0.42, z * (LAMBO_HALF_W + 0.005), 0, z > 0 ? Math.PI / 2 : -Math.PI / 2, 0),
      mat: LM.detail
    });
    // roofline neon trace — outlines the wedge silhouette top edge, both flanks
    const edgeZ = z * (LAMBO_HALF_W + 0.006);
    for (let i = 0; i < LAMBO_TOP_EDGE.length - 1; i++) {
      parts.push({
        geom: strip(LAMBO_TOP_EDGE[i], LAMBO_TOP_EDGE[i + 1], edgeZ, 0.02),
        matrix: stripXform(LAMBO_TOP_EDGE[i], LAMBO_TOP_EDGE[i + 1], edgeZ),
        mat: LM.detail
      });
    }
  }

  // --- full-width light blades, front + rear (thin magenta strips) ---
  parts.push({ geom: new THREE.BoxGeometry(0.05, 0.05, LAMBO_HALF_W * 1.9), matrix: xform(2.16, 0.2, 0), mat: LM.blade });
  parts.push({ geom: new THREE.BoxGeometry(0.05, 0.06, LAMBO_HALF_W * 1.95), matrix: xform(-2.14, 0.5, 0), mat: LM.blade });
  // twin exhaust glow (rear underside, reuses blade material — no extra draw call)
  for (const z of [1, -1]) {
    parts.push({
      geom: new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12),
      matrix: xform(-2.12, 0.13, z * 0.28, Math.PI / 2, 0, 0),
      mat: LM.blade
    });
  }

  // --- underglow (additive plane, rng magenta/teal) ---
  parts.push({
    geom: new THREE.PlaneGeometry(4.1, LAMBO_HALF_W * 2.1),
    matrix: xform(0, 0.03, 0, -Math.PI / 2, 0, 0),
    mat: LM.underglow
  });

  // --- badge glyph (rear, small chevron of paint-colored blocks) ---
  for (let i = 0; i < 3; i++) {
    parts.push({
      geom: new THREE.BoxGeometry(0.02, 0.02, 0.06),
      matrix: xform(-2.06, 0.55 + i * 0.025, 0.06 - i * 0.06),
      mat: LM.paint
    });
  }

  // --- greeble (rng-varied vents) ---
  const nVents = rng.int(2, 4);
  for (let i = 0; i < nVents; i++) {
    for (const z of [1, -1]) {
      parts.push({
        geom: new THREE.BoxGeometry(rng.range(0.08, 0.16), 0.02, 0.015),
        matrix: xform(rng.range(0.8, 1.6), 0.36, z * (LAMBO_HALF_W + 0.003), 0, 0, rng.range(-0.1, 0.1)),
        mat: LM.paint
      });
    }
  }

  void underglowIsTeal; // color choice handled by the material, not geometry
  return parts;
}

export function buildLamboWedge(rng: Rng): CarAsset {
  const underglowTeal = rng.chance(0.5);
  // Moderate metalness/roughness so the hemisphere + key light still put a visible
  // diffuse fill on the paint — full mirror-metal reads as pure black with no env map.
  const paintColor = new THREE.Color(COLORS.towerBody).lerp(new THREE.Color(COLORS.nightHaze), 0.45);
  const paintMat = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.4, roughness: 0.45 });
  const magenta = new THREE.Color(COLORS.signalMagenta);
  const teal = new THREE.Color(COLORS.holoTeal);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0a0006, emissive: magenta, emissiveIntensity: 1.4 });
  const underglowColor = underglowTeal ? teal : magenta;
  const underglowMat = new THREE.MeshBasicMaterial({
    color: underglowColor,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  // roughness kept moderate — a mirror-smooth glass dome/windshield creates a
  // directional-light specular hotspot that blows past the bloom threshold into a
  // giant blown-out orb at this asset's viewing distance.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x060a12, metalness: 0.3, roughness: 0.35, transparent: true, opacity: 0.85 });
  const hexTex = makeHexTexture(underglowTeal ? COLORS.holoTeal : COLORS.signalMagenta);
  const detailMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: underglowColor,
    emissiveMap: hexTex,
    emissiveIntensity: 1.1,
    map: hexTex
  });

  const staticGeom = mergeParts(buildLamboStatic(rng, underglowTeal));
  const mats: THREE.Material[] = [];
  mats[LM.paint] = paintMat;
  mats[LM.blade] = bladeMat;
  mats[LM.underglow] = underglowMat;
  mats[LM.glass] = glassMat;
  mats[LM.detail] = detailMat;
  const staticMesh = new THREE.Mesh(staticGeom, mats);
  staticMesh.name = 'lamboStatic';

  const group = new THREE.Group();
  group.name = 'lamboWedge';
  group.add(staticMesh);

  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.85, roughness: 0.3 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x021014, emissive: teal, emissiveIntensity: 0.9 });
  const wheelGeom = buildYSpokeWheel(LAMBO_WHEEL_R, spokeMat, ringMat);
  const wheelPositions = [
    new THREE.Vector3(LAMBO_FRONT_AXLE, LAMBO_WHEEL_R, LAMBO_TRACK),
    new THREE.Vector3(LAMBO_FRONT_AXLE, LAMBO_WHEEL_R, -LAMBO_TRACK),
    new THREE.Vector3(LAMBO_REAR_AXLE, LAMBO_WHEEL_R, LAMBO_TRACK),
    new THREE.Vector3(LAMBO_REAR_AXLE, LAMBO_WHEEL_R, -LAMBO_TRACK)
  ];
  const wheelMesh = buildWheelSetAt(wheelGeom, wheelPositions);
  group.add(wheelMesh);

  const headAnchor = new THREE.Object3D();
  headAnchor.name = 'headAnchor';
  headAnchor.position.set(2.2, 0.2, 0);
  group.add(headAnchor);
  group.userData.headAnchor = headAnchor;

  const tailAnchor = new THREE.Object3D();
  tailAnchor.name = 'tailAnchor';
  tailAnchor.position.set(-2.14, 0.5, 0);
  group.add(tailAnchor);
  group.userData.tailAnchor = tailAnchor;

  function update(t: number): void {
    spinWheelSet(wheelMesh, wheelPositions, t * SPIN_RATE);
    if (detailMat.map) detailMat.map.offset.x = (t * 0.35) % 1;
  }
  update(0);

  return { group, update };
}

// ---------------------------------------------------------------------------
// GT coupe
// ---------------------------------------------------------------------------

const GT_HALF_W = 0.92;
const GT_WHEEL_R = 0.36;
const GT_FRONT_AXLE = 1.7;
const GT_REAR_AXLE = -1.55;
const GT_TRACK = 0.8;

// Long-hood 2-door: gentle nose, low fastback cabin set well aft.
const GT_PROFILE: Array<[number, number]> = [
  [-2.3, 0.3],
  [-2.2, 0.68],
  [-1.5, 0.86],
  [-0.5, 0.98], // cabin roof
  [0.1, 0.96],
  [0.55, 0.72], // windshield base — long hood ahead
  [2.15, 0.5],
  [2.4, 0.32],
  [2.25, 0.1],
  [-2.05, 0.06]
];

const GM = { paint: 0, glow: 1, chrome: 2, glass: 3, caliper: 4 } as const;

function buildGTStatic(rng: Rng): Part[] {
  const parts: Part[] = [];

  const shape = new THREE.Shape(GT_PROFILE.map(([x, y]) => new THREE.Vector2(x, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: GT_HALF_W * 2, bevelEnabled: false });
  parts.push({ geom: body, matrix: xform(0, 0, -GT_HALF_W), mat: GM.paint });

  // chrome beltline + roofline trim (both flanks) — traces the silhouette so the
  // long-hood profile reads clearly even under the viewer's low ambient lighting.
  for (const z of [1, -1]) {
    const zz = z * (GT_HALF_W + 0.004);
    parts.push({
      geom: strip([-2.2, 0.62], [2.05, 0.48], zz, 0.02, 0.008),
      matrix: stripXform([-2.2, 0.62], [2.05, 0.48], zz),
      mat: GM.chrome
    });
    for (const [p1, p2] of [
      [[-2.2, 0.68] as [number, number], [-0.5, 0.98] as [number, number]],
      [[-0.5, 0.98] as [number, number], [0.55, 0.72] as [number, number]],
      [[0.55, 0.72] as [number, number], [2.15, 0.5] as [number, number]]
    ]) {
      parts.push({ geom: strip(p1, p2, zz, 0.018, 0.008), matrix: stripXform(p1, p2, zz), mat: GM.chrome });
    }
    // door handle + mirror
    parts.push({ geom: new THREE.BoxGeometry(0.14, 0.025, 0.02), matrix: xform(-0.3, 0.6, zz), mat: GM.chrome });
    parts.push({ geom: new THREE.BoxGeometry(0.06, 0.05, 0.09), matrix: xform(0.6, 0.85, z * (GT_HALF_W + 0.03)), mat: GM.paint });
  }

  // windshield + side glass
  parts.push({ geom: new THREE.BoxGeometry(1.3, 0.2, GT_HALF_W * 1.85), matrix: xform(-0.3, 0.92, 0), mat: GM.glass });

  // full-width amber light-bar tail
  parts.push({ geom: new THREE.BoxGeometry(0.06, 0.08, GT_HALF_W * 1.95), matrix: xform(-2.22, 0.55, 0), mat: GM.glow });
  // pop-up style front lights (paired raised housings)
  for (const z of [1, -1]) {
    parts.push({ geom: new THREE.BoxGeometry(0.14, 0.1, 0.16), matrix: xform(2.05, 0.48, z * 0.45), mat: GM.paint });
    parts.push({ geom: new THREE.BoxGeometry(0.02, 0.07, 0.13), matrix: xform(2.13, 0.48, z * 0.45), mat: GM.glow });
  }

  // brake calipers glowing through wire wheels (amber, iteration detail)
  for (const ax of [GT_FRONT_AXLE, GT_REAR_AXLE]) {
    for (const z of [1, -1]) {
      parts.push({
        geom: new THREE.BoxGeometry(0.1, 0.14, 0.06),
        matrix: xform(ax, GT_WHEEL_R, z * GT_TRACK, 0, 0, 0),
        mat: GM.caliper
      });
    }
  }

  // carbon splitter (front, subtle dark lip — iteration detail)
  parts.push({ geom: new THREE.BoxGeometry(0.5, 0.03, GT_HALF_W * 1.9), matrix: xform(2.05, 0.09, 0), mat: GM.chrome });

  // rng greeble: hood vents
  const nVents = rng.int(1, 3);
  for (let i = 0; i < nVents; i++) {
    parts.push({
      geom: new THREE.BoxGeometry(rng.range(0.1, 0.2), 0.015, 0.06),
      matrix: xform(rng.range(0.8, 1.8), 0.75, 0, 0, 0, 0),
      mat: GM.chrome
    });
  }

  return parts;
}

export function buildGTCoupe(rng: Rng): CarAsset {
  // Brief-specified clearcoat: metalness 0.6 / roughness 0.15. Silhouette legibility
  // comes from the chrome beltline+roofline trace above, not from softening this.
  const paintColor = new THREE.Color(COLORS.shadowBlue).lerp(new THREE.Color(COLORS.void), 0.15);
  const paintMat = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.6, roughness: 0.15 });
  const amber = new THREE.Color(COLORS.sodiumAmber);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x0a0602, emissive: amber, emissiveIntensity: 1.3 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 1.0, roughness: 0.08 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x080c14, metalness: 0.3, roughness: 0.35, transparent: true, opacity: 0.82 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0x0a0602, emissive: amber, emissiveIntensity: 0.9 });

  const staticGeom = mergeParts(buildGTStatic(rng));
  const mats: THREE.Material[] = [];
  mats[GM.paint] = paintMat;
  mats[GM.glow] = glowMat;
  mats[GM.chrome] = chromeMat;
  mats[GM.glass] = glassMat;
  mats[GM.caliper] = caliperMat;
  const staticMesh = new THREE.Mesh(staticGeom, mats);
  staticMesh.name = 'gtStatic';

  const group = new THREE.Group();
  group.name = 'gtCoupe';
  group.add(staticMesh);

  const spokeMat = chromeMat;
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.3 });
  const wheelGeom = buildWireWheel(GT_WHEEL_R, spokeMat, hubMat);
  const wheelPositions = [
    new THREE.Vector3(GT_FRONT_AXLE, GT_WHEEL_R, GT_TRACK),
    new THREE.Vector3(GT_FRONT_AXLE, GT_WHEEL_R, -GT_TRACK),
    new THREE.Vector3(GT_REAR_AXLE, GT_WHEEL_R, GT_TRACK),
    new THREE.Vector3(GT_REAR_AXLE, GT_WHEEL_R, -GT_TRACK)
  ];
  const wheelMesh = buildWheelSetAt(wheelGeom, wheelPositions);
  group.add(wheelMesh);

  const headAnchor = new THREE.Object3D();
  headAnchor.name = 'headAnchor';
  headAnchor.position.set(2.25, 0.48, 0);
  group.add(headAnchor);
  group.userData.headAnchor = headAnchor;

  const tailAnchor = new THREE.Object3D();
  tailAnchor.name = 'tailAnchor';
  tailAnchor.position.set(-2.22, 0.55, 0);
  group.add(tailAnchor);
  group.userData.tailAnchor = tailAnchor;

  function update(t: number): void {
    spinWheelSet(wheelMesh, wheelPositions, t * SPIN_RATE);
  }
  update(0);

  return { group, update };
}
