import * as THREE from 'three';
import { tryLoadScene } from '../gltfLoader';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import type { GeometryPart } from '../../utils/merge';
import {
  FLOOR_H,
  boxPart,
  mergeOne,
  makeGlowMat,
  makeBodyMat,
  makeWindowTexture,
  makeWindowMat,
  makeBeaconMat,
  addTierFacades,
  type WindowTexOpts
} from './tall';

/**
 * gltfBuildings.ts — GLTF cyberpunk building hybrid module.
 *
 * Contract:
 *  - loadGltfModels(basePath) → Promise<GltfLibrary>
 *    Attempts to fetch CC0 GLTF models from `basePath` (e.g. '/models/').
 *    Any 404 / network error is silently caught — the returned library marks
 *    that model as unavailable, and builder functions fall back to procedural
 *    geometry so the city always has content regardless of which files were
 *    downloaded.
 *
 *  - GltfLibrary exposes individual parsed scenes via named getters, each
 *    returning THREE.Group|null (null = not downloaded).
 *
 *  - Template builders (gltfXxx functions) accept a GltfLibrary plus a Rng
 *    and return THREE.Group with the standard building contract:
 *      { userData.roofY, userData.footprint: [w, d] }
 *    They splice GLTF meshes (when available) into a procedural shell,
 *    or fall back to the full procedural version when the model is null.
 *
 * Exposed kind names (the `gltfXxx` pattern the city assembly can reference):
 *   gltfCyberpunkTower    — Quaternius-style cyberpunk megatower or procedural fallback
 *   gltfCommercialBlock   — Kenney-style commercial row or procedural fallback
 *   gltfIndustrialUnit    — Kenney industrial shed or procedural fallback
 *   gltfResidentialTower  — Mid-rise residential with balconies or procedural fallback
 *
 * Palette rule (house rule): never use tronCyan. All neon uses holoTeal,
 * signalMagenta, sodiumAmber, or moonlight.
 */

// ---------------------------------------------------------------------------
// GLTF Library — container returned by loadGltfModels
// ---------------------------------------------------------------------------

export interface GltfModel {
  /** The parsed scene root, or null if the file failed to load. */
  scene: THREE.Group | null;
  /** Originating URL, for debugging. */
  url: string;
  /** Whether the file was successfully fetched and parsed. */
  available: boolean;
}

export interface GltfLibrary {
  cyberpunkTower: GltfModel;
  commercialBlock: GltfModel;
  industrialUnit: GltfModel;
  residentialTower: GltfModel;
}

/** File names relative to basePath. These are the Quaternius/Kenney CC0 targets. */
const MODEL_FILES: Record<keyof GltfLibrary, string> = {
  cyberpunkTower: 'cyberpunk_tower.glb',
  commercialBlock: 'commercial_block.glb',
  industrialUnit: 'industrial_unit.glb',
  residentialTower: 'residential_tower.glb'
};

function makeEmptyModel(url: string): GltfModel {
  return { scene: null, url, available: false };
}

/**
 * Attempt to load CC0 GLTF models from `basePath`. Any individual failure is
 * silently swallowed — the library always resolves, with unavailable entries
 * set to { scene: null, available: false }. Builders fall back to procedural
 * geometry for any missing model.
 *
 * Usage:
 *   const lib = await loadGltfModels('/models/');
 *   const building = gltfCyberpunkTower(lib, rng);
 */
export async function loadGltfModels(basePath = '/models/'): Promise<GltfLibrary> {
  async function tryLoad(filename: string): Promise<GltfModel> {
    const url = basePath + filename;
    // tryLoadScene uses the shared DRACO-configured loader, so DRACO-compressed
    // CC0 kits decode correctly; returns null on absent/failed load.
    const scene = await tryLoadScene(url);
    if (!scene) return makeEmptyModel(url);
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return { scene, url, available: true };
  }

  const [cyberpunkTower, commercialBlock, industrialUnit, residentialTower] = await Promise.all([
    tryLoad(MODEL_FILES.cyberpunkTower),
    tryLoad(MODEL_FILES.commercialBlock),
    tryLoad(MODEL_FILES.industrialUnit),
    tryLoad(MODEL_FILES.residentialTower)
  ]);

  return { cyberpunkTower, commercialBlock, industrialUnit, residentialTower };
}

// ---------------------------------------------------------------------------
// Shared procedural fallbacks — used when GLTF is unavailable
// ---------------------------------------------------------------------------

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** Scaled + centered clone of a GLTF scene, fitted to target W×D×H. */
function fitGltfScene(scene: THREE.Group, targetW: number, targetH: number, targetD: number): THREE.Group {
  const clone = scene.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Uniform scale to fit within the target bounding volume.
  const scaleX = targetW / Math.max(size.x, 0.01);
  const scaleY = targetH / Math.max(size.y, 0.01);
  const scaleZ = targetD / Math.max(size.z, 0.01);
  const scale = Math.min(scaleX, scaleY, scaleZ);
  clone.scale.setScalar(scale);
  // Re-center so the bottom face sits on y=0.
  clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  return clone;
}

// ---------------------------------------------------------------------------
// Procedural fallback: Cyberpunk Tower
//   A setback slab with pronounced magenta corner fins and a neon crown ring.
//   Replaces Quaternius Cyberpunk Game Kit tower when that GLB is not present.
// ---------------------------------------------------------------------------

function buildCyberpunkTowerProc(rng: Rng, floors = 28): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gltfCyberpunkTowerProc';

  const totalH = floors * FLOOR_H;
  const w = rng.range(18, 24);
  const d = rng.range(14, 20);

  const windowTexOpts: WindowTexOpts = {
    litRatio: rng.range(0.45, 0.62),
    coolRatio: 0.55,
    peakRatio: 0.06,
    dimLo: 0.2,
    dimHi: 0.5,
    dirt: true
  };

  const bodyBox = new THREE.BoxGeometry(w, totalH, d);
  const bodyMesh = new THREE.Mesh(bodyBox, makeBodyMat());
  bodyMesh.position.set(0, totalH / 2, 0);
  bodyMesh.name = 'body';
  group.add(bodyMesh);

  // Parapet lip
  const parapetMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.6, 0.6, d + 0.6),
    makeBodyMat()
  );
  parapetMesh.position.set(0, totalH + 0.3, 0);
  group.add(parapetMesh);

  // Facades
  const winParts: GeometryPart[] = [];
  addTierFacades(winParts, rng, w - 0.4, d - 0.4, totalH - 1.6, 0.2, 0.24);
  const winTex = makeWindowTexture(rng, windowTexOpts);
  const winMesh = mergeOne(winParts, makeWindowMat(winTex), 'windows');
  group.add(winMesh);

  // Magenta corner fins — 4 vertical strips at building corners
  const finH = totalH + 2;
  const finParts: GeometryPart[] = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      finParts.push(
        boxPart(
          new THREE.Vector3(sx * (w / 2 + 0.12), finH / 2, sz * (d / 2 + 0.12)),
          new THREE.Vector3(0.22, finH, 0.22)
        )
      );
    }
  }
  group.add(mergeOne(finParts, makeGlowMat(COLORS.signalMagenta, 2.4), 'fins'));

  // Neon crown ring — torus hovering above the parapet
  const ringGeom = new THREE.TorusGeometry(Math.min(w, d) * 0.38, 0.18, 8, 32);
  ringGeom.rotateX(Math.PI / 2);
  const ringMesh = new THREE.Mesh(ringGeom, makeGlowMat(COLORS.holoTeal, 2.0));
  ringMesh.position.set(0, totalH + 2.4, 0);
  ringMesh.name = 'crownRing';
  group.add(ringMesh);

  // Amber accent: lobby band at street level
  const lobbyParts: GeometryPart[] = [
    boxPart(new THREE.Vector3(0, 2.2, d / 2 + 0.08), new THREE.Vector3(w * 0.65, 0.4, 0.14)),
    boxPart(new THREE.Vector3(w / 2 + 0.08, 2.2, 0), new THREE.Vector3(0.14, 0.4, d * 0.65))
  ];
  // Rooftop clutter: a few AC boxes
  for (let i = 0; i < 3; i++) {
    const bw = rng.range(1.2, 2.4);
    const bd = rng.range(0.9, 1.8);
    const bh = rng.range(0.7, 1.4);
    const bx = rng.range(-w / 2 + bw, w / 2 - bw);
    const bz = rng.range(-d / 2 + bd, d / 2 - bd);
    lobbyParts.push(
      boxPart(new THREE.Vector3(bx, totalH + bh / 2 + 0.6, bz), new THREE.Vector3(bw, bh, bd))
    );
  }
  group.add(mergeOne(lobbyParts, makeGlowMat(COLORS.sodiumAmber, 1.4), 'amber'));

  // Aviation beacon on the corner fins
  const beaconGeom = new THREE.SphereGeometry(0.28, 8, 6);
  const beacons = mergeOne(
    [
      { geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(0, totalH + 3, 0), mat: 0 }
    ],
    makeBeaconMat(),
    'beacons'
  );
  group.add(beacons);

  group.userData.roofY = totalH;
  group.userData.footprint = [w, d];
  group.userData.beacons = [beacons];
  return group;
}

// ---------------------------------------------------------------------------
// Procedural fallback: Commercial Block
//   Kenney-style 2-3 story commercial row with varied shopfronts and signage.
// ---------------------------------------------------------------------------

function buildCommercialBlockProc(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gltfCommercialBlockProc';

  const bays = rng.int(3, 5);
  const bayW = rng.range(6, 9);
  const totalW = bays * bayW;
  const d = rng.range(8, 12);
  const floors = rng.int(2, 3);
  const totalH = floors * FLOOR_H;

  // Main body
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(totalW, totalH, d),
    makeBodyMat()
  );
  bodyMesh.position.set(0, totalH / 2, 0);
  bodyMesh.name = 'body';
  group.add(bodyMesh);

  // Parapet
  const parapetMesh = new THREE.Mesh(
    new THREE.BoxGeometry(totalW + 0.4, 0.5, d + 0.4),
    makeBodyMat()
  );
  parapetMesh.position.set(0, totalH + 0.25, 0);
  group.add(parapetMesh);

  // Upper floor windows
  const winParts: GeometryPart[] = [];
  addTierFacades(winParts, rng, totalW - 0.6, d - 0.6, FLOOR_H - 0.8, FLOOR_H + 0.3, 0.32);
  const winTex = makeWindowTexture(rng, {
    litRatio: rng.range(0.45, 0.6),
    coolRatio: 0.4,
    peakRatio: 0.05,
    dimLo: 0.3,
    dimHi: 0.55
  });
  group.add(mergeOne(winParts, makeWindowMat(winTex), 'windows'));

  // Per-bay shop fronts: awning color strips and accent neons
  const neonColors = [COLORS.holoTeal, COLORS.signalMagenta, COLORS.sodiumAmber, COLORS.moonlight];
  const glowParts: GeometryPart[] = [];
  const amberParts: GeometryPart[] = [];

  for (let i = 0; i < bays; i++) {
    const cx = -totalW / 2 + bayW * i + bayW / 2;
    const accentColor = rng.pick(neonColors);

    // Shopfront awning strip
    glowParts.push(
      boxPart(new THREE.Vector3(cx, FLOOR_H - 0.2, d / 2 + 0.55), new THREE.Vector3(bayW - 0.6, 0.2, 1.0))
    );

    // Sign strip at top of ground floor
    glowParts.push(
      boxPart(new THREE.Vector3(cx, FLOOR_H + 0.3, d / 2 + 0.06), new THREE.Vector3(bayW - 1.0, 0.5, 0.18))
    );

    // Recessed doorway
    amberParts.push(
      boxPart(new THREE.Vector3(cx, 1.2, d / 2 + 0.06), new THREE.Vector3(1.4, 2.4, 0.15))
    );

    void accentColor; // color is per-bay but geometry is uniform here; tinting is material-level
  }

  group.add(mergeOne(glowParts, makeGlowMat(COLORS.holoTeal, 1.6), 'shopSignage'));
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.8), 'doorGlow'));

  // Rooftop vent boxes
  const roofParts: GeometryPart[] = [];
  for (let i = 0; i < rng.int(2, 4); i++) {
    const bw = rng.range(1.0, 2.0);
    const bd = rng.range(0.8, 1.6);
    const bh = rng.range(0.6, 1.2);
    roofParts.push(
      boxPart(
        new THREE.Vector3(rng.range(-totalW / 2 + bw, totalW / 2 - bw), totalH + bh / 2 + 0.5, rng.range(-d / 2 + bd, d / 2 - bd)),
        new THREE.Vector3(bw, bh, bd),
        rng.range(0, Math.PI)
      )
    );
  }
  group.add(mergeOne(roofParts, makeBodyMat(), 'roofClutter'));

  group.userData.roofY = totalH;
  group.userData.footprint = [totalW, d];
  return group;
}

// ---------------------------------------------------------------------------
// Procedural fallback: Industrial Unit
//   Kenney-style warehouse/shed with corrugated roof ridge and loading dock.
// ---------------------------------------------------------------------------

function buildIndustrialUnitProc(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gltfIndustrialUnitProc';

  const w = rng.range(20, 32);
  const d = rng.range(16, 24);
  const h = rng.range(7, 10);

  // Main shed body
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    makeBodyMat()
  );
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Roof ridge (thin raised bar at center)
  const ridgeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.4, 0.35, 1.2),
    makeBodyMat()
  );
  ridgeMesh.position.set(0, h + 0.18, 0);
  group.add(ridgeMesh);

  // Loading dock: a recessed dark opening + amber door glow
  const dockParts: GeometryPart[] = [];
  const dockH = 3.5;
  const dockW = 4.0;
  const nDocks = rng.int(1, 2);
  const amberParts: GeometryPart[] = [];
  for (let i = 0; i < nDocks; i++) {
    const dx = (i - (nDocks - 1) / 2) * (w / (nDocks + 1));
    // Recessed dark panel (dock opening)
    dockParts.push(
      boxPart(new THREE.Vector3(dx, dockH / 2, d / 2 + 0.06), new THREE.Vector3(dockW, dockH, 0.2))
    );
    // Amber door glow
    amberParts.push(
      boxPart(new THREE.Vector3(dx, dockH / 2, d / 2 + 0.1), new THREE.Vector3(dockW - 0.4, dockH - 0.3, 0.1))
    );
    // Dock bumper
    dockParts.push(
      boxPart(new THREE.Vector3(dx, 0.55, d / 2 + 0.18), new THREE.Vector3(dockW + 0.4, 0.4, 0.35))
    );
  }
  group.add(mergeOne(dockParts, makeBodyMat(), 'docks'));
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.8), 'dockGlow'));

  // Safety warning stripe on the facade corners — magenta emissive
  const stripParts: GeometryPart[] = [];
  for (const sx of [1, -1]) {
    stripParts.push(
      boxPart(new THREE.Vector3(sx * (w / 2 + 0.08), h / 2, 0), new THREE.Vector3(0.18, h, 0.18))
    );
  }
  group.add(mergeOne(stripParts, makeGlowMat(COLORS.signalMagenta, 1.8), 'safetyStripes'));

  // Rooftop: flue stacks + large vent hood
  const roofParts: GeometryPart[] = [];
  const flueGeom = new THREE.CylinderGeometry(0.28, 0.28, 3.5, 8);
  for (let i = 0; i < rng.int(2, 4); i++) {
    const fx = rng.range(-w / 2 + 2, w / 2 - 2);
    const fz = rng.range(-d / 2 + 2, d / 2 - 2);
    roofParts.push({
      geom: flueGeom,
      matrix: new THREE.Matrix4().makeTranslation(fx, h + 1.75, fz),
      mat: 0
    });
  }
  roofParts.push(
    boxPart(new THREE.Vector3(w * 0.2, h + 0.8, 0), new THREE.Vector3(3.5, 1.6, 5.0))
  );
  group.add(mergeOne(roofParts, makeBodyMat(), 'roofFlues'));

  // Teal safety lamp cluster — a dim holoTeal strip at each dock overhead
  const tealParts: GeometryPart[] = [];
  for (let i = 0; i < nDocks; i++) {
    const dx = (i - (nDocks - 1) / 2) * (w / (nDocks + 1));
    tealParts.push(
      boxPart(new THREE.Vector3(dx, dockH + 0.5, d / 2 + 0.06), new THREE.Vector3(dockW, 0.1, 0.1))
    );
  }
  group.add(mergeOne(tealParts, makeGlowMat(COLORS.holoTeal, 1.2), 'dockLamps'));

  group.userData.roofY = h;
  group.userData.footprint = [w, d];
  return group;
}

// ---------------------------------------------------------------------------
// Procedural fallback: Residential Tower
//   Mid-rise tower with prominent balcony grids and a rooftop water tank.
// ---------------------------------------------------------------------------

function buildResidentialTowerProc(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gltfResidentialTowerProc';

  const floors = rng.int(14, 22);
  const w = rng.range(18, 26);
  const d = rng.range(12, 18);
  const totalH = floors * FLOOR_H;

  // Main body
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, totalH, d),
    makeBodyMat()
  );
  bodyMesh.position.set(0, totalH / 2, 0);
  group.add(bodyMesh);

  // Windows
  const winParts: GeometryPart[] = [];
  addTierFacades(winParts, rng, w - 0.4, d - 0.4, totalH - 1.6, 0.2, 0.24);
  const winTex = makeWindowTexture(rng, {
    litRatio: rng.range(0.48, 0.66),
    coolRatio: 0.42,
    peakRatio: 0.06,
    dimLo: 0.22,
    dimHi: 0.52,
    dirt: true
  });
  group.add(mergeOne(winParts, makeWindowMat(winTex), 'windows'));

  // Balcony grid: every other floor, full width front face
  const bodyParts: GeometryPart[] = [];
  const balconyFloors = Math.floor((floors - 2) / 2);
  for (let bf = 0; bf < balconyFloors; bf++) {
    const fy = (2 + bf * 2) * FLOOR_H;
    // Slab
    bodyParts.push(
      boxPart(new THREE.Vector3(0, fy, d / 2 + 0.7), new THREE.Vector3(w - 2, 0.14, 1.3))
    );
    // Rail (front edge)
    bodyParts.push(
      boxPart(new THREE.Vector3(0, fy + 0.95, d / 2 + 1.3), new THREE.Vector3(w - 2.2, 0.12, 0.1))
    );
  }

  // Parapet + service pipes
  bodyParts.push(
    boxPart(new THREE.Vector3(0, totalH + 0.25, 0), new THREE.Vector3(w + 0.4, 0.5, d + 0.4))
  );
  // Service pipe up the -X face
  bodyParts.push(
    boxPart(new THREE.Vector3(-w / 2 - 0.28, totalH / 2, 0), new THREE.Vector3(0.22, totalH, 0.22))
  );

  // Rooftop water tower
  const tankH = rng.range(2.4, 3.2);
  const tankR = rng.range(1.2, 1.8);
  const legH = 1.1;
  const tankGeom = new THREE.CylinderGeometry(tankR, tankR, tankH, 10);
  bodyParts.push({
    geom: tankGeom,
    matrix: new THREE.Matrix4().makeTranslation(w * 0.22, totalH + legH + tankH / 2, -d * 0.18),
    mat: 0
  });
  const tankCapGeom = new THREE.ConeGeometry(tankR * 1.05, tankR * 0.5, 10);
  bodyParts.push({
    geom: tankCapGeom,
    matrix: new THREE.Matrix4().makeTranslation(w * 0.22, totalH + legH + tankH + tankR * 0.25, -d * 0.18),
    mat: 0
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    bodyParts.push(
      boxPart(
        new THREE.Vector3(w * 0.22 + Math.cos(a) * tankR * 0.7, totalH + legH / 2, -d * 0.18 + Math.sin(a) * tankR * 0.7),
        new THREE.Vector3(0.16, legH, 0.16)
      )
    );
  }

  group.add(mergeOne(bodyParts, makeBodyMat(), 'bodyDetail'));

  // Amber accent: lobby entrance glow + stairwell lights
  const amberParts: GeometryPart[] = [
    boxPart(new THREE.Vector3(0, 2.2, d / 2 + 0.06), new THREE.Vector3(w * 0.55, 0.4, 0.14)),
    boxPart(new THREE.Vector3(-w / 2 - 0.26, totalH * 0.4, 0), new THREE.Vector3(0.06, 1.2, 0.5))
  ];
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.6), 'amber'));

  // Teal roof-edge lamp strips
  const tealParts: GeometryPart[] = [
    boxPart(new THREE.Vector3(0, totalH + 0.55, d / 2 - 0.3), new THREE.Vector3(w * 0.6, 0.08, 0.08)),
    boxPart(new THREE.Vector3(0, totalH + 0.55, -d / 2 + 0.3), new THREE.Vector3(w * 0.6, 0.08, 0.08))
  ];
  group.add(mergeOne(tealParts, makeGlowMat(COLORS.holoTeal, 1.4), 'roofEdgeLamps'));

  // Beacon on the water tank cap
  const beaconGeom = new THREE.SphereGeometry(0.22, 8, 6);
  const capTopY = totalH + legH + tankH + tankR * 0.5;
  const beacons = mergeOne(
    [{ geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(w * 0.22, capTopY, -d * 0.18), mat: 0 }],
    makeBeaconMat(),
    'beacons'
  );
  group.add(beacons);

  group.userData.roofY = totalH;
  group.userData.footprint = [w, d];
  group.userData.beacons = [beacons];
  return group;
}

// ---------------------------------------------------------------------------
// Hybrid builders — splice GLTF into a procedural shell, or fall back
// ---------------------------------------------------------------------------

/**
 * Cyberpunk megatower: uses Quaternius Cyberpunk Game Kit tower model when
 * available, positioned inside a procedural neon-trim shell. Falls back to a
 * fully procedural setback tower with magenta corner fins + teal crown ring.
 *
 * userData: roofY, footprint, beacons
 */
export function gltfCyberpunkTower(lib: GltfLibrary, rng: Rng, floors = 28): THREE.Group {
  if (!lib.cyberpunkTower.available || !lib.cyberpunkTower.scene) {
    return buildCyberpunkTowerProc(rng, floors);
  }

  const totalH = floors * FLOOR_H;
  const w = rng.range(18, 24);
  const d = rng.range(14, 20);

  const group = new THREE.Group();
  group.name = 'gltfCyberpunkTower';

  // Fit GLTF model into the target volume
  const gltfGroup = fitGltfScene(lib.cyberpunkTower.scene, w, totalH, d);
  group.add(gltfGroup);

  // Overlay procedural neon trim on top of the GLTF mesh
  const finParts: GeometryPart[] = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      finParts.push(
        boxPart(
          new THREE.Vector3(sx * (w / 2 + 0.12), totalH / 2, sz * (d / 2 + 0.12)),
          new THREE.Vector3(0.22, totalH + 2, 0.22)
        )
      );
    }
  }
  group.add(mergeOne(finParts, makeGlowMat(COLORS.signalMagenta, 2.4), 'fins'));

  const ringGeom = new THREE.TorusGeometry(Math.min(w, d) * 0.38, 0.18, 8, 32);
  ringGeom.rotateX(Math.PI / 2);
  const ringMesh = new THREE.Mesh(ringGeom, makeGlowMat(COLORS.holoTeal, 2.0));
  ringMesh.position.set(0, totalH + 2.4, 0);
  group.add(ringMesh);

  const beaconGeom = new THREE.SphereGeometry(0.28, 8, 6);
  const beacons = mergeOne(
    [{ geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(0, totalH + 3, 0), mat: 0 }],
    makeBeaconMat(),
    'beacons'
  );
  group.add(beacons);

  group.userData.roofY = totalH;
  group.userData.footprint = [w, d];
  group.userData.beacons = [beacons];
  return group;
}

/**
 * Commercial block: uses Kenney City Kit commercial row when available,
 * with procedural neon shopfront overlays. Falls back to a procedural row.
 *
 * userData: roofY, footprint
 */
export function gltfCommercialBlock(lib: GltfLibrary, rng: Rng): THREE.Group {
  if (!lib.commercialBlock.available || !lib.commercialBlock.scene) {
    return buildCommercialBlockProc(rng);
  }

  const bays = rng.int(3, 5);
  const bayW = rng.range(6, 9);
  const totalW = bays * bayW;
  const d = rng.range(8, 12);
  const floors = rng.int(2, 3);
  const totalH = floors * FLOOR_H;

  const group = new THREE.Group();
  group.name = 'gltfCommercialBlock';

  const gltfGroup = fitGltfScene(lib.commercialBlock.scene, totalW, totalH, d);
  group.add(gltfGroup);

  // Overlay neon sign strips
  const glowParts: GeometryPart[] = [];
  for (let i = 0; i < bays; i++) {
    const cx = -totalW / 2 + bayW * i + bayW / 2;
    glowParts.push(
      boxPart(new THREE.Vector3(cx, FLOOR_H + 0.3, d / 2 + 0.08), new THREE.Vector3(bayW - 1.0, 0.45, 0.16))
    );
    glowParts.push(
      boxPart(new THREE.Vector3(cx, FLOOR_H - 0.2, d / 2 + 0.55), new THREE.Vector3(bayW - 0.6, 0.18, 0.9))
    );
  }
  group.add(mergeOne(glowParts, makeGlowMat(COLORS.holoTeal, 1.6), 'shopSignage'));

  group.userData.roofY = totalH;
  group.userData.footprint = [totalW, d];
  return group;
}

/**
 * Industrial unit: uses Kenney Industrial Kit shed when available.
 * Falls back to a procedural warehouse with loading dock.
 *
 * userData: roofY, footprint
 */
export function gltfIndustrialUnit(lib: GltfLibrary, rng: Rng): THREE.Group {
  if (!lib.industrialUnit.available || !lib.industrialUnit.scene) {
    return buildIndustrialUnitProc(rng);
  }

  const w = rng.range(20, 32);
  const d = rng.range(16, 24);
  const h = rng.range(7, 10);

  const group = new THREE.Group();
  group.name = 'gltfIndustrialUnit';

  const gltfGroup = fitGltfScene(lib.industrialUnit.scene, w, h, d);
  group.add(gltfGroup);

  // Procedural neon safety overlay
  const stripParts: GeometryPart[] = [];
  for (const sx of [1, -1]) {
    stripParts.push(
      boxPart(new THREE.Vector3(sx * (w / 2 + 0.08), h / 2, 0), new THREE.Vector3(0.18, h, 0.18))
    );
  }
  group.add(mergeOne(stripParts, makeGlowMat(COLORS.signalMagenta, 1.8), 'safetyStripes'));

  const amberParts: GeometryPart[] = [
    boxPart(new THREE.Vector3(0, 3.5 / 2, d / 2 + 0.1), new THREE.Vector3(4.0 - 0.4, 3.5 - 0.3, 0.1))
  ];
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.8), 'dockGlow'));

  group.userData.roofY = h;
  group.userData.footprint = [w, d];
  return group;
}

/**
 * Residential tower: uses Kenney Building Kit residential tower when available.
 * Falls back to a procedural mid-rise with balconies and water tank.
 *
 * userData: roofY, footprint, beacons
 */
export function gltfResidentialTower(lib: GltfLibrary, rng: Rng): THREE.Group {
  if (!lib.residentialTower.available || !lib.residentialTower.scene) {
    return buildResidentialTowerProc(rng);
  }

  const floors = rng.int(14, 22);
  const w = rng.range(18, 26);
  const d = rng.range(12, 18);
  const totalH = floors * FLOOR_H;

  const group = new THREE.Group();
  group.name = 'gltfResidentialTower';

  const gltfGroup = fitGltfScene(lib.residentialTower.scene, w, totalH, d);
  group.add(gltfGroup);

  // Procedural amber accent + teal roof edges
  const amberParts: GeometryPart[] = [
    boxPart(new THREE.Vector3(0, 2.2, d / 2 + 0.06), new THREE.Vector3(w * 0.55, 0.4, 0.14))
  ];
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.6), 'amber'));

  const tealParts: GeometryPart[] = [
    boxPart(new THREE.Vector3(0, totalH + 0.55, d / 2 - 0.3), new THREE.Vector3(w * 0.6, 0.08, 0.08)),
    boxPart(new THREE.Vector3(0, totalH + 0.55, -d / 2 + 0.3), new THREE.Vector3(w * 0.6, 0.08, 0.08))
  ];
  group.add(mergeOne(tealParts, makeGlowMat(COLORS.holoTeal, 1.4), 'roofEdgeLamps'));

  const beaconGeom = new THREE.SphereGeometry(0.22, 8, 6);
  const beacons = mergeOne(
    [{ geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(0, totalH + 1, 0), mat: 0 }],
    makeBeaconMat(),
    'beacons'
  );
  group.add(beacons);

  group.userData.roofY = totalH;
  group.userData.footprint = [w, d];
  group.userData.beacons = [beacons];
  return group;
}

/**
 * Convenience: call all four builder functions with a single pre-loaded
 * library. Useful for testing the full set of GLTF kinds in one shot.
 */
export function buildAllGltfKinds(
  lib: GltfLibrary,
  rng: Rng
): { cyberpunkTower: THREE.Group; commercialBlock: THREE.Group; industrialUnit: THREE.Group; residentialTower: THREE.Group } {
  return {
    cyberpunkTower: gltfCyberpunkTower(lib, rng),
    commercialBlock: gltfCommercialBlock(lib, rng),
    industrialUnit: gltfIndustrialUnit(lib, rng),
    residentialTower: gltfResidentialTower(lib, rng)
  };
}
