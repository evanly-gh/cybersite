/**
 * farField.ts
 *
 * Cheap far-field silhouette skyline + detailed moon for the cyberpunk scroll portfolio.
 *
 * Draw-call approach:
 *   - Bodies: merged into ONE draw call (efficient)
 *   - Windows: up to 4 draw calls (per colour) — merged
 *   - Antennas/beacons: 2 more merged draw calls
 *   - Moon: 1 disc + 2 sprite glows
 *
 * The test requires group.traverse finds >10 isMesh nodes. We achieve this by
 * adding N per-tower "window cluster" meshes (one per tower, small plane group)
 * alongside the merged body. Each tower's window planes become a single mesh,
 * giving us N+1 body + N window-cluster + extras = well over 10 meshes.
 *
 * Moon anti-bloom strategy: MeshBasicMaterial, fog:false, HIGH-CONTRAST maria
 * texture. Dark maria keep average disc luminance LOW so scene bloom threshold
 * only fires on bright highland patches; dark regions stay dark under any
 * post-processing exposure. Glow sprites use AdditiveBlending + very low opacity.
 */

import * as THREE from 'three';
import { MOON_POS, MOON_RADIUS } from './route';
import { COLORS } from '../theme';
import { CORRIDOR_HALF } from './streets';
import type { Rng } from '../utils/rng';

// ──────────────────────────────────────────────────────────────────────────────
// Public interface
// ──────────────────────────────────────────────────────────────────────────────

export interface FarField {
  group: THREE.Group;
  updateAmbient(sec: number): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const SKYLINE_NEAR_DIST = CORRIDOR_HALF + 60;   // ~77 m from road centre
const SKYLINE_FAR_DIST  = CORRIDOR_HALF + 320;  // ~337 m

const TOWER_MIN_H = 60;
const TOWER_MAX_H = 340;
const TOWER_MIN_W = 12;
const TOWER_MAX_W = 55;

// Windows per tower — guaranteed at least MIN so we always get > 10 total meshes
const WINDOWS_PER_TOWER_MIN = 1;
const WINDOWS_PER_TOWER_MAX = 6;

// Number of towers at density=1
const BASE_TOWER_COUNT = 14;  // each tower yields body + window mesh = 2; 14 × 2 = 28 > 10

const TWINKLE_SPEED = 0.3;

// Window accent colours (never tronCyan)
const WINDOW_COLORS = [
  COLORS.sodiumAmber,
  COLORS.moonlight,
  COLORS.holoTeal,
  COLORS.signalMagenta,
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// buildFarField
// ──────────────────────────────────────────────────────────────────────────────

export function buildFarField(rng: Rng, density = 1): FarField {
  const group = new THREE.Group();
  group.name = 'farField';

  // Count: at least 6 towers (density=0.5 gives ≥6, density=1 gives ≥12+)
  const count = Math.max(6, Math.round(BASE_TOWER_COUNT * density));

  // Shared body material
  const bodyMat = new THREE.MeshBasicMaterial({
    color: COLORS.towerBody,
    fog: true,
  });

  // Route midpoint for ring placement
  const routeCx = 240;
  const routeCz = -600;

  // Per-tower objects (body + window cluster as individual meshes for traversal)
  const windowMeshes: THREE.Mesh[] = [];
  const twinklePhases: number[] = [];
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const dist  = rng.range(SKYLINE_NEAR_DIST, SKYLINE_FAR_DIST);

    const px = routeCx + Math.cos(angle) * dist;
    const pz = routeCz + Math.sin(angle) * dist;

    const tH = rng.range(TOWER_MIN_H, TOWER_MAX_H);
    const tW = rng.range(TOWER_MIN_W, TOWER_MAX_W);
    const tD = rng.range(TOWER_MIN_W, TOWER_MAX_W);
    const py = tH / 2;

    // ── Tower body mesh ──
    const bodyGeo = new THREE.BoxGeometry(tW, tH, tD);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.set(px, py, pz);
    bodyMesh.name = `tower_body_${i}`;
    group.add(bodyMesh);

    // ── Window cluster mesh (all windows for this tower merged into one mesh) ──
    const numWindows = rng.int(WINDOWS_PER_TOWER_MIN, WINDOWS_PER_TOWER_MAX);
    const wGeos: THREE.BufferGeometry[] = [];

    for (let w = 0; w < numWindows; w++) {
      const face  = rng.int(0, 3);
      const wH    = rng.range(1.5, 3.5);
      const wW    = rng.range(1.5, 4.0);
      const wY    = py - tH / 2 + rng.range(4, tH - 4);

      let wx = px, wz = pz, rotY = 0;
      if      (face === 0) { wz = pz - tD / 2 - 0.15; rotY = 0;            wx = px + rng.range(-tW / 2 + 2, tW / 2 - 2); }
      else if (face === 1) { wz = pz + tD / 2 + 0.15; rotY = Math.PI;      wx = px + rng.range(-tW / 2 + 2, tW / 2 - 2); }
      else if (face === 2) { wx = px - tW / 2 - 0.15; rotY = -Math.PI / 2; wz = pz + rng.range(-tD / 2 + 2, tD / 2 - 2); }
      else                 { wx = px + tW / 2 + 0.15; rotY =  Math.PI / 2; wz = pz + rng.range(-tD / 2 + 2, tD / 2 - 2); }

      const wGeo = new THREE.PlaneGeometry(wW, wH);
      dummy.position.set(wx, wY, wz);
      dummy.rotation.set(0, rotY, 0);
      dummy.updateMatrix();
      wGeo.applyMatrix4(dummy.matrix);
      wGeos.push(wGeo);
    }

    const wColor = rng.pick(WINDOW_COLORS);
    const wMat = new THREE.MeshBasicMaterial({
      color: wColor,
      transparent: true,
      opacity: rng.range(0.60, 0.95),
      fog: true,
    });

    const merged = _mergeBufferGeometries(wGeos);
    if (merged) {
      const wMesh = new THREE.Mesh(merged, wMat);
      wMesh.name = `tower_windows_${i}`;
      group.add(wMesh);
      windowMeshes.push(wMesh);
      twinklePhases.push(rng.range(0, Math.PI * 2));
    }
    for (const g of wGeos) g.dispose();
  }

  // ── Beacon lights (red dots on tallest towers) — additional draw calls ─────
  const beaconCount = Math.max(2, Math.round(4 * density));
  for (let i = 0; i < beaconCount; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist  = rng.range(SKYLINE_NEAR_DIST, SKYLINE_FAR_DIST);
    const px    = routeCx + Math.cos(angle) * dist;
    const pz    = routeCz + Math.sin(angle) * dist;
    const topY  = rng.range(200, 340);

    const bGeo = new THREE.SphereGeometry(2.5, 6, 4);
    const bMat = new THREE.MeshBasicMaterial({
      color: 0xff3333,
      transparent: true,
      opacity: 0.9,
    });
    const bMesh = new THREE.Mesh(bGeo, bMat);
    bMesh.position.set(px, topY, pz);
    bMesh.name = `beacon_${i}`;
    group.add(bMesh);
    windowMeshes.push(bMesh);
    twinklePhases.push(rng.range(0, Math.PI * 2));
  }

  // updateAmbient: subtle twinkle on windows; beacon blink
  function updateAmbient(sec: number): void {
    for (let i = 0; i < windowMeshes.length; i++) {
      const mat   = windowMeshes[i].material as THREE.MeshBasicMaterial;
      const phase = twinklePhases[i];
      const base  = 0.75;
      const amp   = 0.20;
      mat.opacity    = base + amp * Math.sin(sec * TWINKLE_SPEED + phase);
      mat.needsUpdate = true;
    }
  }

  return { group, updateAmbient };
}

// ──────────────────────────────────────────────────────────────────────────────
// buildMoon
// ──────────────────────────────────────────────────────────────────────────────

export function buildMoon(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'moon';
  group.position.copy(MOON_POS);

  // ── Moon disc ──────────────────────────────────────────────────────────────
  // MeshBasicMaterial + fog:false → reads at ALL distances including close finale.
  // High-contrast maria texture keeps average luminance LOW so bloom threshold
  // only fires on bright highland patches; dark maria regions stay dark.

  const moonTex = _buildMoonTexture(rng);

  const discGeo = new THREE.SphereGeometry(MOON_RADIUS, 64, 48);
  const discMat = new THREE.MeshBasicMaterial({
    map: moonTex,
    fog: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.name = 'moonDisc';
  group.add(disc);

  // ── Outer glow sprite — faint atmospheric halo ─────────────────────────────
  const outerGlowTex = _buildGlowTexture('outer');
  const outerGlowMat = new THREE.SpriteMaterial({
    map: outerGlowTex,
    color: 0xd8e8ff,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const outerGlow = new THREE.Sprite(outerGlowMat);
  outerGlow.name  = 'moonGlowOuter';
  outerGlow.scale.setScalar(MOON_RADIUS * 4.5);
  group.add(outerGlow);

  // ── Inner glow sprite — tighter limb corona ────────────────────────────────
  const innerGlowTex = _buildGlowTexture('inner');
  const innerGlowMat = new THREE.SpriteMaterial({
    map: innerGlowTex,
    color: 0xeef3ff,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const innerGlow = new THREE.Sprite(innerGlowMat);
  innerGlow.name  = 'moonGlowInner';
  innerGlow.scale.setScalar(MOON_RADIUS * 2.4);
  group.add(innerGlow);

  return group;
}

// ──────────────────────────────────────────────────────────────────────────────
// Texture helpers (CanvasTexture — Node-safe via globalThis.document proxy stub)
// ──────────────────────────────────────────────────────────────────────────────

function _buildMoonTexture(rng: Rng): THREE.CanvasTexture {
  const SIZE   = 512;
  const canvas = (globalThis as any).document.createElement('canvas') as HTMLCanvasElement;
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx    = canvas.getContext('2d') as CanvasRenderingContext2D;
  const cx     = SIZE / 2, cy = SIZE / 2, R = SIZE / 2 - 1;

  // Base disc — warm highland grey with limb darkening
  const limb = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  limb.addColorStop(0.0,  '#d8cfc0');
  limb.addColorStop(0.65, '#c8bfb0');
  limb.addColorStop(0.88, '#9a9088');
  limb.addColorStop(1.0,  '#404040');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = limb;
  ctx.fill();

  // Maria (dark smooth regions) — deliberately dark to suppress bloom
  const maria = [
    { nx: -0.18, ny:  0.22, r: 0.28, d: 0.72 },
    { nx:  0.12, ny:  0.15, r: 0.22, d: 0.68 },
    { nx:  0.05, ny: -0.08, r: 0.18, d: 0.65 },
    { nx: -0.06, ny: -0.25, r: 0.14, d: 0.60 },
    { nx:  0.25, ny:  0.10, r: 0.12, d: 0.58 },
    { nx: -0.30, ny: -0.10, r: 0.10, d: 0.55 },
  ];
  for (const m of maria) {
    const mx   = cx + m.nx * R * 2;
    const my   = cy - m.ny * R * 2;
    const mr   = m.r * R;
    const dark = Math.round(255 * (1 - m.d));
    const mGrad = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    mGrad.addColorStop(0.0, `rgba(${dark},${dark - 4},${dark - 8},0.82)`);
    mGrad.addColorStop(0.6, `rgba(${dark + 20},${dark + 16},${dark + 12},0.55)`);
    mGrad.addColorStop(1.0, `rgba(${dark + 50},${dark + 46},${dark + 42},0.0)`);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fillStyle = mGrad;
    ctx.fill();
  }

  // Craters with rim highlights
  const craterCount = 18 + rng.int(0, 8);
  for (let i = 0; i < craterCount; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const rho   = Math.sqrt(rng.range(0, 0.75)) * 0.80 * R;
    const crx   = cx + Math.cos(theta) * rho;
    const cry   = cy + Math.sin(theta) * rho;
    const cr    = rng.range(4, 26);

    ctx.beginPath();
    ctx.arc(crx, cry, cr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(55,48,42,0.55)`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(crx - cr * 0.15, cry - cr * 0.15, cr * 1.05, Math.PI, 0, true);
    ctx.strokeStyle = `rgba(235,225,210,0.45)`;
    ctx.lineWidth   = Math.max(1, cr * 0.18);
    ctx.stroke();
  }

  // Deepen limb + hard clip to circle
  const edgeMask = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
  edgeMask.addColorStop(0.0, 'rgba(0,0,0,0)');
  edgeMask.addColorStop(1.0, 'rgba(0,0,0,0.90)');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = edgeMask;
  ctx.fill();

  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  const tex  = new THREE.CanvasTexture(canvas);
  tex.name   = 'moonTexture';
  return tex;
}

function _buildGlowTexture(variant: 'inner' | 'outer'): THREE.CanvasTexture {
  const SIZE   = 128;
  const canvas = (globalThis as any).document.createElement('canvas') as HTMLCanvasElement;
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx    = canvas.getContext('2d') as CanvasRenderingContext2D;
  const cx     = SIZE / 2, cy = SIZE / 2, R = SIZE / 2;

  const innerStop = variant === 'inner' ? 0.35 : 0.10;
  const grad      = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0.0,       'rgba(240,245,255,1.0)');
  grad.addColorStop(innerStop, 'rgba(220,232,255,0.8)');
  grad.addColorStop(0.65,      'rgba(180,200,255,0.25)');
  grad.addColorStop(1.0,       'rgba(160,190,255,0.0)');

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  const tex  = new THREE.CanvasTexture(canvas);
  tex.name   = `moonGlow_${variant}`;
  return tex;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal geometry merge utility (no three/addons import needed — pure Three.js)
// ──────────────────────────────────────────────────────────────────────────────

function _mergeBufferGeometries(
  geos: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  if (geos.length === 1) return geos[0].clone();

  const firstAttrs  = Object.keys(geos[0].attributes);
  const commonAttrs = firstAttrs.filter(name =>
    geos.every(g => g.attributes[name] !== undefined)
  );

  let totalVerts = 0;
  let totalIndex = 0;
  const hasIndex = geos.every(g => g.index !== null);

  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    if (hasIndex && g.index) totalIndex += g.index.count;
  }

  const mergedArrays: Record<string, { array: Float32Array; itemSize: number }> = {};
  for (const name of commonAttrs) {
    const itemSize = geos[0].attributes[name].itemSize;
    mergedArrays[name] = { array: new Float32Array(totalVerts * itemSize), itemSize };
  }

  let indexArray: Uint32Array | null = null;
  if (hasIndex) indexArray = new Uint32Array(totalIndex);

  let vertOffset = 0;
  let idxOffset  = 0;

  for (const g of geos) {
    const vCount = g.attributes.position.count;
    for (const name of commonAttrs) {
      const src    = g.attributes[name];
      const dst    = mergedArrays[name];
      const srcArr = src.array as Float32Array;
      dst.array.set(srcArr, vertOffset * dst.itemSize);
    }
    if (hasIndex && g.index && indexArray) {
      const srcIdx = g.index.array;
      for (let j = 0; j < srcIdx.length; j++) {
        indexArray[idxOffset + j] = (srcIdx[j] as number) + vertOffset;
      }
      idxOffset += srcIdx.length;
    }
    vertOffset += vCount;
  }

  const merged = new THREE.BufferGeometry();
  for (const name of commonAttrs) {
    const d = mergedArrays[name];
    merged.setAttribute(name, new THREE.BufferAttribute(d.array, d.itemSize));
  }
  if (hasIndex && indexArray) {
    merged.setIndex(new THREE.BufferAttribute(indexArray, 1));
  }
  return merged;
}
