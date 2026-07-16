import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roadFrame, sampleRoute, ZONES } from './route';
import { COLORS } from '../theme';
import type { Rng } from '../utils/rng';
import { buildBillboard } from '../assets/billboards/billboards';
import { makeAd } from '../content/adGenerator';

// ──────────────────────────────────────────────────────────────────────────────
// Constants (exported per brief)
// ──────────────────────────────────────────────────────────────────────────────

/** Half-width of the road surface (3 lanes ≈ 14 m total). */
export const ROAD_HALF_WIDTH = 7;

/** Half-width of the clear corridor reserved for road + sidewalks. */
export const CORRIDOR_HALF = 17;

// Sidewalk occupies the gap between road edge and corridor edge.
const SIDEWALK_WIDTH = CORRIDOR_HALF - ROAD_HALF_WIDTH; // 10 m each side

// Number of longitudinal samples for the quad-strip sweep.
const ROAD_STEPS = 200;

// Ground plane extends this far in each direction from the route bounding box.
const GROUND_MARGIN = 300;

// ──────────────────────────────────────────────────────────────────────────────
// Materials (flat dark neutrals — grey-box palette, no tronCyan)
// ──────────────────────────────────────────────────────────────────────────────

const matAsphalt = new THREE.MeshStandardMaterial({
  color: COLORS.shadowBlue,   // dark asphalt (~0x101426)
  roughness: 0.9,
  metalness: 0.0,
});

const matConcrete = new THREE.MeshStandardMaterial({
  color: 0x1a1e2e,            // slightly lighter than asphalt for sidewalk
  roughness: 0.85,
  metalness: 0.0,
});

const matGround = new THREE.MeshStandardMaterial({
  color: COLORS.void,         // deepest dark for the city floor
  roughness: 1.0,
  metalness: 0.0,
});

// ──────────────────────────────────────────────────────────────────────────────
// Quad-strip builder helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Given two parallel edges (each with an array of Vector3 points along the
 * strip), build a BufferGeometry of quads (two triangles each).
 */
function buildStripGeometry(
  leftEdge: THREE.Vector3[],
  rightEdge: THREE.Vector3[]
): THREE.BufferGeometry {
  const n = leftEdge.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const l = leftEdge[i];
    const r = rightEdge[i];
    // Vertex index base for this slice: 2*i (left), 2*i+1 (right)
    positions.push(l.x, l.y, l.z);
    positions.push(r.x, r.y, r.z);
    normals.push(0, 1, 0, 0, 1, 0); // pointing up (flat road/sidewalk)
  }

  // Build quads between consecutive slices.
  for (let i = 0; i < n - 1; i++) {
    const bl = 2 * i;       // bottom-left
    const br = 2 * i + 1;   // bottom-right
    const tl = 2 * (i + 1); // top-left
    const tr = 2 * (i + 1) + 1; // top-right

    // Triangle 1: bl, tl, br
    indices.push(bl, tl, br);
    // Triangle 2: tl, tr, br
    indices.push(tl, tr, br);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

// ──────────────────────────────────────────────────────────────────────────────
// Road surface detailing — CanvasTexture lane markings + wet-neon sheen
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Creates a canvas texture for the road surface with lane markings,
 * dashed centre line, crosswalk paint, and a subtle wet-neon sheen
 * (emissive at near-zero intensity so it catches bloom).
 * The canvas is 1024×512 representing ~14m wide × ~30m long of road tile.
 */
function makeRoadMarkingsTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: W, height: H, getContext: () => null } as any;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) {
    // In test/Node environments without full canvas, return a plain texture stub.
    return new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  }

  // Base — dark wet asphalt
  ctx.fillStyle = '#101426';
  ctx.fillRect(0, 0, W, H);

  // Very subtle grid of puddle-reflections — horizontal bands at ~10% opacity
  ctx.fillStyle = 'rgba(16,60,80,0.12)';
  for (let y = 0; y < H; y += 32) {
    ctx.fillRect(0, y, W, 14);
  }

  // Lane dividers — white dashed lines
  // Road is 14 m wide; canvas W=1024 represents that full width.
  // 3 lanes, 2 dashed separators at 1/3 and 2/3.
  const laneW = W / 3;
  ctx.strokeStyle = 'rgba(220,220,200,0.55)';
  ctx.lineWidth = 4;
  ctx.setLineDash([60, 40]);
  for (let lane = 1; lane <= 2; lane++) {
    const x = lane * laneW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Edge lines — solid white at road edges
  ctx.strokeStyle = 'rgba(220,220,200,0.6)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(3, 0); ctx.lineTo(3, H);
  ctx.moveTo(W - 3, 0); ctx.lineTo(W - 3, H);
  ctx.stroke();

  // Crosswalk stripes at y ≈ 10% and 85% of texture height
  ctx.fillStyle = 'rgba(200,200,180,0.35)';
  const stripeW = 60;
  const stripeGap = 18;
  const totalStripe = stripeW + stripeGap;
  for (const crossY of [Math.floor(H * 0.1), Math.floor(H * 0.85)]) {
    for (let x = 0; x < W; x += totalStripe) {
      ctx.fillRect(x, crossY, stripeW, 28);
    }
  }

  // Manhole / grate decals — very subtle dark circles/rectangles
  ctx.fillStyle = 'rgba(8,10,20,0.5)';
  const manholes: [number, number, number, number][] = [
    [W * 0.5, H * 0.3, 22, 22],
    [W * 0.16, H * 0.6, 20, 14],
    [W * 0.82, H * 0.55, 20, 14],
  ];
  for (const [mx, my, mw, mh] of manholes) {
    ctx.beginPath();
    ctx.ellipse(mx, my, mw, mh, 0, 0, Math.PI * 2);
    ctx.fill();
    // Grate lines
    ctx.strokeStyle = 'rgba(30,35,55,0.6)';
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(mx - mw + 4, my + i * mh * 0.4);
      ctx.lineTo(mx + mw - 4, my + i * mh * 0.4);
      ctx.stroke();
    }
  }

  // Subtle neon-wet specular — a faint teal/magenta band near centre
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.35, 'rgba(183,245,233,0.06)');  // holoTeal
  grad.addColorStop(0.65, 'rgba(255,43,214,0.04)');   // signalMagenta
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 8); // tile longitudinally
  return tex;
}

// Lazy-initialised so we don't pay canvas cost in tests that don't need it,
// and share one texture across the road mesh.
let _roadMarkingsTex: THREE.CanvasTexture | null = null;
function getRoadMarkingsTex(): THREE.CanvasTexture {
  if (!_roadMarkingsTex) _roadMarkingsTex = makeRoadMarkingsTexture();
  return _roadMarkingsTex;
}

// ──────────────────────────────────────────────────────────────────────────────
// buildStreets
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Builds the road ribbon, sidewalks, ground plane, and road surface detailing
 * (lane markings, crosswalk paint, wet-neon sheen via CanvasTexture).
 *
 * @param rng - Seeded RNG (accepted per project convention).
 * @returns A THREE.Group named 'streets' containing road, sidewalks, ground.
 */
export function buildStreets(_rng: Rng): THREE.Group {
  // ── Sample the route frame at ROAD_STEPS uniform semantic-t intervals ──────
  const roadLeft: THREE.Vector3[] = [];
  const roadRight: THREE.Vector3[] = [];
  const swLeftInner: THREE.Vector3[] = [];
  const swLeftOuter: THREE.Vector3[] = [];
  const swRightInner: THREE.Vector3[] = [];
  const swRightOuter: THREE.Vector3[] = [];

  // Track bounding box for ground plane sizing.
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i <= ROAD_STEPS; i++) {
    const t = i / ROAD_STEPS;
    const frame = roadFrame(t);
    const { pos, binormal } = frame;

    // Road surface sits at the route y (pos.y already encodes ramp heights).
    const roadY = Math.max(pos.y, 0);
    const roadBase = new THREE.Vector3(pos.x, roadY, pos.z);

    roadLeft.push(roadBase.clone().addScaledVector(binormal, -ROAD_HALF_WIDTH));
    roadRight.push(roadBase.clone().addScaledVector(binormal, ROAD_HALF_WIDTH));

    swLeftInner.push(roadBase.clone().addScaledVector(binormal, -ROAD_HALF_WIDTH));
    swLeftOuter.push(roadBase.clone().addScaledVector(binormal, -CORRIDOR_HALF));

    swRightInner.push(roadBase.clone().addScaledVector(binormal, ROAD_HALF_WIDTH));
    swRightOuter.push(roadBase.clone().addScaledVector(binormal, CORRIDOR_HALF));

    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minZ = Math.min(minZ, pos.z);
    maxZ = Math.max(maxZ, pos.z);
  }

  // ── Build road geometry ───────────────────────────────────────────────────
  const roadGeom = buildStripGeometry(roadLeft, roadRight);

  // ── Build sidewalk geometries ─────────────────────────────────────────────
  const swLeftGeom = buildStripGeometry(swLeftOuter, swLeftInner);
  const swRightGeom = buildStripGeometry(swRightInner, swRightOuter);

  // Merge the two sidewalk geometries into one mesh to halve draw calls.
  const sidewalkMerged = mergeGeometries([swLeftGeom, swRightGeom]);
  if (!sidewalkMerged) throw new Error('streets: failed to merge sidewalk geometries');

  // Road material — use canvas texture for lane markings + wet sheen
  const roadMarkingsTex = getRoadMarkingsTex();
  const matDetailedAsphalt = new THREE.MeshStandardMaterial({
    color: COLORS.shadowBlue,
    map: roadMarkingsTex,
    emissiveMap: roadMarkingsTex,
    emissive: new THREE.Color(COLORS.holoTeal),
    emissiveIntensity: 0.04,  // barely-there wet-neon sheen
    roughness: 0.85,
    metalness: 0.05,
  });

  const roadMesh = new THREE.Mesh(roadGeom, matDetailedAsphalt);
  roadMesh.name = 'road';
  roadMesh.receiveShadow = true;

  const sidewalkMesh = new THREE.Mesh(sidewalkMerged, matConcrete);
  sidewalkMesh.name = 'sidewalks';
  sidewalkMesh.receiveShadow = true;

  // ── Ground plane ──────────────────────────────────────────────────────────
  const groundW = (maxX - minX) + GROUND_MARGIN * 2;
  const groundD = (maxZ - minZ) + GROUND_MARGIN * 2;
  const groundGeom = new THREE.PlaneGeometry(groundW, Math.abs(groundD));
  groundGeom.rotateX(-Math.PI / 2);

  const groundMesh = new THREE.Mesh(groundGeom, matGround);
  groundMesh.name = 'ground';
  groundMesh.position.set(
    (minX + maxX) / 2,
    -0.05,
    (minZ + maxZ) / 2
  );
  groundMesh.receiveShadow = true;

  // ── Assemble group ────────────────────────────────────────────────────────
  const group = new THREE.Group();
  group.name = 'streets';
  group.add(roadMesh, sidewalkMesh, groundMesh);
  group.userData = { draw: 3 };

  return group;
}

// ──────────────────────────────────────────────────────────────────────────────
// Scramble Crossing (Shibuya) canvas texture
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Draws the Shibuya-style scramble intersection onto a canvas.
 * Returns a CanvasTexture suitable for application to a PlaneGeometry floor.
 * The canvas represents a square intersection: 40m × 40m.
 */
function makeShibuyaFloorTexture(): THREE.CanvasTexture {
  const SZ = 1024; // square canvas, 1:1 aspect → 40m×40m
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: SZ, height: SZ, getContext: () => null } as any;
  canvas.width = SZ;
  canvas.height = SZ;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas as HTMLCanvasElement);

  // Base — dark intersection asphalt
  ctx.fillStyle = '#0e1322';
  ctx.fillRect(0, 0, SZ, SZ);

  // Worn concrete wear marks (radial smear at centre)
  const wornGrad = ctx.createRadialGradient(SZ / 2, SZ / 2, SZ * 0.05, SZ / 2, SZ / 2, SZ * 0.45);
  wornGrad.addColorStop(0, 'rgba(40,45,70,0.4)');
  wornGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wornGrad;
  ctx.fillRect(0, 0, SZ, SZ);

  // ── Crosswalk stripes ─────────────────────────────────────────────────────
  // The scramble has 4 edge crossings (N/S/E/W) + 2 diagonals (NE-SW, NW-SE).
  // Each stripe block is a series of parallel rectangles.
  // Road half-width = 7m → 7/40 * SZ pixels ≈ 179 px from centre.
  // Sidewalk edge = 17m → 17/40 * SZ ≈ 435 px from centre.

  const CX = SZ / 2;
  const CY = SZ / 2;
  const halfRoad = (7 / 40) * SZ;   // road edge from centre
  const halfSidewalk = (17 / 40) * SZ; // sidewalk edge from centre

  const stripeColor = 'rgba(210,210,190,0.82)';
  const stripeW = 24;  // stripe width in pixels
  const stripeGap = 14; // gap between stripes

  ctx.fillStyle = stripeColor;

  /** Draw a crosswalk band rotated by `angleDeg` around canvas centre. */
  function drawCrosswalkBand(angleDeg: number): void {
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate((angleDeg * Math.PI) / 180);
    // The band runs from halfRoad to halfSidewalk along the rotated X axis,
    // centred on Y. Width = road width * 2 = 14m → same fraction of SZ.
    const bandStart = halfRoad + 4;
    const bandEnd = halfSidewalk - 4;
    const bandHalfW = halfRoad * 0.85;
    const stripeStep = stripeW + stripeGap;
    for (let y = -bandHalfW; y < bandHalfW; y += stripeStep) {
      ctx.fillRect(bandStart, y, bandEnd - bandStart, stripeW);
    }
    ctx.restore();
  }

  // 4 edge crossings: 0°(right/E), 90°(down/S), 180°(left/W), 270°(up/N)
  drawCrosswalkBand(0);
  drawCrosswalkBand(90);
  drawCrosswalkBand(180);
  drawCrosswalkBand(270);

  // 2 diagonal crossings: NE-SW=45°, NW-SE=135°
  drawCrosswalkBand(45);
  drawCrosswalkBand(135);

  // ── Stop lines ────────────────────────────────────────────────────────────
  // Thick white lines at the edge of each crosswalk on the road side.
  ctx.strokeStyle = 'rgba(220,218,196,0.9)';
  ctx.lineWidth = 8;
  const stopOff = halfRoad + 2;
  // N stop line
  ctx.beginPath();
  ctx.moveTo(CX - halfRoad, CY - stopOff);
  ctx.lineTo(CX + halfRoad, CY - stopOff);
  ctx.stroke();
  // S stop line
  ctx.beginPath();
  ctx.moveTo(CX - halfRoad, CY + stopOff);
  ctx.lineTo(CX + halfRoad, CY + stopOff);
  ctx.stroke();
  // W stop line
  ctx.beginPath();
  ctx.moveTo(CX - stopOff, CY - halfRoad);
  ctx.lineTo(CX - stopOff, CY + halfRoad);
  ctx.stroke();
  // E stop line
  ctx.beginPath();
  ctx.moveTo(CX + stopOff, CY - halfRoad);
  ctx.lineTo(CX + stopOff, CY + halfRoad);
  ctx.stroke();

  // ── Worn paint overlay ────────────────────────────────────────────────────
  // Scuff marks from traffic — diagonal smear patches at random positions
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#1a1e2e';
  for (let i = 0; i < 8; i++) {
    const wx = CX + (i * 113 % SZ) - SZ / 2;
    const wy = CY + (i * 197 % SZ) - SZ / 2;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(i * 0.6);
    ctx.fillRect(-30, -6, 60, 12);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // ── Subtle wet-neon shimmer at centre ─────────────────────────────────────
  const neonGrad = ctx.createRadialGradient(CX, CY, 5, CX, CY, halfRoad * 1.2);
  neonGrad.addColorStop(0, 'rgba(183,245,233,0.07)');  // holoTeal
  neonGrad.addColorStop(0.5, 'rgba(255,43,214,0.04)'); // signalMagenta
  neonGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = neonGrad;
  ctx.fillRect(0, 0, SZ, SZ);

  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  return tex;
}

// ──────────────────────────────────────────────────────────────────────────────
// buildShibuya
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The Shibuya scramble crossing set-piece at the right-turn (t≈0.32).
 * Contains:
 *   - Painted scramble floor with diagonals, stop lines, worn paint
 *   - Wait pads / corner islands on the four corners
 *   - Bollards around the intersection perimeter
 *   - Overhead signal bars spanning the road
 *   - Wall of large wrap-around corner billboards
 */
export function buildShibuya(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shibuya';

  // Sample the turn zone midpoint for the intersection centre.
  const turnMid = (ZONES.turn[0] + ZONES.turn[1]) / 2;
  const frame = sampleRoute(turnMid);
  const centre = frame.pos.clone();
  centre.y = 0; // ground level

  // ── Scramble floor ────────────────────────────────────────────────────────
  const INTERSECTION_SIZE = 40; // 40m × 40m crossing area
  const floorTex = makeShibuyaFloorTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    color: COLORS.shadowBlue,
    map: floorTex,
    emissiveMap: floorTex,
    emissive: new THREE.Color(COLORS.holoTeal),
    emissiveIntensity: 0.05,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floorGeom = new THREE.PlaneGeometry(INTERSECTION_SIZE, INTERSECTION_SIZE);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMesh = new THREE.Mesh(floorGeom, floorMat);
  floorMesh.name = 'shibuya-floor';
  floorMesh.position.copy(centre);
  floorMesh.position.y = 0.01; // just above ground to avoid z-fighting
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // ── Wait pads / corner islands ────────────────────────────────────────────
  const waitPadMat = new THREE.MeshStandardMaterial({
    color: 0x1c2035,
    roughness: 0.9,
    metalness: 0.0,
  });
  const PAD_SIZE = 10; // 10m × 10m corner island
  const PAD_CORNERS: [number, number][] = [
    [-1, -1], [1, -1], [-1, 1], [1, 1]
  ];
  for (const [sx, sz] of PAD_CORNERS) {
    const padGeom = new THREE.BoxGeometry(PAD_SIZE, 0.2, PAD_SIZE);
    const pad = new THREE.Mesh(padGeom, waitPadMat);
    pad.name = 'wait-pad';
    pad.position.set(
      centre.x + sx * (INTERSECTION_SIZE / 2 + PAD_SIZE / 2 + 1),
      0.1,
      centre.z + sz * (INTERSECTION_SIZE / 2 + PAD_SIZE / 2 + 1)
    );
    pad.receiveShadow = true;
    group.add(pad);
  }

  // ── Bollards around intersection perimeter ────────────────────────────────
  const bollardMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e42,
    roughness: 0.7,
    metalness: 0.3,
  });
  const accentBollardMat = new THREE.MeshStandardMaterial({
    color: COLORS.sodiumAmber,
    emissive: new THREE.Color(COLORS.sodiumAmber),
    emissiveIntensity: 0.4,
    roughness: 0.5,
    metalness: 0.0,
  });

  // Place bollards along two sides of the intersection (not blocking road exits)
  const HALF = INTERSECTION_SIZE / 2;
  const bollardSpacing = 4;
  for (let x = -HALF + 2; x <= HALF - 2; x += bollardSpacing) {
    for (const side of [-1, 1]) {
      const bz = centre.z + side * (HALF + 1.5);
      const bx = centre.x + x;
      // Skip the road corridor openings (road half-width = 7m each side)
      if (Math.abs(x) < ROAD_HALF_WIDTH + 1) continue;

      const postGeom = new THREE.CylinderGeometry(0.12, 0.14, 1.1, 8);
      const post = new THREE.Mesh(postGeom, bollardMat);
      post.position.set(bx, 0.55, bz);
      post.castShadow = true;
      group.add(post);

      // Amber reflective band on bollard
      const bandGeom = new THREE.CylinderGeometry(0.135, 0.135, 0.12, 8);
      const band = new THREE.Mesh(bandGeom, accentBollardMat);
      band.position.set(bx, 0.85, bz);
      group.add(band);
    }
  }

  // ── Overhead signal bars ──────────────────────────────────────────────────
  // Two horizontal bars spanning the road — one per axis of the crossing.
  const signalBarMat = new THREE.MeshStandardMaterial({
    color: 0x151826,
    roughness: 0.8,
    metalness: 0.4,
  });
  const signalLightMat = new THREE.MeshStandardMaterial({
    color: COLORS.sodiumAmber,
    emissive: new THREE.Color(COLORS.sodiumAmber),
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });

  // Signal bar running east-west (across the N-S road axis)
  const barGeomEW = new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2 + 6, 0.3, 0.3);
  for (const side of [-1, 1]) {
    const bar = new THREE.Mesh(barGeomEW, signalBarMat);
    bar.name = 'signal-bar';
    bar.position.set(
      centre.x,
      6.5,
      centre.z + side * (ROAD_HALF_WIDTH + 3)
    );
    group.add(bar);

    // Signal lights on the bar
    const lightGeom = new THREE.BoxGeometry(0.4, 0.6, 0.25);
    for (const lx of [-4, 0, 4]) {
      const light = new THREE.Mesh(lightGeom, signalLightMat);
      light.position.set(centre.x + lx, 6.2, centre.z + side * (ROAD_HALF_WIDTH + 3));
      group.add(light);
    }

    // Vertical support pole from bar to ground
    const poleGeom = new THREE.CylinderGeometry(0.12, 0.15, 6.5, 8);
    for (const px of [-ROAD_HALF_WIDTH - 2.5, ROAD_HALF_WIDTH + 2.5]) {
      const pole = new THREE.Mesh(poleGeom, signalBarMat);
      pole.position.set(centre.x + px, 3.25, centre.z + side * (ROAD_HALF_WIDTH + 3));
      pole.castShadow = true;
      group.add(pole);
    }
  }

  // ── Giant corner billboards ───────────────────────────────────────────────
  // Place large billboards on the 4 corner buildings flanking the intersection.
  // Offset well outside the CORRIDOR_HALF (17m) to not block the road.
  const BILLBOARD_OFFSET = CORRIDOR_HALF + 8; // 25m from centre

  const bbFormats: Array<'landscape' | 'portrait' | 'square'> = [
    'landscape', 'portrait', 'landscape', 'portrait'
  ];
  const bbCorners: [number, number, number][] = [
    // [x_offset, z_offset, faceAngle (radians — bill faces inward toward intersection)]
    [-BILLBOARD_OFFSET, -BILLBOARD_OFFSET, Math.PI * 0.25],   // SW corner
    [BILLBOARD_OFFSET, -BILLBOARD_OFFSET, Math.PI * 0.75],    // SE corner
    [-BILLBOARD_OFFSET, BILLBOARD_OFFSET, -Math.PI * 0.25],   // NW corner
    [BILLBOARD_OFFSET, BILLBOARD_OFFSET, -Math.PI * 0.75],    // NE corner
  ];

  for (let i = 0; i < bbCorners.length; i++) {
    const [ox, oz, faceAngle] = bbCorners[i];
    const format = bbFormats[i % bbFormats.length];
    const widthM = format === 'landscape' ? 20 : 8;

    // Use makeAd + buildBillboard — the ad texture is generated via rng
    const texture = makeAd(format, rng);
    const bb = buildBillboard(rng, {
      format,
      mount: 'wall',
      widthM,
      texture,
    });

    bb.group.position.set(
      centre.x + ox,
      0,
      centre.z + oz
    );
    bb.group.rotation.y = faceAngle;
    group.add(bb.group);
  }

  // Second row of smaller billboards facing the intersection along the sidewalk
  const smallBbPositions: [number, number, number, number][] = [
    // [x_offset, z_offset, faceAngle, widthM]
    [0, -(CORRIDOR_HALF + 4), 0, 16],           // South face, landscape
    [-(CORRIDOR_HALF + 4), 0, Math.PI / 2, 14], // West face, landscape
  ];

  for (const [ox, oz, faceAngle, widthM] of smallBbPositions) {
    const texture = makeAd('landscape', rng);
    const bb = buildBillboard(rng, {
      format: 'landscape',
      mount: 'wall',
      widthM,
      texture,
    });
    bb.group.position.set(centre.x + ox, 0, centre.z + oz);
    bb.group.rotation.y = faceAngle;
    group.add(bb.group);
  }

  return group;
}

// ──────────────────────────────────────────────────────────────────────────────
// buildScaffolding
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Construction scaffolding along the scaffold zone (t≈0.46-0.52).
 * The bike rides on the scaffold deck at y≈13 (route y at this zone).
 *
 * Features: steel truss poles, horizontal braces, plank deck, safety netting,
 * work lights (amber), warning stripes. Positioned to the side of the road
 * (clear of the corridor), attached to the implied building face.
 */
export function buildScaffolding(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scaffolding';

  // Sample the scaffold zone to get the deck position and orientation.
  const [tStart, tEnd] = ZONES.scaffold;
  const tMid = (tStart + tEnd) / 2;
  const frameStart = sampleRoute(tStart);
  const frameEnd = sampleRoute(tEnd);
  const frameMid = sampleRoute(tMid);

  // The scaffold attaches to the right side of the road corridor.
  // "Right" means positive binormal (the roadFrame binormal).
  // We derive an approximate binormal from the tangent (tangent × worldUp).
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const tangent = frameMid.tangent.clone().normalize();
  const binormal = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();

  // Deck y at the scaffold zone (from route waypoints: scaffoldDeck y=13).
  const DECK_Y = 13;
  const DECK_HALF_WIDTH = 5; // 10m wide rideable scaffold deck
  const DECK_DEPTH = 0.25;   // plank thickness

  // Total scaffold length along the route
  const scaffoldLength = frameStart.pos.distanceTo(frameEnd.pos);
  // Approximate as straight run along the tangent (the zone is a straight -Z run)
  const DECK_LENGTH = Math.max(scaffoldLength, 30); // at least 30m

  // Place scaffold to the right side of the road (positive binormal side)
  // Offset from road centreline = CORRIDOR_HALF + DECK_HALF_WIDTH + 2m clearance
  const SIDE_OFFSET = CORRIDOR_HALF + DECK_HALF_WIDTH + 2;

  // World position of the scaffold centre
  const deckCentre = frameMid.pos.clone();
  deckCentre.y = DECK_Y;
  deckCentre.addScaledVector(binormal, SIDE_OFFSET);

  // ── Materials ─────────────────────────────────────────────────────────────
  const matSteel = new THREE.MeshStandardMaterial({
    color: 0x2a2e3e,
    roughness: 0.8,
    metalness: 0.6,
  });
  const matPlank = new THREE.MeshStandardMaterial({
    color: 0x3a2e1e,  // weathered wood tone
    roughness: 0.95,
    metalness: 0.0,
  });
  const matHazard = new THREE.MeshStandardMaterial({
    color: COLORS.sodiumAmber,
    emissive: new THREE.Color(COLORS.sodiumAmber),
    emissiveIntensity: 0.35,
    roughness: 0.7,
  });
  const matNetting = new THREE.MeshStandardMaterial({
    color: 0x18203a,
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    wireframe: true,
  });
  const matWorkLight = new THREE.MeshStandardMaterial({
    color: COLORS.sodiumAmber,
    emissive: new THREE.Color(COLORS.sodiumAmber),
    emissiveIntensity: 1.2,
    roughness: 0.3,
  });

  // Rotation to align the scaffold along the route tangent's HEADING only.
  // We project the tangent onto the XZ plane (dropping Y) so the quaternion is
  // a pure yaw: the deck stays flat (rideable) and poles stay world-vertical
  // even when the route tangent has a Y component (slope near the ramp).
  const tangentXZ = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
  const alignQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    tangentXZ
  );

  // Helper: add a box-mesh in scaffold-local space (before rotation/translation)
  function addBox(
    mat: THREE.Material,
    name: string,
    localX: number,
    localY: number,
    localZ: number,
    w: number,
    h: number,
    d: number
  ): void {
    const geom = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = name;
    // Transform: local → world
    const localPos = new THREE.Vector3(localX, localY, localZ);
    localPos.applyQuaternion(alignQuat);
    mesh.position.copy(deckCentre).add(localPos);
    mesh.quaternion.copy(alignQuat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── Deck planks ───────────────────────────────────────────────────────────
  // Main riding deck — full width and length
  addBox(matPlank, 'deck-planks', 0, 0, 0, DECK_HALF_WIDTH * 2, DECK_DEPTH, DECK_LENGTH);

  // Deck edge guard rails (steel)
  for (const side of [-1, 1]) {
    // Top rail
    addBox(matSteel, 'rail-top', side * (DECK_HALF_WIDTH + 0.1), 1.1, 0, 0.1, 0.1, DECK_LENGTH);
    // Mid rail
    addBox(matSteel, 'rail-mid', side * (DECK_HALF_WIDTH + 0.1), 0.55, 0, 0.1, 0.1, DECK_LENGTH);
  }

  // ── Truss poles (vertical uprights) ──────────────────────────────────────
  const POLE_SPACING = 5; // every 5m
  const POLE_HEIGHT_BELOW = DECK_Y; // poles extend from ground to deck
  const nPoles = Math.max(3, Math.floor(DECK_LENGTH / POLE_SPACING));

  for (let i = 0; i <= nPoles; i++) {
    const localZ = (i / nPoles - 0.5) * DECK_LENGTH;
    for (const side of [-1, 1]) {
      const localX = side * (DECK_HALF_WIDTH - 0.25);
      // Vertical pole from ground to deck.
      // CylinderGeometry axis is world Y. alignQuat is now yaw-only (XZ-plane
      // projection of the tangent), so it never tilts the Y axis — poles stay
      // world-vertical. We place the pole centred at deck_y - half its height.
      const poleGeom = new THREE.CylinderGeometry(0.1, 0.12, POLE_HEIGHT_BELOW, 8);
      const poleMesh = new THREE.Mesh(poleGeom, matSteel);
      poleMesh.name = 'pole';
      const localPos = new THREE.Vector3(localX, -POLE_HEIGHT_BELOW / 2, localZ);
      localPos.applyQuaternion(alignQuat);
      poleMesh.position.copy(deckCentre).add(localPos);
      // Leave quaternion as identity — yaw-only alignQuat makes no difference on
      // a rotationally-symmetric cylinder, and identity keeps the axis world-vertical.
      poleMesh.castShadow = true;
      group.add(poleMesh);
    }

    // Horizontal cross-brace every other interval — placed ONCE per bay (not per side).
    // A cross-brace spans the full deck width (centred at x=0), so adding it
    // inside the side loop would create two identical overlapping meshes.
    if (i < nPoles && i % 2 === 0) {
      addBox(matSteel, 'cross-brace', 0, -POLE_HEIGHT_BELOW * 0.35, localZ + POLE_SPACING * 0.5, DECK_HALF_WIDTH * 2, 0.08, 0.08);
    }
  }

  // ── Diagonal braces (X-bracing on each panel) ─────────────────────────────
  for (let i = 0; i < nPoles; i += 2) {
    const z0 = (i / nPoles - 0.5) * DECK_LENGTH;
    const z1 = ((i + 2) / nPoles - 0.5) * DECK_LENGTH;
    const panelH = POLE_HEIGHT_BELOW * 0.6;

    // Brace from bottom-left to top-right
    const a = new THREE.Vector3(-DECK_HALF_WIDTH + 0.25, -panelH, z0);
    const b = new THREE.Vector3(DECK_HALF_WIDTH - 0.25, 0, z1);
    a.applyQuaternion(alignQuat).add(deckCentre);
    b.applyQuaternion(alignQuat).add(deckCentre);

    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.divideScalar(len);
    const braceQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const braceGeom = new THREE.BoxGeometry(0.09, len, 0.09);
    const brace = new THREE.Mesh(braceGeom, matSteel);
    brace.name = 'diagonal-brace';
    brace.position.copy(a).add(b).multiplyScalar(0.5);
    brace.quaternion.copy(braceQ);
    group.add(brace);
  }

  // ── Safety netting (outer face) ───────────────────────────────────────────
  // Hang netting on the outer side (away from building / road)
  const NETTING_SIDE = DECK_HALF_WIDTH; // outer edge side
  const nettingGeom = new THREE.PlaneGeometry(DECK_LENGTH, POLE_HEIGHT_BELOW * 0.8);
  const netting = new THREE.Mesh(nettingGeom, matNetting);
  netting.name = 'safety-netting';
  const netLocalPos = new THREE.Vector3(NETTING_SIDE, -POLE_HEIGHT_BELOW * 0.4, 0);
  netLocalPos.applyQuaternion(alignQuat);
  netting.position.copy(deckCentre).add(netLocalPos);
  // Orient netting perpendicular to the tangent, facing outward
  const netRotQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.atan2(tangent.x, tangent.z) + Math.PI / 2
  );
  netting.quaternion.copy(netRotQ);
  group.add(netting);

  // ── Warning stripes on deck edge ──────────────────────────────────────────
  const STRIPE_SECTIONS = 6;
  for (let i = 0; i < STRIPE_SECTIONS; i++) {
    const t = (i + 0.5) / STRIPE_SECTIONS;
    const localZ = (t - 0.5) * DECK_LENGTH;
    // Alternate amber/dark hazard stripes on outer rail
    if (i % 2 === 0) {
      addBox(matHazard, 'hazard-stripe', DECK_HALF_WIDTH + 0.05, 0.3, localZ, 0.08, 0.5, DECK_LENGTH / STRIPE_SECTIONS - 0.5);
    }
  }

  // ── Work lights along the underside of the deck ───────────────────────────
  const N_WORK_LIGHTS = 5;
  for (let i = 0; i < N_WORK_LIGHTS; i++) {
    const t = (i + 0.5) / N_WORK_LIGHTS;
    const localZ = (t - 0.5) * DECK_LENGTH;
    const lightGeom = new THREE.SphereGeometry(0.15, 8, 8);
    const light = new THREE.Mesh(lightGeom, matWorkLight);
    light.name = 'work-light';
    const localPos = new THREE.Vector3(0, -0.3, localZ);
    localPos.applyQuaternion(alignQuat);
    light.position.copy(deckCentre).add(localPos);
    group.add(light);

    // Small cage around the bulb
    const cageGeom = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    const cage = new THREE.Mesh(cageGeom, matSteel);
    cage.name = 'light-cage';
    cage.position.copy(light.position);
    cage.quaternion.copy(alignQuat);
    group.add(cage);
  }

  // ── Rng-driven variation: debris / planks leaning against structure ────────
  const nDebris = rng.int(2, 5);
  for (let i = 0; i < nDebris; i++) {
    const localZ = rng.range(-DECK_LENGTH * 0.45, DECK_LENGTH * 0.45);
    const localX = rng.range(-DECK_HALF_WIDTH * 0.7, DECK_HALF_WIDTH * 0.7);
    addBox(matPlank, 'debris-plank', localX, 0.15, localZ,
      rng.range(0.15, 0.25), rng.range(0.1, 0.2), rng.range(1.5, 3.0));
  }

  return group;
}
