import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import type { GeometryPart } from '../../utils/merge';
import { boxPart, mergeOne, makeBodyMat, makeGlowMat } from './tall';

/**
 * Task 12 (part 1/2): the shared rooftop clutter kit + `decorateRoof` packer.
 *
 * `decorateRoof` is called for EVERY Ring 0/1 building in the city (the ≥80%
 * non-flat-roof house rule lives here), so its output budget is tight: body and glow
 * clutter always route through two shared, merged buckets (≤2 draw calls) regardless of
 * how many items get packed. Fan discs are the one exception: `mergeStatic` bakes each
 * part's offset into vertex positions, which would leave a merged fan mesh's *transform*
 * at the roof origin — spinning it would orbit every fan around the roof center instead
 * of its own hub. So fan discs are kept as individual small `THREE.Mesh`es (geometry
 * centered at the mesh's own local origin, `mesh.position` set to the vent's hub), one
 * per vent unit (typically 0-2 per roof) — a small extra draw-call cost in exchange for
 * correct per-fan spin (`userData.fans`).
 *
 * Everything here is built in ROOF-LOCAL space: origin at the roof's own center,
 * resting on y=0 (callers translate the returned group to `(x, roof.y, z)`).
 */

export interface RoofSpec {
  y: number;
  w: number;
  d: number;
}

export interface DecorateRoofOpts {
  billboard?: boolean;
}

// ---------------------------------------------------------------------------------
// Individual clutter builders — each pushes into the shared `bodyParts` /
// `glowParts` buckets (and returns fan discs separately, since those need their own
// mesh to spin). All builders are parametric on size/heading via `rng` so repeated
// calls across hundreds of roofs don't look identical.
// ---------------------------------------------------------------------------------

/**
 * Parametric satellite dish: mast + parabolic bowl + feed arm, aimed by `heading`/`tilt`.
 * Round-2 detail (SAW: dishes are near-black on a near-black roof — the reference
 * calls for lit hardware, not invisible props): an optional small feed-tip status LED
 * (into `glowParts`, if provided) so the dish reads as active equipment at night.
 */
export function buildSatelliteDish(
  bodyParts: GeometryPart[],
  x: number,
  z: number,
  y: number,
  radius: number,
  heading: number,
  tilt: number,
  glowParts?: GeometryPart[]
): void {
  const mastH = radius * 1.1;
  bodyParts.push(boxPart(new THREE.Vector3(x, y + mastH / 2, z), new THREE.Vector3(0.14, mastH, 0.14)));
  const bowl = new THREE.SphereGeometry(radius, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4);
  const m = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + tilt, heading, 0))
    .setPosition(x, y + mastH, z);
  bodyParts.push({ geom: bowl, matrix: m, mat: 0 });
  // feed arm proud of the dish face
  const armLen = radius * 0.9;
  const armDir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(Math.PI / 2 + tilt, heading, 0));
  const armPos = new THREE.Vector3(x, y + mastH, z).addScaledVector(armDir, armLen * 0.5);
  const armQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir);
  bodyParts.push({
    geom: new THREE.BoxGeometry(1, 1, 1),
    matrix: new THREE.Matrix4().compose(armPos, armQuat, new THREE.Vector3(0.08, armLen, 0.08)),
    mat: 0
  });
  if (glowParts) {
    const tipPos = new THREE.Vector3(x, y + mastH, z).addScaledVector(armDir, armLen);
    glowParts.push({
      geom: new THREE.SphereGeometry(0.06, 6, 5),
      matrix: new THREE.Matrix4().makeTranslation(tipPos.x, tipPos.y, tipPos.z),
      mat: 0
    });
  }
}

/** A fan disc that must stay its own mesh (see `decorateRoof`'s fan-handling note) so it
 * can spin around its own hub rather than the roof origin. `geom` is centered at the
 * mesh's own local origin (not baked with a translation); `hub` is where that origin
 * belongs in roof-local space. */
export interface FanDisc {
  geom: THREE.BufferGeometry;
  hub: THREE.Vector3;
}

/**
 * Vent/AC unit box with a spinning fan disc on top (fan disc descriptor returned so the
 * caller can build its own un-merged, correctly-pivoted mesh).
 * Round-2 detail: a small status LED on the housing face reads as a lit mechanical
 * unit rather than a dark block.
 */
export function buildVentUnit(
  bodyParts: GeometryPart[],
  glowParts: GeometryPart[],
  x: number,
  z: number,
  y: number,
  w: number,
  d: number,
  h: number
): FanDisc {
  bodyParts.push(boxPart(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(w, h, d)));
  // fan housing rim
  const r = Math.min(w, d) * 0.38;
  bodyParts.push({
    geom: new THREE.CylinderGeometry(r * 1.08, r * 1.08, h * 0.15, 12),
    matrix: new THREE.Matrix4().makeTranslation(x, y + h + h * 0.05, z),
    mat: 0
  });
  glowParts.push(
    boxPart(new THREE.Vector3(x + w / 2 - 0.06, y + h * 0.35, z), new THREE.Vector3(0.05, 0.08, 0.08))
  );
  // Fan geometry stays centered at its own local origin (no baked matrix) so a mesh built
  // from it can spin in place; `hub` tells the caller where to place that mesh's pivot.
  const fanGeom = new THREE.CylinderGeometry(r, r, 0.06, 5);
  return { geom: fanGeom, hub: new THREE.Vector3(x, y + h + h * 0.1, z) };
}

/**
 * Horizontal pipe run along one axis, elbowed at both ends. Round-2 detail: a painted
 * amber warning band at the run's midpoint (industrial hazard-marking weathering) so
 * the pipe reads against the dark roof instead of vanishing.
 */
export function buildPipeRun(
  bodyParts: GeometryPart[],
  glowParts: GeometryPart[],
  x: number,
  z: number,
  y: number,
  len: number,
  axisZ: boolean
): void {
  const r = 0.18;
  const cyl = new THREE.CylinderGeometry(r, r, len, 8);
  const m = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(axisZ ? Math.PI / 2 : 0, 0, axisZ ? 0 : Math.PI / 2))
    .setPosition(x, y + r, z);
  bodyParts.push({ geom: cyl, matrix: m, mat: 0 });
  const elbow = new THREE.SphereGeometry(r * 1.3, 8, 6);
  const off = axisZ ? new THREE.Vector3(0, 0, len / 2) : new THREE.Vector3(len / 2, 0, 0);
  bodyParts.push({ geom: elbow, matrix: new THREE.Matrix4().makeTranslation(x + off.x, y + r, z + off.z), mat: 0 });
  bodyParts.push({ geom: elbow, matrix: new THREE.Matrix4().makeTranslation(x - off.x, y + r, z - off.z), mat: 0 });
  const bandGeom = new THREE.CylinderGeometry(r * 1.15, r * 1.15, len * 0.14, 8);
  glowParts.push({ geom: bandGeom, matrix: m.clone().setPosition(x, y + r, z), mat: 0 });
}

/**
 * Small water tower: tank on 4 legs, conical cap — same silhouette vocab as tall.ts.
 * Round-2 detail: a tiny cap-top warning lamp so the tank silhouette registers at night
 * instead of merging with the dark sky above the roofline.
 */
export function buildWaterTower(bodyParts: GeometryPart[], glowParts: GeometryPart[], x: number, z: number, y: number, r: number): void {
  const legH = 1.3;
  const bodyH = r * 1.8;
  bodyParts.push({
    geom: new THREE.CylinderGeometry(r, r, bodyH, 10),
    matrix: new THREE.Matrix4().makeTranslation(x, y + legH + bodyH / 2, z),
    mat: 0
  });
  bodyParts.push({
    geom: new THREE.ConeGeometry(r * 1.05, r * 0.5, 10),
    matrix: new THREE.Matrix4().makeTranslation(x, y + legH + bodyH + r * 0.25, z),
    mat: 0
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    bodyParts.push(
      boxPart(
        new THREE.Vector3(x + Math.cos(a) * r * 0.7, y + legH / 2, z + Math.sin(a) * r * 0.7),
        new THREE.Vector3(0.14, legH, 0.14)
      )
    );
  }
  glowParts.push({
    geom: new THREE.SphereGeometry(0.08, 6, 5),
    matrix: new THREE.Matrix4().makeTranslation(x, y + legH + bodyH + r * 0.5, z),
    mat: 0
  });
}

/** Small glass observatory dome (hemisphere on a low drum). */
export function buildObservatory(
  bodyParts: GeometryPart[],
  glowParts: GeometryPart[],
  x: number,
  z: number,
  y: number,
  r: number
): void {
  const drumH = 0.8;
  bodyParts.push({
    geom: new THREE.CylinderGeometry(r, r, drumH, 14),
    matrix: new THREE.Matrix4().makeTranslation(x, y + drumH / 2, z),
    mat: 0
  });
  glowParts.push({
    geom: new THREE.SphereGeometry(r * 0.94, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    matrix: new THREE.Matrix4().makeTranslation(x, y + drumH, z),
    mat: 0
  });
}

/** Rooftop table + 4 stools (tiny amenity deck detail). */
export function buildRoofTable(bodyParts: GeometryPart[], x: number, z: number, y: number): void {
  const topR = 0.55;
  bodyParts.push({
    geom: new THREE.CylinderGeometry(topR, topR, 0.06, 10),
    matrix: new THREE.Matrix4().makeTranslation(x, y + 0.75, z),
    mat: 0
  });
  bodyParts.push(boxPart(new THREE.Vector3(x, y + 0.375, z), new THREE.Vector3(0.1, 0.75, 0.1)));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const sx = x + Math.cos(a) * topR * 1.6;
    const sz = z + Math.sin(a) * topR * 1.6;
    bodyParts.push({
      geom: new THREE.CylinderGeometry(0.22, 0.22, 0.05, 8),
      matrix: new THREE.Matrix4().makeTranslation(sx, y + 0.42, sz),
      mat: 0
    });
    bodyParts.push(boxPart(new THREE.Vector3(sx, y + 0.21, sz), new THREE.Vector3(0.06, 0.42, 0.06)));
  }
}

/** Thin whip antenna with a tiny tip light so it registers against the night sky. */
export function buildAntennaWhip(bodyParts: GeometryPart[], glowParts: GeometryPart[], x: number, z: number, y: number, h: number): void {
  bodyParts.push({
    geom: new THREE.CylinderGeometry(0.03, 0.05, h, 6),
    matrix: new THREE.Matrix4().makeTranslation(x, y + h / 2, z),
    mat: 0
  });
  glowParts.push({
    geom: new THREE.SphereGeometry(0.05, 6, 5),
    matrix: new THREE.Matrix4().makeTranslation(x, y + h, z),
    mat: 0
  });
}

/** Flat skylight box with a faint glowing pane. */
export function buildSkylight(bodyParts: GeometryPart[], glowParts: GeometryPart[], x: number, z: number, y: number, w: number, d: number): void {
  const h = 0.35;
  bodyParts.push(boxPart(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(w, h, d)));
  glowParts.push({
    geom: new THREE.PlaneGeometry(w * 0.82, d * 0.82),
    matrix: new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
      .setPosition(x, y + h + 0.01, z),
    mat: 0
  });
}

/** Low parapet rail segment framing an edge of the roof. */
export function buildParapetRail(bodyParts: GeometryPart[], w: number, d: number, y: number): void {
  const railH = 0.9;
  const t = 0.1;
  const yc = y + railH / 2;
  bodyParts.push(
    boxPart(new THREE.Vector3(0, yc, d / 2 - t / 2), new THREE.Vector3(w, railH, t)),
    boxPart(new THREE.Vector3(0, yc, -d / 2 + t / 2), new THREE.Vector3(w, railH, t)),
    boxPart(new THREE.Vector3(w / 2 - t / 2, yc, 0), new THREE.Vector3(t, railH, d)),
    boxPart(new THREE.Vector3(-w / 2 + t / 2, yc, 0), new THREE.Vector3(t, railH, d))
  );
}

/** Rooftop billboard frame: 2 posts + panel (the panel itself uses the glow bucket). */
export function buildBillboardFrame(
  bodyParts: GeometryPart[],
  glowParts: GeometryPart[],
  x: number,
  z: number,
  y: number,
  w: number,
  h: number
): void {
  const postH = h + 1.2;
  bodyParts.push(
    boxPart(new THREE.Vector3(x - w / 2 + 0.3, y + postH / 2, z), new THREE.Vector3(0.3, postH, 0.3)),
    boxPart(new THREE.Vector3(x + w / 2 - 0.3, y + postH / 2, z), new THREE.Vector3(0.3, postH, 0.3)),
    boxPart(new THREE.Vector3(x, y + postH + 0.15, z), new THREE.Vector3(w, 0.3, 0.3))
  );
  glowParts.push({
    geom: new THREE.PlaneGeometry(w * 0.9, h),
    matrix: new THREE.Matrix4().makeTranslation(x, y + postH - h / 2, z + 0.2),
    mat: 0
  });
}

// ---------------------------------------------------------------------------------
// decorateRoof — packs 3-7 clutter items into `roof.w x roof.d` on a simple grid of
// slots (no overlap), reserving the center slot when `opts.billboard` is set.
// ---------------------------------------------------------------------------------

type Kind = 'dish' | 'vent' | 'pipe' | 'water' | 'observatory' | 'table' | 'antenna' | 'skylight';

const KINDS: Kind[] = ['dish', 'vent', 'pipe', 'water', 'observatory', 'table', 'antenna', 'skylight'];

export function decorateRoof(roof: RoofSpec, rng: Rng, opts: DecorateRoofOpts = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = 'roofClutter';

  const margin = 0.9;
  const usableW = Math.max(1, roof.w - margin * 2);
  const usableD = Math.max(1, roof.d - margin * 2);

  // Simple grid of slots sized to fit within the footprint; pick a grid dense enough to
  // host up to 7 non-overlapping items with margin.
  const cols = Math.max(2, Math.min(4, Math.round(Math.sqrt((usableW / usableD) * 6))));
  const rows = Math.max(2, Math.min(4, Math.ceil(6 / cols)));
  const cellW = usableW / cols;
  const cellD = usableD / rows;

  const slots: Array<{ x: number; z: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -usableW / 2 + cellW * (c + 0.5);
      const z = -usableD / 2 + cellD * (r + 0.5);
      slots.push({ x, z });
    }
  }

  // Reserve the slot nearest the center for the billboard.
  let billboardSlot: { x: number; z: number } | undefined;
  if (opts.billboard && slots.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const dist = slots[i].x * slots[i].x + slots[i].z * slots[i].z;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    billboardSlot = slots.splice(bestIdx, 1)[0];
  }

  // Shuffle remaining slots (Fisher-Yates via rng) and take 3-7 (minus the billboard).
  for (let i = slots.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const targetCount = rng.int(3, 7) - (opts.billboard ? 1 : 0);
  const chosen = slots.slice(0, Math.max(0, Math.min(targetCount, slots.length)));

  const bodyParts: GeometryPart[] = [];
  const glowParts: GeometryPart[] = [];
  const fanDiscs: FanDisc[] = [];

  const slotHalfW = cellW / 2 - 0.15;
  const slotHalfD = cellD / 2 - 0.15;

  for (const slot of chosen) {
    const kind = rng.pick(KINDS);
    const { x, z } = slot;
    switch (kind) {
      case 'dish': {
        const r = Math.min(slotHalfW, slotHalfD, rng.range(0.5, 1.1));
        buildSatelliteDish(bodyParts, x, z, 0, r, rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3), glowParts);
        break;
      }
      case 'vent': {
        const w = Math.min(slotHalfW * 1.6, rng.range(1.0, 1.8));
        const d = Math.min(slotHalfD * 1.6, rng.range(1.0, 1.8));
        const fan = buildVentUnit(bodyParts, glowParts, x, z, 0, w, d, rng.range(0.7, 1.3));
        fanDiscs.push(fan);
        break;
      }
      case 'pipe': {
        const axisZ = rng.chance(0.5);
        const len = Math.min(axisZ ? slotHalfD * 1.7 : slotHalfW * 1.7, rng.range(1.2, 2.4));
        buildPipeRun(bodyParts, glowParts, x, z, 0, len, axisZ);
        break;
      }
      case 'water': {
        const r = Math.min(slotHalfW, slotHalfD, rng.range(0.9, 1.5));
        buildWaterTower(bodyParts, glowParts, x, z, 0, r);
        break;
      }
      case 'observatory': {
        const r = Math.min(slotHalfW, slotHalfD, rng.range(0.8, 1.4));
        buildObservatory(bodyParts, glowParts, x, z, 0, r);
        break;
      }
      case 'table': {
        buildRoofTable(bodyParts, x, z, 0);
        break;
      }
      case 'antenna': {
        buildAntennaWhip(bodyParts, glowParts, x, z, 0, rng.range(2, 4));
        break;
      }
      case 'skylight': {
        const w = Math.min(slotHalfW * 1.6, rng.range(1.2, 2.2));
        const d = Math.min(slotHalfD * 1.6, rng.range(1.2, 2.2));
        buildSkylight(bodyParts, glowParts, x, z, 0, w, d);
        break;
      }
    }
  }

  if (opts.billboard && billboardSlot) {
    const bw = Math.min(roof.w * 0.7, 6);
    const bh = Math.min(2.5, roof.d * 0.5);
    buildBillboardFrame(bodyParts, glowParts, billboardSlot.x, billboardSlot.z, 0, bw, bh);
  }

  // Low parapet rail around the whole roof, always present, folded into bodyParts.
  buildParapetRail(bodyParts, roof.w - 0.3, roof.d - 0.3, 0);

  // Round-3 detail (SAW: even with clutter placed, the bare deck between items reads as
  // a flat dark plane — real rooftops in this reference are rain-slicked, catching
  // ambient neon): a faint teal puddle sheen dropped near a roof corner (kept out of the
  // billboard's reserved center) reads as wet weathering without adding a new draw call.
  const puddleR = Math.min(usableW, usableD, 4.8) * 0.18;
  const puddleX = -usableW / 2 + puddleR + 0.3;
  const puddleZ = usableD / 2 - puddleR - 0.3;
  glowParts.push({
    geom: new THREE.CircleGeometry(puddleR, 16),
    matrix: new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
      .setPosition(puddleX, 0.01, puddleZ),
    mat: 0
  });

  // Round-3 detail: dim teal marker lights spaced along the parapet perimeter — cheap
  // rooftop safety/edge lighting that ties the rail silhouette to the same lit
  // vocabulary as the rest of the clutter (folded into the same glow bucket).
  const railW = roof.w - 0.3;
  const railD = roof.d - 0.3;
  const perimLights = Math.max(4, Math.round((railW + railD) / 6));
  for (let i = 0; i < perimLights; i++) {
    const t = i / perimLights;
    const perim = 2 * (railW + railD);
    const dist = t * perim;
    let px: number;
    let pz: number;
    if (dist < railW) {
      px = -railW / 2 + dist;
      pz = -railD / 2;
    } else if (dist < railW + railD) {
      px = railW / 2;
      pz = -railD / 2 + (dist - railW);
    } else if (dist < 2 * railW + railD) {
      px = railW / 2 - (dist - railW - railD);
      pz = railD / 2;
    } else {
      px = -railW / 2;
      pz = railD / 2 - (dist - 2 * railW - railD);
    }
    glowParts.push({
      geom: new THREE.SphereGeometry(0.05, 5, 4),
      matrix: new THREE.Matrix4().makeTranslation(px, 0.95, pz),
      mat: 0
    });
  }

  if (bodyParts.length > 0) group.add(mergeOne(bodyParts, makeBodyMat(), 'clutterBody'));
  if (glowParts.length > 0) group.add(mergeOne(glowParts, makeGlowMat(COLORS.holoTeal, 1.4), 'clutterGlow'));

  // Fan discs stay individual meshes (NOT merged) — see the file-header note and
  // `FanDisc` doc: mergeStatic bakes each part's offset into vertex positions, so a
  // merged fan mesh's transform would sit at the roof origin and spinning it would orbit
  // every fan around the roof center instead of spinning in place on its own hub. Each
  // disc's geometry is centered at its own local origin, so `mesh.position = hub` gives
  // it the correct pivot and `mesh.rotation.y` spins it in place.
  const fanMat = makeGlowMat(COLORS.shadowBlue, 0.2);
  const fans: THREE.Mesh[] = fanDiscs.map((fan, i) => {
    const mesh = new THREE.Mesh(fan.geom, fanMat);
    mesh.position.copy(fan.hub);
    mesh.name = `fan${i}`;
    group.add(mesh);
    return mesh;
  });

  group.userData.footprint = [roof.w, roof.d];
  group.userData.fans = fans;
  return group;
}
