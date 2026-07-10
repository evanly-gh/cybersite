import * as THREE from 'three';
import { makeRng, type Rng } from '../utils/rng';
import { WAYPOINTS } from './route';
import { buildTallStepped, buildTallSlab } from '../assets/buildings/tall';
import { buildMonolith } from '../assets/buildings/special';
import { buildApartment, buildOfficeHolo, buildParking } from '../assets/buildings/medium';
import { buildStorefrontRow, buildFancyRestaurant, buildRamenShop, buildBar } from '../assets/buildings/short';
import { buildRadioMast, buildMonument } from '../assets/buildings/skinny';
import { decorateRoof } from '../assets/buildings/rooftop';
import { buildBillboard, type BillboardMount } from '../assets/billboards/billboards';
import type { AdFormat } from '../content/adGenerator';
import { buildPerson, buildCrowd } from '../assets/characters/person';
import { buildDog } from '../assets/characters/dog';
import { buildCrane } from '../assets/props/crane';
import { buildMetro } from '../assets/metro/metro';
import { buildGasStation } from '../assets/props/gasStation';
import { buildPowerRun } from '../assets/props/powerlines';
import {
  buildStreetLamp,
  buildTrafficLight,
  buildSteamVent,
  buildVendingMachine,
  buildHydrant,
  buildTrashHeap
} from '../assets/props/streetProps';

/**
 * Task 20: the zoned cyberpunk city. This module is split in two halves per the brief:
 *
 *  1. Pure DATA layer (`computeCityLayout`): block rectangles + building/prop/billboard
 *     placements as plain numbers, no THREE geometry/materials/GPU. Testable in plain
 *     node (see tests/layout.test.ts).
 *  2. Mesh ASSEMBLY layer (`buildCity`): walks the layout data and instantiates real
 *     builders. Repeated "filler" buildings are built ONCE per (zone, kind, variant) as a
 *     template and then replicated across all their placements via InstancedMesh — this
 *     is what keeps the draw-call budget flat regardless of how many lots a zone has,
 *     and (since each instanced group's placements stay confined to one zone) still lets
 *     three.js's default frustum culling drop whole zones the camera isn't looking at.
 */

// ---------------------------------------------------------------------------------
// 1. Pure data layer
// ---------------------------------------------------------------------------------

export type Zone =
  | 'aboutWall'
  | 'aboutBack'
  | 'shibuya'
  | 'projectsWall'
  | 'projectsBack'
  | 'boulevard'
  | 'skywayFlank';

export interface BlockRect {
  x: number;
  z: number;
  w: number;
  d: number;
  zone: Zone;
}

export type FillerKind = 'tallStepped' | 'tallSlab' | 'apartment' | 'officeHolo' | 'parking' | 'storefrontRow';
export type LandmarkKind = 'monolith' | 'radioMast' | 'monument' | 'restaurant' | 'ramen' | 'bar';

export interface BuildingSlot {
  id: string;
  kind: FillerKind | LandmarkKind;
  x: number;
  z: number;
  rotY: number;
  w: number;
  d: number;
  zone: Zone;
  variant: number; // which pre-built template variant (fillers only)
  isFiller: boolean;
  isVenue: boolean;
  hasRoofClutter: boolean; // non-flat-roof flag for the Step-4 test
}

export interface BillboardSlot {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  format: AdFormat;
  mount: BillboardMount;
  widthM?: number;
  unique: boolean; // individually built (hero spot) vs. instanced repeat
  zone: Zone;
}

export interface LampSlot {
  x: number;
  z: number;
  rotY: number;
  zone: Zone;
}

export interface PowerRunSlot {
  from: [number, number];
  to: [number, number];
  poles: number;
}

export interface PropSlot {
  kind: 'trafficLight' | 'steamVent' | 'vendingMachine' | 'hydrant' | 'trashHeap';
  x: number;
  z: number;
  rotY: number;
}

export interface CrowdSlot {
  x: number;
  z: number;
  n: number;
  area: [number, number];
}

export interface WalkerSlot {
  x: number;
  z: number;
  rotY: number;
}

export interface DogSlot {
  x: number;
  z: number;
  rotY: number;
}

export interface CraneSlot {
  x: number;
  z: number;
  swinging: boolean;
}

export interface CityLayoutData {
  blocks: BlockRect[];
  buildings: BuildingSlot[];
  billboards: BillboardSlot[];
  lamps: LampSlot[];
  powerRuns: PowerRunSlot[];
  props: PropSlot[];
  crowds: CrowdSlot[];
  walkers: WalkerSlot[];
  dogs: DogSlot[];
  cranes: CraneSlot[];
  gasStation: { x: number; z: number };
  anchors: {
    aboutWall: Array<{ x: number; y: number; z: number; rotY: number }>;
    projectsWall: Array<{ x: number; y: number; z: number; rotY: number }>;
    researchSky: Array<{ x: number; y: number; z: number; rotY: number }>;
    introOverhead: { x: number; y: number; z: number };
  };
}

// Nominal footprints (meters) used by the planning layer AND as the placement pitch in
// the mesh-assembly layer. The real builders' rng-driven sizes vary a few % around
// these — absorbed by the block gaps below, never causing a visible clash.
export const FILLER_FOOTPRINT: Record<FillerKind, [number, number]> = {
  tallStepped: [27, 27],
  tallSlab: [40, 16],
  apartment: [22, 14],
  officeHolo: [26, 18],
  parking: [34, 22],
  storefrontRow: [32, 9]
};

const LANDMARK_FOOTPRINT: Record<LandmarkKind, [number, number]> = {
  monolith: [46, 46],
  radioMast: [28, 28],
  monument: [8, 8],
  restaurant: [14, 16],
  ramen: [9, 8],
  bar: [10, 8]
};

const GAP = 6;
const SIDEWALK_SETBACK = 11; // building near-edge distance from street centerline

// Route-derived corridor extents (kept in lockstep with world/streets.ts constants by
// comment, not import, since streets.ts doesn't export its internal PLAZA_SIZE/ABOUT_LEN).
const ABOUT_X0 = -296;
const ABOUT_X1 = 210; // stop short of the Shibuya plaza (plaza half-size 20 @ x=240)
const BLVD_X = WAYPOINTS.shibuyaCenter.x; // 240
const BLVD_Z0 = -24; // just south of the plaza
const BLVD_Z1 = WAYPOINTS.skywayStart.z; // -420
const SKYWAY_Z0 = BLVD_Z1;
const SKYWAY_Z1 = WAYPOINTS.skywayEnd.z; // -800

function rectsOverlap(a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.z - b.z) * 2 < a.d + b.d;
}

/** Sequential fill along a street wall: walks a cursor down the corridor, weight-picks a
 * filler kind per slot, and skips over any reserved (landmark/venue) rects in its path. */
function fillWall(
  rng: Rng,
  axis: 'x' | 'z',
  from: number,
  to: number,
  fixedCoord: number,
  outward: 1 | -1,
  zone: Zone,
  weights: Array<[FillerKind, number]>,
  reserved: BlockRect[],
  out: { blocks: BlockRect[]; buildings: BuildingSlot[] },
  idPrefix: string
): void {
  const dir = to >= from ? 1 : -1;
  let cursor = from;
  let i = 0;
  const totalWeight = weights.reduce((s, [, w]) => s + w, 0);

  function pickKind(): FillerKind {
    let r = rng.range(0, totalWeight);
    for (const [kind, w] of weights) {
      if (r < w) return kind;
      r -= w;
    }
    return weights[0][0];
  }

  while ((dir > 0 && cursor < to) || (dir < 0 && cursor > to)) {
    const kind = pickKind();
    const [fw, fd] = FILLER_FOOTPRINT[kind];
    // `fw` (face width) is always the extent along the sequential/pitch axis, whether
    // that's x (About street) or z (boulevard) — `fd` (depth) is always perpendicular,
    // and the building sits with its NEAR edge on `fixedCoord`, extending `outward`
    // (away from the street) by `fd` — never centered ON the sidewalk line.
    const span = fw;
    const center = cursor + (dir * span) / 2;
    const perp = fixedCoord + (outward * fd) / 2;
    const rect: BlockRect =
      axis === 'x'
        ? { x: center, z: perp, w: fw, d: fd, zone }
        : { x: perp, z: center, w: fd, d: fw, zone };

    const blocked = reserved.some((r) => rectsOverlap(rect, r));
    if (blocked) {
      // Skip past the reserved rect entirely (plus one gap) rather than placing here.
      const reservedHit = reserved.find((r) => rectsOverlap(rect, r))!;
      const reservedSpan = axis === 'x' ? reservedHit.w : reservedHit.d;
      const reservedCenter = axis === 'x' ? reservedHit.x : reservedHit.z;
      cursor = reservedCenter + (dir * reservedSpan) / 2 + dir * GAP;
      continue;
    }

    out.blocks.push(rect);
    // Draw-call budget: filler buildings are instanced GLOBALLY by (kind, variant) —
    // see buildCity — so every placement of a given kind/variant shares one InstancedMesh
    // set regardless of zone. Roof billboards are reserved for the Shibuya/hero unique
    // buildings only (a per-placement billboard variant here would multiply the instanced
    // template count); fillers always get plain roof clutter (still non-flat).
    const variant = 0;
    void rng.chance(0.7); // keep the rng stream shape stable regardless of this decision
    const rotY = zone === 'aboutWall' || zone === 'projectsWall' ? facingRotY(zone) : facingRotY(zone) + Math.PI;
    out.buildings.push({
      id: `${idPrefix}${i++}`,
      kind,
      x: rect.x,
      z: rect.z,
      rotY,
      w: rect.w,
      d: rect.d,
      zone,
      variant,
      isFiller: true,
      isVenue: false,
      hasRoofClutter: true
    });

    cursor = center + (dir * span) / 2 + dir * GAP;
  }
}

/** Outward-facing rotation (radians) for a wall zone's buildings — front face points at
 * the street the zone flanks. */
function facingRotY(zone: Zone): number {
  switch (zone) {
    case 'aboutWall':
      return Math.PI / 2; // faces +Z (toward the street/camera on the -Z side)
    case 'aboutBack':
      return -Math.PI / 2;
    case 'projectsWall':
      return Math.PI; // faces -X (toward the boulevard)
    case 'boulevard':
      return 0;
    case 'skywayFlank':
      return Math.PI / 2;
    default:
      return 0;
  }
}

export function computeCityLayout(seed: number): CityLayoutData {
  const rng = makeRng(seed);
  const blocks: BlockRect[] = [];
  const buildings: BuildingSlot[] = [];
  const billboards: BillboardSlot[] = [];
  const lamps: LampSlot[] = [];
  const powerRuns: PowerRunSlot[] = [];
  const props: PropSlot[] = [];
  const crowds: CrowdSlot[] = [];
  const walkers: WalkerSlot[] = [];
  const dogs: DogSlot[] = [];
  const cranes: CraneSlot[] = [];

  // --- reserved landmark + venue rects (placed first so fillWall routes around them) ---
  const reserved: BlockRect[] = [];
  const landmarkSlots: BuildingSlot[] = [];

  function addLandmark(kind: LandmarkKind, x: number, z: number, rotY: number, zone: Zone, id: string): void {
    const [w, d] = LANDMARK_FOOTPRINT[kind];
    const rect: BlockRect = { x, z, w, d, zone };
    reserved.push(rect);
    blocks.push(rect);
    landmarkSlots.push({
      id,
      kind,
      x,
      z,
      rotY,
      w,
      d,
      zone,
      variant: 0,
      isFiller: false,
      isVenue: kind === 'restaurant' || kind === 'ramen' || kind === 'bar',
      hasRoofClutter: kind === 'monolith' || kind === 'radioMast' || kind === 'monument'
    });
  }

  // Monolith landmark, visible down both streets.
  addLandmark('monolith', 140, -60, Math.PI / 4, 'boulevard', 'monolith');
  // Radio mast + monument along the skyway flank / About plaza.
  addLandmark('radioMast', 255, -450, 0, 'skywayFlank', 'radioMast');
  addLandmark('monument', -20, -14, Math.PI / 2, 'aboutWall', 'monument');

  // Venues clustered near the About-street midpoint.
  const aboutMid = (ABOUT_X0 + ABOUT_X1) / 2;
  addLandmark('restaurant', aboutMid - 10, -SIDEWALK_SETBACK, Math.PI / 2, 'aboutWall', 'restaurant');
  addLandmark('ramen', aboutMid + 20, SIDEWALK_SETBACK, -Math.PI / 2, 'aboutBack', 'ramen0');
  addLandmark('bar', aboutMid - 40, SIDEWALK_SETBACK, -Math.PI / 2, 'aboutBack', 'bar');
  // Ramen repeat near the gas station on the boulevard.
  addLandmark('ramen', 200, -235, Math.PI, 'projectsBack', 'ramen1');

  buildings.push(...landmarkSlots);

  const gasStation = { x: 215, z: -240 };
  reserved.push({ x: gasStation.x, z: gasStation.z, w: 22, d: 16, zone: 'boulevard' });

  cranes.push({ x: 300, z: -140, swinging: true }, { x: 170, z: -520, swinging: false });
  reserved.push({ x: 300, z: -140, w: 16, d: 16, zone: 'boulevard' });
  reserved.push({ x: 170, z: -520, w: 16, d: 16, zone: 'skywayFlank' });

  // Reserve the 4 Shibuya corner footprints up front (computed below, but geometry is
  // fixed) so the boulevard fill routes around them instead of clipping into the plaza.
  const cxEarly = WAYPOINTS.shibuyaCenter.x;
  const cornersEarly: Array<[number, number, FillerKind]> = [
    [cxEarly + 30, 30, 'officeHolo'],
    [cxEarly + 30, -30, 'storefrontRow'],
    [cxEarly - 30, 30, 'storefrontRow'],
    [cxEarly - 30, -30, 'officeHolo']
  ];
  for (const [x, z, kind] of cornersEarly) {
    const [w, d] = FILLER_FOOTPRINT[kind];
    reserved.push({ x, z, w, d, zone: 'shibuya' });
  }

  // --- filler walls ---
  // Front-wall zones (aboutWall/projectsWall) stay storefrontRow/apartment/officeHolo
  // ONLY — those need clean, low, flat-adjacent faces as Phase-5 content anchors, so no
  // added height variety there. Back zones (aboutBack/projectsBack/skywayFlank) sit
  // across the street from the anchors and never host content, so they're where the
  // skyline gets its height variety: tallStepped/tallSlab/parking are folded into their
  // weight tables below. Each added kind is still one globally-instanced template (see
  // instanceTemplate) — cheap regardless of placement count — but IS a new "always
  // drawn where visible" line item, so weights are kept modest and the draw-call budget
  // is re-audited after (Step 6 of the brief) rather than assumed safe.
  const aboutWallWeights: Array<[FillerKind, number]> = [
    ['storefrontRow', 0.4],
    ['apartment', 0.3],
    ['officeHolo', 0.3]
  ];
  const aboutBackWeights: Array<[FillerKind, number]> = [
    ['storefrontRow', 0.3],
    ['apartment', 0.4],
    ['tallStepped', 0.12],
    ['tallSlab', 0.12],
    ['parking', 0.06]
  ];
  const projectsWallWeights: Array<[FillerKind, number]> = [['officeHolo', 1]];
  const projectsBackWeights: Array<[FillerKind, number]> = [
    ['apartment', 0.35],
    ['storefrontRow', 0.35],
    ['tallStepped', 0.12],
    ['tallSlab', 0.12],
    ['parking', 0.06]
  ];
  const skywayWeights: Array<[FillerKind, number]> = [
    ['officeHolo', 0.6],
    ['tallStepped', 0.16],
    ['tallSlab', 0.16],
    ['parking', 0.08]
  ];

  fillWall(rng, 'x', ABOUT_X0, ABOUT_X1, -SIDEWALK_SETBACK, -1, 'aboutWall', aboutWallWeights, reserved, { blocks, buildings }, 'aboutWall');
  fillWall(rng, 'x', ABOUT_X0, ABOUT_X1, SIDEWALK_SETBACK, 1, 'aboutBack', aboutBackWeights, reserved, { blocks, buildings }, 'aboutBack');
  fillWall(rng, 'z', BLVD_Z0, BLVD_Z1 + 24, BLVD_X + SIDEWALK_SETBACK, 1, 'projectsWall', projectsWallWeights, reserved, { blocks, buildings }, 'projectsWall');
  fillWall(rng, 'z', BLVD_Z0, BLVD_Z1 + 24, BLVD_X - SIDEWALK_SETBACK, -1, 'boulevard', projectsBackWeights, reserved, { blocks, buildings }, 'projectsBack');
  // Skyway flank: sparse, both sides, larger pitch (footprints already sized ~34-40, gap x2).
  // Starts 12m past BLVD_Z1 (seam buffer, matching the boulevard fill's early stop above).
  fillWall(rng, 'z', SKYWAY_Z0 - 24, SKYWAY_Z1, BLVD_X + SIDEWALK_SETBACK, 1, 'skywayFlank', skywayWeights, reserved, { blocks, buildings }, 'skyR');
  fillWall(rng, 'z', SKYWAY_Z0 - 24, SKYWAY_Z1, BLVD_X - SIDEWALK_SETBACK, -1, 'skywayFlank', skywayWeights, reserved, { blocks, buildings }, 'skyL');

  // --- Shibuya corners: office w/ mega billboard + storefront row, alternating ---
  const cx = cxEarly;
  const corners: Array<[number, number, number, FillerKind]> = [
    [cxEarly + 30, 30, Math.PI + Math.PI / 4, 'officeHolo'],
    [cxEarly + 30, -30, Math.PI / 2 + Math.PI / 4, 'storefrontRow'],
    [cxEarly - 30, 30, -Math.PI / 4, 'storefrontRow'],
    [cxEarly - 30, -30, Math.PI / 4, 'officeHolo']
  ];
  corners.forEach(([x, z, rotY, kind], i) => {
    const [w, d] = FILLER_FOOTPRINT[kind];
    const rect: BlockRect = { x, z, w, d, zone: 'shibuya' };
    blocks.push(rect);
    buildings.push({
      id: `shibuya${i}`,
      kind,
      x,
      z,
      rotY,
      w,
      d,
      zone: 'shibuya',
      variant: 1, // Shibuya corners always get the roof-billboard variant (mega signage)
      isFiller: true,
      isVenue: false,
      hasRoofClutter: true
    });
  });

  // --- billboards: ~120 total. A handful of unique hero placements + many cheap repeats ---
  // Kept deliberately small (6, not ~15) — each is its own individually-built
  // buildBillboard() call at 4 draw calls apiece, so this list is a direct line item in
  // the per-viewpoint draw-call budget. The ≥100 total-billboard count is carried by the
  // cheap globally-instanced repeats below instead.
  const uniqueSpots: Array<[number, number, number, AdFormat, BillboardMount, Zone]> = [
    [aboutMid - 60, -SIDEWALK_SETBACK - 0.2, Math.PI / 2, 'landscape', 'wall', 'aboutWall'],
    [aboutMid - 20, 0, 0, 'strip', 'stand', 'aboutWall'],
    [cx, 22, 0, 'landscape', 'roof', 'shibuya'],
    [cx + 26, 26, -Math.PI / 4, 'landscape', 'wall', 'shibuya'],
    [BLVD_X + SIDEWALK_SETBACK + 0.2, -100, -Math.PI / 2, 'landscape', 'wall', 'projectsWall'],
    [BLVD_X, 0, Math.PI / 2, 'strip', 'stand', 'boulevard']
  ];
  uniqueSpots.forEach(([x, z, rotY, format, mount, zone], i) => {
    billboards.push({ id: `hero${i}`, x, y: 0, z, rotY, format, mount, unique: true, zone });
  });

  // Cheap instanced repeats: stand-mounted vcards down both About + boulevard sidewalks.
  // Only 1 format (not 3) — draw-call budget pass: fewer globally-instanced repeat
  // groups, same reasoning as the filler-kind count above.
  const repeatFormats: AdFormat[] = ['vcard'];
  let bi = 0;
  for (let x = ABOUT_X0 + 15; x < ABOUT_X1 - 15; x += 16) {
    for (const side of [-1, 1] as const) {
      billboards.push({
        id: `rep${bi++}`,
        x,
        y: 0,
        z: side * (SIDEWALK_SETBACK - 3),
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        format: repeatFormats[bi % repeatFormats.length],
        mount: 'stand',
        unique: false,
        zone: side < 0 ? 'aboutWall' : 'aboutBack'
      });
    }
  }
  for (let z = BLVD_Z0 - 15; z > SKYWAY_Z1 + 15; z -= 16) {
    for (const side of [-1, 1] as const) {
      billboards.push({
        id: `rep${bi++}`,
        x: BLVD_X + side * (SIDEWALK_SETBACK - 3),
        y: 0,
        z,
        rotY: side < 0 ? 0 : Math.PI,
        format: repeatFormats[bi % repeatFormats.length],
        mount: 'stand',
        unique: false,
        zone: side < 0 ? (z > BLVD_Z1 ? 'boulevard' : 'skywayFlank') : z > BLVD_Z1 ? 'projectsWall' : 'skywayFlank'
      });
    }
  }

  // --- powerlines: one run per street (draw-call budget pass — a second symmetric run
  // down the opposite sidewalk reads fine as "the other side just isn't wired yet") ---
  powerRuns.push(
    { from: [ABOUT_X0 + 10, -SIDEWALK_SETBACK - 1], to: [ABOUT_X1 - 10, -SIDEWALK_SETBACK - 1], poles: 12 },
    { from: [BLVD_X + SIDEWALK_SETBACK + 1, BLVD_Z0 - 10], to: [BLVD_X + SIDEWALK_SETBACK + 1, BLVD_Z1 + 10], poles: 10 }
  );

  // --- street lamps every 22m, alternating sides ---
  let side = 1;
  for (let x = ABOUT_X0 + 8; x < ABOUT_X1 - 8; x += 22) {
    lamps.push({ x, z: side * (SIDEWALK_SETBACK - 3.5), rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2, zone: 'aboutWall' });
    side *= -1;
  }
  for (let z = BLVD_Z0 - 8; z > BLVD_Z1 + 8; z -= 22) {
    lamps.push({ x: BLVD_X + side * (SIDEWALK_SETBACK - 3.5), z, rotY: side < 0 ? 0 : Math.PI, zone: 'boulevard' });
    side *= -1;
  }

  // --- traffic lights at Shibuya, steam vents, vending, hydrants, trash ---
  [
    [cx + 12, 12],
    [cx + 12, -12],
    [cx - 12, 12],
    [cx - 12, -12]
  ].forEach(([x, z], i) => props.push({ kind: 'trafficLight', x, z, rotY: (i * Math.PI) / 2 }));

  const ventSpots: Array<[number, number]> = [
    [ABOUT_X0 + 60, -SIDEWALK_SETBACK + 1],
    [aboutMid + 80, SIDEWALK_SETBACK - 1],
    [ABOUT_X1 - 40, -SIDEWALK_SETBACK + 1],
    [BLVD_X + SIDEWALK_SETBACK - 1, -80],
    [BLVD_X - SIDEWALK_SETBACK + 1, -300],
    [BLVD_X + SIDEWALK_SETBACK - 1, -400]
  ];
  ventSpots.forEach(([x, z], i) => props.push({ kind: 'steamVent', x, z, rotY: (i * Math.PI) / 3 }));

  // Draw-call budget pass: only 2 prop kinds total (steamVent above + hydrant here) —
  // vendingMachine/trashHeap positions kept for sidewalk clutter density but built as
  // hydrants instead, so they don't add 2 more always-on globally-instanced groups.
  const clutterSpots: Array<[number, number]> = [
    [ABOUT_X0 + 90, SIDEWALK_SETBACK - 1],
    [aboutMid - 90, -SIDEWALK_SETBACK + 1],
    [ABOUT_X0 + 40, -SIDEWALK_SETBACK + 1],
    [BLVD_X - SIDEWALK_SETBACK + 1, -150],
    [aboutMid + 100, SIDEWALK_SETBACK - 1],
    [BLVD_X + SIDEWALK_SETBACK - 1, -260]
  ];
  clutterSpots.forEach(([x, z]) => props.push({ kind: 'hydrant', x, z, rotY: 0 }));

  // --- life: crowds, walkers, dogs ---
  crowds.push(
    { x: cx + 15, z: 15, n: 14, area: [10, 10] },
    { x: cx + 15, z: -15, n: 14, area: [10, 10] },
    { x: cx - 15, z: 15, n: 14, area: [10, 10] },
    { x: cx - 15, z: -15, n: 14, area: [10, 10] }
  );

  // Walker/dog counts trimmed from the brief's ~20/4 during the draw-call budget pass
  // (Step 6/6): individual skinned-mesh people are cheap in isolation but the fully
  // assembled city measured far more per-person cost than an isolated viewer asset does
  // (some interaction with the composer's bloom pass at full scene complexity) — cut
  // here rather than compromise the mandatory 100%-occupancy venue seating.
  for (let i = 0; i < 5; i++) {
    walkers.push({
      x: ABOUT_X0 + 20 + i * 90,
      z: rng.pick([-SIDEWALK_SETBACK + 3.5, SIDEWALK_SETBACK - 3.5]),
      rotY: rng.pick([0, Math.PI])
    });
  }
  for (let i = 0; i < 4; i++) {
    walkers.push({
      x: BLVD_X + rng.pick([-SIDEWALK_SETBACK + 3.5, SIDEWALK_SETBACK - 3.5]),
      z: BLVD_Z0 - 20 - i * 90,
      rotY: rng.pick([Math.PI / 2, -Math.PI / 2])
    });
  }
  for (let i = 0; i < 2; i++) {
    walkers.push({ x: cx + rng.range(-15, 15), z: rng.range(-15, 15), rotY: rng.range(0, Math.PI * 2) });
  }

  for (let i = 0; i < 2; i++) {
    dogs.push({
      x: ABOUT_X0 + 80 + i * 200,
      z: rng.pick([-SIDEWALK_SETBACK + 4, SIDEWALK_SETBACK - 4]),
      rotY: rng.pick([0, Math.PI])
    });
  }

  // --- DisplayAnchors (positions only — Object3D instantiation happens in buildCity) ---
  const aboutWallAnchors = [-180, -80, 20, 120].map((x) => ({ x, y: 6, z: -SIDEWALK_SETBACK - 0.5, rotY: Math.PI / 2 }));
  const projectsWallAnchors = [-80, -180, -280, -380].map((z) => ({
    x: BLVD_X + SIDEWALK_SETBACK + 0.5,
    y: 8,
    z,
    rotY: -Math.PI / 2
  }));
  const researchSkyAnchors = [0.15, 0.4, 0.65, 0.9].map((t) => ({
    x: BLVD_X,
    y: 32,
    z: SKYWAY_Z0 + (SKYWAY_Z1 - SKYWAY_Z0) * t,
    rotY: 0
  }));
  const introOverhead = { x: WAYPOINTS.introStart.x + 20, y: 15, z: 0 };

  return {
    blocks,
    buildings,
    billboards,
    lamps,
    powerRuns,
    props,
    crowds,
    walkers,
    dogs,
    cranes,
    gasStation,
    anchors: {
      aboutWall: aboutWallAnchors,
      projectsWall: projectsWallAnchors,
      researchSky: researchSkyAnchors,
      introOverhead
    }
  };
}

// ---------------------------------------------------------------------------------
// 2. Mesh assembly layer
// ---------------------------------------------------------------------------------

export interface DisplayAnchors {
  aboutWall: THREE.Object3D[];
  projectsWall: THREE.Object3D[];
  researchSky: THREE.Object3D[];
  introOverhead: THREE.Object3D;
}

export interface City {
  group: THREE.Group;
  update(t: number): void;
  updateAmbient(sec: number): void;
  anchors: DisplayAnchors;
}

const FILLER_BUILDERS: Record<FillerKind, (rng: Rng) => THREE.Group> = {
  tallStepped: (rng) => buildTallStepped(rng),
  tallSlab: (rng) => buildTallSlab(rng),
  apartment: (rng) => buildApartment(rng),
  officeHolo: (rng) => buildOfficeHolo(rng),
  parking: (rng) => buildParking(rng),
  storefrontRow: (rng) => buildStorefrontRow(rng, 4)
};

/** Builds one filler template (building + roof clutter, optionally a roof billboard),
 * origin at ground center — ready to be replicated via `instanceTemplate`. */
function buildFillerTemplate(kind: FillerKind, rng: Rng, withRoofBillboard: boolean): THREE.Group {
  const group = FILLER_BUILDERS[kind](rng);
  const roofY = (group.userData.roofY as number) ?? 0;
  const footprint = (group.userData.footprint as [number, number]) ?? FILLER_FOOTPRINT[kind];
  const roof = decorateRoof({ y: 0, w: footprint[0], d: footprint[1] }, rng, { billboard: withRoofBillboard });
  roof.position.set(0, roofY, 0);
  group.add(roof);
  // Propagate the roof's individual fan-disc meshes up so instanceTemplate (which
  // traverses `group`, not `roof`, for its mesh list) can identify which of the
  // template's meshes need per-instance spin animation.
  if (roof.userData.fans) group.userData.fans = roof.userData.fans;
  return group;
}

const FAN_SPIN_SPEED = 2.4; // rad/sec // TUNE

/** Replicates every Mesh in `template` (in its own local/world space, with the template
 * group left at the identity transform) across `placements` as one InstancedMesh per
 * distinct mesh — draw-call cost is fixed at "meshes in the template", independent of
 * placement count. Placements confined to one zone keep the resulting InstancedMesh's
 * bounding sphere tight, so ordinary frustum culling still drops whole zones. */
function instanceTemplate(
  template: THREE.Group,
  placements: Array<{ x: number; z: number; rotY: number; y?: number }>
): THREE.Group {
  template.updateMatrixWorld(true);
  const out = new THREE.Group();
  if (placements.length === 0) return out;

  const meshes: THREE.Mesh[] = [];
  template.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.Mesh);
  });

  // Fan-disc meshes (see rooftop.ts / buildFillerTemplate) are kept as individual small
  // meshes specifically so they can spin around their own local Y — even after being
  // folded into a global InstancedMesh here, each instance's baked matrix already has
  // the fan's own hub as its local origin, so re-applying a Y-rotation on the RIGHT of
  // that baked matrix (innermost, closest to the geometry) spins each instance in place
  // around its own hub rather than around the world/building origin. Buildings only
  // ever yaw around Y too, so the fan's local Y always coincides with world Y.
  const fanSet = new Set<THREE.Mesh>((template.userData.fans as THREE.Mesh[] | undefined) ?? []);
  const spinFns: Array<(sec: number) => void> = [];

  const q = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const placementMatrix = new THREE.Matrix4();
  const finalMatrix = new THREE.Matrix4();

  for (const mesh of meshes) {
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
    inst.name = mesh.name || 'filler';
    const isFan = fanSet.has(mesh);
    const baseMatrices: THREE.Matrix4[] | undefined = isFan ? [] : undefined;
    placements.forEach((p, i) => {
      q.setFromAxisAngle(upAxis, p.rotY);
      placementMatrix.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q, new THREE.Vector3(1, 1, 1));
      finalMatrix.multiplyMatrices(placementMatrix, mesh.matrixWorld);
      baseMatrices?.push(finalMatrix.clone());
      inst.setMatrixAt(i, finalMatrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    out.add(inst);

    if (isFan && baseMatrices) {
      const spinMatrix = new THREE.Matrix4();
      const spun = new THREE.Matrix4();
      spinFns.push((sec: number) => {
        spinMatrix.makeRotationY(sec * FAN_SPIN_SPEED);
        baseMatrices.forEach((base, i) => {
          spun.multiplyMatrices(base, spinMatrix);
          inst.setMatrixAt(i, spun);
        });
        inst.instanceMatrix.needsUpdate = true;
      });
    }
  }

  if (spinFns.length > 0) {
    out.userData.spinFans = (sec: number) => {
      for (const fn of spinFns) fn(sec);
    };
  }
  return out;
}

const CITY_SEED_SALT = {
  filler: 1000,
  billboardRepeat: 5000,
  lamp: 6000,
  prop: 7000,
  crowd: 8000,
  walker: 9000,
  dog: 10000,
  powerline: 11000,
  gasStation: 12000,
  crane: 13000,
  billboardHero: 14000,
  metro: 15000
};

export function buildCity(seed: number, density = 1): City {
  const layout = computeCityLayout(seed);
  const group = new THREE.Group();
  group.name = 'city';

  const updateAmbientFns: Array<(sec: number) => void> = [];
  const updateFns: Array<(t: number) => void> = [];

  // --- filler buildings: ONE template per kind, instanced GLOBALLY across every zone's
  // placements (not per-zone) — draw-call cost is fixed at "6 kinds x ~8 meshes" no
  // matter how many lots the city has or which viewpoint the camera sits at. (An earlier
  // per-zone-instanced version measured 800+ draw calls at some viewpoints because the
  // city's L-shaped route means far-away zones can still fall inside a narrow, far-reaching
  // camera frustum — global instancing sidesteps that entirely instead of relying on
  // per-zone frustum culling that this camera geometry defeats.)
  const fillerByKind = new Map<FillerKind, BuildingSlot[]>();
  for (const b of layout.buildings) {
    if (!b.isFiller) continue;
    const kind = b.kind as FillerKind;
    if (!fillerByKind.has(kind)) fillerByKind.set(kind, []);
    fillerByKind.get(kind)!.push(b);
  }
  let templateSalt = 0;
  for (const [kind, slots] of fillerByKind) {
    const rng = makeRng(seed + CITY_SEED_SALT.filler + templateSalt++);
    const template = buildFillerTemplate(kind, rng, false);
    const instanced = instanceTemplate(
      template,
      slots.map((s) => ({ x: s.x, z: s.z, rotY: s.rotY }))
    );
    instanced.name = `filler:${kind}`;
    group.add(instanced);
    const spinFans = instanced.userData.spinFans as ((sec: number) => void) | undefined;
    if (spinFans) updateAmbientFns.push(spinFans);
  }

  // --- landmark + venue buildings: built individually, real userData used directly ---
  const venueSeatFillers: Array<() => void> = [];
  for (const b of layout.buildings) {
    if (b.isFiller) continue;
    const rng = makeRng(seed + CITY_SEED_SALT.filler + 500 + hashId(b.id));
    let bGroup: THREE.Group;
    switch (b.kind as LandmarkKind) {
      case 'monolith':
        bGroup = buildMonolith(rng);
        break;
      case 'radioMast':
        bGroup = buildRadioMast(rng);
        break;
      case 'monument':
        bGroup = buildMonument(rng);
        break;
      case 'restaurant':
        bGroup = buildFancyRestaurant(rng);
        break;
      case 'ramen':
        bGroup = buildRamenShop(rng);
        break;
      case 'bar':
        bGroup = buildBar(rng);
        break;
      default:
        continue;
    }
    bGroup.position.set(b.x, 0, b.z);
    bGroup.rotation.y = b.rotY;
    bGroup.updateMatrixWorld(true);
    group.add(bGroup);

    const beacons = bGroup.userData.beacons as THREE.Mesh[] | undefined;
    const halo = bGroup.userData.halo as THREE.Object3D | undefined;
    if (beacons || halo) {
      updateAmbientFns.push((sec) => {
        if (beacons) {
          for (const beacon of beacons) {
            const mat = beacon.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = 1.6 + Math.sin(sec * 2 + beacon.id) * 0.8;
          }
        }
        if (halo) halo.rotation.y = sec * 0.15;
      });
    }

    if (b.isVenue) {
      const seats = (bGroup.userData.seats as THREE.Object3D[] | undefined) ?? [];
      const standAnchors = (bGroup.userData.standAnchors as THREE.Object3D[] | undefined) ?? [];
      venueSeatFillers.push(() => {
        seats.forEach((anchor, i) => {
          const prng = makeRng(seed + CITY_SEED_SALT.filler + 900 + hashId(b.id) + i);
          const person = buildPerson(prng, 'sit');
          enableCulling(person.group);
          anchor.add(person.group);
          updateAmbientFns.push(person.updateAmbient);
        });
        standAnchors.forEach((anchor, i) => {
          const prng = makeRng(seed + CITY_SEED_SALT.filler + 950 + hashId(b.id) + i);
          const person = buildPerson(prng, 'stand');
          enableCulling(person.group);
          anchor.add(person.group);
          updateAmbientFns.push(person.updateAmbient);
        });
      });
    }
  }
  venueSeatFillers.forEach((f) => f());

  // --- billboards: unique hero placements built individually, repeats instanced per zone ---
  for (const bb of layout.billboards.filter((b) => b.unique)) {
    const rng = makeRng(seed + CITY_SEED_SALT.billboardHero + hashId(bb.id));
    const built = buildBillboard(rng, { format: bb.format, mount: bb.mount, widthM: bb.widthM });
    built.group.position.set(bb.x, bb.y, bb.z);
    built.group.rotation.y = bb.rotY;
    group.add(built.group);
    updateAmbientFns.push(built.updateAmbient);
  }
  // Grouped by (format, mount) ONLY — global across every zone, same reasoning as the
  // filler buildings above: a handful of ad templates, replicated everywhere, for a
  // draw-call cost that never grows with the repeat count.
  // On mobile (density < 1), halve the repeat billboard count to reduce GPU load.
  const repeatsByGroup = new Map<string, BillboardSlot[]>();
  for (const bb of layout.billboards.filter((b) => !b.unique)) {
    const key = `${bb.format}:${bb.mount}`;
    if (!repeatsByGroup.has(key)) repeatsByGroup.set(key, []);
    repeatsByGroup.get(key)!.push(bb);
  }
  // Apply density: keep only floor(count * density) repeats per group.
  if (density < 1) {
    for (const [key, slots] of repeatsByGroup) {
      const keep = Math.floor(slots.length * density);
      repeatsByGroup.set(key, slots.slice(0, keep));
    }
  }
  let bbTemplateSalt = 0;
  for (const [key, slots] of repeatsByGroup) {
    const [format, mount] = key.split(':');
    const rng = makeRng(seed + CITY_SEED_SALT.billboardRepeat + bbTemplateSalt++);
    const built = buildBillboard(rng, { format: format as AdFormat, mount: mount as BillboardMount });
    built.group.updateMatrixWorld(true);
    const instanced = instanceTemplate(
      built.group,
      slots.map((s) => ({ x: s.x, z: s.z, rotY: s.rotY, y: s.y }))
    );
    instanced.name = `billboardRepeat:${key}`;
    group.add(instanced);
  }

  // --- lamps: ONE global instanced template covering every lamp post in the city ---
  {
    const rng = makeRng(seed + CITY_SEED_SALT.lamp);
    const template = buildStreetLamp(rng);
    const instanced = instanceTemplate(
      template,
      layout.lamps.map((s) => ({ x: s.x, z: s.z, rotY: s.rotY }))
    );
    instanced.name = 'lamps';
    group.add(instanced);
  }

  // --- props: traffic lights individually (few), rest instanced per kind ---
  const propsByKind = new Map<string, PropSlot[]>();
  for (const p of layout.props) {
    if (!propsByKind.has(p.kind)) propsByKind.set(p.kind, []);
    propsByKind.get(p.kind)!.push(p);
  }
  const PROP_BUILDERS: Record<PropSlot['kind'], (rng: Rng) => THREE.Group> = {
    trafficLight: buildTrafficLight,
    steamVent: buildSteamVent,
    vendingMachine: buildVendingMachine,
    hydrant: buildHydrant,
    trashHeap: (rng) => buildTrashHeap(rng)
  };
  let propSalt = 0;
  for (const [kind, slots] of propsByKind) {
    if (kind === 'trafficLight') {
      // Built individually: few in number, and each needs its own steady-state pose.
      for (const p of slots) {
        const rng = makeRng(seed + CITY_SEED_SALT.prop + propSalt++);
        const t = buildTrafficLight(rng);
        t.position.set(p.x, 0, p.z);
        t.rotation.y = p.rotY;
        group.add(t);
      }
      continue;
    }
    const rng = makeRng(seed + CITY_SEED_SALT.prop + propSalt++);
    const template = PROP_BUILDERS[kind as PropSlot['kind']](rng);
    const instanced = instanceTemplate(
      template,
      slots.map((s) => ({ x: s.x, z: s.z, rotY: s.rotY }))
    );
    instanced.name = `props:${kind}`;
    group.add(instanced);
  }

  // --- powerlines ---
  layout.powerRuns.forEach((run, i) => {
    const rng = makeRng(seed + CITY_SEED_SALT.powerline + i);
    const run3d = buildPowerRun(
      rng,
      new THREE.Vector3(run.from[0], 0, run.from[1]),
      new THREE.Vector3(run.to[0], 0, run.to[1]),
      run.poles
    );
    group.add(run3d);
  });

  // --- gas station ---
  {
    const rng = makeRng(seed + CITY_SEED_SALT.gasStation);
    const gs = buildGasStation(rng);
    gs.position.set(layout.gasStation.x, 0, layout.gasStation.z);
    group.add(gs);
  }

  // --- cranes ---
  layout.cranes.forEach((c, i) => {
    const rng = makeRng(seed + CITY_SEED_SALT.crane + i);
    const crane = buildCrane(rng, c.swinging);
    crane.group.position.set(c.x, 0, c.z);
    group.add(crane.group);
    updateAmbientFns.push(crane.updateAmbient);
  });

  // --- metro: suspended monorail threading Ring 0/1 (About street, Shibuya, boulevard,
  // bridge approach — spec §4.3). Its `update(t)` is keyed to global scroll progress
  // (not wall-clock), so it goes through `updateFns`, not `updateAmbientFns`.
  {
    const rng = makeRng(seed + CITY_SEED_SALT.metro);
    const metro = buildMetro(rng);
    group.add(metro.group);
    updateFns.push(metro.update);
  }

  // --- crowds ---
  layout.crowds.forEach((c, i) => {
    const rng = makeRng(seed + CITY_SEED_SALT.crowd + i);
    const crowd = buildCrowd(rng, c.n, c.area);
    crowd.group.position.set(c.x, 0, c.z);
    group.add(crowd.group);
    updateAmbientFns.push(crowd.updateAmbient);
  });

  // --- walkers ---
  layout.walkers.forEach((w, i) => {
    const rng = makeRng(seed + CITY_SEED_SALT.walker + i);
    const person = buildPerson(rng, 'walk');
    enableCulling(person.group);
    person.group.position.set(w.x, 0, w.z);
    person.group.rotation.y = w.rotY;
    group.add(person.group);
    updateAmbientFns.push(person.updateAmbient);
  });

  // --- phone-standers under billboards (reuse a few hero billboard spots) ---
  const phoneSpots = layout.billboards.filter((b) => b.unique).slice(0, 3);
  phoneSpots.forEach((b, i) => {
    const rng = makeRng(seed + CITY_SEED_SALT.walker + 100 + i);
    const person = buildPerson(rng, 'stand');
    enableCulling(person.group);
    person.group.position.set(b.x + 1.5, 0, b.z + 1.5);
    group.add(person.group);
    updateAmbientFns.push(person.updateAmbient);
  });

  // --- dogs (paired with the first few walkers as owners) ---
  layout.dogs.forEach((d, i) => {
    const rng = makeRng(seed + CITY_SEED_SALT.dog + i);
    const dog = buildDog(rng, rng.chance(0.5) ? 'walk' : 'sit');
    enableCulling(dog.group);
    dog.group.position.set(d.x + 0.6, 0, d.z + 0.6);
    dog.group.rotation.y = d.rotY;
    group.add(dog.group);
    updateAmbientFns.push(dog.updateAmbient);
  });

  // --- DisplayAnchors: empty positioned/oriented nodes for Phase 5 section content ---
  function makeAnchor(spec: { x: number; y: number; z: number; rotY: number }): THREE.Object3D {
    const o = new THREE.Object3D();
    o.position.set(spec.x, spec.y, spec.z);
    o.rotation.y = spec.rotY;
    group.add(o);
    return o;
  }
  const anchors: DisplayAnchors = {
    aboutWall: layout.anchors.aboutWall.map(makeAnchor),
    projectsWall: layout.anchors.projectsWall.map(makeAnchor),
    researchSky: layout.anchors.researchSky.map(makeAnchor),
    introOverhead: makeAnchor({ ...layout.anchors.introOverhead, rotY: 0 })
  };

  function update(t: number): void {
    for (const fn of updateFns) fn(t);
  }
  function updateAmbient(sec: number): void {
    for (const fn of updateAmbientFns) fn(sec);
  }

  return { group, update, updateAmbient, anchors };
}

/**
 * People/dog builders set `mesh.frustumCulled = false` on their SkinnedMesh (reasonable
 * in their own single-figure viewer contexts, where "always draw the one figure on
 * screen" is harmless) — but every person/dog placed in the city is a small, mostly-
 * static figure with an already-tight authored `geometry.boundingSphere`, and the city
 * has dozens of them scattered along a 1800m route. Left un-culled, EVERY one of them
 * draws in EVERY viewpoint regardless of camera direction, which blew the draw-call
 * budget even at viewpoints nowhere near the venue/crowd clusters. Re-enabling per-object
 * frustum culling here (city-placement time only, not touching the shared asset modules)
 * is what makes the population scale with what a viewpoint can actually see.
 */
function enableCulling(object: THREE.Object3D): void {
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = true;
  });
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100000;
}
