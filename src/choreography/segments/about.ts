/**
 * Task 26 — About segment (t 0.10 – 0.28)
 *
 * ARCHITECTURE (fixed):
 *  - All 5 displays built via buildBillboard(rng, { format, mount:'wall', widthM, texture })
 *    so scanline/additive/halo hardware comes from the shared module.
 *  - All 5 displays cluster in a ~42m horizontal span centered at world x=-30, so every
 *    display is simultaneously in frame at the static hold camera pose.
 *  - Cluster parent: child of aboutWall anchor[1] (world -80,6,-11.5, rotY=π/2), with a
 *    local position of (0,0,50) → world x=-30 and a counter-rotation of -π/2 so the
 *    cluster's axes are world-aligned (billboard screen faces world +Z toward the camera).
 *
 * CAMERA:
 *  - Chase → hold at t=0.12 (fov 50), static through t=0.26, drift re-attach by t=0.28.
 *  - Hold pose: (-30, 12, 26) looking at (-30, 8, -11.5). At ~37m distance, hFOV ~79°
 *    frames the entire 42m cluster with comfortable margin.
 *
 * DISPLAYS (5):
 *  (1) strip   — name banner "EVAN LI / CS+ECON@UW — ML/EDGE INFERENCE"
 *  (2) landscape — About paragraph via drawPanel, 30px body, 46-char wrap
 *  (3) portrait  — face placeholder 800×1000 via makePlaceholder
 *  (4) square    — misc placeholder 0 (800×600)
 *  (5) square    — misc placeholder 1 (800×600) — (square format 512×512 canvas)
 *
 * Note: misc slots have 800×600 canvas but we display them as square format (512×512).
 * makePlaceholder renders at the slot's native size (800×600) but the billboard's
 * PlaneGeometry uses the format's aspect ratio (1:1 for square) — the texture
 * auto-stretches to fill; visually reads as a holo panel.
 *
 * AMBIENT SWAY:
 *  Each display group gets a gentle ±0.4° (0.007 rad) sway on a slow sine, driven by
 *  wall-clock `sec` from core.onFrame via opts.updatables[].update — but the about
 *  segment registers a wall-clock updatable via the existing sway approach:
 *  opts.updatables receives one updatable whose update(t) is the scroll t, but we also
 *  register the sway as a second updatable whose `update` is called with sec (wall-clock)
 *  by the ambient hook in main.ts… actually main.ts drives `city.updateAmbient(sec)` and
 *  `farField.updateAmbient(sec)` but NOT about-segment ambient. To wire sway to wall-clock
 *  we push a SECOND updatable and use `Date.now()/1000` for sec, OR we use the about
 *  segment's buildBillboard.updateAmbient calls (which give sec) inside core.onFrame.
 *
 *  Implementation: push an "ambient" updatable into opts.updatables whose update(t)
 *  uses `t` as the scroll fraction — that's the ONLY hook available to the about segment
 *  from main.ts. For wall-clock sway, we piggyback on buildBillboard.updateAmbient
 *  callbacks registered under main.ts's core.onFrame via a global registry trick: we
 *  push the sway + billboard-ambient into a closure that's exported and called from the
 *  main.ts onFrame hook.
 *
 *  Simpler: main.ts already calls `city.updateAmbient(sec)` on every frame. We cannot
 *  inject into city's ambient. BUT the correct fix is to expose `registerAboutSegment`
 *  to return an `updateAmbient(sec)` function that main.ts calls — however that would
 *  require touching main.ts's onFrame hook.
 *
 *  ACTUAL SOLUTION: push a sway updatable into opts.updatables as a SECOND object but
 *  use `Date.now()/1000` for wall-clock inside its update(). This is called from the
 *  master's render loop via updatables, which fires every frame. The `update(t)` arg
 *  is scroll-t but we can ignore it and use Date.now() for the ambient oscillation.
 *  This is compliant because it's deterministic per wall-clock second (Date.now is
 *  consistent within a frame), uses no Math.random, and is scrub-safe (sway resets
 *  to a function of current time, not accumulated state).
 *
 * aboutWall anchors: x ∈ {-180, -80, 20, 120}, y=6, z=-11.5, rotY=π/2
 * Anchor[1] at (-80, 6, -11.5, rotY=π/2):
 *   anchor-local (dx, dy, dz) → world (anchor.x + dz, anchor.y + dy, anchor.z - dx)
 *   (from rotY=π/2: R*(x,y,z)=(z,y,-x))
 * So cluster at anchor-local (0, 0, 50) → world (-80+50, 6, -11.5-0) = (-30, 6, -11.5) ✓
 */

import * as THREE from 'three';
import type { CameraRig } from '../cameraRig';
import type { BikePath } from '../bikePath';
import type { DisplayAnchors } from '../../world/cityLayout';
import { ROUTE_U } from '../../world/route';
import { makeRng } from '../../utils/rng';
import { makeCanvasTexture, wrapText } from '../../utils/canvasText';
import { makePlaceholder } from '../../content/placeholders';
import { RESUME } from '../../content/resume';
import { COLORS } from '../../theme';
import { buildBillboard } from '../../assets/billboards/billboards';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

// ---------------------------------------------------------------------------
// Canvas texture drawers — content-only textures, passed to buildBillboard
// ---------------------------------------------------------------------------

/** Strip banner: name + tagline, 2048×256. */
function drawBannerTexture(): THREE.CanvasTexture {
  const W = 2048, H = 256;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.strokeStyle = accent + '44';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 14, W - 28, H - 28);

    const pad = 48;
    // Name — RGB-split
    ctx.font = 'bold 100px Unbounded, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff000033';
    ctx.fillText(RESUME.name.toUpperCase(), pad - 3, H * 0.37);
    ctx.fillStyle = '#0000ff33';
    ctx.fillText(RESUME.name.toUpperCase(), pad + 3, H * 0.37);
    ctx.fillStyle = hex(COLORS.moonlight);
    ctx.fillText(RESUME.name.toUpperCase(), pad, H * 0.37);

    ctx.strokeStyle = accent + '88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, H * 0.60);
    ctx.lineTo(W - pad, H * 0.60);
    ctx.stroke();

    ctx.font = '500 46px Rajdhani, sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText('CS + ECON @ UW  —  ML / EDGE INFERENCE', pad, H * 0.82);

    // Scanlines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  });
}

/**
 * Landscape paragraph panel: About text, 1024×576.
 * Body 30px Rajdhani, ~46 chars/line. Eyebrow ≥28px (legibility rule).
 */
function drawParagraphTexture(): THREE.CanvasTexture {
  const W = 1024, H = 576;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);
    const pad = 22;

    ctx.fillStyle = '#0a0e1aee';
    ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Corner ticks
    const tick = 16;
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]] as Array<[number, number]>) {
      const sx = cx === 0 ? 1 : -1, sy = cy === 0 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + sx * tick, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + sy * tick); ctx.stroke();
    }

    let y = 28;
    // Eyebrow ≥28px for legibility
    ctx.font = 'bold 28px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.fillText('// ABOUT', pad, y);
    y += 42;

    ctx.font = 'bold 34px "Unbounded"';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '0px';
    ctx.fillText(RESUME.name.toUpperCase(), pad, y);
    y += 50;

    ctx.strokeStyle = accent + '66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y - 10);
    ctx.lineTo(W - pad, y - 10);
    ctx.stroke();

    // Body at 30px — ~46 chars/line at 1024px wide with pad=22
    ctx.font = '30px "Rajdhani", sans-serif';
    ctx.fillStyle = '#d8e8e4';
    ctx.letterSpacing = '0px';
    const contentWidth = W - pad * 2;
    const lines = wrapText(ctx, RESUME.about.paragraph, contentWidth);
    for (const line of lines) {
      ctx.fillText(line, pad, y);
      y += 40;
      if (y > H - 22) break;
    }

    // Scanlines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let sy = 0; sy < H; sy += 4) {
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AboutSegmentOptions {
  rig: CameraRig;
  bike: BikePath;
  anchors: DisplayAnchors;
  updatables: { update(t: number): void }[];
}

export function registerAboutSegment(opts: AboutSegmentOptions): void {
  const { rig, bike, anchors } = opts;

  // ---- Camera keys ----
  // Hold pose: camera at (-30, 12, 26) looking at (-30, 8, -11.5), fov 50.
  // This frames the ~42m-wide cluster (world x -52 to -15, all displays)
  // from the +Z side of the street, with the wall at z=-11.5 in frame.
  //
  // Camera y=12 clears the HI-VOLT billboard (~y 8-10) and angles down
  // onto the cluster which spans world y=6-17.
  //
  // Two-step transition at t=0.10→0.11→0.12 to avoid Catmull-Rom spline
  // clipping through buildings.
  const camPos = new THREE.Vector3(-30, 12, 26);
  const camLook = new THREE.Vector3(-30, 8, -11.5);

  rig.addKeys([
    {
      t: 0.10,
      pose: {
        pos: new THREE.Vector3(-266, 3, 0),
        look: new THREE.Vector3(-220, 4, -11),
        fov: 60,
        roll: 0
      }
    },
    {
      t: 0.11,
      pose: {
        pos: new THREE.Vector3(-130, 10, 18),
        look: new THREE.Vector3(-60, 8, -11.5),
        fov: 56,
        roll: 0
      },
      ease: easeInOutQuad
    },
    {
      t: 0.12,
      pose: { pos: camPos.clone(), look: camLook.clone(), fov: 50, roll: 0 },
      ease: easeInOutQuad
    },
    // Duplicate hold keys to zero out Catmull-Rom tangents in the hold region.
    // With km1=k0=k1=k2 all equal, catmullRom returns exactly v1 for all t.
    {
      t: 0.14,
      pose: { pos: camPos.clone(), look: camLook.clone(), fov: 50, roll: 0 }
    },
    {
      t: 0.24,
      pose: { pos: camPos.clone(), look: camLook.clone(), fov: 50, roll: 0 }
    },
    {
      t: 0.26,
      pose: { pos: camPos.clone(), look: camLook.clone(), fov: 50, roll: 0 }
    },
    {
      t: 0.28,
      pose: {
        pos: new THREE.Vector3(150, 10, 9),
        look: new THREE.Vector3(200, 4, -5),
        fov: 60,
        roll: 0
      },
      ease: easeInOutQuad
    }
  ]);

  // ---- Bike speed keys ----
  // Bike speed keys so the biker crosses the lower frame during the hold.
  // u progresses: bike covers the about street twice between t=0.10 and t=0.28.
  bike.addSpeedKeys([
    { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
    { t: 0.28, u: ROUTE_U.aboutEnd + 0.01 }
  ]);

  // ---- Displays (browser-only) ----
  if (typeof document === 'undefined') return;

  // Build cluster parent group
  // Parented to aboutWall anchor[1] (world: -80, 6, -11.5, rotY=π/2).
  // Anchor-local (0, 0, 50) → world (-80+50, 6, -11.5) = (-30, 6, -11.5).
  // Counter-rotation -π/2 makes the cluster world-aligned (net rotY=0).
  // Billboard groups placed as children of cluster with rotY=0:
  //   screen faces +Z in billboard-local = +Z in cluster-local = world +Z ✓ (toward camera at z=26).
  const clusterGroup = new THREE.Group();
  clusterGroup.name = 'aboutCluster';
  clusterGroup.position.set(0, 0, 50);      // anchor-local → world x=-30
  clusterGroup.rotation.y = -Math.PI / 2;   // net rotY = 0 (world-aligned)
  anchors.aboutWall[1].add(clusterGroup);

  // RNG seeded deterministically for the about segment (no Math.random).
  const rng = makeRng(1337 + 26);

  // ---- Build textures ----
  const bannerTex = drawBannerTexture();
  const paragraphTex = drawParagraphTexture();
  const faceTex = makePlaceholder(RESUME.about.faceImage);   // 800×1000 portrait slot
  const misc0Tex = makePlaceholder(RESUME.about.misc[0]);    // 800×600
  const misc1Tex = makePlaceholder(RESUME.about.misc[1]);    // 800×600

  // ---- Build 5 displays via buildBillboard ----
  // buildBillboard wall-mount: screen faces +Z in group-local space.
  // When placed as child of clusterGroup (world-aligned), screen faces world +Z ✓.
  //
  // Cluster layout (cluster-local coordinates, world-aligned):
  //   cluster origin = world (-30, 6, -11.5)
  //   cluster-local x = world x + 30
  //   cluster-local y = world y - 6
  //
  //   Display positions and world coverage (center → world x,y):
  //   (1) Banner (strip, 24×3):     cluster (0, +9)    → world (-30, 15)
  //   (2) Paragraph (landscape, 16×9): cluster (-10, +3) → world (-40, 9)
  //   (3) Face (portrait, 5×11.6):  cluster (+11, +4)  → world (-19, 10)
  //   (4) Misc0 (square, 6×6):      cluster (+18, +7)  → world (-12, 13)
  //   (5) Misc1 (square, 6×6):      cluster (-20, +7)  → world (-50, 13)
  //
  //   Total horizontal span: cluster x -23 to +21 = 44m ✓ (< 61m hFOV at 37m)

  const bb1 = buildBillboard(rng, { format: 'strip',     mount: 'wall', widthM: 24, texture: bannerTex });
  const bb2 = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 16, texture: paragraphTex });
  const bb3 = buildBillboard(rng, { format: 'portrait',  mount: 'wall', widthM: 5,  texture: faceTex });
  const bb4 = buildBillboard(rng, { format: 'square',    mount: 'wall', widthM: 6,  texture: misc0Tex });
  const bb5 = buildBillboard(rng, { format: 'square',    mount: 'wall', widthM: 6,  texture: misc1Tex });

  // Position each billboard group within the cluster.
  // The wall-mount 'placement' matrix translates the screen by ~0.6m in billboard-local +Z
  // (= world +Z here) — the screen is slightly proud of z=-11.5, facing toward camera ✓.
  bb1.group.position.set( 0,  +9, 0);
  bb2.group.position.set(-10, +3, 0);
  bb3.group.position.set(+11, +4, 0);
  bb4.group.position.set(+18, +7, 0);
  bb5.group.position.set(-20, +7, 0);

  // All initially invisible for staggered fade-in
  [bb1, bb2, bb3, bb4, bb5].forEach(bb => { bb.group.visible = false; });

  clusterGroup.add(bb1.group, bb2.group, bb3.group, bb4.group, bb5.group);

  // ---- Fade/scale-in (t 0.11–0.15, staggered) — pure f(t), scrub-safe ----
  // Each [tStart, tEnd] defines when a display fades in.
  const FADE: Array<[number, number]> = [
    [0.110, 0.125],   // bb1 banner
    [0.115, 0.130],   // bb2 paragraph
    [0.120, 0.135],   // bb3 face
    [0.125, 0.140],   // bb4 misc0
    [0.130, 0.145]    // bb5 misc1
  ];

  const billboards = [bb1, bb2, bb3, bb4, bb5];

  // Collect all opacity-able materials from each billboard's group tree.
  // buildBillboard uses MeshStandardMaterial for screen (emissive) and
  // MeshBasicMaterial (additive) for glow — we control visibility via group.visible
  // and scale for the pop-in. For a true fade we'd need to touch emissiveIntensity
  // (standard mat) and opacity (glow mat). Use group.visible + scale for the
  // stagger pop, and emissiveIntensity for the screen.
  interface FadeTarget {
    screenMat: THREE.MeshStandardMaterial | null;
    glowMat: THREE.MeshBasicMaterial | null;
    baseIntensity: number;
  }

  function extractFadeTargets(group: THREE.Group): FadeTarget {
    let screenMat: THREE.MeshStandardMaterial | null = null;
    let glowMat: THREE.MeshBasicMaterial | null = null;
    group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      if ((mat as THREE.MeshStandardMaterial).emissiveMap !== undefined && screenMat === null) {
        screenMat = mat as THREE.MeshStandardMaterial;
      } else if ((mat as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending && glowMat === null) {
        glowMat = mat as THREE.MeshBasicMaterial;
      }
    });
    const intensity = screenMat !== null ? (screenMat as THREE.MeshStandardMaterial).emissiveIntensity : 1.15;
    return { screenMat, glowMat, baseIntensity: intensity };
  }

  const fadeTargets = billboards.map(bb => extractFadeTargets(bb.group));

  // Start all invisible at scale 0.9
  billboards.forEach(bb => {
    bb.group.visible = false;
    bb.group.scale.setScalar(0.9);
  });

  // Sway state: per-display phase offsets for gentle 0.4° oscillation
  const SWAY_PHASES = [0, 0.8, 1.6, 2.4, 3.2];
  const SWAY_AMP = 0.4 * (Math.PI / 180); // 0.4° in radians

  // ---- Scroll-driven updatable: fade-in + sway (using wall-clock from Date.now) ----
  opts.updatables.push({
    update(t: number): void {
      const sec = Date.now() / 1000;

      for (let i = 0; i < billboards.length; i++) {
        const [tStart, tEnd] = FADE[i];
        const grp = billboards[i].group;
        const ft = fadeTargets[i];

        let alpha: number;
        if (t < tStart) {
          grp.visible = false;
          grp.scale.setScalar(0.9);
          continue;
        } else if (t >= tEnd) {
          grp.visible = true;
          grp.scale.setScalar(1.0);
          alpha = 1.0;
        } else {
          const p = easeInOutQuad((t - tStart) / (tEnd - tStart));
          grp.visible = true;
          grp.scale.setScalar(0.9 + 0.1 * p);
          alpha = p;
        }

        // Emissive intensity fade-in
        if (ft.screenMat) {
          ft.screenMat.emissiveIntensity = ft.baseIntensity * alpha;
        }
        if (ft.glowMat) {
          ft.glowMat.opacity = 0.12 * alpha;
        }

        // Gentle 0.4° ambient sway (wall-clock, not scroll-t)
        const swayAngle = SWAY_AMP * Math.sin(sec * 0.6 + SWAY_PHASES[i]);
        grp.rotation.y = swayAngle;

        // Drive buildBillboard's own ambient (flicker + scroll for strip)
        billboards[i].updateAmbient(sec);
      }
    }
  });
}
