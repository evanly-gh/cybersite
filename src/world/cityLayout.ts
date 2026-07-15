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
import {
  gltfCyberpunkTower,
  gltfCommercialBlock,
  gltfIndustrialUnit,
  gltfResidentialTower,
  type GltfLibrary
} from '../assets/buildings/gltfBuildings';

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
  | 'aboutWallNear' // dense storefront/apartment wall on the camera-facing side of About street
  | 'aboutWallFar' // taller mixed office/apartment/tall wall further down About street
  | 'aboutBack' // skyline depth behind the About camera
  | 'shibuya' // the 4 dense scramble-crossing corners
  | 'projectsWall' // the project display wall down the boulevard
  | 'projectsBack' // boulevard skyline depth
  | 'researchCanyon' // TALL buildings both sides of the ground-level research road
  | 'bridgeApproach' // thinning transition into the bridge run
  // legacy aliases (kept so incidental references still type-check; unused by the new layout)
  | 'aboutWall'
  | 'projectsBackLegacy'
  | 'boulevard'
  | 'skywayFlank';

export interface BlockRect {
  x: number;
  z: number;
  w: number;
  d: number;
  zone: Zone;
}

export type FillerKind =
  | 'tallStepped'
  | 'tallSlab'
  | 'apartment'
  | 'officeHolo'
  | 'parking'
  | 'storefrontRow'
  | 'gltfCyberpunkTower'
  | 'gltfCommercialBlock'
  | 'gltfIndustrialUnit'
  | 'gltfResidentialTower';
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
    researchCanyon: Array<{ x: number; y: number; z: number; rotY: number }>;
    introOverhead: { x: number; y: number; z: number };
  };
}

// Nominal footprints (meters) used by the planning layer AND as the placement pitch in
// the mesh-assembly layer. The real builders' rng-driven sizes vary a few % around
// these — absorbed by the block gaps below, never causing a visible clash.
export const FILLER_FOOTPRINT: Record<FillerKind, [number, number]> = {
  tallStepped: [30, 30],
  tallSlab: [40, 16],
  apartment: [22, 14],
  officeHolo: [26, 18],
  parking: [34, 22],
  storefrontRow: [32, 9],
  // GLTF kinds (Task G). Footprints match the builders' rng size ranges (upper end used
  // as the placement pitch so the rng-jittered mesh never overruns its lot).
  gltfCyberpunkTower: [24, 20],
  gltfCommercialBlock: [46, 12], // up to 5 bays x 9m = 45m wide
  gltfIndustrialUnit: [32, 24],
  gltfResidentialTower: [26, 18]
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
const FRONT_GAP = 4; // tighter inter-building gap on the storefront front walls (denser feel)
const SIDEWALK_SETBACK = 11; // building near-edge distance from street centerline (front/wall zones)
// Research-canyon near-edge distance from centerline (x=240). Road halfwidth 7 + sidewalk
// 3 + 1m margin = 11 minimum clearance; the canyon reads as "tight/towering" via building
// HEIGHT, never by intruding the road. (Was 8m — combined with the fillWall footprint bug
// that let 40m-wide slabs stick 20m perpendicular, that put buildings 11m INTO the road.)
const CANYON_SETBACK = 11;
// Hard road-clearance clamp: no building's near-edge may sit closer than this to the
// street centerline (About: z=0; boulevard/canyon: x=240). roadHalf 7 + sidewalk 3 + 1.
const ROAD_HALFWIDTH = 7;
const SIDEWALK_W = 3;
const CLEARANCE_MARGIN = 1;
const MIN_ROAD_CLEARANCE = ROAD_HALFWIDTH + SIDEWALK_W + CLEARANCE_MARGIN; // 11

// Per-zone setbacks for the "back" zones whose buildings sit on the CAMERA's side of the
// street for About and Projects sections.  These must be large enough that no building's
// footprint intrudes into the camera position or its sightline to the opposite wall.
//
// About: fixed camera at z=+26 looks across to aboutWall at z=-11.5.  The corridor from
//   z=-11.5 to z=+26 must be clear.  aboutBack near-edge is pushed to z=ABOUT_BACK_SETBACK
//   (32) so the entire corridor is unobstructed.  Deepest filler (parking d=22) then extends
//   to z=54, well behind the camera.
//
// Boulevard (projects back): fixed cameras at x=205 and x≈204 look across to projectsWall
//   at x≈251.5.  The sightline from x=205 to x=252 must be clear.  boulevard near-edge is
//   pushed to BLVD_X - BLVD_BACK_SETBACK = 240-44 = 196, so x=196..174 (parking) are all
//   west of the camera.  The strip from x=196 to x=229 (old setback) is left as open lot /
//   wide sidewalk — common in cyberpunk dense-block districts adjacent to ramp lanes.
const ABOUT_BACK_SETBACK = 32;  // aboutBack near-edge at z=+32; camera at z=+26 is clear
const BLVD_BACK_SETBACK  = 44;  // boulevard near-edge at x=196; camera at x=205 is clear

// Route-derived corridor extents (kept in lockstep with world/streets.ts constants by
// comment, not import, since streets.ts doesn't export its internal PLAZA_SIZE/ABOUT_LEN).
const ABOUT_X0 = -296;
const ABOUT_X1 = 210; // stop short of the Shibuya plaza (plaza half-size 20 @ x=240)
const ABOUT_SPLIT = -100; // aboutWallNear (dense storefronts) west of here; aboutWallFar (taller mix) east
const BLVD_X = WAYPOINTS.shibuyaCenter.x; // 240
const BLVD_Z0 = -24; // just south of the plaza
const BLVD_Z1 = WAYPOINTS.researchEntry.z; // -420
const CANYON_Z0 = BLVD_Z1; // -420: research canyon start
const CANYON_Z1 = WAYPOINTS.researchEnd.z; // -800: research canyon end
const BRIDGE_Z0 = CANYON_Z1; // -800
const BRIDGE_Z1 = -860; // bridge approach ramp end

function rectsOverlap(a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.z - b.z) * 2 < a.d + b.d;
}

/** Sequential fill along a street wall: walks a cursor down the corridor, weight-picks a
 * filler kind per slot, and skips over any reserved (landmark/venue) rects in its path.
 *
 * ROTATED-FOOTPRINT CORRECTNESS (bug fix): a filler's nominal footprint is [fw, fd] in the
 * builder's LOCAL frame — fw is the FRONT-FACE width (spans local X), fd the depth (spans
 * local Z). Which world axis each maps to depends on the placement `rotY`: an axis-aligned
 * turn (rotY≈0/π) keeps local X→world X; a quarter turn (rotY≈±π/2) swaps them. When the
 * front face points at the road (the convention `facingRotY` now enforces), the width fw
 * always runs ALONG the street and the depth fd runs PERPENDICULAR (into the block) — but
 * we derive that from the rotation rather than assume it, and hard-clamp the near-edge to
 * `MIN_ROAD_CLEARANCE` so no building can ever cross into the roadway. The prior code read
 * fd as the perpendicular extent unconditionally, which let π/2-rotated walls stick their
 * full width (e.g. a 40m slab) into a corridor sized for ~1m of clearance. */
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
  idPrefix: string,
  gap: number = GAP,
  rotYOverride?: number,
  roadCenterPerp?: number
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

  // Hard road-clearance clamp: the intended near-edge (fixedCoord) is pushed out if it sits
  // closer than MIN_ROAD_CLEARANCE to the road center on the outward side.
  const nearEdge =
    roadCenterPerp === undefined
      ? fixedCoord
      : outward > 0
        ? Math.max(fixedCoord, roadCenterPerp + MIN_ROAD_CLEARANCE)
        : Math.min(fixedCoord, roadCenterPerp - MIN_ROAD_CLEARANCE);

  while ((dir > 0 && cursor < to) || (dir < 0 && cursor > to)) {
    const kind = pickKind();
    const [fw, fd] = FILLER_FOOTPRINT[kind];
    const rotY = rotYOverride ?? facingRotY(zone);
    // A quarter turn (|sin|≈1) swaps which local axis maps to the world perpendicular axis.
    const quarter = Math.abs(Math.sin(rotY)) > 0.7071;
    // perpExtent = world size perpendicular to the street (into/away from the road);
    // alongExtent = world size along the street (the sequential pitch axis).
    let perpExtent: number;
    let alongExtent: number;
    if (axis === 'z') {
      // Street runs along world Z → perpendicular is world X. aligned: worldX=fw; quarter: worldX=fd.
      perpExtent = quarter ? fd : fw;
      alongExtent = quarter ? fw : fd;
    } else {
      // Street runs along world X → perpendicular is world Z. aligned: worldZ=fd; quarter: worldZ=fw.
      perpExtent = quarter ? fw : fd;
      alongExtent = quarter ? fd : fw;
    }
    const span = alongExtent;
    const center = cursor + (dir * span) / 2;
    // Building sits with its NEAR edge on `nearEdge`, extending `outward` (away from the
    // street) by its REAL perpendicular extent — never centered ON the sidewalk line.
    const perp = nearEdge + (outward * perpExtent) / 2;
    const rect: BlockRect =
      axis === 'x'
        ? { x: center, z: perp, w: alongExtent, d: perpExtent, zone }
        : { x: perp, z: center, w: perpExtent, d: alongExtent, zone };

    const blocked = reserved.some((r) => rectsOverlap(rect, r));
    if (blocked) {
      // Skip past the reserved rect entirely (plus one gap) rather than placing here.
      const reservedHit = reserved.find((r) => rectsOverlap(rect, r))!;
      const reservedSpan = axis === 'x' ? reservedHit.w : reservedHit.d;
      const reservedCenter = axis === 'x' ? reservedHit.x : reservedHit.z;
      cursor = reservedCenter + (dir * reservedSpan) / 2 + dir * gap;
      continue;
    }

    out.blocks.push(rect);
    // Register this placement as reserved so LATER walls (which share this same `reserved`
    // list) route around it — prevents cross-wall overlaps where two perpendicular walls
    // meet at a corner, or two collinear walls abut at a zone seam.
    reserved.push(rect);
    // Draw-call budget: filler buildings are instanced GLOBALLY by (kind, variant) —
    // see buildCity — so every placement of a given kind/variant shares one InstancedMesh
    // set regardless of zone. Roof billboards are reserved for the Shibuya/hero unique
    // buildings only (a per-placement billboard variant here would multiply the instanced
    // template count); fillers always get plain roof clutter (still non-flat).
    const variant = 0;
    void rng.chance(0.7); // keep the rng stream shape stable regardless of this decision
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

    cursor = center + (dir * span) / 2 + dir * gap;
  }
}

/** Outward-facing rotation (radians) for a wall zone's buildings — front face points at
 * the street the zone flanks.
 *
 * About-street walls run along +X. The near wall sits on the -Z side (z<0) and must face
 * +Z toward the street/camera; the far/back walls sit on the +Z side and face -Z.
 * Boulevard / research walls run along -Z at x=240. The projects/east wall sits on the
 * +X side and faces -X; the boulevard/west back wall sits on the -X side and faces +X. */
// Builders author their FRONT face at local +Z, with the frontage WIDTH (fw) spanning
// local X and DEPTH (fd) spanning local Z. A rotation θ about Y maps local +Z to world
// (sinθ, 0, cosθ). We pick θ so the front points at the road AND the wide face lines the
// street (small depth perpendicular) — this is what keeps the perpendicular extent small
// (=fd) and the road clear.
function facingRotY(zone: Zone): number {
  switch (zone) {
    case 'aboutWall':
    case 'aboutWallNear':
    case 'aboutWallFar':
      return 0; // building at z<0, street at z=0 (+Z side): front +Z faces the street.
    case 'aboutBack':
      return Math.PI; // building at z>0, street at z=0 (-Z side): front faces -Z.
    case 'projectsWall':
      return -Math.PI / 2; // east wall at x>240: front faces -X (toward the boulevard).
    case 'projectsBack':
    case 'projectsBackLegacy':
    case 'boulevard':
      return Math.PI / 2; // west back wall at x<240: front faces +X (toward the boulevard).
    case 'researchCanyon':
    case 'bridgeApproach':
    case 'skywayFlank':
      return 0; // placement-time rotation is overridden per-side in the canyon/bridge fill
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

  // Monolith landmark, in the open lot west of the boulevard, visible down both streets.
  addLandmark('monolith', 140, -60, Math.PI / 4, 'projectsBack', 'monolith');
  // Radio mast far east of the boulevard (out of the research-canyon camera corridor).
  addLandmark('radioMast', 292, -200, 0, 'projectsBack', 'radioMast');
  addLandmark('monument', -20, -14, Math.PI / 2, 'aboutWallFar', 'monument');

  // Venues clustered near the About-street midpoint.
  const aboutMid = (ABOUT_X0 + ABOUT_X1) / 2; // ≈ -43
  addLandmark('restaurant', aboutMid - 10, -SIDEWALK_SETBACK, Math.PI / 2, 'aboutWallFar', 'restaurant');
  addLandmark('ramen', aboutMid + 20, ABOUT_BACK_SETBACK, -Math.PI / 2, 'aboutBack', 'ramen0');
  addLandmark('bar', aboutMid - 40, ABOUT_BACK_SETBACK, -Math.PI / 2, 'aboutBack', 'bar');
  // Ramen repeat near the gas station on the boulevard back zone.
  addLandmark('ramen', 183, -235, Math.PI, 'projectsBack', 'ramen1');

  buildings.push(...landmarkSlots);

  // Gas station at x=183 (inside BLVD_BACK_SETBACK zone) so it does not intrude into the
  // camera corridor (cameras at x≈205 look across boulevard to x≈251.5).
  const gasStation = { x: 183, z: -240 };
  reserved.push({ x: gasStation.x, z: gasStation.z, w: 22, d: 16, zone: 'projectsBack' });

  cranes.push({ x: 300, z: -140, swinging: true }, { x: 170, z: -520, swinging: false });
  reserved.push({ x: 300, z: -140, w: 16, d: 16, zone: 'projectsBack' });
  // Crane at x=170 z=-520: far west of the research-canyon west wall (near-edge x=232),
  // clear of the x∈[233,247] camera corridor.
  reserved.push({ x: 170, z: -520, w: 16, d: 16, zone: 'researchCanyon' });

  // Reserve the 4 Shibuya corner footprints up front (computed below, but geometry is
  // fixed) so the boulevard fill routes around them instead of clipping into the plaza.
  //
  // The two +z corners (at z=+30) are moved outward to z=+45 to clear the drift-segment
  // camera at (265,5,38): with corners at z=30 the footprint (d=9 → z=25.5..34.5) falls
  // across the camera's sightline from z=38 to z≈-5.  At z=45 the footprint spans
  // z=40.5..49.5, safely behind the camera.
  const cxEarly = WAYPOINTS.shibuyaCenter.x;
  const cornersEarly: Array<[number, number, FillerKind]> = [
    [cxEarly + 30, 45, 'officeHolo'],  // +z pair moved from z=30 to z=45 (clears drift camera)
    [cxEarly + 30, -30, 'storefrontRow'],
    [cxEarly - 30, 45, 'storefrontRow'],  // +z pair moved from z=30 to z=45
    [cxEarly - 30, -30, 'officeHolo']
  ];
  for (const [x, z, kind] of cornersEarly) {
    const [w, d] = FILLER_FOOTPRINT[kind];
    reserved.push({ x, z, w, d, zone: 'shibuya' });
  }

  // --- filler walls ---
  // The front-wall zones (aboutWallNear/aboutWallFar/projectsWall) host Phase-5 content
  // anchors and stay low/mid so the holo-panels read cleanly against them; the back and
  // canyon zones carry the skyline height. Every kind (including the 4 GLTF kinds) is one
  // globally-instanced template (see instanceTemplate) — cheap regardless of placement
  // count — but each IS a new "always drawn where visible" line item, so canyon/back
  // weights stay modest and the draw-call budget is re-audited (Step 6) after.
  //
  // aboutWallNear (x -296..-100): dense camera-facing storefronts + apartments + a
  // commercial GLTF row for variety. Tight FRONT_GAP for a packed shopfront feel.
  const aboutNearWeights: Array<[FillerKind, number]> = [
    ['storefrontRow', 0.42],
    ['apartment', 0.28],
    ['gltfCommercialBlock', 0.18],
    ['officeHolo', 0.12]
  ];
  // aboutWallFar (x -100..210): taller mixed wall — office/apartment/tallStepped/residential.
  const aboutFarWeights: Array<[FillerKind, number]> = [
    ['officeHolo', 0.34],
    ['apartment', 0.28],
    ['tallStepped', 0.16],
    ['gltfResidentialTower', 0.14],
    ['storefrontRow', 0.08]
  ];
  // aboutBack (z=+32): pure skyline depth — tall + parking + industrial sheds.
  const aboutBackWeights: Array<[FillerKind, number]> = [
    ['apartment', 0.3],
    ['tallStepped', 0.2],
    ['tallSlab', 0.18],
    ['gltfIndustrialUnit', 0.14],
    ['parking', 0.1],
    ['storefrontRow', 0.08]
  ];
  // projectsWall (x=251.5 east of boulevard): office display wall.
  const projectsWallWeights: Array<[FillerKind, number]> = [
    ['officeHolo', 0.7],
    ['gltfResidentialTower', 0.3]
  ];
  // projectsBack (x=196 west of boulevard): boulevard skyline depth.
  const projectsBackWeights: Array<[FillerKind, number]> = [
    ['apartment', 0.3],
    ['tallStepped', 0.2],
    ['tallSlab', 0.18],
    ['gltfIndustrialUnit', 0.14],
    ['parking', 0.1],
    ['storefrontRow', 0.08]
  ];
  // researchCanyon (BOTH sides of x=240, z -420..-800): the key new spatial experience —
  // TALL towers placed CLOSE (CANYON_SETBACK=11, road-clearance-clamped) so a low camera looking up sees an
  // enclosed neon corridor. Only tall kinds (50-120m) here.
  const canyonWeights: Array<[FillerKind, number]> = [
    ['tallSlab', 0.28],
    ['tallStepped', 0.26],
    ['gltfCyberpunkTower', 0.26],
    ['gltfResidentialTower', 0.2]
  ];
  // bridgeApproach (z -800..-860): thinning transition — skinnier slab + residential.
  const bridgeWeights: Array<[FillerKind, number]> = [
    ['tallSlab', 0.5],
    ['gltfResidentialTower', 0.3],
    ['apartment', 0.2]
  ];

  // About street runs along world X at z=0 (road center z=0). Near/far walls sit on the -Z
  // side (outward=-1) facing +Z; the clamp keeps their near-edge ≥ MIN_ROAD_CLEARANCE from z=0.
  const ABOUT_ROAD_Z = 0;
  fillWall(rng, 'x', ABOUT_X0, ABOUT_SPLIT, -SIDEWALK_SETBACK, -1, 'aboutWallNear', aboutNearWeights, reserved, { blocks, buildings }, 'aboutNear', FRONT_GAP, undefined, ABOUT_ROAD_Z);
  fillWall(rng, 'x', ABOUT_SPLIT, ABOUT_X1, -SIDEWALK_SETBACK, -1, 'aboutWallFar', aboutFarWeights, reserved, { blocks, buildings }, 'aboutFar', FRONT_GAP, undefined, ABOUT_ROAD_Z);
  // aboutBack: near-edge at z=ABOUT_BACK_SETBACK (32), clearing the fixed About camera at z=+26.
  fillWall(rng, 'x', ABOUT_X0, ABOUT_X1, ABOUT_BACK_SETBACK, 1, 'aboutBack', aboutBackWeights, reserved, { blocks, buildings }, 'aboutBack', GAP, undefined, ABOUT_ROAD_Z);
  // Boulevard/canyon/bridge run along world Z at x=240 (road center x=240).
  // Projects display wall: east side (outward=+1), front faces -X toward the camera.
  fillWall(rng, 'z', BLVD_Z0, BLVD_Z1 + 24, BLVD_X + SIDEWALK_SETBACK, 1, 'projectsWall', projectsWallWeights, reserved, { blocks, buildings }, 'projectsWall', GAP, undefined, BLVD_X);
  // boulevard back: near-edge at x=196 (BLVD_BACK_SETBACK), clearing the fixed Projects cameras at x=205.
  fillWall(rng, 'z', BLVD_Z0, BLVD_Z1 + 24, BLVD_X - BLVD_BACK_SETBACK, -1, 'projectsBack', projectsBackWeights, reserved, { blocks, buildings }, 'projectsBack', GAP, undefined, BLVD_X);
  // Research canyon: TALL towers both sides, near-edge clamped to x=251 east / x=229 west
  // (MIN_ROAD_CLEARANCE=11 from x=240 → outside the x∈[233,247] road corridor + sidewalk).
  // Front faces the road: east wall (outward=+1) rotY=-π/2, west wall (outward=-1) rotY=+π/2.
  fillWall(rng, 'z', CANYON_Z0 - 12, CANYON_Z1, BLVD_X + CANYON_SETBACK, 1, 'researchCanyon', canyonWeights, reserved, { blocks, buildings }, 'canyonR', 5, -Math.PI / 2, BLVD_X);
  fillWall(rng, 'z', CANYON_Z0 - 12, CANYON_Z1, BLVD_X - CANYON_SETBACK, -1, 'researchCanyon', canyonWeights, reserved, { blocks, buildings }, 'canyonL', 5, Math.PI / 2, BLVD_X);
  // Bridge approach: thinning transition, both sides, front toward the road, clearance-clamped.
  fillWall(rng, 'z', BRIDGE_Z0 - 6, BRIDGE_Z1, BLVD_X + SIDEWALK_SETBACK, 1, 'bridgeApproach', bridgeWeights, reserved, { blocks, buildings }, 'bridgeR', 8, -Math.PI / 2, BLVD_X);
  fillWall(rng, 'z', BRIDGE_Z0 - 6, BRIDGE_Z1, BLVD_X - SIDEWALK_SETBACK, -1, 'bridgeApproach', bridgeWeights, reserved, { blocks, buildings }, 'bridgeL', 8, Math.PI / 2, BLVD_X);

  // --- Shibuya corners: office w/ mega billboard + storefront row, alternating ---
  // +z corners match their reserved positions (z=45, moved from 30 to clear drift camera).
  const cx = cxEarly;
  const corners: Array<[number, number, number, FillerKind]> = [
    [cxEarly + 30, 45, Math.PI + Math.PI / 4, 'officeHolo'],   // z=45 (was 30)
    [cxEarly + 30, -30, Math.PI / 2 + Math.PI / 4, 'storefrontRow'],
    [cxEarly - 30, 45, -Math.PI / 4, 'storefrontRow'],          // z=45 (was 30)
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
    [aboutMid - 60, -SIDEWALK_SETBACK - 0.2, Math.PI / 2, 'landscape', 'wall', 'aboutWallFar'],
    [aboutMid - 20, 0, 0, 'strip', 'stand', 'aboutWallFar'],
    [cx, 22, 0, 'landscape', 'roof', 'shibuya'],
    [cx + 26, 26, -Math.PI / 4, 'landscape', 'wall', 'shibuya'],
    [BLVD_X + SIDEWALK_SETBACK + 0.2, -100, -Math.PI / 2, 'landscape', 'wall', 'projectsWall'],
    [BLVD_X, 0, Math.PI / 2, 'strip', 'stand', 'projectsBack']
  ];
  uniqueSpots.forEach(([x, z, rotY, format, mount, zone], i) => {
    billboards.push({ id: `hero${i}`, x, y: 0, z, rotY, format, mount, unique: true, zone });
  });

  // Cheap instanced repeats: stand-mounted vcards down both About + boulevard sidewalks.
  // Only 1 format (not 3) — draw-call budget pass: fewer globally-instanced repeat
  // groups, same reasoning as the filler-kind count above.
  const repeatFormats: AdFormat[] = ['vcard'];
  let bi = 0;
  // About street: denser sidewalk vcards (12m pitch, was 16m).
  for (let x = ABOUT_X0 + 12; x < ABOUT_X1 - 12; x += 12) {
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
        zone: side < 0 ? (x < ABOUT_SPLIT ? 'aboutWallNear' : 'aboutWallFar') : 'aboutBack'
      });
    }
  }
  // Boulevard + canyon: stand-mounted sidewalk vcards down both sides.
  for (let z = BLVD_Z0 - 14; z > BRIDGE_Z1 + 14; z -= 14) {
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
        zone: z > BLVD_Z1 ? (side < 0 ? 'projectsBack' : 'projectsWall') : 'researchCanyon'
      });
    }
  }
  // Research canyon neon corridor: wall-mounted landscape ads high on the canyon walls,
  // BELOW the y=20-28 content anchors so they frame (not compete with) the holo-panels.
  // All one globally-instanced 'landscape:wall' repeat group → cheap regardless of count.
  for (let z = CANYON_Z0 - 20; z > CANYON_Z1 + 20; z -= 26) {
    for (const side of [-1, 1] as const) {
      billboards.push({
        id: `rep${bi++}`,
        x: BLVD_X + side * (CANYON_SETBACK + 0.3),
        y: 12,
        z,
        rotY: side < 0 ? 0 : Math.PI,
        format: 'landscape',
        mount: 'wall',
        unique: false,
        zone: 'researchCanyon'
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
    lamps.push({ x, z: side * (SIDEWALK_SETBACK - 3.5), rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2, zone: x < ABOUT_SPLIT ? 'aboutWallNear' : 'aboutWallFar' });
    side *= -1;
  }
  for (let z = BLVD_Z0 - 8; z > BLVD_Z1 + 8; z -= 22) {
    lamps.push({ x: BLVD_X + side * (SIDEWALK_SETBACK - 3.5), z, rotY: side < 0 ? 0 : Math.PI, zone: 'projectsBack' });
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
  // Research canyon anchors: mounted HIGH on the canyon walls (y=20-28), alternating
  // sides, so a LOW camera (y≈1.5 at x=240) riding the ground-level road looks UP at them.
  // Left/west wall anchors sit at x=233 facing +X (rotY toward the road from the west);
  // right/east wall anchors at x=247 facing -X. (Task I positions panel children with a
  // small local offset off these anchors.)
  const researchCanyonAnchors = [
    { x: 233, y: 24, z: -480, rotY: Math.PI / 2 }, // left/west wall
    { x: 247, y: 26, z: -560, rotY: -Math.PI / 2 }, // right/east wall
    { x: 233, y: 22, z: -650, rotY: Math.PI / 2 }, // left/west wall
    { x: 247, y: 28, z: -730, rotY: -Math.PI / 2 } // right/east wall
  ];
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
      researchCanyon: researchCanyonAnchors,
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
  researchCanyon: THREE.Object3D[];
  introOverhead: THREE.Object3D;
}

export interface City {
  group: THREE.Group;
  update(t: number): void;
  updateAmbient(sec: number): void;
  anchors: DisplayAnchors;
}

/** Options for buildCity. `gltf` is an optional pre-loaded GLTF library (Task L calls
 * loadGltfModels() at boot and passes it in). When absent, the gltf* filler builders use
 * their procedural fallbacks — keeping buildCity synchronous and layout deterministic. */
export interface BuildCityOptions {
  density?: number;
  gltf?: GltfLibrary;
}

/** Filler-building template builders. GLTF kinds receive the (possibly-null) library and
 * fall back to procedural geometry when a model is unavailable. */
const FILLER_BUILDERS: Record<FillerKind, (rng: Rng, gltf: GltfLibrary | null) => THREE.Group> = {
  tallStepped: (rng) => buildTallStepped(rng),
  tallSlab: (rng) => buildTallSlab(rng),
  apartment: (rng) => buildApartment(rng),
  officeHolo: (rng) => buildOfficeHolo(rng),
  parking: (rng) => buildParking(rng),
  storefrontRow: (rng) => buildStorefrontRow(rng, 4),
  gltfCyberpunkTower: (rng, gltf) => gltfCyberpunkTower(gltf ?? EMPTY_GLTF, rng),
  gltfCommercialBlock: (rng, gltf) => gltfCommercialBlock(gltf ?? EMPTY_GLTF, rng),
  gltfIndustrialUnit: (rng, gltf) => gltfIndustrialUnit(gltf ?? EMPTY_GLTF, rng),
  gltfResidentialTower: (rng, gltf) => gltfResidentialTower(gltf ?? EMPTY_GLTF, rng)
};

/** A library where every model is unavailable — used when buildCity is called without a
 * gltf param, so the gltf* builders take their procedural fallback path. */
const EMPTY_GLTF: GltfLibrary = {
  cyberpunkTower: { scene: null, url: '', available: false },
  commercialBlock: { scene: null, url: '', available: false },
  industrialUnit: { scene: null, url: '', available: false },
  residentialTower: { scene: null, url: '', available: false }
};

/** Builds one filler template (building + roof clutter, optionally a roof billboard),
 * origin at ground center — ready to be replicated via `instanceTemplate`. */
function buildFillerTemplate(kind: FillerKind, rng: Rng, withRoofBillboard: boolean, gltf: GltfLibrary | null): THREE.Group {
  const group = FILLER_BUILDERS[kind](rng, gltf);
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

export function buildCity(seed: number, opts: BuildCityOptions | number = {}): City {
  // Back-compat: buildCity(seed, density) is still accepted (old callers pass a number).
  const { density = 1, gltf = null } = typeof opts === 'number' ? { density: opts } : opts;
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
    const template = buildFillerTemplate(kind, rng, false, gltf);
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
    researchCanyon: layout.anchors.researchCanyon.map(makeAnchor),
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
