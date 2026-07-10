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
 *  - Bloom strength ramps 0.9→1.5; exposure 1.1→1.25.
 *  - Closing type (in-world CanvasTexture strip holos) fades in t 0.94–0.98:
 *      "EVAN LI — PORTFOLIO 2026" and "KEEP SCROLLING ▼"
 *    Positioned flanking the bridge exit in world space (near bridgeEnd z=-1400).
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
 *  Left strip: (224, 16, -1350) facing +Z (bridge approach direction, looking ahead)
 *  Right strip: (256, 16, -1350) same facing
 *  Actually: place them above bridge deck, facing the approach (-Z direction of travel,
 *  so camera behind the bike sees them above the bridge ahead).
 *  Strips face world +Z (toward the camera that's behind the bike):
 *    camera is at z_cam = z_bike + 18..20 (more positive Z = behind bike which moves -Z)
 *    strips at z=-1350 face +Z so camera at z=-1350+20=-1330 sees them (panel faces +Z = toward +Z direction)
 *  Wait: camera is BEHIND the bike (more positive Z). Strip at z=-1350 should face +Z.
 *    Camera is at z=-1350+20=-1330. Vector from strip to camera: +Z. Strip facing +Z ✓
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
import { makeRng } from '../../utils/rng';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T_START = 0.79;
const T_END   = 1.0;
const T_FINALE_MODE = 0.80;  // sandevistan switches to finale
const T_TYPE_IN  = 0.92;     // closing type fade in begins
const T_TYPE_FULL = 0.95;    // closing type fully visible
const T_TYPE_STAY = 0.99;    // keep visible until here

// Base bloom/exposure (same as core.ts defaults)
const BLOOM_BASE  = 0.9;
const BLOOM_PEAK  = 1.1;
const EXPOSURE_BASE = 1.1;
const EXPOSURE_PEAK = 1.15;

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

  const _rng = makeRng(1337 + 30);

  // Build strip textures
  const titleTex  = drawTitleStrip();
  const scrollTex = drawScrollStrip();

  // Strip dimensions in world metres
  // Title strip: 1280×160 canvas → 24m wide × 3m tall in world
  const TITLE_W  = 24;
  const TITLE_H  = TITLE_W * (160 / 1280);  // ≈3m

  // Scroll strip: 640×100 canvas → 8m wide × 1.25m tall
  const SCROLL_W = 8;
  const SCROLL_H = SCROLL_W * (100 / 640);  // ≈1.25m

  // --- Build title strip geometry (PlaneGeometry, additive screen) ---
  // Positioned above the bridge deck flanking the closing stretch.
  // World position: x=240 (bridge center), y=20 (above deck at y≈12), z=-1340 (near end of bridge).
  // Strip faces world +Z so the camera behind the bike (at z > -1340) can see it.
  // One large centered strip spanning the full bridge width.
  // Geometry and materials for in-world closing type.
  // Normal blending (not additive) so text is readable against both dark and bright backgrounds.
  // fog: false to avoid distance fade.
  const titleGeo = new THREE.PlaneGeometry(TITLE_W, TITLE_H);
  const titleMat = new THREE.MeshBasicMaterial({
    map: titleTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide
  });

  // PLACEMENT: at t=0.95 bike is at z≈-1300, camera is 20m behind at z≈-1280.
  // Type at z=-1380 is ahead of camera, in field of view looking toward -Z.
  // Camera looks at bikePos (z≈-1300), type is at z=-1380 further ahead = in upper view frustum.
  // y=16: just above bridge deck (deck at y≈12), visible from camera at y≈19.5 looking slightly down.
  const titleMesh = new THREE.Mesh(titleGeo, titleMat);
  titleMesh.position.set(240, 16, -1380);
  titleMesh.name = 'finaleTitle';
  titleMesh.frustumCulled = false;

  // Scroll strip below the title
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
  scrollMesh.position.set(240, 14, -1380);
  scrollMesh.name = 'finaleScroll';
  scrollMesh.frustumCulled = false;

  // Glow plane: additive backlight halo (always additive, low opacity)
  const glowGeo = new THREE.PlaneGeometry(TITLE_W + 6, TITLE_H + 3);
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.moonlight),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide
  });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.position.set(240, 15.8, -1381);  // slightly behind title (more negative z)
  glowMesh.name = 'finaleGlow';
  glowMesh.frustumCulled = false;

  // These objects need to be added to the scene.
  // We defer to the updatable's first call — but they need a scene reference.
  // Pattern: flag-based lazy add the first time update(t) sees t near 0.94.
  // We receive scene via a closure passed from main.ts.
  // To avoid needing scene reference, we instead require caller to pass the scene.
  // For simplicity: we return an init function that the caller invokes with the scene.
  // But looking at how other segments do it (they add to anchors which are already in scene),
  // we need to add directly to the scene. The handle returned from registerFinaleSegment
  // will include an init(scene) method.
  // Update: simpler approach — just use the group pattern, caller adds to scene.
  // Return the group from the handle, and caller adds it.
  // Actually, looking at research.ts more carefully — it adds to anchors which are THREE.Group
  // objects already in the scene. For finale, we have no anchor, so we need the scene.
  // The cleanest approach: store all three meshes in a group, return that group from handle,
  // and let main.ts add it to the scene. But that changes the interface.
  // Alternative (used here): pass scene to updatable directly through closure — but we don't
  // have the scene at registration time.
  //
  // Decision: add `scene` to FinaleSegmentOptions. Update main.ts to pass core.scene.

  // NOTE: This will be wired in main.ts — we mark these as needing scene.add().
  // We use a lazy-init approach: on first update call, if not added yet, add to scene.
  // We store a reference via the opts.updatables push below.
  let typeAddedToScene = false;

  // We need the scene — store reference to core (which has core.scene)
  const scene = core.scene;

  function ensureTypeMeshesInScene(): void {
    if (typeAddedToScene) return;
    typeAddedToScene = true;
    scene.add(titleMesh);
    scene.add(scrollMesh);
    scene.add(glowMesh);
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
        scrollMat.opacity = alpha * 0.85;
        glowMat.opacity   = alpha * 0.04;
      } else {
        titleMat.opacity  = 0;
        scrollMat.opacity = 0;
        glowMat.opacity   = 0;
      }
    }
  });

  // Ambient: slow pulsing glow and subtle title billboard-face toward camera
  function updateAmbient(sec: number): void {
    if (!typeAddedToScene) return;
    const alpha = titleMat.opacity;
    if (alpha <= 0) return;

    // Gentle pulse on glow
    const pulse = 0.03 + 0.015 * Math.sin(sec * 0.8);
    glowMat.opacity = alpha * pulse;
  }

  return { updateAmbient };
}
