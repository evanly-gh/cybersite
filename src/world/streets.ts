import * as THREE from 'three';
import { WAYPOINTS, ROUTE_U, roadFrame, type RoadFrame } from './route';
import { COLORS } from '../theme';
import type { Rng } from '../utils/rng';
import { mergeStatic, type GeometryPart } from '../utils/merge';
import { makeCanvasTexture } from '../utils/canvasText';

/**
 * Task 7: the road network the whole ride happens on — About street (along +X),
 * the Shibuya-style scramble crossing, Projects boulevard (along -Z) with two skate-
 * ramp jumps, an elevated skyway, and the ocean bridge out toward the moon.
 *
 * Everything here is built as a handful of `GeometryPart[]` lists (one list per visual
 * "material category": asphalt, metal structure, concrete curbs, paint, the crossing
 * decal, and three emissive accent categories) and merged via `mergeOne` so the whole
 * network costs a small, fixed number of meshes regardless of how many hundreds of
 * little boxes/wedges/cylinders went into it.
 */

export const STREET_WIDTH = 14; // 2 lanes each way
export const SIDEWALK_W = 3;

const HALF_STREET = STREET_WIDTH / 2;
const SIDEWALK_OFFSET = HALF_STREET + SIDEWALK_W / 2;
const CURB_H = 0.15;

const RAMP_LEN = 8;
const RAMP_LIP = 2.6;

// Extra marking/concrete/asphalt constants that aren't part of the 7-token theme palette.
const ASPHALT = 0x0a0c14;
const METAL = COLORS.shadowBlue;
const CONCRETE = 0x14182a;
const PAINT_WHITE = 0xf2f2f0;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------------
// Low-level geometry helpers
// ---------------------------------------------------------------------------------

const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

/** A box GeometryPart spanning `size` centered at `center`, oriented by an orthonormal frame. */
function boxPart(
  center: THREE.Vector3,
  size: THREE.Vector3,
  xAxis: THREE.Vector3 = X_AXIS,
  yAxis: THREE.Vector3 = Y_AXIS,
  zAxis: THREE.Vector3 = Z_AXIS
): GeometryPart {
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
  const matrix = new THREE.Matrix4().compose(center, quat, size);
  return { geom: unitBox, matrix, mat: 0 };
}

/**
 * Merges a same-material part list into ONE real draw call: mergeStatic's group-per-part
 * behavior only matters when `mesh.material` stays an array (three.js only splits render
 * calls per-group when `Array.isArray(material)` is true — see WebGLRenderer.projectObject).
 * Unwrapping to the bare Material after merging collapses all those groups back into a
 * single gl draw call for free.
 */
function mergeOne(parts: GeometryPart[], material: THREE.Material): THREE.Mesh {
  const mesh = mergeStatic(parts, [material]);
  mesh.geometry.clearGroups();
  mesh.material = material;
  return mesh;
}

/** Triangular ramp-wedge profile: `riseAtEnd` puts the 2.6m vertical lip at the far end
 * (local x = RAMP_LEN, launch wedges) vs. the near end (local x = 0, landing wedges). */
function wedgeShape(riseAtEnd: boolean): THREE.Shape {
  const s = new THREE.Shape();
  if (riseAtEnd) {
    s.moveTo(0, 0);
    s.lineTo(RAMP_LEN, 0);
    s.lineTo(RAMP_LEN, RAMP_LIP);
    s.lineTo(0, 0);
  } else {
    s.moveTo(0, 0);
    s.lineTo(0, RAMP_LIP);
    s.lineTo(RAMP_LEN, 0);
    s.lineTo(0, 0);
  }
  return s;
}

/**
 * Builds one ramp/landing wedge at `waypoint`. The shape is authored in a local (travel,
 * height) plane and extruded along local Z (= road width); rotateY(90°) then remaps
 * local (x,y,z) -> world (z, y, -x), i.e. local-x becomes "further along -Z travel" and
 * local-z (centered) becomes world X across the road. That is exactly ramp geometry: the
 * wedge starts flush with the flat road at `waypoint` and rises/falls over RAMP_LEN meters
 * continuing in the -Z ride direction.
 */
function wedgePart(waypoint: THREE.Vector3, riseAtEnd: boolean): GeometryPart {
  const shape = wedgeShape(riseAtEnd);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: STREET_WIDTH, bevelEnabled: false, curveSegments: 1 });
  geom.translate(0, 0, -HALF_STREET);
  geom.computeVertexNormals();
  const matrix = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  matrix.setPosition(waypoint.x, 0, waypoint.z);
  return { geom, matrix, mat: 0 };
}

/** Flat axis-aligned road box (used for About street + the three straight boulevard segments). */
function flatRoadPart(centerX: number, centerZ: number, lengthX: number, lengthZ: number): GeometryPart {
  return boxPart(new THREE.Vector3(centerX, -0.1, centerZ), new THREE.Vector3(lengthX, 0.2, lengthZ));
}

function sampleFrames(uStart: number, uEnd: number, count: number): RoadFrame[] {
  const frames: RoadFrame[] = [];
  for (let i = 0; i <= count; i++) {
    frames.push(roadFrame(THREE.MathUtils.lerp(uStart, uEnd, i / count)));
  }
  return frames;
}

/** Deck ribbon following a sampled frame list, half-width interpolated start->end. */
function deckParts(frames: RoadFrame[], hwStart: number, hwEnd: number, thickness: number): GeometryPart[] {
  const parts: GeometryPart[] = [];
  const n = frames.length - 1;
  for (let i = 0; i < n; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const hw = THREE.MathUtils.lerp(hwStart, hwEnd, (i + 0.5) / n);
    const center = a.pos.clone().add(b.pos).multiplyScalar(0.5);
    center.y -= thickness / 2;
    const segLen = a.pos.distanceTo(b.pos) * 1.05; // slight overlap hides seams between segments
    const tangent = b.pos.clone().sub(a.pos).normalize();
    parts.push(boxPart(center, new THREE.Vector3(hw * 2, thickness, segLen), a.binormal, a.normal, tangent));
  }
  return parts;
}

/** Guard rails / parapets along both deck edges. */
function railParts(frames: RoadFrame[], halfWidth: number, railHeight: number, railThickness = 0.15): GeometryPart[] {
  const parts: GeometryPart[] = [];
  const n = frames.length - 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      const offset = a.binormal.clone().multiplyScalar(side * halfWidth);
      const center = a.pos.clone().add(b.pos).multiplyScalar(0.5).add(offset);
      center.y += railHeight / 2;
      const segLen = a.pos.distanceTo(b.pos) * 1.05;
      const tangent = b.pos.clone().sub(a.pos).normalize();
      parts.push(
        boxPart(center, new THREE.Vector3(railThickness, railHeight, segLen), a.binormal, a.normal, tangent)
      );
    }
  }
  return parts;
}

/** Thin emissive cyan strip riding both deck edges, full length. */
function edgeLightParts(frames: RoadFrame[], halfWidth: number): GeometryPart[] {
  const parts: GeometryPart[] = [];
  const n = frames.length - 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      const offset = a.binormal.clone().multiplyScalar(side * (halfWidth - 0.15));
      const center = a.pos.clone().add(b.pos).multiplyScalar(0.5).add(offset);
      center.y += 0.06;
      const segLen = a.pos.distanceTo(b.pos) * 1.05;
      const tangent = b.pos.clone().sub(a.pos).normalize();
      parts.push(boxPart(center, new THREE.Vector3(0.2, 0.08, segLen), a.binormal, a.normal, tangent));
    }
  }
  return parts;
}

/** Vertical ground pylons every `spacing` meters of arc length, wherever the deck is aloft. */
function pylonParts(frames: RoadFrame[], spacing: number, radius: number): GeometryPart[] {
  const parts: GeometryPart[] = [];
  let acc = spacing; // place one near the start too
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    acc += a.pos.distanceTo(b.pos);
    if (acc >= spacing && a.pos.y > 2) {
      const height = a.pos.y;
      const cyl = new THREE.CylinderGeometry(radius, radius * 1.3, height, 8).toNonIndexed();
      const matrix = new THREE.Matrix4().setPosition(a.pos.x, height / 2, a.pos.z);
      parts.push({ geom: cyl, matrix, mat: 0 });
      acc = 0;
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------------
// Lane markings (plain small boxes merged into one paint mesh — crisp dashes without
// needing UV-repeat bookkeeping across straight segments of varying length).
// ---------------------------------------------------------------------------------

function dashesAlongX(z: number, xFrom: number, xTo: number, dashLen = 3, gapLen = 3, width = 0.18): GeometryPart[] {
  const parts: GeometryPart[] = [];
  let x = xFrom;
  while (x < xTo) {
    const len = Math.min(dashLen, xTo - x);
    parts.push(boxPart(new THREE.Vector3(x + len / 2, 0.02, z), new THREE.Vector3(len, 0.01, width)));
    x += dashLen + gapLen;
  }
  return parts;
}

function dashesAlongZ(x: number, zFrom: number, zTo: number, dashLen = 3, gapLen = 3, width = 0.18): GeometryPart[] {
  const parts: GeometryPart[] = [];
  const dir = zTo < zFrom ? -1 : 1;
  let z = zFrom;
  while (dir < 0 ? z > zTo : z < zTo) {
    const len = Math.min(dashLen, Math.abs(zTo - z));
    parts.push(boxPart(new THREE.Vector3(x, 0.02, z + (dir * len) / 2), new THREE.Vector3(width, 0.01, len)));
    z += dir * (dashLen + gapLen);
  }
  return parts;
}

function solidAlongX(z: number, xFrom: number, xTo: number, width = 0.2): GeometryPart {
  return boxPart(
    new THREE.Vector3((xFrom + xTo) / 2, 0.02, z),
    new THREE.Vector3(Math.abs(xTo - xFrom), 0.01, width)
  );
}

function solidAlongZ(x: number, zFrom: number, zTo: number, width = 0.2): GeometryPart {
  return boxPart(
    new THREE.Vector3(x, 0.02, (zFrom + zTo) / 2),
    new THREE.Vector3(width, 0.01, Math.abs(zTo - zFrom))
  );
}

/** Cat-eye reflector dot, small emissive disc sitting flush with the lane centerline. */
function reflectorDot(x: number, z: number): GeometryPart {
  return boxPart(new THREE.Vector3(x, 0.03, z), new THREE.Vector3(0.3, 0.03, 0.3));
}

// ---------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------

function makeConcreteTexture(rng: Rng): THREE.CanvasTexture {
  const size = 256;
  const tex = makeCanvasTexture(size, size, (ctx) => {
    ctx.fillStyle = '#171b30';
    ctx.fillRect(0, 0, size, size);
    // Expansion joints: a couple of darker grid lines.
    ctx.strokeStyle = 'rgba(5,6,12,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.moveTo(size * 0.15, 0);
    ctx.lineTo(size * 0.15, size);
    ctx.moveTo(size * 0.85, 0);
    ctx.lineTo(size * 0.85, size);
    ctx.stroke();
    // Speckle noise for a worn concrete look.
    for (let i = 0; i < 500; i++) {
      const v = rng.range(0, 1);
      ctx.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${rng.range(0.02, 0.08)})`;
      ctx.fillRect(rng() * size, rng() * size, rng.range(1, 3), rng.range(1, 3));
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 3);
  return tex;
}

/**
 * Draws one crosswalk band: individual zebra stripes are short bars of length `stripeLen`
 * (oriented along local Y after rotation) repeated every `stripeThick + gap` across
 * `repeatSpan` (along local X after rotation) — i.e. a real zebra crossing, not a solid
 * block. `angleRad` picks which world axis local-X (the repeat/across-the-road axis) maps
 * onto: 0 keeps local X = world X, PI/2 maps local X = world Z.
 */
function stripeBand(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cz: number,
  angleRad: number,
  repeatSpan: number,
  stripeLen: number,
  stripeThick: number,
  gap: number
): void {
  ctx.save();
  ctx.translate(cx, cz);
  ctx.rotate(angleRad);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  let x = -repeatSpan / 2;
  while (x < repeatSpan / 2 - 0.01) {
    ctx.fillRect(x, -stripeLen / 2, stripeThick, stripeLen);
    x += stripeThick + gap;
  }
  ctx.restore();
}

/**
 * Shibuya scramble decal: realistic top-down layout with 4 edge zebra crossings (one per
 * road arm, set back near the plaza boundary) + 2 diagonal crossings going corner-to-corner,
 * all with bare-asphalt gaps so the center reads as open intersection, not an asterisk.
 *
 * Coordinate system (after ctx.translate to canvas center):
 *   canvas-X = world X (east-west, About street direction).
 *   canvas-Y = world Z (north-south, boulevard direction).
 *   plazaSize = 40 m; half = 20 m. scale = px/plazaSize pixels-per-metre.
 *
 * Layout (real Shibuya scramble reference):
 *   - 4 straight zebra crossings, one per road arm, centred at ±edgeOffset from plaza centre.
 *     Each crossing sits close to the plaza boundary (curb line), leaving a clear bare-asphalt
 *     zone in the middle of the intersection between the crossing bands.
 *   - 2 diagonal crossings (NW-SE and NE-SW) going corner-to-corner across the plaza.
 *     These cross through the centre (correct for a scramble), with stripes perpendicular
 *     to each diagonal direction — two distinct zebra bands, not a radiating asterisk.
 */
function makeCrossingTexture(rng: Rng, plazaSize: number): THREE.CanvasTexture {
  const px = 1024;
  const scale = px / plazaSize;

  // Stripe proportions: ~0.5 m white + ~0.55 m gap (realistic zebra crosswalk).
  const stripeW = 0.5 * scale;
  const gapW = 0.55 * scale;

  // Road half-width: STREET_WIDTH = 14 m, so full crossing spans 14 m across the road.
  const roadHalf = (STREET_WIDTH / 2) * scale;

  // Each straight crossing is centred at this offset from plaza centre (in metres).
  // Plaza half = 20 m; edgeOffset = 14 m puts crosswalk centre at 70% of the way to edge,
  // leaving clear bare asphalt between the diagonal crossing tips and the arm crossings.
  const edgeOffset = 14;
  const edgeOffPx = edgeOffset * scale;

  // Crosswalk band depth: the painted stripe region is 3.5 m wide perpendicular to travel.
  const cwDepth = 3.5 * scale;

  // Diagonal crossing: stripes repeat across the road width (14 m) in local-X (after 45° rotate),
  // and each stripe bar is cwDepth deep in local-Y (perpendicular to diagonal = pedestrian direction).
  const diagSpan = STREET_WIDTH * scale;

  return makeCanvasTexture(px, px, (ctx) => {
    ctx.translate(px / 2, px / 2);

    // --- 4 straight zebra crossings, one per road arm ---
    //
    // West crossing (crosses the N-S boulevard at the west edge of the plaza):
    //   Pedestrians walk E-W (canvas-X). Stripes repeat across E-W = local-X at angle 0.
    //   Each stripe bar is cwDepth tall in canvas-Y (N-S = along the road). Center at (-edgeOffset, 0).
    stripeBand(ctx, -edgeOffPx, 0, 0, 2 * roadHalf, cwDepth, stripeW, gapW);

    // East crossing:
    stripeBand(ctx, edgeOffPx, 0, 0, 2 * roadHalf, cwDepth, stripeW, gapW);

    // North crossing (crosses the E-W About street at the north edge of the plaza):
    //   Pedestrians walk N-S (canvas-Y). Angle PI/2 rotates local-X onto canvas-Y.
    //   Stripes repeat across N-S = local-X; each stripe elongated in canvas-X (E-W). Center at (0, -edgeOffset).
    stripeBand(ctx, 0, -edgeOffPx, Math.PI / 2, 2 * roadHalf, cwDepth, stripeW, gapW);

    // South crossing:
    stripeBand(ctx, 0, edgeOffPx, Math.PI / 2, 2 * roadHalf, cwDepth, stripeW, gapW);

    // --- 2 diagonal corner-to-corner crossings ---
    //
    // NW-SE diagonal (angle PI/4): local-X along NW-SE, local-Y along NE-SW.
    //   Stripes repeat 14 m along the diagonal; each is cwDepth perpendicular. Center at (0,0).
    stripeBand(ctx, 0, 0, Math.PI / 4, diagSpan, cwDepth, stripeW, gapW);

    // NE-SW diagonal (angle -PI/4):
    stripeBand(ctx, 0, 0, -Math.PI / 4, diagSpan, cwDepth, stripeW, gapW);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Worn/faded surface: erase random speckles out of the paint.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.1, 0.55)})`;
      const r = rng.range(1, 5);
      ctx.beginPath();
      ctx.arc(rng() * px, rng() * px, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}

function makeManholeTexture(): THREE.CanvasTexture {
  const size = 128;
  return makeCanvasTexture(size, size, (ctx) => {
    ctx.fillStyle = '#1a1d2a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
    // Grate cross-hatch.
    ctx.lineWidth = 2;
    for (let i = 1; i < 6; i++) {
      const r = ((size / 2 - 8) * i) / 6;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2 + Math.cos(ang) * (size / 2 - 4), size / 2 + Math.sin(ang) * (size / 2 - 4));
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------

function makeMaterials(rng: Rng) {
  const road = new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 0.35, metalness: 0.75 });
  const structure = new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.4, metalness: 0.8 });
  const curb = new THREE.MeshStandardMaterial({
    color: CONCRETE,
    roughness: 0.85,
    metalness: 0.05,
    map: makeConcreteTexture(rng)
  });
  const marking = new THREE.MeshStandardMaterial({
    color: PAINT_WHITE,
    emissive: PAINT_WHITE,
    emissiveIntensity: 0.12,
    roughness: 0.5,
    metalness: 0
  });
  const crossing = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: makeCrossingTexture(rng, 40),
    transparent: true,
    roughness: 0.6,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });
  // C1 fix: reduced emissiveIntensity 2.2 → 1.4 so bridge/skyway cyan edge-light strips
  // read as crisp neon lines without blowing out under bloom at finale camera distances.
  const cyanEdge = new THREE.MeshStandardMaterial({
    color: COLORS.tronCyan,
    emissive: COLORS.tronCyan,
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0.2
  });
  const cable = new THREE.MeshStandardMaterial({
    color: COLORS.holoTeal,
    emissive: COLORS.holoTeal,
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.3
  });
  const reflector = new THREE.MeshStandardMaterial({
    color: COLORS.sodiumAmber,
    emissive: COLORS.sodiumAmber,
    emissiveIntensity: 2.5,
    roughness: 0.4,
    metalness: 0.1
  });
  const manhole = new THREE.MeshStandardMaterial({
    color: 0x1a1d2a,
    map: makeManholeTexture(),
    roughness: 0.6,
    metalness: 0.5
  });
  return { road, structure, curb, marking, crossing, cyanEdge, cable, reflector, manhole };
}

type Materials = ReturnType<typeof makeMaterials>;

// ---------------------------------------------------------------------------------
// About street (flat, along +X)
// ---------------------------------------------------------------------------------

const ABOUT_CENTER_X = (WAYPOINTS.introStart.x + WAYPOINTS.shibuyaCenter.x) / 2;
const ABOUT_LEN = 560;
const ABOUT_X0 = ABOUT_CENTER_X - ABOUT_LEN / 2;
const ABOUT_X1 = ABOUT_CENTER_X + ABOUT_LEN / 2;

function buildAboutStreet(): { road: GeometryPart[]; curb: GeometryPart[]; marking: GeometryPart[] } {
  // Markings and sidewalks stop at the plaza's WEST edge (x = 220): markings sit at
  // y 0.02-0.025 (above the plaza top at y 0.02) and sidewalks at y 0.15, so running them
  // through the plaza footprint would cut painted stripes / raised strips straight through
  // the scramble-crossing decal. The road slab itself still runs to ABOUT_X1 underneath the
  // plaza (its top at y = 0 is fully covered by the plaza slab's top at y = 0.02).
  const clipX = WAYPOINTS.shibuyaCenter.x - PLAZA_SIZE / 2;
  const clippedLen = clipX - ABOUT_X0;
  const clippedCenter = ABOUT_X0 + clippedLen / 2;

  const road = [flatRoadPart(ABOUT_CENTER_X, 0, ABOUT_LEN, STREET_WIDTH)];
  const curb = [
    boxPart(
      new THREE.Vector3(clippedCenter, CURB_H / 2, SIDEWALK_OFFSET),
      new THREE.Vector3(clippedLen, CURB_H, SIDEWALK_W)
    ),
    boxPart(
      new THREE.Vector3(clippedCenter, CURB_H / 2, -SIDEWALK_OFFSET),
      new THREE.Vector3(clippedLen, CURB_H, SIDEWALK_W)
    )
  ];
  const marking: GeometryPart[] = [
    solidAlongX(HALF_STREET - 0.15, ABOUT_X0, clipX),
    solidAlongX(-HALF_STREET + 0.15, ABOUT_X0, clipX),
    solidAlongX(0, ABOUT_X0, clipX),
    ...dashesAlongX(HALF_STREET / 2, ABOUT_X0, clipX),
    ...dashesAlongX(-HALF_STREET / 2, ABOUT_X0, clipX)
  ];
  return { road, curb, marking };
}

// ---------------------------------------------------------------------------------
// Projects boulevard (flat, along -Z) with the two ramp jumps
// ---------------------------------------------------------------------------------

const BLVD_X = WAYPOINTS.shibuyaCenter.x; // 240

interface RampSpec {
  base: THREE.Vector3;
  land: THREE.Vector3;
}

const RAMPS: RampSpec[] = [
  { base: WAYPOINTS.ramp1Base, land: WAYPOINTS.ramp1Land },
  { base: WAYPOINTS.ramp2Base, land: WAYPOINTS.ramp2Land }
];

function buildBoulevard(): { road: GeometryPart[]; curb: GeometryPart[]; marking: GeometryPart[]; reflector: GeometryPart[] } {
  const road: GeometryPart[] = [];
  const marking: GeometryPart[] = [];
  const reflector: GeometryPart[] = [];

  // Boulevard surfaces start flush with the plaza slab's south edge (-PLAZA_SIZE/2 = -20),
  // NOT at driftExit (-30): the plaza only covers z in [-20, +20], so keying off driftExit
  // left a 10m hole in the drivable surface between the plaza and the first road segment.
  // Exact abutment at z = -20 (no overlap), so there's no double-stacked z-fight either.
  const zTop = -PLAZA_SIZE / 2;
  const zBottom = WAYPOINTS.skywayStart.z; // -420

  // Flat segments between plaza edge / ramp1 / ramp2 / skywayStart, skipping the wedge + gap zones.
  const segments: Array<[number, number]> = [
    [zTop, RAMPS[0].base.z],
    [RAMPS[0].land.z - RAMP_LEN, RAMPS[1].base.z],
    [RAMPS[1].land.z - RAMP_LEN, zBottom]
  ];

  for (const [z0, z1] of segments) {
    const len = Math.abs(z1 - z0);
    const center = (z0 + z1) / 2;
    road.push(flatRoadPart(BLVD_X, center, STREET_WIDTH, len));
    marking.push(solidAlongZ(BLVD_X + HALF_STREET - 0.15, z0, z1));
    marking.push(solidAlongZ(BLVD_X - HALF_STREET + 0.15, z0, z1));
    marking.push(solidAlongZ(BLVD_X, z0, z1));
    marking.push(...dashesAlongZ(BLVD_X + HALF_STREET / 2, z0, z1));
    marking.push(...dashesAlongZ(BLVD_X - HALF_STREET / 2, z0, z1));

    // Cat-eye reflectors down both lane centers, every 12m.
    const dir = z1 < z0 ? -1 : 1;
    for (let z = z0; dir < 0 ? z > z1 : z < z1; z += dir * 12) {
      reflector.push(reflectorDot(BLVD_X + HALF_STREET / 2, z));
      reflector.push(reflectorDot(BLVD_X - HALF_STREET / 2, z));
    }
  }

  // Ramp wedges: launch wedge at Base (lip faces further -Z into the gap), landing wedge at
  // Land (lip faces back toward the gap, then descends continuing -Z).
  for (const { base, land } of RAMPS) {
    road.push(wedgePart(base, true));
    road.push(wedgePart(land, false));
  }

  const curb: GeometryPart[] = [
    boxPart(
      new THREE.Vector3(BLVD_X + SIDEWALK_OFFSET, CURB_H / 2, (zTop + zBottom) / 2),
      new THREE.Vector3(SIDEWALK_W, CURB_H, Math.abs(zBottom - zTop))
    ),
    boxPart(
      new THREE.Vector3(BLVD_X - SIDEWALK_OFFSET, CURB_H / 2, (zTop + zBottom) / 2),
      new THREE.Vector3(SIDEWALK_W, CURB_H, Math.abs(zBottom - zTop))
    )
  ];

  return { road, curb, marking, reflector };
}

// ---------------------------------------------------------------------------------
// Shibuya scramble intersection
// ---------------------------------------------------------------------------------

const PLAZA_SIZE = 40;

function buildShibuya(materials: Materials): { road: GeometryPart[]; curb: GeometryPart[]; crossing: THREE.Mesh } {
  const road = [
    boxPart(
      new THREE.Vector3(WAYPOINTS.shibuyaCenter.x, -0.08, 0),
      new THREE.Vector3(PLAZA_SIZE, 0.2, PLAZA_SIZE)
    )
  ];

  const bulbSize = 7;
  const bulbOffset = 11.5;
  const curb: GeometryPart[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      curb.push(
        boxPart(
          new THREE.Vector3(WAYPOINTS.shibuyaCenter.x + sx * bulbOffset, CURB_H / 2, sz * bulbOffset),
          new THREE.Vector3(bulbSize, CURB_H, bulbSize)
        )
      );
    }
  }

  const decalGeom = new THREE.PlaneGeometry(PLAZA_SIZE, PLAZA_SIZE);
  decalGeom.rotateX(-Math.PI / 2);
  const crossing = new THREE.Mesh(decalGeom, materials.crossing);
  crossing.position.set(WAYPOINTS.shibuyaCenter.x, 0.03, 0);

  return { road, curb, crossing };
}

// ---------------------------------------------------------------------------------
// Skyway (elevated, curved) + connector + bridge
// ---------------------------------------------------------------------------------

const SKYWAY_HALF_W = 5; // 10 wide
const BRIDGE_HALF_W = 6; // 12 wide
const DECK_THICKNESS = 0.6;
const RAIL_H = 1.1;
const TOWER_HEIGHT = 40;

function buildSkyway(): {
  road: GeometryPart[];
  structure: GeometryPart[];
  cyan: GeometryPart[];
} {
  const frames = sampleFrames(ROUTE_U.skywayStart, ROUTE_U.skywayEnd, 40);
  const road = deckParts(frames, SKYWAY_HALF_W, SKYWAY_HALF_W, DECK_THICKNESS);
  const structure = [
    ...railParts(frames, SKYWAY_HALF_W, RAIL_H),
    ...pylonParts(frames, 30, 1.2)
  ];
  const cyan = edgeLightParts(frames, SKYWAY_HALF_W);
  return { road, structure, cyan };
}

function buildConnector(): { road: GeometryPart[]; structure: GeometryPart[]; cyan: GeometryPart[] } {
  const frames = sampleFrames(ROUTE_U.skywayEnd, ROUTE_U.bridgeStart, 10);
  const road = deckParts(frames, SKYWAY_HALF_W, BRIDGE_HALF_W, DECK_THICKNESS);
  const structure = [
    ...railParts(frames, SKYWAY_HALF_W, RAIL_H),
    ...pylonParts(frames, 30, 1.2)
  ];
  const cyan = edgeLightParts(frames, (SKYWAY_HALF_W + BRIDGE_HALF_W) / 2);
  return { road, structure, cyan };
}

/**
 * Shared tower + suspension-cable builder for a bridge span, given the frames at its two
 * ends, the two tower stations, and the midspan sag point. Used by both the real
 * (route-following) bridge and the `streetsBridge` debug sub-asset's synthetic straight
 * span, so the cable-sag math only lives in one place.
 */
function buildBridgeTowersAndCables(
  frameStart: RoadFrame,
  frameEnd: RoadFrame,
  frameA: RoadFrame,
  frameB: RoadFrame,
  frameMid: RoadFrame
): { structure: GeometryPart[]; cable: GeometryPart[] } {
  const structure: GeometryPart[] = [];
  const cable: GeometryPart[] = [];

  for (const side of [-1, 1]) {
    const colA = frameA.pos.clone().add(frameA.binormal.clone().multiplyScalar(side * BRIDGE_HALF_W));
    const colB = frameB.pos.clone().add(frameB.binormal.clone().multiplyScalar(side * BRIDGE_HALF_W));

    // Tower columns + cap beam + beacon.
    structure.push(
      boxPart(colA.clone().add(new THREE.Vector3(0, TOWER_HEIGHT / 2, 0)), new THREE.Vector3(2, TOWER_HEIGHT, 2))
    );
    structure.push(
      boxPart(colB.clone().add(new THREE.Vector3(0, TOWER_HEIGHT / 2, 0)), new THREE.Vector3(2, TOWER_HEIGHT, 2))
    );

    const beaconGeomA = new THREE.SphereGeometry(1.4, 12, 12).toNonIndexed();
    cable.push({
      geom: beaconGeomA,
      matrix: new THREE.Matrix4().setPosition(colA.x, colA.y + TOWER_HEIGHT, colA.z),
      mat: 0
    });
    const beaconGeomB = new THREE.SphereGeometry(1.4, 12, 12).toNonIndexed();
    cable.push({
      geom: beaconGeomB,
      matrix: new THREE.Matrix4().setPosition(colB.x, colB.y + TOWER_HEIGHT, colB.z),
      mat: 0
    });

    // Sagging main cable: anchor -> tower top -> midspan sag -> tower top -> anchor.
    const anchorStart = frameStart.pos
      .clone()
      .add(frameStart.binormal.clone().multiplyScalar(side * BRIDGE_HALF_W));
    const anchorEnd = frameEnd.pos.clone().add(frameEnd.binormal.clone().multiplyScalar(side * BRIDGE_HALF_W));
    const towerTopA = colA.clone().add(new THREE.Vector3(0, TOWER_HEIGHT, 0));
    const towerTopB = colB.clone().add(new THREE.Vector3(0, TOWER_HEIGHT, 0));
    const sagPoint = frameMid.pos
      .clone()
      .add(frameMid.binormal.clone().multiplyScalar(side * BRIDGE_HALF_W))
      .add(new THREE.Vector3(0, 4, 0));

    const curve = new THREE.CatmullRomCurve3([anchorStart, towerTopA, sagPoint, towerTopB, anchorEnd]);
    const tubeGeom = new THREE.TubeGeometry(curve, 64, 0.35, 8, false).toNonIndexed();
    cable.push({ geom: tubeGeom, matrix: new THREE.Matrix4(), mat: 0 });
  }

  // Cap beams connecting the two columns of each tower.
  const capA = frameA.pos.clone().add(new THREE.Vector3(0, TOWER_HEIGHT, 0));
  const capB = frameB.pos.clone().add(new THREE.Vector3(0, TOWER_HEIGHT, 0));
  structure.push(boxPart(capA, new THREE.Vector3(BRIDGE_HALF_W * 2 + 2, 1.5, 1.5), frameA.binormal, frameA.normal, frameA.tangent));
  structure.push(boxPart(capB, new THREE.Vector3(BRIDGE_HALF_W * 2 + 2, 1.5, 1.5), frameB.binormal, frameB.normal, frameB.tangent));

  return { structure, cable };
}

function buildBridge(): {
  road: GeometryPart[];
  structure: GeometryPart[];
  cyan: GeometryPart[];
  cable: GeometryPart[];
} {
  const frames = sampleFrames(ROUTE_U.bridgeStart, ROUTE_U.bridgeEnd, 60);
  const road = deckParts(frames, BRIDGE_HALF_W, BRIDGE_HALF_W, DECK_THICKNESS);
  const rails = railParts(frames, BRIDGE_HALF_W, 1.0);
  const cyan = edgeLightParts(frames, BRIDGE_HALF_W);

  const uA = THREE.MathUtils.lerp(ROUTE_U.bridgeStart, ROUTE_U.bridgeEnd, 0.22);
  const uB = THREE.MathUtils.lerp(ROUTE_U.bridgeStart, ROUTE_U.bridgeEnd, 0.78);
  const uMid = (uA + uB) / 2;
  const { structure: towers, cable } = buildBridgeTowersAndCables(
    roadFrame(ROUTE_U.bridgeStart),
    roadFrame(ROUTE_U.bridgeEnd),
    roadFrame(uA),
    roadFrame(uB),
    roadFrame(uMid)
  );

  return { road, structure: [...rails, ...towers], cyan, cable };
}

// ---------------------------------------------------------------------------------
// Iteration-loop detail: manholes + storm drains
// ---------------------------------------------------------------------------------

function buildManholes(rng: Rng): GeometryPart[] {
  const parts: GeometryPart[] = [];
  const manholeGeom = new THREE.CylinderGeometry(0.7, 0.7, 0.04, 20).toNonIndexed();

  // A handful of manholes down the About street + boulevard lane centers.
  for (let x = ABOUT_X0 + 20; x < ABOUT_X1 - 20; x += 45) {
    parts.push({ geom: manholeGeom, matrix: new THREE.Matrix4().setPosition(x, 0.02, rng.pick([-3.5, 3.5])), mat: 0 });
  }
  const zTop = WAYPOINTS.driftExit.z;
  const zBottom = WAYPOINTS.ramp1Base.z;
  for (let z = zTop - 15; z > zBottom + 10; z -= 40) {
    parts.push({
      geom: manholeGeom,
      matrix: new THREE.Matrix4().setPosition(BLVD_X + rng.pick([-3.5, 3.5]), 0.02, z),
      mat: 0
    });
  }

  // Storm drains: short grated slots at the curb line, along both streets.
  const drainGeom = new THREE.BoxGeometry(1.6, 0.03, 0.4).toNonIndexed();
  for (let x = ABOUT_X0 + 15; x < ABOUT_X1 - 15; x += 60) {
    for (const z of [HALF_STREET - 0.3, -HALF_STREET + 0.3]) {
      parts.push({ geom: drainGeom, matrix: new THREE.Matrix4().setPosition(x, 0.015, z), mat: 0 });
    }
  }
  for (let z = zTop - 10; z > zBottom + 10; z -= 50) {
    for (const x of [BLVD_X + HALF_STREET - 0.3, BLVD_X - HALF_STREET + 0.3]) {
      const m = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      m.setPosition(x, 0.015, z);
      parts.push({ geom: drainGeom, matrix: m, mat: 0 });
    }
  }

  return parts;
}

// ---------------------------------------------------------------------------------
// Worn asphalt patches via vertex-color darkening
// ---------------------------------------------------------------------------------

/** Darkens random patches of the merged road mesh via a vertex-color multiplier, so the
 * asphalt reads as worn/uneven instead of a perfectly uniform material. */
function applyWornPatches(
  mesh: THREE.Mesh,
  rng: Rng,
  material: THREE.MeshStandardMaterial,
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number } = {
    xMin: -320,
    xMax: 260,
    zMin: -1400,
    zMax: 20
  },
  numPatches = 40
): void {
  const geom = mesh.geometry;
  const pos = geom.getAttribute('position');
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  // A handful of random patch centers (world-space-ish, using local/merged coordinates).
  const patches: Array<{ x: number; z: number; r: number; darkness: number }> = [];
  for (let i = 0; i < numPatches; i++) {
    patches.push({
      x: rng.range(bounds.xMin, bounds.xMax),
      z: rng.range(bounds.zMin, bounds.zMax),
      r: rng.range(4, 14),
      darkness: rng.range(0.3, 0.7)
    });
  }

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let shade = 1;
    for (const p of patches) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r) {
        shade *= 1 - p.darkness * (1 - d / p.r);
      }
    }
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  material.vertexColors = true;
}

// ---------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------

// Detail-pass feature flags, flipped on one at a time during the Step 4 iteration loop
// (see task-7-report.md for the see -> add log). All default true for the shipped version.
const DETAIL_MANHOLES = true;
const DETAIL_REFLECTORS = true;
const DETAIL_WORN_PATCHES = true;

export function buildStreets(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  const materials = makeMaterials(rng);

  const about = buildAboutStreet();
  const blvd = buildBoulevard();
  const shibuya = buildShibuya(materials);
  const skyway = buildSkyway();
  const connector = buildConnector();
  const bridge = buildBridge();
  const manholes = DETAIL_MANHOLES ? buildManholes(rng) : [];

  const roadParts = [
    ...about.road,
    ...blvd.road,
    ...shibuya.road,
    ...skyway.road,
    ...connector.road,
    ...bridge.road
  ];
  const structureParts = [...skyway.structure, ...connector.structure, ...bridge.structure];
  const curbParts = [...about.curb, ...blvd.curb, ...shibuya.curb];
  const markingParts = [...about.marking, ...blvd.marking];
  const cyanParts = [...skyway.cyan, ...connector.cyan, ...bridge.cyan];
  const cableParts = [...bridge.cable];
  const reflectorParts = DETAIL_REFLECTORS ? [...blvd.reflector] : [];

  const roadMesh = mergeOne(roadParts, materials.road);
  if (DETAIL_WORN_PATCHES) applyWornPatches(roadMesh, rng, materials.road);
  group.add(roadMesh);
  group.add(mergeOne(structureParts, materials.structure));
  group.add(mergeOne(curbParts, materials.curb));
  group.add(mergeOne(markingParts, materials.marking));
  group.add(mergeOne(cyanParts, materials.cyanEdge));
  group.add(mergeOne(cableParts, materials.cable));
  if (reflectorParts.length) group.add(mergeOne(reflectorParts, materials.reflector));
  if (manholes.length) group.add(mergeOne(manholes, materials.manhole));
  group.add(shibuya.crossing);

  return group;
}

/** Debug-only sub-asset: just the Shibuya scramble crossing + a short stub of each street.
 * Kept tight (25m stubs, not the full 560m About street) so the viewer's bounding-sphere
 * auto-framing actually zooms in instead of parking the camera hundreds of meters back. */
export function buildStreetsShibuya(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  const materials = makeMaterials(rng);
  const shibuya = buildShibuya(materials);

  const stub = 25;
  // Stubs mirror production layout: About street approaches from the WEST (production's
  // slab ends at x = 250, inside the plaza — there is no street east of it), boulevard
  // leaves south, both abutting the plaza edges exactly like buildAboutStreet/buildBoulevard.
  const westEdge = WAYPOINTS.shibuyaCenter.x - PLAZA_SIZE / 2;
  const southEdge = -PLAZA_SIZE / 2;
  const roadParts = [
    ...shibuya.road,
    flatRoadPart(westEdge - stub / 2, 0, stub, STREET_WIDTH),
    flatRoadPart(BLVD_X, southEdge - stub / 2, STREET_WIDTH, stub)
  ];
  const markingParts = [
    solidAlongX(HALF_STREET - 0.15, westEdge - stub, westEdge),
    solidAlongX(-HALF_STREET + 0.15, westEdge - stub, westEdge),
    ...dashesAlongX(HALF_STREET / 2, westEdge - stub, westEdge),
    ...dashesAlongX(-HALF_STREET / 2, westEdge - stub, westEdge),
    solidAlongZ(BLVD_X + HALF_STREET - 0.15, southEdge, southEdge - stub),
    solidAlongZ(BLVD_X - HALF_STREET + 0.15, southEdge, southEdge - stub)
  ];

  group.add(mergeOne(roadParts, materials.road));
  group.add(mergeOne(shibuya.curb, materials.curb));
  group.add(mergeOne(markingParts, materials.marking));
  group.add(shibuya.crossing);
  return group;
}

/**
 * Debug-only sub-asset: the launch + landing wedge pair, close together. This is a
 * synthetic close-up layout (NOT the real ramp1Base/ramp1Land world positions, which are
 * 80m apart with a 72m open-air gap between the wedges) — per the Task 6 precedent
 * ("adjust the debug asset, not the route"), spacing is compressed here purely so the
 * viewer's auto-framed camera gets close enough to read the wedge silhouettes instead of
 * parking ~100m back to fit the true gap distance.
 */
export function buildStreetsRamp(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  const materials = makeMaterials(rng);

  const approachLen = 15;
  const gapLen = 10;
  const runoffLen = 15;
  const baseZ = 0;
  const landZ = baseZ - RAMP_LEN - gapLen;
  const runoffStart = landZ - RAMP_LEN;

  const roadParts: GeometryPart[] = [
    flatRoadPart(BLVD_X, baseZ + approachLen / 2, STREET_WIDTH, approachLen),
    wedgePart(new THREE.Vector3(BLVD_X, 0, baseZ), true),
    wedgePart(new THREE.Vector3(BLVD_X, 0, landZ), false),
    flatRoadPart(BLVD_X, runoffStart - runoffLen / 2, STREET_WIDTH, runoffLen)
  ];
  const spanCenterZ = (approachLen + runoffStart - runoffLen) / 2;
  const spanLen = approachLen - runoffStart + runoffLen;
  const curbParts: GeometryPart[] = [
    boxPart(new THREE.Vector3(BLVD_X + SIDEWALK_OFFSET, CURB_H / 2, spanCenterZ), new THREE.Vector3(SIDEWALK_W, CURB_H, spanLen)),
    boxPart(new THREE.Vector3(BLVD_X - SIDEWALK_OFFSET, CURB_H / 2, spanCenterZ), new THREE.Vector3(SIDEWALK_W, CURB_H, spanLen))
  ];

  const roadMesh = mergeOne(roadParts, materials.road);
  if (DETAIL_WORN_PATCHES) {
    applyWornPatches(
      roadMesh,
      rng,
      materials.road,
      { xMin: BLVD_X - HALF_STREET, xMax: BLVD_X + HALF_STREET, zMin: runoffStart - runoffLen, zMax: baseZ + approachLen },
      15
    );
  }
  group.add(roadMesh);
  group.add(mergeOne(curbParts, materials.curb));

  if (DETAIL_REFLECTORS) {
    const reflectorParts: GeometryPart[] = [];
    for (let z = approachLen - 2; z > baseZ; z -= 5) {
      reflectorParts.push(reflectorDot(BLVD_X + HALF_STREET / 2, z));
      reflectorParts.push(reflectorDot(BLVD_X - HALF_STREET / 2, z));
    }
    for (let z = runoffStart; z > runoffStart - runoffLen + 2; z -= 5) {
      reflectorParts.push(reflectorDot(BLVD_X + HALF_STREET / 2, z));
      reflectorParts.push(reflectorDot(BLVD_X - HALF_STREET / 2, z));
    }
    group.add(mergeOne(reflectorParts, materials.reflector));
  }
  if (DETAIL_MANHOLES) {
    const manholeGeom = new THREE.CylinderGeometry(0.7, 0.7, 0.04, 20).toNonIndexed();
    const manholeParts: GeometryPart[] = [
      { geom: manholeGeom, matrix: new THREE.Matrix4().setPosition(BLVD_X - 3, 0.02, approachLen - 6), mat: 0 },
      { geom: manholeGeom, matrix: new THREE.Matrix4().setPosition(BLVD_X + 3, 0.02, runoffStart - 8), mat: 0 }
    ];
    group.add(mergeOne(manholeParts, materials.manhole));
  }

  return group;
}

function syntheticFrame(z: number): RoadFrame {
  return {
    pos: new THREE.Vector3(0, 0, z),
    tangent: new THREE.Vector3(0, 0, -1),
    normal: new THREE.Vector3(0, 1, 0),
    binormal: new THREE.Vector3(1, 0, 0)
  };
}

/**
 * Debug-only sub-asset: a synthetic (NOT route-following) straight two-tower suspension
 * span, at the same tower height / cable-sag math as the real bridge, just compressed to
 * ~140m total instead of the real bridge's 540m. The real bridge sits ~900m out along the
 * route (deep into FogExp2 falloff at true scale — same reasoning as DISPLAY_SCALE in
 * routeDebug), so this exists purely to let the viewer's auto-framing get close enough to
 * check that the main cables actually sag into a believable catenary-like curve.
 */
export function buildStreetsBridge(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  const materials = makeMaterials(rng);

  const span = 60; // distance between the two towers
  const overhang = 25; // deck run-off past each tower to an anchor point
  const frameStart = syntheticFrame(overhang);
  const frameEnd = syntheticFrame(-(span + overhang));
  const frameA = syntheticFrame(0);
  const frameB = syntheticFrame(-span);
  const frameMid = syntheticFrame(-span / 2);

  const frames = sampleFrames(0, 1, 24).map((_, i, arr) =>
    syntheticFrame(overhang - ((overhang * 2 + span) * i) / (arr.length - 1))
  );
  const road = deckParts(frames, BRIDGE_HALF_W, BRIDGE_HALF_W, DECK_THICKNESS);
  const rails = railParts(frames, BRIDGE_HALF_W, 1.0);
  const { structure: towers, cable } = buildBridgeTowersAndCables(frameStart, frameEnd, frameA, frameB, frameMid);

  group.add(mergeOne(road, materials.road));
  group.add(mergeOne([...rails, ...towers], materials.structure));
  group.add(mergeOne(cable, materials.cable));
  return group;
}
