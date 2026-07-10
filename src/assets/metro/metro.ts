import * as THREE from 'three';
import { COLORS } from '../../theme';
import { makeCanvasTexture } from '../../utils/canvasText';
import { mergeStatic, type GeometryPart } from '../../utils/merge';
import type { Rng } from '../../utils/rng';

/**
 * Task 19 — Cyberpunk: Edgerunners-style SUSPENDED MONORAIL.
 *
 * A dark elevated box-girder threads Ring 0/1 of the city as a CLOSED loop, and a
 * 4-car "NIGHT LOOP" consist HANGS FROM THE UNDERSIDE of that girder on bogie arms
 * that hook over the girder top. At night the near-black girder and cars read only
 * by their punctuation: lit amber/magenta window bands, teal edge running-lights,
 * and a teal underside skid glow.
 *
 * Palette rule (binding): tron-cyan is RESERVED for the biker. The metro's cool
 * accent is holo-TEAL (running lights + skid glow); windows are sodium-amber /
 * signal-magenta. Nothing here glows cyan.
 *
 * Interface: buildMetro(rng) -> { group, update(t) }. update(t) is DETERMINISTIC in
 * t (scrub-safe, no wall clock): the train sits at pathU = (t*METRO_SPEED + PHASE)%1
 * and sways as a pure function of t.
 */

// ---------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------

/**
 * How many full loops the train completes per unit of global scroll t. // TUNE
 * Chosen so the consist is roughly in-frame near t≈0.17 (About), t≈0.33 (drift),
 * t≈0.86 (finale). These land points will be re-tuned in Task 25 once the real
 * scroll timeline exists — keep this an exported const so that pass can adjust it.
 */
export const METRO_SPEED = 3.2;

/** Phase offset added before the wrap, so the choreographed passes line up. // TUNE */
export const METRO_PHASE = 0.62;

const GIRDER_Y = 16; // girder core height (spec: y 14–18)
const GIRDER_CORE_R = 0.55; // TubeGeometry backbone radius (radial=4 -> box girder)
const RIB_HALF_W = 0.95; // box-girder cross-section half-width
// Exported so tests can pin the pylon-underside sign fix and draw-call budget without
// duplicating these magic numbers.
export const RIB_HALF_H = 0.7; // box-girder cross-section half-height
const GIRDER_TOP = RIB_HALF_H; // local y of girder top (bogies grip here)
export const GIRDER_BOTTOM = -RIB_HALF_H; // local y of girder underside

export const PYLON_SPACING = 35; // T-pylon every 35 m
const RUN_LIGHT_OUT = RIB_HALF_W + 0.12; // running-light lateral offset from centreline
const RUN_LIGHT_DOWN = RIB_HALF_H - 0.05; // running-light drop below girder centre

// Train consist
const CAR_LEN = 7.4;
const CAR_HALF_W = 1.05;
const CAR_HALF_H = 1.35;
const CAR_GAP = 1.3; // gangway gap between car ends
const CAR_PITCH = CAR_LEN + CAR_GAP;
const N_CARS = 4;
const ARM_LEN = 1.15; // bogie arm reach: girder top down to car roof
const HANG_DROP = GIRDER_BOTTOM - ARM_LEN - CAR_HALF_H; // car centre y in pivot-local space (<0)
const SWAY_MAX = THREE.MathUtils.degToRad(1.5);
const SWAY_FREQ = 5.0; // pendulum cycles per unit t // TUNE

// ---------------------------------------------------------------------------------
// The closed loop threading the city (see src/world/route.ts for context coords)
// ---------------------------------------------------------------------------------
// About street runs +X along z0 (x -260..200); Shibuya at (240,0,0); Projects
// boulevard runs -Z at x240; bridge approach heads out toward -Z near x240.
const METRO_WAYPOINTS: THREE.Vector3[] = [
  new THREE.Vector3(-262, GIRDER_Y, 52), // behind About street's left wall (west end)
  new THREE.Vector3(-60, GIRDER_Y + 1, 56),
  new THREE.Vector3(160, GIRDER_Y, 44),
  new THREE.Vector3(212, GIRDER_Y, 20), // sweeping in toward Shibuya
  new THREE.Vector3(272, GIRDER_Y, -26), // diagonal ACROSS the Shibuya intersection
  new THREE.Vector3(306, GIRDER_Y, -150), // Projects boulevard, far side
  new THREE.Vector3(300, GIRDER_Y, -470),
  new THREE.Vector3(282, GIRDER_Y + 1.5, -770), // distant pass, bridge approach
  new THREE.Vector3(120, GIRDER_Y + 2, -820), // far turn behind everything
  new THREE.Vector3(-120, GIRDER_Y + 1, -560), // long return leg (distant)
  new THREE.Vector3(-272, GIRDER_Y, -190),
  new THREE.Vector3(-330, GIRDER_Y, 6) // west loop-back into the start
];

export const METRO_PATH = new THREE.CatmullRomCurve3(
  METRO_WAYPOINTS,
  true, // CLOSED loop
  'centripetal'
);

const WORLD_UP = new THREE.Vector3(0, 1, 0);

interface PathFrame {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

const _m = new THREE.Matrix4();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Level (world-up-projected) frame at arc-length u: forward=+X-local=tangent, up=+Y. */
function pathFrameAt(u: number, out: PathFrame): PathFrame {
  METRO_PATH.getPointAt(u, out.pos);
  METRO_PATH.getTangentAt(u, _fwd).normalize();
  _right.crossVectors(_fwd, WORLD_UP);
  if (_right.lengthSq() < 1e-6) _right.set(0, 0, 1);
  _right.normalize();
  _up.crossVectors(_right, _fwd).normalize();
  // Basis columns: local +X=forward, +Y=up, +Z=right (matches car geometry below).
  _m.makeBasis(_fwd, _up, _right);
  out.quat.setFromRotationMatrix(_m);
  return out;
}

function wrap01(x: number): number {
  return ((x % 1) + 1) % 1;
}

// ---------------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------------

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Long lit window band: warm amber interior with dark standing-passenger silhouettes. */
function makeWindowTexture(rng: Rng, magenta: boolean): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const warm = magenta ? hex(COLORS.signalMagenta) : hex(COLORS.sodiumAmber);
  return makeCanvasTexture(w, h, (ctx) => {
    // Interior glow gradient
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, warm);
    g.addColorStop(1, magenta ? '#8a1478' : '#a86a1f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Passenger silhouettes (heads + shoulders) as dark blobs
    ctx.fillStyle = '#0a0710cc';
    const n = 10;
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * (w / n) + rng.range(-14, 14);
      const shoulderY = h * rng.range(0.52, 0.66);
      const bodyW = rng.range(26, 40);
      // shoulders
      ctx.beginPath();
      ctx.moveTo(cx - bodyW / 2, h);
      ctx.quadraticCurveTo(cx - bodyW / 2, shoulderY, cx, shoulderY - 4);
      ctx.quadraticCurveTo(cx + bodyW / 2, shoulderY, cx + bodyW / 2, h);
      ctx.closePath();
      ctx.fill();
      // head
      const hr = rng.range(8, 11);
      ctx.beginPath();
      ctx.arc(cx, shoulderY - hr - 2, hr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Window mullions (vertical dividers)
    ctx.strokeStyle = '#05060bdd';
    ctx.lineWidth = 5;
    const bays = 8;
    for (let i = 1; i < bays; i++) {
      const x = (i / bays) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Top/bottom frame
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, w, 8);
    ctx.fillRect(0, h - 8, w, 8);
  });
}

/** Mono destination board: "NIGHT LOOP ▸ KABUKI". */
function makeDestinationTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 96;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, w, h);
    // faint scanline dot-matrix wash
    ctx.fillStyle = hex(COLORS.holoTeal);
    ctx.font = 'bold 52px "Share Tech Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('NIGHT LOOP', w * 0.33, h * 0.5);
    ctx.fillStyle = hex(COLORS.sodiumAmber);
    ctx.fillText('▸ KABUKI', w * 0.76, h * 0.5);
    // dot-matrix grid overlay to sell the board
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 3);
  });
}

/** Amber/black diagonal hazard stripes for pylon bases. */
function makeHazardTexture(): THREE.CanvasTexture {
  const s = 128;
  const tex = makeCanvasTexture(s, s, (ctx) => {
    ctx.fillStyle = hex(COLORS.sodiumAmber);
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#0a0a0c';
    ctx.lineWidth = 0;
    const step = 34;
    ctx.save();
    ctx.beginPath();
    for (let i = -s; i < s * 2; i += step * 2) {
      ctx.moveTo(i, 0);
      ctx.lineTo(i + step, 0);
      ctx.lineTo(i + step - s, s);
      ctx.lineTo(i - s, s);
    }
    ctx.fill();
    ctx.restore();
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Magenta spray-tag graffiti for a pylon column (iteration detail). */
function makeGraffitiTexture(rng: Rng): THREE.CanvasTexture {
  const w = 128;
  const h = 256;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, w, h);
    // a loose magenta tag near the base
    ctx.strokeStyle = hex(COLORS.signalMagenta);
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.9;
    const baseY = h * 0.72;
    ctx.beginPath();
    let x = 18;
    ctx.moveTo(x, baseY);
    for (let i = 0; i < 5; i++) {
      x += rng.range(14, 22);
      ctx.lineTo(x, baseY + rng.range(-26, 8));
      ctx.lineTo(x + 4, baseY + rng.range(8, 30));
    }
    ctx.stroke();
    // drip
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(40, baseY + 20);
    ctx.lineTo(40, baseY + 46);
    ctx.stroke();
  });
}

// ---------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------

function darkStructureMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS.towerBody,
    roughness: 0.82,
    metalness: 0.35
  });
}

function glowMat(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS.void,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.9,
    metalness: 0
  });
}

function windowMat(tex: THREE.Texture, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: intensity,
    roughness: 0.5,
    metalness: 0.1
  });
}

// ---------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const unitBox = new THREE.BoxGeometry(1, 1, 1);

function boxPart(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): GeometryPart {
  const pos = new THREE.Vector3(cx, cy, cz);
  const scl = new THREE.Vector3(sx, sy, sz);
  return { geom: unitBox, matrix: new THREE.Matrix4().compose(pos, new THREE.Quaternion(), scl), mat: 0 };
}

function mergeOne(parts: GeometryPart[], mat: THREE.Material, name: string): THREE.Mesh {
  const mesh = mergeStatic(parts, [mat]);
  mesh.geometry.clearGroups();
  mesh.material = mat;
  mesh.name = name;
  return mesh;
}

// Offset tube (running lights / cable tray) built by sweeping an offset of the metro path.
function buildOffsetTube(
  side: number,
  down: number,
  outAmount: number,
  radius: number,
  mat: THREE.Material,
  name: string
): THREE.Mesh {
  const N = 400;
  const pts: THREE.Vector3[] = [];
  const frame: PathFrame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  for (let i = 0; i < N; i++) {
    const u = i / N;
    pathFrameAt(u, frame);
    // In pathFrameAt's basis, local +Z is 'right' and local +Y is 'up'.
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quat);
    pts.push(
      frame.pos
        .clone()
        .addScaledVector(right, side * outAmount)
        .addScaledVector(up, -down)
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const geom = new THREE.TubeGeometry(curve, N, radius, 4, true);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  return mesh;
}

// ---------------------------------------------------------------------------------
// Track: box-girder + ribs + running lights + T-pylons
// ---------------------------------------------------------------------------------

/**
 * Zone boundary u-parameters for splitting the metro loop into cullable segments.
 * Each zone covers a spatial region of the city; when the camera doesn't look at
 * that region, the zone's meshes frustum-cull out entirely.
 *
 * Approximate zone boundaries derived by arc-length-sampling METRO_PATH and
 * mapping the 12 waypoints to their closest u values:
 *   about    : u 0.00 → 0.28  (About street, w→e)
 *   shibuya  : u 0.28 → 0.46  (Shibuya crossing + boulevard north)
 *   boulevard: u 0.46 → 0.60  (Projects boulevard, z -150 → -470)
 *   far      : u 0.60 → 1.00  (distant return leg — mostly off-screen, stays merged)
 *
 * The "far" zone is NOT split further — it's behind everything visible from any
 * street camera, so its draw calls only appear at the overhead/debug viewpoint.
 */
const METRO_ZONE_BOUNDARIES = [0, 0.28, 0.46, 0.60, 1.0] as const;
type MetroZone = 'about' | 'shibuya' | 'boulevard' | 'far';
const METRO_ZONE_NAMES: MetroZone[] = ['about', 'shibuya', 'boulevard', 'far'];

/**
 * Sample n points of METRO_PATH between u0 and u1 (arc-length params),
 * returning a new (open) CatmullRomCurve3 suitable for building a sub-arc
 * TubeGeometry with a tight spatial bounding sphere.
 */
function subCurve(u0: number, u1: number, n = 80): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = u0 + (i / n) * (u1 - u0);
    pts.push(METRO_PATH.getPointAt(u));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

/**
 * Build a per-zone offset tube (running lights / cable tray) — same logic as
 * buildOffsetTube but sampling only the [u0,u1] arc of METRO_PATH.
 */
function buildOffsetTubeZone(
  u0: number,
  u1: number,
  side: number,
  down: number,
  outAmount: number,
  radius: number,
  mat: THREE.Material,
  name: string
): THREE.Mesh {
  const N = Math.max(20, Math.round(60 * (u1 - u0)));
  const pts: THREE.Vector3[] = [];
  const frame: PathFrame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  for (let i = 0; i <= N; i++) {
    const u = u0 + (i / N) * (u1 - u0);
    pathFrameAt(u, frame);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quat);
    pts.push(
      frame.pos.clone()
        .addScaledVector(right, side * outAmount)
        .addScaledVector(up, -down)
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const geom = new THREE.TubeGeometry(curve, N, radius, 4, false);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  return mesh;
}

/**
 * Build an offset path (for the deck plate) over [u0, u1].
 */
function offsetPathYZone(dy: number, u0: number, u1: number, N = 60): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const u = u0 + (i / N) * (u1 - u0);
    METRO_PATH.getPointAt(u, p);
    pts.push(new THREE.Vector3(p.x, p.y + dy, p.z));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

/**
 * Zone-split metro track builder (Task 33 draw-call fix).
 *
 * The original buildTrack built one TubeGeometry per track feature (girder,
 * deck, running lights, cable tray) over the FULL ~2000m loop. Each of those
 * tubes computes a bounding sphere that spans the whole loop, so THREE's default
 * frustum culling never drops them — they draw at every viewpoint regardless of
 * camera direction (~+10 extra draws at every street viewpoint).
 *
 * Fix: split each tube and each InstancedMesh (ribs, pylons) into per-zone
 * sub-meshes. Each zone's mesh has a tight bounding sphere covering only its
 * spatial extent (~500m radius vs. ~1200m for the full loop), so zones out of
 * the camera's view frustum-cull properly.
 *
 * SHARED across zones: all THREE.Material instances (darkStructureMat,
 * runMat, etc.) — we create them ONCE and pass to every zone's mesh. This is
 * the critical invariant from the d125b32 lesson: never regenerate per-zone
 * textures or ad-texture geometry; only the mesh/instance grouping is zoned.
 */
function buildTrack(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'metroTrack';

  // Shared materials — created ONCE, reused across all zones.
  const structMat = darkStructureMat();
  const runMat = glowMat(COLORS.holoTeal, 3.4);

  const pathLen = METRO_PATH.getLength();
  const ribSpacing = 3.2;
  const ribGeom = new THREE.BoxGeometry(0.28, RIB_HALF_H * 2 + 0.35, RIB_HALF_W * 2 + 0.3);
  const frame: PathFrame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const mtx = new THREE.Matrix4();
  const scl = new THREE.Vector3(1, 1, 1);

  // Build per-zone sub-meshes. Each zone group has a tight bounding sphere.
  for (let zi = 0; zi < METRO_ZONE_NAMES.length; zi++) {
    const zoneName = METRO_ZONE_NAMES[zi];
    const u0 = METRO_ZONE_BOUNDARIES[zi];
    const u1 = METRO_ZONE_BOUNDARIES[zi + 1];
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `metroZone:${zoneName}`;

    // Segment resolution proportional to zone arc fraction.
    const tubeSegs = Math.max(30, Math.round(700 * (u1 - u0)));

    // --- Girder core: TubeGeometry over zone arc ---
    const coreCurve = subCurve(u0, u1, tubeSegs);
    const coreGeom = new THREE.TubeGeometry(coreCurve, tubeSegs, GIRDER_CORE_R, 4, false);
    const coreMesh = new THREE.Mesh(coreGeom, structMat);
    coreMesh.name = `girderCore:${zoneName}`;
    zoneGroup.add(coreMesh);

    // --- Deck plate: tube offset in Y ---
    const deckSegs = Math.max(20, Math.round(500 * (u1 - u0)));
    const deckCurve = offsetPathYZone(GIRDER_TOP + 0.12, u0, u1, deckSegs);
    const deckGeom = new THREE.TubeGeometry(deckCurve, deckSegs, 0.12, 4, false);
    const deckMesh = new THREE.Mesh(deckGeom, structMat);
    deckMesh.name = `girderDeck:${zoneName}`;
    zoneGroup.add(deckMesh);

    // --- Running lights (2 emissive tubes) ---
    zoneGroup.add(buildOffsetTubeZone(u0, u1, +1, RUN_LIGHT_DOWN, RUN_LIGHT_OUT, 0.09, runMat, `runLightR:${zoneName}`));
    zoneGroup.add(buildOffsetTubeZone(u0, u1, -1, RUN_LIGHT_DOWN, RUN_LIGHT_OUT, 0.09, runMat, `runLightL:${zoneName}`));

    // --- Cable tray ---
    zoneGroup.add(buildOffsetTubeZone(u0, u1, +1, RIB_HALF_H + 0.35, RIB_HALF_W * 0.55, 0.16, structMat, `cableTray:${zoneName}`));

    // --- Ribs: InstancedMesh covering only this zone's arc ---
    const nRibsTotal = Math.floor(pathLen / ribSpacing);
    const ribU0 = Math.floor(u0 * nRibsTotal);
    const ribU1 = Math.ceil(u1 * nRibsTotal);
    const nZoneRibs = ribU1 - ribU0;
    if (nZoneRibs > 0) {
      const ribs = new THREE.InstancedMesh(ribGeom, structMat, nZoneRibs);
      ribs.name = `girderRibs:${zoneName}`;
      for (let i = 0; i < nZoneRibs; i++) {
        const globalI = ribU0 + i;
        pathFrameAt(globalI / nRibsTotal, frame);
        mtx.compose(frame.pos, frame.quat, scl);
        ribs.setMatrixAt(i, mtx);
      }
      ribs.instanceMatrix.needsUpdate = true;
      ribs.computeBoundingSphere();
      zoneGroup.add(ribs);
    }

    group.add(zoneGroup);
  }

  // T-pylons: zone-split by u-range (skips distant far leg gz < -400 as before).
  buildPylonsZoned(group, rng, pathLen, structMat);

  return group;
}

/** A curve offset a constant amount in world-Y from the metro path (for the deck plate). */
function offsetPathY(dy: number): THREE.CatmullRomCurve3 {
  const N = 300;
  const pts: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    METRO_PATH.getPointAt(i / N, p);
    pts.push(new THREE.Vector3(p.x, p.y + dy, p.z));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

interface PylonPlan {
  pylonMat: THREE.Matrix4; // world transform of the pylon's base frame (pos + track-aligned rotation)
  h: number; // column height: ground (0) up to the girder UNDERSIDE
  hasGraffiti: boolean;
  graffitiOffsetY: number;
  strobeWorldPos: THREE.Vector3;
  phase: number;
}

/**
 * T-pylons every PYLON_SPACING metres, ground to girder underside. Repeated structure
 * (column + T-cap + braces, hazard base, graffiti decals, strobes) is drawn via a
 * handful of InstancedMesh/Points draw calls total (see farField.ts's InstancedMesh
 * pattern) rather than one Group+mesh per pylon, so pylon count stays cheap against
 * the city-wide draw-call budget.
 *
 * @deprecated Use buildPylonsZoned instead (Task 33 draw-call fix).
 */
function buildPylons(group: THREE.Group, rng: Rng, pathLen: number): void {
  const structMat = darkStructureMat();
  const hazardMat = new THREE.MeshStandardMaterial({
    map: makeHazardTexture(),
    roughness: 0.8,
    metalness: 0.1
  });
  const graffitiMat = new THREE.MeshStandardMaterial({
    map: makeGraffitiTexture(rng),
    transparent: true,
    roughness: 0.9,
    metalness: 0
  });

  const nPylonsRaw = Math.floor(pathLen / PYLON_SPACING);
  const frame: PathFrame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };

  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3(1, 1, 1);
  const plans: PylonPlan[] = [];

  for (let i = 0; i < nPylonsRaw; i++) {
    const u = i / nPylonsRaw;
    pathFrameAt(u, frame);
    const gx = frame.pos.x;
    const gy = frame.pos.y;
    const gz = frame.pos.z;
    // Skip the distant far return leg (z well behind the near streets, off-street and
    // behind everything) — not worth spending pylons on.
    if (gz < -400) continue;

    const h = gy + GIRDER_BOTTOM; // column reaches from ground (0) to the girder UNDERSIDE

    const pylonMat = new THREE.Matrix4().compose(
      _pos.set(gx, 0, gz),
      frame.quat.clone(),
      _scale
    );
    const strobeWorldPos = new THREE.Vector3(0, h - 0.3, 0).applyMatrix4(pylonMat);

    plans.push({
      pylonMat,
      h,
      hasGraffiti: rng.chance(0.5),
      graffitiOffsetY: rng.range(2.5, 4.5),
      strobeWorldPos,
      phase: i * 0.37
    });
  }

  const nPylons = plans.length;
  if (nPylons === 0) return;

  const localMat = new THREE.Matrix4();
  const worldMat = new THREE.Matrix4();
  const zeroQuat = new THREE.Quaternion();

  // --- 1) Structural boxes (column + T-cap + 2 braces): one InstancedMesh, 4 instances/pylon.
  const PARTS_PER_PYLON = 4;
  const structMesh = new THREE.InstancedMesh(unitBox, structMat, nPylons * PARTS_PER_PYLON);
  structMesh.name = 'pylonStruct';
  let idx = 0;
  for (const p of plans) {
    const { h } = p;
    // column
    localMat.compose(_pos.set(0, h / 2, 0), zeroQuat, _scale.set(0.9, h, 0.9));
    structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
    // T-cap: horizontal cross-beam just under the girder
    localMat.compose(_pos.set(0, h - 0.3, 0), zeroQuat, _scale.set(0.6, 0.6, RIB_HALF_W * 2 + 1.6));
    structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
    // two diagonal-ish braces (short angled boxes approximated by thin verticals)
    localMat.compose(_pos.set(0, h - 1.4, RIB_HALF_W + 0.5), zeroQuat, _scale.set(0.35, 2.2, 0.35));
    structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
    localMat.compose(_pos.set(0, h - 1.4, -(RIB_HALF_W + 0.5)), zeroQuat, _scale.set(0.35, 2.2, 0.35));
    structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
  }
  structMesh.instanceMatrix.needsUpdate = true;
  group.add(structMesh);

  // --- 2) Hazard-striped base collars: one InstancedMesh.
  const hazardMesh = new THREE.InstancedMesh(unitBox, hazardMat, nPylons);
  hazardMesh.name = 'pylonHazardBase';
  plans.forEach((p, i) => {
    localMat.compose(_pos.set(0, 1.2, 0), zeroQuat, _scale.set(1.15, 2.4, 1.15));
    hazardMesh.setMatrixAt(i, worldMat.multiplyMatrices(p.pylonMat, localMat));
  });
  hazardMesh.instanceMatrix.needsUpdate = true;
  group.add(hazardMesh);

  // --- 3) Graffiti decals on a random subset of columns: one InstancedMesh.
  const graffitiPlans = plans.filter((p) => p.hasGraffiti);
  if (graffitiPlans.length > 0) {
    const decalGeom = new THREE.PlaneGeometry(0.9, 1.8);
    const decalQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2);
    const graffitiMesh = new THREE.InstancedMesh(decalGeom, graffitiMat, graffitiPlans.length);
    graffitiMesh.name = 'pylonGraffiti';
    graffitiPlans.forEach((p, i) => {
      localMat.compose(_pos.set(0.46, p.graffitiOffsetY, 0), decalQuat, _scale.set(1, 1, 1));
      graffitiMesh.setMatrixAt(i, worldMat.multiplyMatrices(p.pylonMat, localMat));
    });
    graffitiMesh.instanceMatrix.needsUpdate = true;
    group.add(graffitiMesh);
  }

  // --- 4) Amber strobes: a single Points draw call, per-instance phase, deterministic in t.
  const strobePositions = new Float32Array(nPylons * 3);
  const strobePhases = new Float32Array(nPylons);
  plans.forEach((p, i) => {
    strobePositions[i * 3 + 0] = p.strobeWorldPos.x;
    strobePositions[i * 3 + 1] = p.strobeWorldPos.y;
    strobePositions[i * 3 + 2] = p.strobeWorldPos.z;
    strobePhases[i] = p.phase;
  });
  const strobeGeom = new THREE.BufferGeometry();
  strobeGeom.setAttribute('position', new THREE.BufferAttribute(strobePositions, 3));
  strobeGeom.setAttribute('aPhase', new THREE.BufferAttribute(strobePhases, 1));
  strobeGeom.computeBoundingSphere();

  const strobeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(COLORS.sodiumAmber) }
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      varying float vPhase;
      void main() {
        vPhase = aPhase;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 900.0 / -mv.z;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying float vPhase;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        // Deterministic blink in uTime (== global t), matching the original per-strobe
        // emissive pulse: mostly-on with occasional bright peaks.
        float on = step(0.6, sin(uTime * 24.0 + vPhase));
        float intensity = 0.4 + mix(0.05, 1.0, on) * 4.0;
        gl_FragColor = vec4(uColor * intensity, 1.0);
      }
    `,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const strobePoints = new THREE.Points(strobeGeom, strobeMat);
  strobePoints.name = 'pylonStrobes';
  strobePoints.frustumCulled = false;
  group.add(strobePoints);

  group.userData.strobeMaterial = strobeMat;
}

/**
 * Zone-split pylon builder (Task 33 draw-call fix).
 *
 * Splits pylons into per-zone InstancedMesh groups so each zone's bounding
 * sphere covers only its spatial extent. When the camera looks at one street
 * zone, the other zones' pylons frustum-cull out.
 *
 * Materials and geometry are SHARED across zones (created once, reused).
 * The strobeMaterial is returned via group.userData for metro.ts's update().
 */
function buildPylonsZoned(group: THREE.Group, rng: Rng, pathLen: number, sharedStructMat: THREE.Material): void {
  // Create pylon-specific materials once, shared across all zones.
  const hazardMat = new THREE.MeshStandardMaterial({
    map: makeHazardTexture(),
    roughness: 0.8,
    metalness: 0.1
  });
  const graffitiMat = new THREE.MeshStandardMaterial({
    map: makeGraffitiTexture(rng),
    transparent: true,
    roughness: 0.9,
    metalness: 0
  });

  const nPylonsRaw = Math.floor(pathLen / PYLON_SPACING);
  const pylonFrame: PathFrame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3(1, 1, 1);

  // Collect all pylon plans (same logic as buildPylons, same rng stream shape).
  const allPlans: Array<PylonPlan & { u: number }> = [];
  for (let i = 0; i < nPylonsRaw; i++) {
    const u = i / nPylonsRaw;
    pathFrameAt(u, pylonFrame);
    const gz = pylonFrame.pos.z;
    // Skip distant far return leg (same exclusion as buildPylons — no rng consumed on skip).
    if (gz < -400) continue;
    const gx = pylonFrame.pos.x;
    const gy = pylonFrame.pos.y;
    const h = gy + GIRDER_BOTTOM;
    const pylonMat4 = new THREE.Matrix4().compose(
      _pos.set(gx, 0, gz),
      pylonFrame.quat.clone(),
      _scale
    );
    const strobeWorldPos = new THREE.Vector3(0, h - 0.3, 0).applyMatrix4(pylonMat4);
    allPlans.push({
      pylonMat: pylonMat4,
      h,
      hasGraffiti: rng.chance(0.5),
      graffitiOffsetY: rng.range(2.5, 4.5),
      strobeWorldPos,
      phase: i * 0.37,
      u
    });
  }

  if (allPlans.length === 0) return;

  const localMat = new THREE.Matrix4();
  const worldMat = new THREE.Matrix4();
  const zeroQuat = new THREE.Quaternion();
  const decalQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2);
  const decalGeom = new THREE.PlaneGeometry(0.9, 1.8);

  // Build per-zone pylon InstancedMesh groups.
  for (let zi = 0; zi < METRO_ZONE_NAMES.length; zi++) {
    const zoneName = METRO_ZONE_NAMES[zi];
    const u0 = METRO_ZONE_BOUNDARIES[zi];
    const u1 = METRO_ZONE_BOUNDARIES[zi + 1];
    const zonePlans = allPlans.filter((p) => p.u >= u0 && p.u < u1);
    if (zonePlans.length === 0) continue;

    const nZ = zonePlans.length;

    // --- Structural boxes (column + T-cap + 2 braces): one InstancedMesh/zone ---
    const PARTS_PER_PYLON = 4;
    const structMesh = new THREE.InstancedMesh(unitBox, sharedStructMat, nZ * PARTS_PER_PYLON);
    structMesh.name = `pylonStruct:${zoneName}`;
    let idx = 0;
    for (const p of zonePlans) {
      const { h } = p;
      localMat.compose(_pos.set(0, h / 2, 0), zeroQuat, _scale.set(0.9, h, 0.9));
      structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
      localMat.compose(_pos.set(0, h - 0.3, 0), zeroQuat, _scale.set(0.6, 0.6, RIB_HALF_W * 2 + 1.6));
      structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
      localMat.compose(_pos.set(0, h - 1.4, RIB_HALF_W + 0.5), zeroQuat, _scale.set(0.35, 2.2, 0.35));
      structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
      localMat.compose(_pos.set(0, h - 1.4, -(RIB_HALF_W + 0.5)), zeroQuat, _scale.set(0.35, 2.2, 0.35));
      structMesh.setMatrixAt(idx++, worldMat.multiplyMatrices(p.pylonMat, localMat));
    }
    structMesh.instanceMatrix.needsUpdate = true;
    structMesh.computeBoundingSphere();
    group.add(structMesh);

    // --- Hazard base collars ---
    const hazardMesh = new THREE.InstancedMesh(unitBox, hazardMat, nZ);
    hazardMesh.name = `pylonHazardBase:${zoneName}`;
    zonePlans.forEach((p, i) => {
      localMat.compose(_pos.set(0, 1.2, 0), zeroQuat, _scale.set(1.15, 2.4, 1.15));
      hazardMesh.setMatrixAt(i, worldMat.multiplyMatrices(p.pylonMat, localMat));
    });
    hazardMesh.instanceMatrix.needsUpdate = true;
    hazardMesh.computeBoundingSphere();
    group.add(hazardMesh);

    // --- Graffiti decals ---
    const graffitiZonePlans = zonePlans.filter((p) => p.hasGraffiti);
    if (graffitiZonePlans.length > 0) {
      const graffitiMesh = new THREE.InstancedMesh(decalGeom, graffitiMat, graffitiZonePlans.length);
      graffitiMesh.name = `pylonGraffiti:${zoneName}`;
      graffitiZonePlans.forEach((p, i) => {
        localMat.compose(_pos.set(0.46, p.graffitiOffsetY, 0), decalQuat, _scale.set(1, 1, 1));
        graffitiMesh.setMatrixAt(i, worldMat.multiplyMatrices(p.pylonMat, localMat));
      });
      graffitiMesh.instanceMatrix.needsUpdate = true;
      graffitiMesh.computeBoundingSphere();
      group.add(graffitiMesh);
    }
  }

  // --- Strobes: a single Points draw call covering all near-zone pylons.
  // Keep frustumCulled=false (the bounding sphere would be per-zone, but strobe
  // sprites need to be visible over a wider angle as small emissive dots — the
  // draw cost is 1 call at any viewpoint regardless of zone, same as original).
  const nearPlans = allPlans; // all plans (gz < -400 already excluded above)
  const nNear = nearPlans.length;
  const strobePositions = new Float32Array(nNear * 3);
  const strobePhases = new Float32Array(nNear);
  nearPlans.forEach((p, i) => {
    strobePositions[i * 3 + 0] = p.strobeWorldPos.x;
    strobePositions[i * 3 + 1] = p.strobeWorldPos.y;
    strobePositions[i * 3 + 2] = p.strobeWorldPos.z;
    strobePhases[i] = p.phase;
  });
  const strobeGeom = new THREE.BufferGeometry();
  strobeGeom.setAttribute('position', new THREE.BufferAttribute(strobePositions, 3));
  strobeGeom.setAttribute('aPhase', new THREE.BufferAttribute(strobePhases, 1));
  strobeGeom.computeBoundingSphere();

  const strobeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(COLORS.sodiumAmber) }
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      varying float vPhase;
      void main() {
        vPhase = aPhase;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 900.0 / -mv.z;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying float vPhase;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        float on = step(0.6, sin(uTime * 24.0 + vPhase));
        float intensity = 0.4 + mix(0.05, 1.0, on) * 4.0;
        gl_FragColor = vec4(uColor * intensity, 1.0);
      }
    `,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const strobePoints = new THREE.Points(strobeGeom, strobeMat);
  strobePoints.name = 'pylonStrobes';
  strobePoints.frustumCulled = false;
  group.add(strobePoints);

  group.userData.strobeMaterial = strobeMat;
}

// ---------------------------------------------------------------------------------
// Train: 4 hanging cars + bogies + gangway bellows
// ---------------------------------------------------------------------------------

interface CarNode {
  pivot: THREE.Group; // positioned/oriented at the girder-top path frame
  swing: THREE.Group; // swings ±SWAY about local forward (X) for pendulum sway
  headlight?: THREE.Mesh;
  skid: THREE.Mesh;
}

function buildCar(
  rng: Rng,
  isLead: boolean,
  sharedMats: {
    body: THREE.Material;
    win: THREE.Material;
    winMag: THREE.Material;
    dest: THREE.Material;
    skid: THREE.Material;
    head: THREE.Material;
    bogie: THREE.Material;
  }
): CarNode {
  const pivot = new THREE.Group();
  pivot.name = 'carPivot';

  // Bogie arms: two arms hooking over the girder top, reaching down to the car roof.
  const bogieParts: GeometryPart[] = [];
  const carTopY = HANG_DROP + CAR_HALF_H; // local y of car roof
  for (const ax of [-CAR_LEN * 0.28, CAR_LEN * 0.28]) {
    // hook plate gripping girder top
    bogieParts.push(boxPart(ax, GIRDER_TOP + 0.18, 0, 0.5, 0.36, RIB_HALF_W * 2 + 0.5));
    // side claws down the girder flanks
    bogieParts.push(boxPart(ax, 0, RIB_HALF_W + 0.12, 0.4, RIB_HALF_H * 2 + 0.4, 0.22));
    bogieParts.push(boxPart(ax, 0, -(RIB_HALF_W + 0.12), 0.4, RIB_HALF_H * 2 + 0.4, 0.22));
    // vertical arm from girder bottom down to car roof
    const armMidY = (GIRDER_BOTTOM + carTopY) / 2;
    const armH = GIRDER_BOTTOM - carTopY;
    bogieParts.push(boxPart(ax, armMidY, 0, 0.34, armH, 0.42));
  }
  pivot.add(mergeOne(bogieParts, sharedMats.bogie, 'bogie'));

  // Swing group (pendulum). Cars pivot about the girder line -> pivot at local y=0.
  const swing = new THREE.Group();
  swing.name = 'carSwing';
  pivot.add(swing);

  // --- Car body (dark rounded box) ---
  const bodyParts: GeometryPart[] = [];
  const cy = HANG_DROP;
  // main hull
  bodyParts.push(boxPart(0, cy, 0, CAR_LEN, CAR_HALF_H * 2, CAR_HALF_W * 2));
  // rounded "cheeks": narrower boxes stacked to fake a rounded roof + belly
  bodyParts.push(boxPart(0, cy + CAR_HALF_H, 0, CAR_LEN - 0.6, 0.4, CAR_HALF_W * 2 - 0.5));
  bodyParts.push(boxPart(0, cy - CAR_HALF_H, 0, CAR_LEN - 0.6, 0.4, CAR_HALF_W * 2 - 0.5));
  // nose/tail taper caps
  bodyParts.push(boxPart(CAR_LEN / 2 - 0.2, cy, 0, 0.5, CAR_HALF_H * 2 - 0.5, CAR_HALF_W * 2 - 0.4));
  bodyParts.push(boxPart(-CAR_LEN / 2 + 0.2, cy, 0, 0.5, CAR_HALF_H * 2 - 0.5, CAR_HALF_W * 2 - 0.4));
  swing.add(mergeOne(bodyParts, sharedMats.body, 'carBody'));

  // --- Lit window band on both sides ---
  const winMat = rng.chance(0.35) ? sharedMats.winMag : sharedMats.win;
  for (const sz of [1, -1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(CAR_LEN - 1.1, 1.0), winMat);
    win.position.set(0, cy + 0.15, sz * (CAR_HALF_W + 0.01));
    win.rotation.y = sz > 0 ? 0 : Math.PI;
    win.name = 'windowBand';
    swing.add(win);
  }

  // --- Destination board (front + one side) ---
  const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), sharedMats.dest);
  dest.position.set(0, cy + CAR_HALF_H - 0.25, CAR_HALF_W + 0.02);
  dest.name = 'destBoard';
  swing.add(dest);

  // --- Underside teal skid glow ---
  const skid = new THREE.Mesh(new THREE.PlaneGeometry(CAR_LEN - 1.2, CAR_HALF_W * 1.4), sharedMats.skid);
  skid.rotation.x = Math.PI / 2;
  skid.position.set(0, cy - CAR_HALF_H - 0.02, 0);
  skid.name = 'skidGlow';
  swing.add(skid);

  // --- Headlight on the lead car nose ---
  let headlight: THREE.Mesh | undefined;
  if (isLead) {
    headlight = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), sharedMats.head);
    headlight.position.set(CAR_LEN / 2 + 0.02, cy + 0.2, 0);
    headlight.rotation.y = Math.PI / 2;
    headlight.name = 'headlight';
    swing.add(headlight);
  }

  return { pivot, swing, headlight, skid };
}

/** Gangway bellows connecting two adjacent car roofs (concertina rings). */
function buildBellows(mat: THREE.Material): THREE.Mesh {
  const parts: GeometryPart[] = [];
  const rings = 5;
  const cy = HANG_DROP + 0.1;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1) - 0.5;
    const r = i % 2 === 0 ? 1.0 : 0.82;
    parts.push(boxPart(t * (CAR_GAP - 0.15), cy, 0, (CAR_GAP - 0.15) / rings, r * CAR_HALF_H, r * CAR_HALF_W));
  }
  return mergeOne(parts, mat, 'bellows');
}

interface TrainAsset {
  group: THREE.Group;
  cars: CarNode[];
  place(pathU: number, t: number): void;
}

function buildTrain(rng: Rng): TrainAsset {
  const group = new THREE.Group();
  group.name = 'metroTrain';

  const sharedMats = {
    body: darkStructureMat(),
    win: windowMat(makeWindowTexture(rng, false), 2.6),
    winMag: windowMat(makeWindowTexture(rng, true), 2.6),
    dest: windowMat(makeDestinationTexture(), 3.0),
    skid: glowMat(COLORS.holoTeal, 2.4),
    head: glowMat(COLORS.moonlight, 4.0),
    bogie: new THREE.MeshStandardMaterial({ color: COLORS.shadowBlue, roughness: 0.7, metalness: 0.5 })
  };

  const cars: CarNode[] = [];
  const bellowsMat = new THREE.MeshStandardMaterial({ color: 0x05060b, roughness: 0.95, metalness: 0 });
  const bellows: THREE.Group[] = [];
  for (let i = 0; i < N_CARS; i++) {
    const car = buildCar(rng, i === 0, sharedMats);
    group.add(car.pivot);
    cars.push(car);
    if (i < N_CARS - 1) {
      // bellows lives on its own pivot placed between car i and i+1
      const bg = new THREE.Group();
      bg.add(buildBellows(bellowsMat));
      group.add(bg);
      bellows.push(bg);
    }
  }

  const pathLen = METRO_PATH.getLength();
  const carSpacingU = CAR_PITCH / pathLen;

  const frame: PathFrame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };

  function place(pathU: number, t: number): void {
    // Cars: each at its own u offset so the consist bends through curves.
    for (let i = 0; i < N_CARS; i++) {
      const u = wrap01(pathU - (i - (N_CARS - 1) / 2) * carSpacingU);
      pathFrameAt(u, frame);
      cars[i].pivot.position.copy(frame.pos);
      cars[i].pivot.quaternion.copy(frame.quat);
      // Deterministic pendulum sway in t (+ per-car phase); pivots at the girder line.
      const sway = SWAY_MAX * Math.sin(t * SWAY_FREQ * Math.PI * 2 + i * 0.6);
      cars[i].swing.rotation.x = sway;
    }
    // Bellows between consecutive cars.
    for (let i = 0; i < bellows.length; i++) {
      const u = wrap01(pathU - (i - (N_CARS - 1) / 2 + 0.5) * carSpacingU);
      pathFrameAt(u, frame);
      bellows[i].position.copy(frame.pos);
      bellows[i].quaternion.copy(frame.quat);
      bellows[i].rotation.x += SWAY_MAX * 0.6 * Math.sin(t * SWAY_FREQ * Math.PI * 2 + i * 0.6 + 0.3);
    }
  }

  return { group, cars, place };
}

// ---------------------------------------------------------------------------------
// Public: buildMetro
// ---------------------------------------------------------------------------------

export interface MetroAsset {
  group: THREE.Group;
  update: (t: number) => void;
}

export function buildMetro(rng: Rng): MetroAsset {
  const group = new THREE.Group();
  group.name = 'metro';

  const track = buildTrack(rng);
  group.add(track);

  const train = buildTrain(rng);
  group.add(train.group);

  const strobeMaterial = track.userData.strobeMaterial as THREE.ShaderMaterial | undefined;

  function update(t: number): void {
    const pathU = wrap01(t * METRO_SPEED + METRO_PHASE);
    train.place(pathU, t);
    // Deterministic strobe blink (function of t only) — computed on the GPU from uTime.
    if (strobeMaterial) strobeMaterial.uniforms.uTime.value = t;
  }

  update(0);
  return { group, update };
}

// ---------------------------------------------------------------------------------
// Viewer demos (straight-track close-ups; the real loop is city-scale)
// ---------------------------------------------------------------------------------

/** Straight 40 m girder with the 4-car consist hanging beneath — for the metroTrain viewer. */
export function buildMetroTrainDemo(rng: Rng): MetroAsset {
  const group = new THREE.Group();
  const structMat = darkStructureMat();

  // Straight girder along X at y=0 (viewer re-centres). Build a short box-girder.
  const len = 44;
  const girderParts: GeometryPart[] = [];
  girderParts.push(boxPart(0, 0, 0, len, RIB_HALF_H * 2, RIB_HALF_W * 2));
  girderParts.push(boxPart(0, RIB_HALF_H + 0.1, 0, len, 0.2, RIB_HALF_W * 2 + 0.3));
  group.add(mergeOne(girderParts, structMat, 'demoGirder'));
  // ribs
  for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 3.2) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.28, RIB_HALF_H * 2 + 0.35, RIB_HALF_W * 2 + 0.3), structMat);
    rib.position.x = x;
    group.add(rib);
  }
  // running lights
  const runMat = glowMat(COLORS.holoTeal, 3.4);
  for (const sz of [1, -1]) {
    const rl = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), runMat);
    rl.position.set(0, -RUN_LIGHT_DOWN, sz * RUN_LIGHT_OUT);
    group.add(rl);
  }

  // Hanging consist, laid straight along X.
  const sharedMats = {
    body: darkStructureMat(),
    win: windowMat(makeWindowTexture(rng, false), 2.6),
    winMag: windowMat(makeWindowTexture(rng, true), 2.6),
    dest: windowMat(makeDestinationTexture(), 3.0),
    skid: glowMat(COLORS.holoTeal, 2.4),
    head: glowMat(COLORS.moonlight, 4.0),
    bogie: new THREE.MeshStandardMaterial({ color: COLORS.shadowBlue, roughness: 0.7, metalness: 0.5 })
  };
  const bellowsMat = new THREE.MeshStandardMaterial({ color: 0x05060b, roughness: 0.95, metalness: 0 });
  const cars: CarNode[] = [];
  for (let i = 0; i < N_CARS; i++) {
    const car = buildCar(rng, i === 0, sharedMats);
    car.pivot.position.set((i - (N_CARS - 1) / 2) * -CAR_PITCH, 0, 0);
    group.add(car.pivot);
    cars.push(car);
    if (i < N_CARS - 1) {
      const bg = new THREE.Group();
      bg.add(buildBellows(bellowsMat));
      bg.position.set((i - (N_CARS - 1) / 2) * -CAR_PITCH - CAR_PITCH / 2, 0, 0);
      group.add(bg);
    }
  }

  function update(t: number): void {
    for (let i = 0; i < cars.length; i++) {
      cars[i].swing.rotation.x = SWAY_MAX * Math.sin(t * SWAY_FREQ * Math.PI * 2 + i * 0.6);
    }
  }
  update(0);
  return { group, update };
}

/** One 35 m girder segment + a single T-pylon to the ground — for the metroPylon viewer. */
export function buildMetroPylonDemo(rng: Rng): MetroAsset {
  const group = new THREE.Group();
  const structMat = darkStructureMat();
  const gy = GIRDER_Y;

  // Girder segment along X at y=gy
  const len = PYLON_SPACING + 6;
  const gParts: GeometryPart[] = [];
  gParts.push(boxPart(0, gy, 0, len, RIB_HALF_H * 2, RIB_HALF_W * 2));
  gParts.push(boxPart(0, gy + RIB_HALF_H + 0.1, 0, len, 0.2, RIB_HALF_W * 2 + 0.3));
  for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 3.2) {
    gParts.push(boxPart(x, gy, 0, 0.28, RIB_HALF_H * 2 + 0.35, RIB_HALF_W * 2 + 0.3));
  }
  group.add(mergeOne(gParts, structMat, 'segGirder'));

  const runMat = glowMat(COLORS.holoTeal, 3.4);
  for (const sz of [1, -1]) {
    const rl = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), runMat);
    rl.position.set(0, gy - RUN_LIGHT_DOWN, sz * RUN_LIGHT_OUT);
    group.add(rl);
  }

  // T-pylon
  const h = gy + GIRDER_BOTTOM;
  const pParts: GeometryPart[] = [];
  pParts.push(boxPart(0, h / 2, 0, 0.9, h, 0.9));
  pParts.push(boxPart(0, h - 0.3, 0, 0.6, 0.6, RIB_HALF_W * 2 + 1.6));
  pParts.push(boxPart(0, h - 1.4, RIB_HALF_W + 0.5, 0.35, 2.2, 0.35));
  pParts.push(boxPart(0, h - 1.4, -(RIB_HALF_W + 0.5), 0.35, 2.2, 0.35));
  group.add(mergeOne(pParts, structMat, 'segPylon'));

  const hazardMat = new THREE.MeshStandardMaterial({ map: makeHazardTexture(), roughness: 0.8, metalness: 0.1 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.4, 1.15), hazardMat);
  base.position.set(0, 1.2, 0);
  group.add(base);

  const graffiti = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.8),
    new THREE.MeshStandardMaterial({ map: makeGraffitiTexture(rng), transparent: true, roughness: 0.9 })
  );
  graffiti.position.set(0.46, 3.4, 0);
  graffiti.rotation.y = Math.PI / 2;
  group.add(graffiti);

  const strobeMat = glowMat(COLORS.sodiumAmber, 4.0);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), strobeMat);
  strobe.position.set(0, h - 0.3, 0);
  group.add(strobe);

  function update(t: number): void {
    strobeMat.emissiveIntensity = 0.4 + (Math.sin(t * 24) > 0.6 ? 4 : 0.05);
  }
  update(0);
  return { group, update };
}
