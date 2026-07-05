import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';

/**
 * Task 14 — night-city ground traffic. DETAIL SCALES WITH PRICE TIER.
 *
 *   cheap (buildHatchback, buildKeiVan)   — deliberately LOW detail / dim:
 *       plain body tint, dim amber halogen lights (glass shares the dim glow so
 *       the cabin reads as a faint dash smear), steel wheels, one dent, and — on
 *       the kei van — a mismatched primer door panel + roof-rack crate + mud.
 *   average (buildSedan, buildCrossover)  — MID detail:
 *       richer paint, dark-chrome beltline trim, white LED strip heads + red LED
 *       bar tail, alloy wheels, door seams, wipers, exhaust, lit plate, a reddish
 *       instrument glow bleeding through the windshield.
 *
 * Palette rule: tron-cyan is RESERVED for the biker. Cars only ever use amber /
 * magenta / moonlight / neutral tints pulled from src/theme COLORS.
 *
 * Geometry: 1 unit = 1 m. Origin at ground center, +X = forward, +Y up, ±Z the
 * lateral (track) axis. Bodies are stacked beveled box silhouettes; every static
 * part is merged into ONE mesh whose draw-call count equals the number of
 * distinct materials (contiguous same-material runs are coalesced into a single
 * group). Wheels are a single 4-instance InstancedMesh (1 draw call) spun about
 * their Z axle by update(t).
 *
 * Draw-call budgets (verified by tests):
 *   hatchback ≤ 3   kei van ≤ 4   sedan ≤ 5   crossover ≤ 5
 *
 * Each car exposes userData.headAnchor / userData.tailAnchor (Object3D at the
 * head/tail lamps) for the Task 24 light-pool system.
 */

export interface CarAsset {
  group: THREE.Group;
  /** Advance wheel spin. Angle = t · userData.speed (traffic system drives speed). */
  update(t: number): void;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface Part {
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  mat: number;
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

/** Convenience: a beveled-look box part (plain box; bevel implied by stacking). */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: number,
  rz = 0
): Part {
  return { geom: new THREE.BoxGeometry(w, h, d), matrix: xform(x, y, z, 0, 0, rz), mat };
}

/** Horizontal grille slats across the nose (reuses an existing material index). */
function grille(
  parts: Part[],
  x: number,
  y: number,
  w: number,
  slats: number,
  mat: number,
  height = 0.2
): void {
  for (let i = 0; i < slats; i++) {
    const yy = y - height / 2 + ((i + 0.5) / slats) * height;
    parts.push(box(0.05, 0.02, w, x, yy, 0, mat));
  }
}

/**
 * Merge parts into ONE geometry with exactly one material group per distinct
 * material (parts sorted by material, contiguous runs coalesced). This is what
 * keeps the draw-call count equal to the material count rather than the part
 * count — the same trick bike.ts uses.
 */
function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const sorted = [...parts].sort((a, b) => a.mat - b.mat);
  const geoms: THREE.BufferGeometry[] = [];
  const runs: Array<{ mat: number; count: number }> = [];

  for (const p of sorted) {
    let g = p.geom.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(p.matrix);
    // keep a consistent attribute set for the merge
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
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
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Shared helper: one road wheel, merged, oriented so its axle lies along +Z
 * (car wheels face ±Z) and its center is at the origin. Spun about Z by update().
 * `alloy` swaps the flat cheap hubcap for a 6-spoke rim.
 */
function makeWheel(r: number, alloy = false): THREE.BufferGeometry {
  const width = 0.2;
  const parts: Part[] = [];
  // tire (axle along Y for now; the whole geom is rotated to Z at the end)
  parts.push({ geom: new THREE.CylinderGeometry(r, r, width, alloy ? 22 : 16), matrix: xform(0, 0, 0), mat: 0 });
  // inner rim dish
  parts.push({
    geom: new THREE.CylinderGeometry(r * 0.62, r * 0.62, width * 1.04, 16),
    matrix: xform(0, 0, 0),
    mat: 0
  });
  // hub cap
  parts.push({
    geom: new THREE.CylinderGeometry(r * 0.2, r * 0.2, width * 1.08, 12),
    matrix: xform(0, 0, 0),
    mat: 0
  });
  if (alloy) {
    // 3 centered bars → 6 spokes
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      parts.push({
        geom: new THREE.BoxGeometry(r * 1.22, width * 1.06, r * 0.14),
        matrix: xform(0, 0, 0, 0, a, 0),
        mat: 0
      });
    }
  }
  const g = mergeParts(parts);
  g.rotateX(Math.PI / 2); // axle Y → Z
  return g;
}

/** Shared helper: a thin emissive light strip geometry + its material. */
function makeLightBar(
  w: number,
  color: THREE.ColorRepresentation,
  intensity: number
): { geom: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } {
  return {
    geom: new THREE.BoxGeometry(0.05, 0.11, w),
    mat: new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity
    })
  };
}

/** signalMagenta pulled toward pure red — the palette has no red token. */
function tailRed(): THREE.Color {
  const c = new THREE.Color(COLORS.signalMagenta);
  c.g *= 0.35;
  c.b *= 0.12;
  return c;
}

// ---------------------------------------------------------------------------
// Assembly (shared by all four cars)
// ---------------------------------------------------------------------------

interface CarSpec {
  parts: Part[];
  mats: THREE.Material[];
  wheelGeom: THREE.BufferGeometry;
  wheelMat: THREE.Material;
  /** [x, z] wheel centers; y is wheelR. */
  wheelPos: Array<[number, number]>;
  wheelR: number;
  headPos: THREE.Vector3;
  tailPos: THREE.Vector3;
  baseSpeed: number;
  name: string;
}

function assembleCar(spec: CarSpec): CarAsset {
  const group = new THREE.Group();
  group.name = spec.name;
  group.userData.speed = spec.baseSpeed;

  const bodyMesh = new THREE.Mesh(mergeParts(spec.parts), spec.mats);
  bodyMesh.name = 'carBody';
  group.add(bodyMesh);

  const wheels = new THREE.InstancedMesh(spec.wheelGeom, spec.wheelMat, spec.wheelPos.length);
  wheels.name = 'wheels';
  wheels.frustumCulled = false;
  group.add(wheels);

  const headAnchor = new THREE.Object3D();
  headAnchor.name = 'headAnchor';
  headAnchor.position.copy(spec.headPos);
  group.add(headAnchor);
  group.userData.headAnchor = headAnchor;

  const tailAnchor = new THREE.Object3D();
  tailAnchor.name = 'tailAnchor';
  tailAnchor.position.copy(spec.tailPos);
  group.add(tailAnchor);
  group.userData.tailAnchor = tailAnchor;

  const dummy = new THREE.Object3D();
  function update(t: number): void {
    const speed = (group.userData.speed as number) ?? spec.baseSpeed;
    const ang = t * speed;
    for (let i = 0; i < spec.wheelPos.length; i++) {
      dummy.position.set(spec.wheelPos[i][0], spec.wheelR, spec.wheelPos[i][1]);
      dummy.rotation.set(0, 0, ang);
      dummy.updateMatrix();
      wheels.setMatrixAt(i, dummy.matrix);
    }
    wheels.instanceMatrix.needsUpdate = true;
  }
  // Seed instance matrices so the viewer's pre-update bounding box is correct.
  update(0);

  return { group, update };
}

// ---------------------------------------------------------------------------
// Palette helpers
// ---------------------------------------------------------------------------

const C = (n: number) => new THREE.Color(n);

/** Dim, low-sat cheap-car body tints (neutral / beige / faded). */
function cheapTint(rng: Rng): THREE.Color {
  const options = [
    C(COLORS.void).lerp(C(COLORS.moonlight), 0.34), // dirty gray
    C(COLORS.moonlight).lerp(C(COLORS.sodiumAmber), 0.28).multiplyScalar(0.5), // faded beige
    C(COLORS.shadowBlue).lerp(C(COLORS.moonlight), 0.22), // washed blue-gray
    C(COLORS.void).lerp(C(COLORS.signalMagenta), 0.12).multiplyScalar(0.7) // grimy maroon
  ];
  return rng.pick(options);
}

/** Richer average-car body tints. */
function avgTint(rng: Rng): THREE.Color {
  const options = [
    C(COLORS.moonlight).multiplyScalar(0.82), // pearl white
    C(COLORS.shadowBlue).lerp(C(COLORS.moonlight), 0.12), // deep navy
    C(COLORS.signalMagenta).multiplyScalar(0.4), // maroon
    C(COLORS.sodiumAmber).multiplyScalar(0.45), // bronze
    C(COLORS.void).lerp(C(COLORS.moonlight), 0.18) // graphite
  ];
  return rng.pick(options);
}

// ---------------------------------------------------------------------------
// CHEAP TIER
// ---------------------------------------------------------------------------

// material indices: 0 paint, 1 glow(dim glass+lamps), 2 panel(primer, van only)
const CHEAP = { paint: 0, glow: 1, panel: 2 } as const;

function cheapMaterials(rng: Rng): THREE.Material[] {
  const paint = new THREE.MeshStandardMaterial({
    color: cheapTint(rng),
    metalness: 0.18,
    roughness: 0.72
  });
  // Dim glow shared by grimy glass + weak halogen lamps: the cabin reads as a
  // faint amber dash smear, the round headlamps as tired incandescent bulbs.
  const glow = new THREE.MeshStandardMaterial({
    color: 0x08090b,
    emissive: C(COLORS.sodiumAmber),
    emissiveIntensity: 0.16,
    metalness: 0.1,
    roughness: 0.55
  });
  const panel = new THREE.MeshStandardMaterial({
    color: C(COLORS.void).lerp(C(COLORS.moonlight), 0.26), // grey primer
    metalness: 0.05,
    roughness: 0.95
  });
  return [paint, glow, panel];
}

export function buildHatchback(rng: Rng): CarAsset {
  const P = CHEAP;
  const parts: Part[] = [];
  const W = 1.6;

  // 2-box silhouette: lower body slab + hood, then a tall greenhouse box.
  parts.push(box(3.5, 0.5, W, 0.0, 0.5, 0, P.paint)); // lower body
  parts.push(box(1.4, 0.34, W - 0.06, 1.05, 0.78, 0, P.paint)); // hood
  parts.push(box(1.9, 0.5, W - 0.08, -0.35, 1.06, 0, P.paint)); // cabin/greenhouse
  parts.push(box(0.55, 0.44, W - 0.1, -1.4, 0.95, 0, P.paint)); // stubby hatch tail

  // window band — dim glossy inset, narrower than the cabin so it sits recessed
  parts.push(box(1.55, 0.3, W - 0.12, -0.35, 1.09, 0, P.glow));
  // windshield + hatch glass (raked), inset
  parts.push(box(0.05, 0.4, W - 0.2, 0.62, 1.05, 0, P.glow, -0.62));
  parts.push(box(0.05, 0.38, W - 0.2, -1.28, 1.02, 0, P.glow, 0.7));

  // dim round headlamps (2) + weak tail lamps (2)
  for (const z of [1, -1]) {
    parts.push({ geom: new THREE.SphereGeometry(0.14, 12, 8), matrix: xform(1.74, 0.62, z * 0.5), mat: P.glow });
    parts.push(box(0.06, 0.16, 0.22, -1.66, 0.72, z * 0.55, P.glow));
  }

  // front grille slats (dark recess, faint amber cast) + stubby roof antenna
  grille(parts, 1.78, 0.44, W - 0.5, 4, P.glow, 0.18);
  parts.push({
    geom: new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6),
    matrix: xform(-1.0, 1.5, 0.5),
    mat: P.paint
  });

  // bumpers (body-colored, cheap) — front & rear
  parts.push(box(0.24, 0.24, W, 1.72, 0.4, 0, P.paint));
  parts.push(box(0.22, 0.24, W, -1.66, 0.42, 0, P.paint));

  // side mirrors
  for (const z of [1, -1]) {
    parts.push(box(0.14, 0.1, 0.06, 0.5, 1.02, z * (W / 2 + 0.04), P.paint));
  }

  // one dent — an inset darker panel patch on a rear door (rng-placed side)
  const dside = rng.chance(0.5) ? 1 : -1;
  parts.push(box(0.5, 0.28, 0.04, -0.55, 0.6, dside * (W / 2 + 0.01), P.glow, rng.range(-0.12, 0.12)));

  // mudflaps behind the rear wheels (body-colored, cheap)
  for (const z of [1, -1]) parts.push(box(0.06, 0.2, 0.28, -1.42, 0.28, z * (W / 2 - 0.02), P.paint));

  const wheelR = 0.32;
  return assembleCar({
    name: 'hatchback',
    parts,
    mats: cheapMaterials(rng),
    wheelGeom: makeWheel(wheelR, false),
    wheelMat: new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.55, roughness: 0.5 }),
    wheelPos: [
      [1.15, 0.78],
      [1.15, -0.78],
      [-1.15, 0.78],
      [-1.15, -0.78]
    ],
    wheelR,
    headPos: new THREE.Vector3(1.78, 0.62, 0),
    tailPos: new THREE.Vector3(-1.7, 0.72, 0),
    baseSpeed: 9
  });
}

export function buildKeiVan(rng: Rng): CarAsset {
  const P = CHEAP;
  const parts: Part[] = [];
  const W = 1.46;

  // tall single-box body, flat cab-forward face
  parts.push(box(3.0, 1.4, W, -0.1, 0.95, 0, P.paint)); // main box
  parts.push(box(0.28, 1.2, W, 1.5, 0.9, 0, P.paint)); // flat nose face

  // near-vertical windshield + side window band (dim glass, inset high on the box)
  parts.push(box(0.06, 0.6, W - 0.16, 1.36, 1.34, 0, P.glow, -0.28));
  parts.push(box(2.1, 0.36, W - 0.1, -0.2, 1.46, 0, P.glow));

  // sliding-door groove: a thin recessed dark line down each flank
  for (const z of [1, -1]) {
    parts.push(box(0.04, 0.9, 0.05, -0.1, 0.9, z * (W / 2 + 0.005), P.panel));
    // door handle stub
    parts.push(box(0.16, 0.05, 0.04, -0.55, 1.05, z * (W / 2 + 0.02), P.panel));
    // mudflap behind the rear wheel
    parts.push(box(0.06, 0.24, 0.34, -1.42, 0.28, z * (W / 2 - 0.02), P.panel));
  }

  // mismatched primer door panel (signature cheap detail) — one side
  const pside = rng.chance(0.5) ? 1 : -1;
  parts.push(box(0.95, 0.85, 0.05, 0.35, 0.85, pside * (W / 2 + 0.008), P.panel));

  // roof rack + strapped crate
  for (const x of [0.6, -0.7]) parts.push(box(0.06, 0.06, W - 0.05, x, 1.68, 0, P.panel));
  parts.push(box(0.7, 0.34, W - 0.35, 0.0, 1.85, 0, P.paint)); // crate body
  parts.push(box(0.74, 0.05, 0.08, 0.0, 1.86, 0, P.panel)); // strap over crate

  // dim square headlamps (flat face) + tail lamps
  for (const z of [1, -1]) {
    parts.push(box(0.06, 0.2, 0.22, 1.64, 0.72, z * 0.5, P.glow));
    parts.push(box(0.06, 0.28, 0.18, -1.68, 0.95, z * 0.5, P.glow));
  }

  // bumpers
  parts.push(box(0.2, 0.22, W, 1.66, 0.42, 0, P.paint));
  parts.push(box(0.2, 0.22, W, -1.62, 0.44, 0, P.paint));

  // mirrors (bug-eye, stalked)
  for (const z of [1, -1]) {
    parts.push(box(0.1, 0.14, 0.09, 1.35, 1.2, z * (W / 2 + 0.12), P.paint));
  }

  // mud splatter — low dark patches near the wheel arches
  for (let i = 0; i < 4; i++) {
    const z = rng.chance(0.5) ? 1 : -1;
    parts.push(box(rng.range(0.3, 0.6), 0.22, 0.04, rng.range(-1.1, 1.1), 0.4, z * (W / 2 + 0.006), P.panel));
  }

  // front grille slats on the flat face + a whip antenna
  grille(parts, 1.66, 0.5, W - 0.4, 4, P.panel, 0.2);
  parts.push({
    geom: new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6),
    matrix: xform(1.3, 1.5, -0.55),
    mat: P.panel
  });

  const wheelR = 0.3;
  return assembleCar({
    name: 'keiVan',
    parts,
    mats: cheapMaterials(rng),
    wheelGeom: makeWheel(wheelR, false),
    wheelMat: new THREE.MeshStandardMaterial({ color: 0x101217, metalness: 0.5, roughness: 0.55 }),
    wheelPos: [
      [1.1, 0.66],
      [1.1, -0.66],
      [-1.0, 0.66],
      [-1.0, -0.66]
    ],
    wheelR,
    headPos: new THREE.Vector3(1.68, 0.72, 0),
    tailPos: new THREE.Vector3(-1.72, 0.95, 0),
    baseSpeed: 8
  });
}

// ---------------------------------------------------------------------------
// AVERAGE TIER
// ---------------------------------------------------------------------------

// material indices: 0 paint, 1 dark(glass/trim/plastic), 2 head(white), 3 tail(red)
const AVG = { paint: 0, dark: 1, head: 2, tail: 3 } as const;

function avgMaterials(rng: Rng): THREE.Material[] {
  const paint = new THREE.MeshStandardMaterial({
    color: avgTint(rng),
    metalness: 0.55,
    roughness: 0.32
  });
  // dark glossy: glass, dark-chrome beltline, plastic cladding, bumpers, mirrors,
  // door seams, wipers, exhaust. Faint reflective sheen sells "nicer" at night.
  const dark = new THREE.MeshStandardMaterial({
    color: 0x0b0d13,
    metalness: 0.7,
    roughness: 0.28
  });
  const head = makeLightBar(1, COLORS.moonlight, 1.6).mat; // white LED
  const tail = new THREE.MeshStandardMaterial({
    color: 0x120608,
    emissive: tailRed(),
    emissiveIntensity: 1.1
  });
  return [paint, dark, head, tail];
}

/** Common average-tier greebles: seams, wipers, exhaust, lit plate, dash glow. */
function avgDetails(
  parts: Part[],
  opts: {
    W: number;
    frontX: number;
    rearX: number;
    beltY: number;
    windshieldX: number;
    windshieldY: number;
    plateY: number;
  }
): void {
  const { W, frontX, rearX, beltY, plateY } = opts;
  const D = AVG.dark;

  // door seams — thin dark vertical lines on both flanks
  for (const z of [1, -1]) {
    for (const x of [0.55, -0.15, -0.95]) {
      parts.push(box(0.03, 0.44, 0.03, x, beltY - 0.25, z * (W / 2 + 0.004), D));
    }
    // door handles
    parts.push(box(0.14, 0.04, 0.04, 0.15, beltY - 0.02, z * (W / 2 + 0.02), D));
  }

  // dark-chrome beltline trim strip running the length
  for (const z of [1, -1]) {
    parts.push(box(2.9, 0.05, 0.04, -0.1, beltY + 0.02, z * (W / 2 + 0.006), D));
  }

  // wipers on the windshield
  for (const z of [0.35, -0.2]) {
    parts.push(box(0.5, 0.02, 0.02, opts.windshieldX - 0.05, opts.windshieldY - 0.16, z, D, 0.35));
  }

  // exhaust pipe (rear, offset to one side)
  parts.push({
    geom: new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10),
    matrix: xform(rearX - 0.02, 0.34, 0.45, 0, 0, Math.PI / 2),
    mat: D
  });

  // lit license plates (front & rear) — white LED material, reads as a plate
  parts.push(box(0.04, 0.14, 0.4, frontX + 0.02, plateY, 0, AVG.head));
  parts.push(box(0.04, 0.14, 0.4, rearX - 0.02, plateY + 0.05, 0, AVG.head));

  // reddish instrument-cluster glow behind the windshield (bleeds through glass)
  parts.push(box(0.5, 0.06, W - 0.4, opts.windshieldX - 0.35, opts.windshieldY - 0.28, 0, AVG.tail));

  // rear bumper reflectors (small red squares, low on the corners)
  for (const z of [1, -1]) parts.push(box(0.04, 0.09, 0.14, rearX + 0.03, 0.36, z * (W / 2 - 0.18), AVG.tail));

  // mudflaps behind the rear wheels
  for (const z of [1, -1]) parts.push(box(0.06, 0.22, 0.3, rearX + 0.72, 0.28, z * (W / 2 - 0.02), D));

  // gloss front grille slats + roof shark-fin antenna
  grille(parts, frontX - 0.06, 0.56, W - 0.5, 5, D, 0.22);
  parts.push({
    geom: new THREE.ConeGeometry(0.05, 0.16, 4),
    matrix: xform(-1.6, opts.windshieldY + 0.32, 0, 0, Math.PI / 4, -0.5),
    mat: D
  });
}

export function buildSedan(rng: Rng): CarAsset {
  const P = AVG;
  const parts: Part[] = [];
  const W = 1.76;
  const beltY = 0.9;

  // 3-box silhouette: hood, cabin, trunk over a lower body slab.
  parts.push(box(4.3, 0.52, W, 0.0, 0.55, 0, P.paint)); // lower body
  parts.push(box(1.5, 0.32, W - 0.04, 1.35, 0.82, 0, P.paint)); // hood
  parts.push(box(2.0, 0.46, W - 0.06, -0.05, 1.06, 0, P.paint)); // cabin
  parts.push(box(1.15, 0.34, W - 0.04, -1.55, 0.85, 0, P.paint)); // trunk

  // greenhouse glass band + windshield + backlight (dark glossy inset)
  parts.push(box(1.75, 0.34, W - 0.02, -0.05, 1.12, 0, P.dark));
  parts.push(box(0.06, 0.4, W - 0.12, 0.92, 1.04, 0, P.dark, -0.62)); // windshield
  parts.push(box(0.06, 0.38, W - 0.12, -1.0, 1.02, 0, P.dark, 0.66)); // backlight

  // white LED headlight strips + red LED tail bar
  for (const z of [1, -1]) {
    parts.push(box(0.06, 0.12, 0.42, 2.13, 0.72, z * 0.6, P.head));
  }
  parts.push(box(0.05, 0.14, W - 0.24, -2.13, 0.78, 0, P.tail)); // full-width tail bar
  // white LED corner marker nubs (reuses headlight material; not amber turn signals)
  for (const z of [1, -1]) parts.push(box(0.05, 0.08, 0.12, 2.13, 0.58, z * 0.86, P.head));

  // bumpers, mirrors (dark)
  parts.push(box(0.22, 0.26, W, 2.14, 0.42, 0, P.dark));
  parts.push(box(0.22, 0.26, W, -2.12, 0.44, 0, P.dark));
  for (const z of [1, -1]) {
    parts.push(box(0.16, 0.11, 0.08, 0.62, 1.0, z * (W / 2 + 0.08), P.dark));
  }

  avgDetails(parts, {
    W,
    frontX: 2.16,
    rearX: -2.14,
    beltY,
    windshieldX: 0.92,
    windshieldY: 1.06,
    plateY: 0.5
  });

  const wheelR = 0.34;
  return assembleCar({
    name: 'sedan',
    parts,
    mats: avgMaterials(rng),
    wheelGeom: makeWheel(wheelR, true),
    wheelMat: new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.85, roughness: 0.3 }),
    wheelPos: [
      [1.4, 0.82],
      [1.4, -0.82],
      [-1.45, 0.82],
      [-1.45, -0.82]
    ],
    wheelR,
    headPos: new THREE.Vector3(2.18, 0.72, 0),
    tailPos: new THREE.Vector3(-2.16, 0.78, 0),
    baseSpeed: 10
  });
}

export function buildCrossover(rng: Rng): CarAsset {
  const P = AVG;
  const parts: Part[] = [];
  const W = 1.84;
  const beltY = 1.0;

  // taller wagon: lower body + long roofline extending to the rear
  parts.push(box(4.2, 0.62, W, 0.0, 0.62, 0, P.paint)); // lower body
  parts.push(box(1.35, 0.36, W - 0.04, 1.4, 0.94, 0, P.paint)); // hood
  parts.push(box(2.7, 0.52, W - 0.06, -0.35, 1.2, 0, P.paint)); // long wagon cabin
  parts.push(box(0.35, 0.5, W - 0.06, -1.85, 1.15, 0, P.paint)); // near-vertical tailgate

  // plastic cladding — darker lower band + wheel-arch flares (rugged look)
  for (const z of [1, -1]) {
    parts.push(box(4.2, 0.2, 0.03, 0.0, 0.4, z * (W / 2 + 0.006), P.dark));
    for (const x of [1.3, -1.3]) {
      parts.push({
        geom: new THREE.TorusGeometry(0.42, 0.06, 6, 16, Math.PI),
        matrix: xform(x, 0.5, z * (W / 2 - 0.02), 0, Math.PI / 2, 0),
        mat: P.dark
      });
    }
  }

  // roof rails
  for (const z of [1, -1]) {
    parts.push(box(2.4, 0.05, 0.05, -0.35, 1.49, z * (W / 2 - 0.12), P.dark));
    for (const x of [0.7, -1.4]) parts.push(box(0.05, 0.06, 0.05, x, 1.46, z * (W / 2 - 0.12), P.dark));
  }

  // greenhouse glass + windshield + tailgate glass
  parts.push(box(2.4, 0.4, W - 0.02, -0.35, 1.26, 0, P.dark));
  parts.push(box(0.06, 0.44, W - 0.12, 0.86, 1.16, 0, P.dark, -0.55)); // windshield
  parts.push(box(0.06, 0.44, W - 0.12, -1.82, 1.2, 0, P.dark, 0.2)); // tailgate glass

  // white LED heads + fog lamps (low) + red tail bars
  for (const z of [1, -1]) {
    parts.push(box(0.06, 0.14, 0.4, 2.08, 0.84, z * 0.62, P.head));
    parts.push({ geom: new THREE.SphereGeometry(0.08, 10, 8), matrix: xform(2.1, 0.42, z * 0.66), mat: P.head }); // fog lamp
    parts.push(box(0.05, 0.4, 0.1, -2.05, 0.9, z * 0.62, P.tail)); // vertical tail
  }

  // bumpers (rugged, dark), mirrors
  parts.push(box(0.26, 0.3, W, 2.08, 0.42, 0, P.dark));
  parts.push(box(0.26, 0.3, W, -2.04, 0.44, 0, P.dark));
  for (const z of [1, -1]) parts.push(box(0.16, 0.12, 0.08, 0.6, 1.12, z * (W / 2 + 0.08), P.dark));

  avgDetails(parts, {
    W,
    frontX: 2.1,
    rearX: -2.06,
    beltY,
    windshieldX: 0.86,
    windshieldY: 1.2,
    plateY: 0.5
  });

  const wheelR = 0.37;
  return assembleCar({
    name: 'crossover',
    parts,
    mats: avgMaterials(rng),
    wheelGeom: makeWheel(wheelR, true),
    wheelMat: new THREE.MeshStandardMaterial({ color: 0x24272f, metalness: 0.8, roughness: 0.34 }),
    wheelPos: [
      [1.35, 0.84],
      [1.35, -0.84],
      [-1.4, 0.84],
      [-1.4, -0.84]
    ],
    wheelR,
    headPos: new THREE.Vector3(2.12, 0.84, 0),
    tailPos: new THREE.Vector3(-2.08, 0.9, 0),
    baseSpeed: 9
  });
}
