/**
 * Task 30 — Finale segment (t 0.79 – 1.0)
 *
 * ARCHITECTURE:
 *  The money shot. Bike accelerates from skywayEnd down onto the ocean bridge,
 *  riding straight toward the massive rising moon over the black ocean.
 *
 *  - Camera: chase from behind (shows moon ahead) at t=0.79, then slow pull-back
 *    and rise so the moon DOMINATES the upper frame with the biker silhouetted
 *    center-bottom against the moon-glitter streak (t 0.84–0.96), then camera
 *    holds while biker shrinks toward the moon (t 0.96–1.0).
 *  - Sandevistan: setMode('finale') at t≥0.80 (full rainbow echo), 'ride' below.
 *  - Bloom strength ramps BLOOM_BASE=0.9 → BLOOM_PEAK=1.1 (easeOutCubic); resets
 *    to BLOOM_BASE below t=0.79. Sweep showed 1.25+ blows out; 1.1 is tasteful ceiling
 *    given the moon+bridge-rail emissive baseline (easeOutCubic hits 87% peak by t=0.90).
 *  - Exposure ramps EXPOSURE_BASE=1.1 → EXPOSURE_PEAK=1.14 (easeOutCubic); resets
 *    to EXPOSURE_BASE below t=0.79.
 *  - Closing type (in-world CanvasTexture strip holos) fades in t 0.94–0.97:
 *      "EVAN LI — PORTFOLIO 2026" (left strip) and "KEEP SCROLLING ▼" (right strip)
 *    Two strips FLANKING the bridge exit: one left of center, one right of center,
 *    framing the biker's path toward the moon. (bridge center x=240, deck ~12m wide)
 *
 * CAMERA GEOMETRY:
 *  Moon at (240, 260, -2600), MOON_RADIUS=320. Bridge runs along x=240, y≈12-14,
 *  z from -860 to -1400. Camera chase from behind:
 *    t=0.79: 8m behind bike, 3m up — sees moon dead ahead down the bridge.
 *    t=0.84: 14m behind, 6m up — moon fills upper half, bike is small silhouette.
 *    t=0.92: 18m behind, 7m up, FOV=50 — moon even larger, biker tiny against it.
 *    t=0.96: 20m behind, 8m up, FOV=48 — hold here, biker drifts toward moon.
 *    t=1.0:  hold at t=0.96 pose — biker continues riding into the moon.
 *
 * SPEED KEYS:
 *  Research ended at t=0.79 with u = ROUTE_U.skywayStart + 0.65*(ROUTE_U.skywayEnd - ROUTE_U.skywayStart).
 *  Finale: continuous acceleration, reaching bridgeEnd (ROUTE_U.bridgeEnd) by t=1.0.
 *  u-rate ramps ×2.5 over the segment (piecewise with 3 keys).
 *
 * CLOSING TYPE:
 *  No DisplayAnchors for the finale. Position directly in world space.
 *  Two thin strips FLANKING the bridge exit, facing world +Z (toward the chase camera).
 *  Left strip: (226, 14, -1500) — "EVAN LI — PORTFOLIO 2026", 30m wide
 *  Right strip: (254, 14, -1500) — "KEEP SCROLLING ▼", 15m wide
 *  Bridge center x=240, deck ~12m wide; strips are ~14m off-center (just outside rails).
 *
 *  Z-position rationale: at t=0.94 bike is at z≈-1386 (easeOutCubic≈0.977 of route),
 *  camera is 20m behind at z≈-1366. Strips at z=-1500 are 134m ahead of camera,
 *  well inside FOV=48° looking toward moon at z=-2600. bridgeEnd is z=-1400;
 *  z=-1500 is below ocean surface (off-bridge), fine for floating holographic strips.
 *
 *  Fade in t=0.93 (T_TYPE_IN) → full at t=0.95 (T_TYPE_FULL) → hold until t=0.99 → fade out.
 *
 * FOG NOTE:
 *  Moon uses MeshBasicMaterial + fog:false — already punches through fog.
 *  FOG_DENSITY=0.0016. At z=-2600 (moon center), fog factor ≈ 1-exp(-0.0016^2 * 2600^2)
 *  ≈ 1-exp(-17.3) ≈ 1.0 — completely fogged. BUT the moon material has fog:false,
 *  so the sphere itself is never fogged. The glow sprite also uses fog:false.
 *  Per brief: moon should be visible. No fog density change needed.
 */

import * as THREE from 'three';
import type { CameraRig } from '../cameraRig';
import type { BikePath } from '../bikePath';
import type { SandevistanTrail } from '../../fx/sandevistan';
import type { Core } from '../../core/core';
import { ROUTE_U, roadFrame } from '../../world/route';
import { makeCanvasTexture } from '../../utils/canvasText';
import { COLORS } from '../../theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T_START = 0.79;
const T_END   = 1.0;
const T_FINALE_MODE = 0.80;  // sandevistan switches to finale
const T_TYPE_IN  = 0.93;     // closing type fade in begins — slightly before 0.94 so strips are fully legible by 0.95
const T_TYPE_FULL = 0.95;    // closing type fully visible at t=0.95 (brief legibility gate)
const T_TYPE_STAY = 0.99;    // keep visible until here

// Base bloom/exposure (same as core.ts defaults, reset below T_START for scrub-safety).
// Bloom sweep results (easeOutCubic ramp: at t=0.90 already ~87% of peak):
//   1.35: blown white mush at t=0.90 (moon+rails overwhelm)
//   1.30: blown, upper frame solid white at t=0.90
//   1.25: blown, biker invisible at t=0.95
//   1.15: better but still bright at upper frame — mid-frame OK
//   1.10: controlled — moon glow crisp, rails bright but not clipping, biker silhouette clear.
//         This is the tasteful ceiling for this scene given moon+rail emissive baseline.
// EXPOSURE: 1.20 pushed detail out at t=0.97, 1.14 lifts shadows without blowing moon.
const BLOOM_BASE  = 0.9;
const BLOOM_PEAK  = 1.1;
const EXPOSURE_BASE = 1.1;
const EXPOSURE_PEAK = 1.14;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/** Linear interpolation */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Finale progress 0→1 over t 0.79→1.0 */
function finaleProgress(t: number): number {
  return THREE.MathUtils.clamp((t - T_START) / (T_END - T_START), 0, 1);
}

// ---------------------------------------------------------------------------
// Camera key computation
// ---------------------------------------------------------------------------

/**
 * Computes the chase-behind camera position for the finale.
 * The bike travels along x=240, y≈12-14, z decreasing from ~-820 to -1400.
 * We position the camera behind (more positive Z) and above the bike.
 *
 * params.behindM: metres behind the bike (along +Z / reverse of travel direction)
 * params.upM: metres above the bike
 */
function chasePos(bikePos: THREE.Vector3, behindM: number, upM: number): THREE.Vector3 {
  // Route tangent on the bridge section is approximately (0, ~0, -1) — nearly pure -Z.
  // "Behind" = opposite of travel = +Z direction.
  // We use the route tangent for accuracy.
  return new THREE.Vector3(
    bikePos.x,
    bikePos.y + upM,
    bikePos.z + behindM   // +Z = behind
  );
}

/**
 * Compute bike world position at a given t in the finale.
 * Uses the speed key linear interpolation u values directly.
 */
function bikePosAtFinaleT(t: number, uAt79: number, uAt100: number): THREE.Vector3 {
  const frac = THREE.MathUtils.clamp((t - T_START) / (T_END - T_START), 0, 1);
  // Accelerating: use easeInQuad for u so the bike accelerates
  const uFrac = easeOutCubic(frac);
  const u = THREE.MathUtils.clamp(uAt79 + uFrac * (uAt100 - uAt79), 0, 1);
  return roadFrame(u).pos.clone();
}

// ---------------------------------------------------------------------------
// Strip holo texture builders
// ---------------------------------------------------------------------------

/** "EVAN LI — PORTFOLIO 2026" strip */
function drawTitleStrip(): THREE.CanvasTexture {
  const W = 1280;
  const H = 160;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);
    const moonlight = hex(COLORS.moonlight);

    // Background: near-black with slight blue tint
    ctx.fillStyle = '#07101eee';
    ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Scan lines (subtle)
    ctx.strokeStyle = 'rgba(183,245,233,0.04)';
    ctx.lineWidth = 1;
    for (let sy = 0; sy < H; sy += 4) {
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }

    // Corner marks
    const ck = 16;
    const corners: Array<[number, number, number, number]> = [
      [10, 10, 1, 1], [W-10, 10, -1, 1], [10, H-10, 1, -1], [W-10, H-10, -1, -1]
    ];
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + sx*ck, cy);
      ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + sy*ck);
      ctx.stroke();
    }

    // Main text — centered
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 56px "Unbounded"';
    ctx.fillStyle = moonlight;
    ctx.letterSpacing = '4px';
    ctx.fillText('EVAN LI — PORTFOLIO 2026', W / 2, H / 2);

    // Thin accent underline
    ctx.strokeStyle = accent + 'aa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(60, H - 18); ctx.lineTo(W - 60, H - 18);
    ctx.stroke();
  });
}

/** "KEEP SCROLLING ▼" mono strip */
function drawScrollStrip(): THREE.CanvasTexture {
  const W = 640;
  const H = 100;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);

    // Background
    ctx.fillStyle = '#06101dcc';
    ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = accent + '88';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '34px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '2px';
    ctx.fillText('KEEP SCROLLING ▼', W / 2, H / 2);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FinaleSegmentOptions {
  rig: CameraRig;
  bike: BikePath;
  sandevistan: SandevistanTrail;
  core: Core;
  updatables: { update(t: number): void }[];
}

export interface FinaleSegmentHandle {
  updateAmbient(sec: number): void;
}

export function registerFinaleSegment(opts: FinaleSegmentOptions): FinaleSegmentHandle {
  const { rig, bike, sandevistan, core } = opts;

  // ---- Step 1: Speed keys ----
  // Research segment ended at:
  //   { t:0.79, u: ROUTE_U.skywayStart + 0.65*(ROUTE_U.skywayEnd - ROUTE_U.skywayStart) }
  // We share that boundary t=0.79.
  // Finale: continuous acceleration from skywayEnd area to bridgeEnd.
  // u-rate ramps ×2.5: we achieve this with 3 keys creating a steeper slope toward t=1.0.
  //
  // uAt79: must match research segment's last u exactly.
  const uAt79 = ROUTE_U.skywayStart + 0.65 * (ROUTE_U.skywayEnd - ROUTE_U.skywayStart);
  // uAt100: bridgeEnd — where the bike reaches by the end of the scroll
  const uAt100 = ROUTE_U.bridgeEnd;

  // Total u-span for finale
  const uSpan = uAt100 - uAt79;

  // Acceleration: 3 keys at t=0.79, t=0.90, t=1.0
  // u-rate in first segment (0.79–0.90) is ~1x base
  // u-rate in second segment (0.90–1.0) is ~2.5x base
  // Chosen so overall u coverage hits uAt100.
  // If base rate r: 0.11*r + 0.10*(2.5*r) = uSpan → 0.11r + 0.25r = 0.36r = uSpan → r = uSpan/0.36
  // u at t=0.90: uAt79 + 0.11 * r = uAt79 + 0.11 * uSpan / 0.36 = uAt79 + uSpan * 0.306
  const uAt90 = uAt79 + uSpan * 0.306;

  bike.addSpeedKeys([
    { t: 0.79, u: uAt79  },
    { t: 0.90, u: uAt90  },
    { t: 1.00, u: uAt100 }
  ]);

  // ---- Step 2: Camera keys ----
  // Chase-behind camera. The bridge section runs from z≈-860 to z=-1400, x=240.
  // Moon at (240, 260, -2600) — dead ahead and high.
  // Camera behind = more positive Z. Camera looks toward the bike then ahead toward moon.
  //
  // Key strategy:
  //   t=0.79: 8m behind, 3m up → bike at ~z=-820, cam at z≈-812, looking at bike+moon ahead
  //   t=0.82: 10m behind, 4m up → opening reveal
  //   t=0.84: 14m behind, 6m up → moon starts dominating
  //   t=0.88: 16m behind, 7m up, FOV=52
  //   t=0.92: 18m behind, 7.5m up, FOV=50
  //   t=0.96: 20m behind, 8m up, FOV=48 → moon fills top 2/3, biker tiny center-bottom
  //   t=1.00: same pose as 0.96 → biker continues toward moon

  // Pre-compute bike positions at key t values
  type CamKeySpec = {
    t: number;
    behindM: number;
    upM: number;
    fov: number;
    roll: number;
  };

  // NOTE on camera handoff from research (t=0.79):
  // Research's last camera key at t=0.79 positions the camera 9m AHEAD of the bike
  // looking BACK (+Z direction). If we also add a key at t=0.79, the rig interpolates
  // between these two opposite orientations creating a "swinging" camera through t=0.79→0.80.
  //
  // Solution: Start finale's first key at t=0.800 (just past the research boundary).
  // The camera rig holds research's t=0.79 pose right up to t=0.800, then our first key
  // takes over. This means there's a hard snap at t=0.800, which is intentional and short
  // enough to feel like a "cut" at the moment the bridge segment begins.
  const keySpecs: CamKeySpec[] = [
    { t: 0.800, behindM:  8, upM: 3.0, fov: 58, roll: 0 },  // chase starts (snap from research)
    { t: 0.820, behindM: 10, upM: 4.0, fov: 56, roll: 0 },  // chase stabilizes
    { t: 0.850, behindM: 14, upM: 5.5, fov: 54, roll: 0 },  // pull back, moon reveals
    { t: 0.880, behindM: 16, upM: 6.5, fov: 52, roll: 0 },
    { t: 0.920, behindM: 18, upM: 7.0, fov: 50, roll: 0 },
    { t: 0.960, behindM: 20, upM: 7.5, fov: 48, roll: 0 },
    { t: 1.000, behindM: 20, upM: 7.5, fov: 48, roll: 0 }
  ];

  const camKeys = keySpecs.map((spec, i) => {
    const bikePos = bikePosAtFinaleT(spec.t, uAt79, uAt100);
    const camPos  = chasePos(bikePos, spec.behindM, spec.upM);

    // Look at a point slightly ahead of the bike toward the moon.
    // As the camera rises and pulls back, the look target transitions from
    // pure bike position to a blend between bike and moon direction.
    // This keeps the biker in frame while showing the moon growing.
    const moonDir = new THREE.Vector3(240, 260, -2600).sub(bikePos).normalize();
    const lookBlend = THREE.MathUtils.clamp((spec.t - 0.82) / 0.14, 0, 1); // 0→1 over t 0.82→0.96
    // lookTarget: bike pos + small blend toward moon direction
    // At t=0.79-0.82: look straight at bike
    // At t=0.96: look slightly above bike toward moon
    const lookTarget = bikePos.clone().add(moonDir.clone().multiplyScalar(lookBlend * 8));

    return {
      t: spec.t,
      pose: {
        pos: camPos,
        look: lookTarget,
        fov: spec.fov,
        roll: spec.roll
      },
      ease: i === 0 ? easeInOutQuad : undefined
    };
  });

  rig.addKeys(camKeys);

  // ---- Step 3: Updatable (sandevistan mode + bloom/exposure ramp) ----
  opts.updatables.push({
    update(t: number): void {
      // Sandevistan mode: finale at t≥0.80, ride below
      if (t >= T_FINALE_MODE) {
        sandevistan.setMode('finale');
      } else {
        sandevistan.setMode('ride');
      }

      // Bloom + exposure ramp: scrub-safe pure f(t)
      // Below t=0.79: reset to base (this segment's update runs for all t since it's
      // pushed to updatables, which process every frame).
      if (t < T_START) {
        core.setBloomStrength(BLOOM_BASE);
        core.setExposure(EXPOSURE_BASE);
      } else {
        const fp = finaleProgress(t);
        const eased = easeOutCubic(fp);
        core.setBloomStrength(lerp(BLOOM_BASE, BLOOM_PEAK, eased));
        core.setExposure(lerp(EXPOSURE_BASE, EXPOSURE_PEAK, eased));
      }
    }
  });

  // ---- Step 4: Closing type (browser-only) ----
  if (typeof document === 'undefined') {
    return { updateAmbient: () => {} };
  }

  // Build strip textures
  const titleTex  = drawTitleStrip();
  const scrollTex = drawScrollStrip();

  // Strip dimensions in world metres.
  // Brief: "two THIN strip holos FLANKING the bridge exit."
  // Each strip is kept narrow so they flank without blocking the moon view.
  //
  // Flanking geometry:
  //   Bridge center x=240, deck ~12m wide → rails near x=234 and x=246.
  //   LEFT strip (title "EVAN LI — PORTFOLIO 2026") at x=226 — just outside left rail.
  //   RIGHT strip (scroll "KEEP SCROLLING ▼") at x=254 — just outside right rail.
  //   Both at y=22 (above bridge deck at y≈12, above camera at y≈19.5 for visibility),
  //   z=-1500 (past bridgeEnd, floating in ocean space ahead of the bridge exit).
  //   Both face world +Z (toward the chase camera which is at more positive z).
  //   Camera at t=0.97: bike≈z=-1398, cam 20m behind at z≈-1378, strips at z=-1500
  //   → strips are 122m ahead of camera in the path toward the moon. FOV=48° at 122m:
  //   half-width ≈ 122*tan(24°) ≈ 54m, so ±14m lateral is well within frame.
  //   No Y-rotation needed: strips face +Z and camera looks along -Z, roughly face-on.

  // Title strip: 30m wide × aspect-correct height (1280:160 = 8:1 → 30m × 3.75m)
  // At z=-1500 (122m from camera at t=0.97), 30m occupies ~14° of FOV — clearly visible.
  const TITLE_W  = 30;
  const TITLE_H  = TITLE_W * (160 / 1280);  // ≈3.75m

  // Scroll strip: 15m wide × aspect-correct height (640:100 = 6.4:1 → 15m × 2.34m)
  const SCROLL_W = 15;
  const SCROLL_H = SCROLL_W * (100 / 640);  // ≈2.34m

  // Left strip (title) — LEFT of bridge center
  const titleGeo = new THREE.PlaneGeometry(TITLE_W, TITLE_H);
  const titleMat = new THREE.MeshBasicMaterial({
    map: titleTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide
  });

  const titleMesh = new THREE.Mesh(titleGeo, titleMat);
  // x=226: left of center; y=14: at bridge-deck height (darker part of frame, visible vs teal ocean);
  // z=-1500: past bridgeEnd, floating in ocean space ahead of biker's final position.
  titleMesh.position.set(226, 14, -1500);
  titleMesh.name = 'finaleTitle';
  titleMesh.frustumCulled = false;

  // Right strip (scroll) — RIGHT of bridge center
  const scrollGeo = new THREE.PlaneGeometry(SCROLL_W, SCROLL_H);
  const scrollMat = new THREE.MeshBasicMaterial({
    map: scrollTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide
  });
  const scrollMesh = new THREE.Mesh(scrollGeo, scrollMat);
  // x=254: right of center; y=14: same height; z=-1500: aligned with title strip
  scrollMesh.position.set(254, 14, -1500);
  scrollMesh.name = 'finaleScroll';
  scrollMesh.frustumCulled = false;

  // Glow planes: one behind each strip for additive halo effect
  const glowGeoL = new THREE.PlaneGeometry(TITLE_W + 4, TITLE_H + 2);
  const glowGeoR = new THREE.PlaneGeometry(SCROLL_W + 4, SCROLL_H + 2);
  const glowMatL = new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.moonlight),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide
  });
  const glowMatR = glowMatL.clone();
  const glowMeshL = new THREE.Mesh(glowGeoL, glowMatL);
  glowMeshL.position.set(226, 14, -1501);  // slightly behind left strip
  glowMeshL.name = 'finaleGlowL';
  glowMeshL.frustumCulled = false;
  const glowMeshR = new THREE.Mesh(glowGeoR, glowMatR);
  glowMeshR.position.set(254, 14, -1501);  // slightly behind right strip
  glowMeshR.name = 'finaleGlowR';
  glowMeshR.frustumCulled = false;

  // Lazy-add to scene on first visible frame.
  let typeAddedToScene = false;
  const scene = core.scene;

  function ensureTypeMeshesInScene(): void {
    if (typeAddedToScene) return;
    typeAddedToScene = true;
    scene.add(titleMesh);
    scene.add(scrollMesh);
    scene.add(glowMeshL);
    scene.add(glowMeshR);
  }

  // Closing type alpha
  function typeAlpha(t: number): number {
    if (t < T_TYPE_IN)   return 0;
    if (t < T_TYPE_FULL) return easeInOutQuad((t - T_TYPE_IN) / (T_TYPE_FULL - T_TYPE_IN));
    if (t < T_TYPE_STAY) return 1;
    // Fade out very gently at t≥0.99
    return Math.max(0, 1 - (t - T_TYPE_STAY) / 0.01);
  }

  // Push updatable for closing type visibility
  opts.updatables.push({
    update(t: number): void {
      const alpha = typeAlpha(t);
      if (alpha > 0) {
        ensureTypeMeshesInScene();
        titleMat.opacity  = alpha;
        scrollMat.opacity = alpha;
        glowMatL.opacity  = alpha * 0.04;
        glowMatR.opacity  = alpha * 0.04;
      } else {
        titleMat.opacity  = 0;
        scrollMat.opacity = 0;
        glowMatL.opacity  = 0;
        glowMatR.opacity  = 0;
      }
    }
  });

  // Ambient: slow pulsing glow on both flanking glow planes
  function updateAmbient(sec: number): void {
    if (!typeAddedToScene) return;
    const alpha = titleMat.opacity;
    if (alpha <= 0) return;

    // Gentle pulse on glow
    const pulse = 0.03 + 0.015 * Math.sin(sec * 0.8);
    glowMatL.opacity = alpha * pulse;
    glowMatR.opacity = alpha * pulse;
  }

  return { updateAmbient };
}
