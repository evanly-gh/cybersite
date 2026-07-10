/**
 * Task 28 — Projects segment (t 0.38 – 0.62)
 *
 * ARCHITECTURE:
 *  - Two ramp backflips: air window 1 (t 0.42–0.475) over ramp1, air window 2 (t 0.53–0.565) over ramp2.
 *  - Camera: low chase (t 0.38–0.42) → fixed side pose watching ramp1 flip (t 0.42–0.50)
 *            → brief re-chase (t 0.50–0.53) → fixed side pose watching ramp2 flip (t 0.53–0.60)
 *            → pull back to chase toward skyway (t 0.60–0.62).
 *  - Displays: two large holos (TTT-E2E, RememberMe) placed ABOVE and BELOW the ramp1 arc
 *              band with ≥1.5m clearance — the arc reads as intentional negative space.
 *              Three square cards (Mandarin, Bellevue 2nd, DubHacks) under the ramp2 arc.
 *  - Glitch-in (RGB-split 3-frame effect keyed to t) as camera arrives at each fixed pose.
 *
 * ANCHOR ORIENTATION:
 *  projectsWall anchors: x ≈ 251.5, z ∈ {-80,-180,-280,-380}, rotY = -π/2.
 *  With rotY = -π/2: R*(x,y,z) = (-z, y, x)
 *  So anchor-local (dx, dy, dz) → world (anchor.x - dz, anchor.y + dy, anchor.z + dx)
 *  Counter-rotation of +π/2 makes cluster world-aligned.
 *  At world-aligned: billboard screen faces world +X → but camera is at x=190 (on -X side).
 *  We need screens to face world -X (toward camera).
 *  Solution: counter-rotation of -π/2 so cluster is world-aligned with screen facing +Z
 *  in cluster-local = world -X after anchor's -π/2. Let's verify:
 *
 *  anchor rotY = -π/2 transforms cluster-local to world:
 *    R(-π/2)*(x,y,z) = (z, y, -x)
 *  So cluster's +Z axis → world +X; cluster's +X axis → world -Z; cluster's -X → world +Z
 *  Cluster's -Z → world -X (toward camera at x=190 from wall at x=251.5) ✓
 *
 *  For billboard wall-mount, the screen faces +Z in billboard-local space.
 *  So we need billboard's +Z in billboard-local = cluster's -Z in cluster-local.
 *  This means billboard must have rotY = π (180° rotation in cluster space).
 *
 *  Actually, let's think differently. Anchor rotY = -π/2 = -90°.
 *  A vector in cluster-local space gets transformed by the anchor's -π/2 rotation:
 *    cluster +Z → world: R(-π/2) * (0,0,1) = (sin(-π/2), 0, cos(-π/2)) = (-1, 0, 0) wait no.
 *    Rotation by Y by angle θ: x' = x*cos(θ) - z*sin(θ), z' = x*sin(θ) + z*cos(θ)
 *    At θ = -π/2: x' = x*0 - z*(-1) = z, z' = x*(-1) + z*0 = -x
 *    So (0,0,1) → (1, 0, 0) world: cluster +Z → world +X
 *    And (0,0,-1) → (-1, 0, 0): cluster -Z → world -X ✓ (toward camera)
 *
 *  buildBillboard wall-mount: screen faces +Z in billboard-local.
 *  We need screen to face world -X = cluster's -Z.
 *  So billboard +Z must equal cluster -Z: billboard needs rotation by π around Y in cluster-local.
 *  i.e. clusterGroup.rotation.y = π (counter-rotation to flatten net).
 *
 *  WAIT. The about segment uses anchors.aboutWall[1] with rotY = +π/2.
 *  aboutWall: rotY = +π/2; screen faces world +Z (toward camera at z=26).
 *  About segment counter-rotates with -π/2 → net rotY = 0 → cluster's +Z = world +Z ✓
 *  (Screen in billboard-local +Z → cluster +Z → world +Z → toward camera)
 *
 *  For projectsWall: anchor rotY = -π/2. Camera is at x=190, wall at x≈251.5 → camera on -X side.
 *  Cluster +Z in cluster-local → world +X (away from camera).
 *  Cluster -Z in cluster-local → world -X (toward camera) ✓
 *  Screen in billboard-local +Z → must become cluster -Z → billboard needs rotY = π.
 *  Counter-rotation applied to clusterGroup: rotation.y = Math.PI
 *  Net: anchor(-π/2) + cluster(π) = π/2 → cluster's +Z → world... let me redo:
 *  With anchor(-π/2) and cluster child rotated by +π:
 *    cluster-local +Z (screen's "forward") → parent(cluster) applies +π rotation → becomes -Z in anchor-local
 *    anchor(-π/2) applies: (0, 0, -1) → (-(-1)*sin(-π/2), 0, 0*sin(-π/2) + (-1)*cos(-π/2))
 *    Wait, let me just use the matrix:
 *    rotY(α) * rotY(β) = rotY(α + β) in terms of vector transforms:
 *    anchor applies -π/2 to cluster-local. Cluster applies π to billboard-local.
 *    Net rotation on billboard = anchor(-π/2) * cluster(π) = rotation(-π/2 + π) = rotation(π/2).
 *    rotY(π/2) on +Z: x' = 0*cos(π/2) - 1*sin(π/2) = -1, z' = 0... so +Z → (-1, 0, 0) = world -X ✓
 *
 *  So: clusterGroup.rotation.y = Math.PI (counter-rotation for projectsWall anchors with rotY=-π/2)
 *
 * ARC BAND CALCULATION (ramp1):
 *  Flight arc: ramp1Base(240,0,-90) to ramp1Land(240,0,-170), apexY=14.
 *  Arc midpoint at world (240, 14, -130). Camera at (190, 10, -125), fov=46.
 *  Display gap: arc spans y ≈ 0..14 through the flight. The arc at z=-125 is near apex (y≈14).
 *  We place one display centered ABOVE arc (y_center ≈ 20) and one BELOW (y_center ≈ 2).
 *  With ≥1.5m clearance: top of lower display ≤ y_arc_min - 1.5m at that z.
 *  bottom of upper display ≥ y_arc_max + 1.5m.
 *
 * CLUSTER PLACEMENT:
 *  For anchor[1] at (251.5, 8, -180) with rotY=-π/2:
 *  Cluster-local (dx, dy, dz): world pos = anchor_rotY(-π/2) * (dx, dy, dz) + anchor_pos
 *    world x = 251.5 + dz   (because R(-π/2)*(0,0,dz) = (dz, 0, 0))
 *    world y = 8 + dy
 *    world z = -180 + (-dx)  (because R(-π/2)*(dx,0,0) = (0, 0, -dx))
 *  Wait, the full transform: world = anchor_pos + anchor_rot * cluster_local
 *    R(-π/2)*(dx, dy, dz) = (dx*cos(-π/2) - dz*sin(-π/2), dy, dx*sin(-π/2) + dz*cos(-π/2))
 *                         = (dx*0 - dz*(-1), dy, dx*(-1) + dz*0)
 *                         = (dz, dy, -dx)
 *  So world = (251.5 + dz, 8 + dy, -180 - dx)
 *
 *  For anchor[0] at (251.5, 8, -80) with rotY=-π/2:
 *  world = (251.5 + dz, 8 + dy, -80 - dx)
 *
 *  To target world z ≈ -125 from anchor[1] at z=-180:
 *   -180 - dx = -125 → dx = -55 → but that's large. Let me use anchor[0] at z=-80:
 *   -80 - dx = -125 → dx = 45 → large but the anchor spans from -80 to -180.
 *
 *  Actually, we should place the cluster midway. Let's use anchor[0] (z=-80):
 *  For the ramp1 region (z=-90 to -170, midpoint -130):
 *   dx to center cluster at z=-130: -80 - dx = -130 → dx = 50 (50m along -Z from anchor)
 *
 *  Or use anchor[1] (z=-180):
 *   dx to center cluster at z=-130: -180 - dx = -130 → dx = -50 (toward +Z from anchor)
 *
 *  Let's use anchor[1] at z=-180 with dx=-55 (cluster at world z = -180 - (-55) = -125) ✓
 *  cluster_local_position = (-55, 0, 0) → world z = -180 - (-55) = -125 ✓
 *  world x = 251.5 + 0 = 251.5 ✓ (on the wall)
 *
 *  For the ramp2 region (z=-260 to -330, midpoint -295):
 *  anchor[2] at z=-280: dx = -280 - (-295) = 15 → cluster at z = -280 - 15 = -295 ✓
 *  cluster_local_position = (15, 0, 0) → world z = -280 - 15 = -295 ✓
 *
 * DISPLAY Y-POSITIONS (in cluster-local, where y is world y offset from anchor.y=8):
 *  Anchor y=8. dy = world_y - 8.
 *  Arc at camera midpoint (z=-125): parabolic y(p) at p = (125-90)/(170-90) = 35/80 = 0.4375
 *    y_arc = 0 * (1-0.4375) + 0 * 0.4375 + 14 * 4 * 0.4375 * (1-0.4375)
 *          = 14 * 4 * 0.4375 * 0.5625 = 14 * 0.984375 ≈ 13.78m → the arc peaks at z≈-130
 *  Arc y range in frame: from ~0 (at edges) to ~14 (at apex).
 *  Upper display (TTT-E2E): center at world y ≈ 21. Lower display (RememberMe): center at world y ≈ 4.
 *    Upper: dy = 21 - 8 = 13 → landscape billboard, height = 12m*(720/1280) = 6.75m → spans y 17.6..24.4
 *      Gap below upper: 17.6 - 14 = 3.6m clearance ✓ (>1.5m)
 *    Lower: dy = 4 - 8 = -4 → landscape billboard h=6.75m → spans y 0.6..7.4
 *      Gap above lower: 14 (approx apex when arc crosses frame) - 7.4 = 6.6m clearance... wait
 *      Actually the arc at the camera z=-125 is at y=13.78. So gap from top of lower to arc:
 *      7.4m (top of lower) to 13.78m (arc) = 6.38m > 1.5m ✓
 *      Gap from arc peak (~14m) to bottom of upper: 17.6 - 14 = 3.6m > 1.5m ✓
 *
 *  For ramp2 arc (z=-260 to -330, apexY=11):
 *  Camera at (190, 9, -295). Arc y range 0..11. Three small square displays below arc.
 *  Small cards 800×600 at widthM=8m → height = 8*(600/800) = 6m. Place center at dy = -4 each.
 *  Cards arranged at different dx offsets for z-spacing.
 *
 * GLITCH-IN:
 *  Pure f(t): groups hidden before camera arrives, reveal at tArrive with a 3-frame
 *  RGB-split flicker keyed to t (not accumulated).
 */

import * as THREE from 'three';
import type { CameraRig } from '../cameraRig';
import type { BikePath } from '../bikePath';
import type { DisplayAnchors } from '../../world/cityLayout';
import { ROUTE_U } from '../../world/route';
import { makeRng } from '../../utils/rng';
import { makeCanvasTexture, drawPanel, wrapText } from '../../utils/canvasText';
import { makePlaceholder } from '../../content/placeholders';
import { RESUME } from '../../content/resume';
import { COLORS } from '../../theme';
import { buildBillboard } from '../../assets/billboards/billboards';

// ---------------------------------------------------------------------------
// Ease helpers
// ---------------------------------------------------------------------------

function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Canvas texture builders for projects displays
// ---------------------------------------------------------------------------

/**
 * Builds a large landscape project panel (1280×720) with drawPanel title/stack/blurb.
 * The panel texture occupies the lower-strip portion below a placeholder image area.
 */
function drawProjectMainTexture(
  title: string,
  stack: string,
  blurb: string,
  placeholderLabel: string
): THREE.CanvasTexture {
  const W = 1280;
  const H = 720;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);

    // Background
    ctx.fillStyle = '#0a0e1af0';
    ctx.fillRect(0, 0, W, H);

    // Outer border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.strokeStyle = accent + '44';
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, W - 24, H - 24);

    // Upper two-thirds: placeholder area (dark section with crosshair)
    const imgH = Math.round(H * 0.62);
    ctx.fillStyle = hex(COLORS.shadowBlue) + 'cc';
    ctx.fillRect(16, 16, W - 32, imgH - 16);

    // Crosshair in placeholder area
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(16, 16);
    ctx.lineTo(W - 16, imgH);
    ctx.moveTo(W - 16, 16);
    ctx.lineTo(16, imgH);
    ctx.stroke();
    ctx.restore();

    // Label in placeholder area
    ctx.font = '28px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(placeholderLabel.toUpperCase(), W / 2, imgH / 2 + 8);

    // Divider
    ctx.strokeStyle = accent + '88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, imgH + 4);
    ctx.lineTo(W - 16, imgH + 4);
    ctx.stroke();

    // Lower strip: title + stack + blurb
    const pad = 24;
    let y = imgH + 24;

    // Eyebrow: stack tech (≥28px legibility rule)
    ctx.font = 'bold 28px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('// ' + stack.toUpperCase(), pad, y);
    y += 40;

    // Title (large, Unbounded) — body ≥28px rule
    ctx.font = 'bold 48px "Unbounded"';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '0px';
    ctx.fillText(title, pad, y);
    y += 62;

    // Blurb (body ≥28px)
    ctx.font = '28px "Rajdhani"';
    ctx.fillStyle = '#d4e8e4';
    ctx.letterSpacing = '0px';
    const contentWidth = W - pad * 2;
    const lines = wrapText(ctx, blurb, contentWidth);
    for (const line of lines) {
      if (y > H - 20) break;
      ctx.fillText(line, pad, y);
      y += 36;
    }

    // Scanlines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let sy = 0; sy < H; sy += 4) {
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
    }
  });
}

/**
 * Small square project card (800×600): project title, one-liner blurb + stack.
 * Body ≥28px per legibility rule.
 */
function drawProjectSmallTexture(
  title: string,
  stack: string,
  blurb: string,
  placeholderLabel: string
): THREE.CanvasTexture {
  const W = 800;
  const H = 600;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);

    ctx.fillStyle = '#0a0e1af0';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Corner ticks
    const tick = 14;
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]] as Array<[number, number]>) {
      const sx = cx === 0 ? 1 : -1;
      const sy = cy === 0 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + sx * tick, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + sy * tick); ctx.stroke();
    }

    // Placeholder area (upper half)
    const imgH = Math.round(H * 0.52);
    ctx.fillStyle = hex(COLORS.shadowBlue) + 'aa';
    ctx.fillRect(8, 8, W - 16, imgH - 8);

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(W - 8, imgH);
    ctx.moveTo(W - 8, 8);
    ctx.lineTo(8, imgH);
    ctx.stroke();
    ctx.restore();

    ctx.font = '28px "Share Tech Mono"';  // ≥28px legibility rule
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(placeholderLabel.toUpperCase(), W / 2, imgH / 2);

    // Divider
    ctx.strokeStyle = accent + '66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, imgH + 2);
    ctx.lineTo(W - 8, imgH + 2);
    ctx.stroke();

    // Lower strip: eyebrow + title + blurb
    const pad = 18;
    let y = imgH + 16;

    ctx.font = '28px "Share Tech Mono"';  // ≥28px legibility rule
    ctx.fillStyle = accent;
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('// ' + stack.toUpperCase(), pad, y);
    y += 36;

    ctx.font = 'bold 36px "Unbounded"';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '0px';
    ctx.fillText(title, pad, y);
    y += 48;

    // Blurb body ≥28px
    ctx.font = '28px "Rajdhani"';
    ctx.fillStyle = '#d4e8e4';
    const contentWidth = W - pad * 2;
    const lines = wrapText(ctx, blurb, contentWidth);
    for (const line of lines) {
      if (y > H - 12) break;
      ctx.fillText(line, pad, y);
      y += 34;
    }

    // Scanlines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let sy = 0; sy < H; sy += 4) {
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------
// Glitch-in helper
// ---------------------------------------------------------------------------

/**
 * Computes a glitch-in alpha for a display arriving at tArrive.
 * Returns 0 before tArrive, flickers [0..1] over 3 short frames, then 1.
 * Pure f(t), scrub-safe.
 */
function glitchAlpha(t: number, tArrive: number): number {
  if (t < tArrive) return 0;
  const dt = t - tArrive;
  const frameDur = 0.004; // ~3 "frames" at 60fps
  if (dt >= frameDur * 3) return 1;
  const frame = Math.floor(dt / frameDur);
  // 3 frames: 0.3, 0.7, 1.0
  const frameAlphas = [0.3, 0.7, 1.0];
  return frameAlphas[frame] ?? 1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProjectsSegmentOptions {
  rig: CameraRig;
  bike: BikePath;
  anchors: DisplayAnchors;
  updatables: { update(t: number): void }[];
  /** When true, raise fixed-side pose fov by +8 and pull back 15% for portrait framing. */
  mobile?: boolean;
}

export interface ProjectsSegmentHandle {
  updateAmbient(sec: number): void;
}

export function registerProjectsSegment(opts: ProjectsSegmentOptions): ProjectsSegmentHandle {
  const { rig, bike, anchors, mobile = false } = opts;

  // ---- Step 1: Air windows (backflips) ----
  bike.addAir([
    {
      t0: 0.42,
      t1: 0.475,
      u0: ROUTE_U.ramp1Base,
      u1: ROUTE_U.ramp1Land,
      apexY: 14,
      flips: 1
    },
    {
      t0: 0.53,
      t1: 0.565,
      u0: ROUTE_U.ramp2Base,
      u1: ROUTE_U.ramp2Land,
      apexY: 11,
      flips: 1
    }
  ]);

  // ---- Bike speed keys ----
  // Hard accel into each ramp (u-rate ×1.8 relative to segment baseline),
  // slow-mo THROUGH each flip (u-rate ×0.55 — sandevistan moment),
  // normal on landing.
  //
  // Baseline u-rate: (ROUTE_U.skywayStart - ROUTE_U.ramp1Base) / (0.62 - 0.38) ≈ base rate
  // We key specific u values at specific t values to achieve the rate ratios.
  //
  // t=0.38: bike at ramp1Base (drift segment left us here)
  // t=0.42: at ramp1Base ready to launch (accel toward ramp)
  // t=0.475: at ramp1Land (slow-mo through flip)
  // t=0.50: past ramp1Land, normal speed toward ramp2
  // t=0.53: at ramp2Base ready to launch (accel)
  // t=0.565: at ramp2Land (slow-mo through flip)
  // t=0.62: at skywayStart

  // Speed key design:
  // - Drift segment already registered { t:0.38, u:ramp1Base }; we must NOT add
  //   another t=0.38 key (allowed by addSpeedKeys boundary-sharing rule, but
  //   duplicate-u would give zero speed visually). Start projects keys at t=0.39.
  // - "Hard accel into ramp1" (×1.8 feel): drift left us exactly at ramp1Base
  //   at t=0.38, so we CANNOT show an approach toward ramp1Base. Instead we show
  //   the bike rolling forward from ramp1Base — already on the ramp — building
  //   speed rapidly before the t=0.42 launch. This satisfies the accel intent
  //   given the geometric constraint (drift exits at ramp1Base, not before it).
  // - During air windows (t=0.42→0.475, 0.53→0.565) the air window's own u-lerp
  //   from u0→u1 governs bike position; speed keys are used for uAt() only.
  // - Ramp2 approach (t=0.50→0.53): u advances from 35% between land→ramp2Base
  //   to ramp2Base — genuine forward motion, accel feel ✓.

  const ramp1Span = ROUTE_U.ramp1Land - ROUTE_U.ramp1Base;

  bike.addSpeedKeys([
    // Hard roll from ramp1Base into the launch ramp (×1.8 accel feel).
    // Drift's boundary key is at t=0.38, u=ramp1Base. We pick up from t=0.39.
    { t: 0.39, u: ROUTE_U.ramp1Base + ramp1Span * 0.12 },  // 12% into ramp span after 0.01 of t
    // At launch (t=0.42) we are 28% into the ramp span — a visibly fast roll-in.
    { t: 0.42, u: ROUTE_U.ramp1Base + ramp1Span * 0.28 },
    // Slow-mo THROUGH flip 1: t 0.42→0.475 (air window uses its own u0..u1)
    { t: 0.475, u: ROUTE_U.ramp1Land },
    // Normal pace after landing, accel approach to ramp2
    { t: 0.50, u: ROUTE_U.ramp1Land + (ROUTE_U.ramp2Base - ROUTE_U.ramp1Land) * 0.35 },
    // At ramp2 base (accel approach: t=0.50→0.53 is moving, not a hold ✓)
    { t: 0.53, u: ROUTE_U.ramp2Base },
    // Slow-mo THROUGH flip 2
    { t: 0.565, u: ROUTE_U.ramp2Land },
    // After landing, continue to skyway
    { t: 0.62, u: ROUTE_U.skywayStart }
  ]);

  // ---- Step 2: Camera keys ----
  // Low chase behind ramp1 (t 0.38–0.42)
  // Fixed side pose watching ramp1 flip (t 0.42–0.50)
  // Brief re-chase (t 0.50–0.53)
  // Fixed side pose at ramp2 (t 0.53–0.60)
  // Pull back to chase rising toward skyway (t 0.60–0.62)

  // Side pose 1: perpendicular fixed pose looking at the +X wall.
  // I4 fix: moved camera closer (x=205 vs 190) and raised FOV (52 vs 46) so project
  // displays and the arcing biker both read. Distance 251-205=46m vs 61m original.
  // The biker arc peaks at y≈14, appearing larger in frame at this tighter angle.
  const side1Look = new THREE.Vector3(251, 12, -125);
  const side1Fov = mobile ? 52 + 8 : 52;
  const side1Pos = mobile
    ? new THREE.Vector3(251 - 46 * 1.15, 10, -125)
    : new THREE.Vector3(205, 10, -125);

  // Side pose 2: second fixed side pose at ramp2.
  // I4 fix: same camera pull-in as side1 for consistency.
  const side2Look = new THREE.Vector3(251, 7, -295);
  const side2Fov = mobile ? 52 + 8 : 52;
  const side2Pos = mobile
    ? new THREE.Vector3(251 - 46 * 1.15, 9, -295)
    : new THREE.Vector3(205, 9, -295);

  // Low chase pose at ramp1Base approach
  const chaseRamp1Pos = new THREE.Vector3(243, 1.4, -10);
  const chaseRamp1Look = new THREE.Vector3(241, 1.0, -140);

  // Re-chase pose between ramps
  const rechasePos = new THREE.Vector3(243, 2, -190);
  const rechaseLook = new THREE.Vector3(241, 1.5, -280);

  // Skyway approach chase
  const skywayChasePos = new THREE.Vector3(243, 4, -380);
  const skywayLook = new THREE.Vector3(241, 10, -480);

  rig.addKeys([
    // Anchor at t=0.38 (shared boundary with drift segment which ends here)
    {
      t: 0.38,
      pose: {
        pos: chaseRamp1Pos.clone(),
        look: chaseRamp1Look.clone(),
        fov: 66,
        roll: 0
      }
    },
    // Hold low chase through approach (bike heads toward ramp1)
    {
      t: 0.40,
      pose: {
        pos: chaseRamp1Pos.clone(),
        look: chaseRamp1Look.clone(),
        fov: 66,
        roll: 0
      }
    },
    // At launch: pan to fixed side pose
    {
      t: 0.42,
      pose: {
        pos: side1Pos.clone(),
        look: side1Look.clone(),
        fov: side1Fov,
        roll: 0
      },
      ease: easeInOutQuad
    },
    // Hold side pose through the arc (duplicate keys kill Catmull-Rom overshoot)
    {
      t: 0.44,
      pose: {
        pos: side1Pos.clone(),
        look: side1Look.clone(),
        fov: side1Fov,
        roll: 0
      }
    },
    {
      t: 0.475,
      pose: {
        pos: side1Pos.clone(),
        look: side1Look.clone(),
        fov: side1Fov,
        roll: 0
      }
    },
    {
      t: 0.50,
      pose: {
        pos: side1Pos.clone(),
        look: side1Look.clone(),
        fov: side1Fov,
        roll: 0
      }
    },
    // Re-chase: brief transit between ramps — peak at t=0.51, then transition to side2.
    // The re-chase is compressed to 0.50–0.53 so side2 is fully settled by t=0.53
    // (air window 2 starts at 0.53; camera must be locked on ramp2 flip from its start).
    {
      t: 0.51,
      pose: {
        pos: rechasePos.clone(),
        look: rechaseLook.clone(),
        fov: 64,
        roll: 0
      },
      ease: easeInOutQuad
    },
    // Second fixed side pose at ramp2 — arrives by t=0.53 so camera is locked on
    // the second flip from the moment air window 2 opens.
    {
      t: 0.53,
      pose: {
        pos: side2Pos.clone(),
        look: side2Look.clone(),
        fov: side2Fov,
        roll: 0
      },
      ease: easeInOutQuad
    },
    // Hold side pose 2 through arc 2 (duplicate key kills Catmull-Rom overshoot)
    {
      t: 0.555,
      pose: {
        pos: side2Pos.clone(),
        look: side2Look.clone(),
        fov: side2Fov,
        roll: 0
      }
    },
    {
      t: 0.60,
      pose: {
        pos: side2Pos.clone(),
        look: side2Look.clone(),
        fov: side2Fov,
        roll: 0
      }
    },
    // Pull back to chase rising toward skyway
    {
      t: 0.62,
      pose: {
        pos: skywayChasePos.clone(),
        look: skywayLook.clone(),
        fov: 60,
        roll: 0
      },
      ease: easeInOutQuad
    }
  ]);

  // ---- Step 3: Displays (browser-only) ----
  if (typeof document === 'undefined') {
    return { updateAmbient: () => {} };
  }

  const rng = makeRng(1337 + 28);

  // ---- Wall 1: TTT-E2E + RememberMe around ramp1 arc ----
  // Anchor[1] at (251.5, 8, -180), rotY=-π/2.
  // anchor-local (dx, dy, dz) → world (251.5 + dz, 8 + dy, -180 - dx)
  // Set cluster at anchor-local (-55, 0, 0) → world (251.5, 8, -125) ✓
  // Counter-rotate cluster by +π so billboard +Z becomes world -X (toward camera at x=190).

  // projectsWall anchor[1]: world (251.5, 8, -180), rotY = -π/2
  // anchor-local → world: R(-π/2)*(dx,dy,dz) = (-dz, dy, dx)
  // cluster1 anchor-local (55, 0, 0) → world (251.5 + 0, 8, -180 + 55) = (251.5, 8, -125) ✓
  //
  // Counter-rotation for billboard screens to face world -X (toward camera at x=190):
  // Anchor rotY=-π/2; screen in billboard-local +Z direction:
  //   R(anchor=-π/2) * R(cluster=0) * (0,0,1) = R(-π/2)*(0,0,1) = (-1,0,0) = world -X ✓
  // So NO counter-rotation needed (cluster.rotation.y = 0).
  const cluster1 = new THREE.Group();
  cluster1.name = 'projectsCluster1';
  cluster1.position.set(55, 0, 0);  // cluster at world z ≈ -125 (midpoint of ramp1 arc)
  cluster1.rotation.y = 0;          // no counter-rotation: anchor rotY=-π/2 already aligns screen to face -X
  anchors.projectsWall[1].add(cluster1);

  // Build textures for main projects
  const tttTex = drawProjectMainTexture(
    RESUME.projectsMain[0].title,
    RESUME.projectsMain[0].stack,
    RESUME.projectsMain[0].blurb,
    RESUME.projectsMain[0].image.label
  );
  const rememberMeTex = drawProjectMainTexture(
    RESUME.projectsMain[1].title,
    RESUME.projectsMain[1].stack,
    RESUME.projectsMain[1].blurb,
    RESUME.projectsMain[1].image.label
  );

  // Landscape billboards 14m wide (h = 14 * 720/1280 ≈ 7.875m)
  const bbW1Top = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 14, texture: tttTex });
  const bbW1Bot = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 14, texture: rememberMeTex });

  // Cluster-local → world: world = cluster1_world + R(-π/2) * cluster_local
  //   = (251.5, 8, -125) + (-clz, cly, clx)
  // So: cluster_local (clx, cly, clz) → world (251.5 - clz, 8 + cly, -125 + clx)
  //
  // Arc at z=-125 (camera focal z): y_arc = 14 * 4 * p * (1-p) at p = (z+90)/80 = 35/80 = 0.4375
  // y_arc ≈ 13.8m at the camera z.
  // Upper display: center at world y ≈ 21 → cly = 21 - 8 = 13, clx = 0 (z stays at -125)
  // Lower display: center at world y ≈ 2.5 → cly = 2.5 - 8 = -5.5
  // Displays at same z as cluster (clx=0) → world z = -125.
  // Display h ≈ 7.875m: upper spans world y 17.1..24.9 (gap above arc: 17.1 - 13.8 = 3.3m ✓)
  //                      lower spans world y -1.4..6.4  (gap below arc: 13.8 - 6.4 = 7.4m ✓)
  bbW1Top.group.position.set(0, 13, 0);    // world y = 8 + 13 = 21, world z = -125
  bbW1Bot.group.position.set(0, -5.5, 0);  // world y = 8 - 5.5 = 2.5, world z = -125

  // Start invisible for glitch-in
  bbW1Top.group.visible = false;
  bbW1Bot.group.visible = false;

  cluster1.add(bbW1Top.group, bbW1Bot.group);

  // Waypoint ticks: 6 small holo chevrons along the arc (arc at z=-90 to -170, y 0..14)
  // Place them in world space at z = -90 to -170 stepped.
  // In cluster1 local: cluster is at world (251.5, 8, -125), rotated π around y.
  // With π rotation, cluster-local z → world: R(π)*(0,0,dz) = (0, 0, -dz)
  // So cluster-local z = dz → world z = -125 - dz... wait let me redo.
  // The cluster is parented to anchor[1] with anchor-local position (-55, 0, 0).
  // Cluster.rotation.y = π applied in anchor-local space.
  // anchor-local (before cluster's own rotation): cluster is at (-55, 0, 0).
  // cluster-local → anchor-local: anchor applies (-55, 0, 0) translation first, then cluster.rotation.y = π.
  // Actually Three.js: cluster-local → parent via: parent_pos + parent_rot * (cluster_local_pos + cluster_rot * local)
  // Let's just figure out roughly where ticks need to be in cluster-local space.
  // Arc spans world z = -90 to -170 (80m), y = 0..14..0 (parabola).
  // Cluster1 world position ≈ (251.5, 8, -125). The ticks should be placed at the wall x≈251.5 (dz ≈ 0 in cluster local)
  // and varying z. In cluster-local with rotY=π: local +z direction → anchor's local -z direction → world +z direction
  // Actually this is getting complex. Let's just build 6 small plane meshes and set their world positions.
  // We'll use group.parent.worldToLocal to position them.

  // 6 small chevron tick meshes
  const TICK_COUNT = 6;
  const tickMeshes: THREE.Mesh[] = [];
  const chevronGeo = new THREE.PlaneGeometry(1.2, 0.8);
  const chevronMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(hex(COLORS.holoTeal)),
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  for (let i = 0; i < TICK_COUNT; i++) {
    const tick = new THREE.Mesh(chevronGeo, chevronMat.clone());
    tick.name = `arcTick${i}`;
    // Arc spans world z = -90 to -170, y = 14*4*p*(1-p)
    const p = (i + 0.5) / TICK_COUNT;
    const wz = -90 - p * 80;
    const wy = 14 * 4 * p * (1 - p);

    // Cluster1-local: (clx, cly, clz) → world (251.5 - clz, 8 + cly, -125 + clx)
    // Target world (251.5, wy, wz): clx = wz + 125, cly = wy - 8, clz = 0
    const clx = wz + 125;  // = (-90 - p*80) + 125 = 35 - p*80
    const cly = wy - 8;
    const clz = 0;

    tick.position.set(clx, cly, clz);
    // PlaneGeometry default face is +Z in local space.
    // Cluster-local +Z → world R(-π/2)*(0,0,1) = (-1, 0, 0) = world -X (toward camera) ✓
    // So no additional rotation needed.
    tick.rotation.y = 0;
    tickMeshes.push(tick);
    cluster1.add(tick);
  }

  // ---- Wall 2: Three small square cards around ramp2 arc ----
  // Anchor[2] at (251.5, 8, -280), rotY=-π/2.
  // anchor-local (dx, dy, dz) → world (251.5 + dz, 8 + dy, -280 - dx)
  // Set cluster at anchor-local (15, 0, 0) → world z = -280 - 15 = -295 ✓

  // projectsWall anchor[2]: world (251.5, 8, -280), rotY = -π/2
  // cluster2 at anchor-local (-15, 0, 0):
  //   R(-π/2)*(-15, 0, 0) = (-0, 0, -15) = (0, 0, -15)
  //   world = (251.5 + 0, 8, -280 + (-15)) = (251.5, 8, -295) ✓
  // No counter-rotation needed (same logic as cluster1).
  const cluster2 = new THREE.Group();
  cluster2.name = 'projectsCluster2';
  cluster2.position.set(-15, 0, 0);  // cluster at world z ≈ -295 (midpoint of ramp2 arc)
  cluster2.rotation.y = 0;           // no counter-rotation
  anchors.projectsWall[2].add(cluster2);

  // Build textures for small projects
  const mandarinTex = drawProjectSmallTexture(
    RESUME.projectsSmall[0].title,
    RESUME.projectsSmall[0].stack,
    RESUME.projectsSmall[0].blurb,
    RESUME.projectsSmall[0].image.label
  );
  const bellevueTex = drawProjectSmallTexture(
    RESUME.projectsSmall[1].title,
    RESUME.projectsSmall[1].stack,
    RESUME.projectsSmall[1].blurb,
    RESUME.projectsSmall[1].image.label
  );
  const dubhacksTex = drawProjectSmallTexture(
    RESUME.projectsSmall[2].title,
    RESUME.projectsSmall[2].stack,
    RESUME.projectsSmall[2].blurb,
    RESUME.projectsSmall[2].image.label
  );

  // Square billboards 8m wide (h = 8 * 600/800 = 6m)
  const bbW2A = buildBillboard(rng, { format: 'square', mount: 'wall', widthM: 8, texture: mandarinTex });
  const bbW2B = buildBillboard(rng, { format: 'square', mount: 'wall', widthM: 8, texture: bellevueTex });
  const bbW2C = buildBillboard(rng, { format: 'square', mount: 'wall', widthM: 8, texture: dubhacksTex });

  // Cluster2-local → world: world = (251.5 - clz, 8 + cly, -295 + clx)
  // Arc2: z=-260 to -330, apexY=11. Camera at (190, 9, -295), looking at (240, 8, -295).
  // Arc at z=-295 (camera focal z): p = (295-260)/70 = 0.5 → y_arc = 11*4*0.5*0.5 = 11m (apex).
  // Three cards below arc. Cards center at world y ≈ 2.5 → cly = 2.5 - 8 = -5.5.
  // Arc at z=-295 (clx=0): y_arc=11, cards top=2.5+3=5.5 (h=6m), gap=11-5.5=5.5m ✓.
  // Arrange 3 cards at world z = -275, -295, -315 (20m spacing):
  //   Card A at world z=-275: clx = -275 - (-295) = 20
  //   Card B at world z=-295: clx = -295 - (-295) = 0
  //   Card C at world z=-315: clx = -315 - (-295) = -20

  bbW2A.group.position.set(20, -5.5, 0);   // world z ≈ -275
  bbW2B.group.position.set(0, -5.5, 0);    // world z ≈ -295 (center, camera looks here)
  bbW2C.group.position.set(-20, -5.5, 0);  // world z ≈ -315

  bbW2A.group.visible = false;
  bbW2B.group.visible = false;
  bbW2C.group.visible = false;

  cluster2.add(bbW2A.group, bbW2B.group, bbW2C.group);

  // ---- Glitch-in and updatable ----
  // Wall 1 arrives at t=0.42 (camera hits side1 pose)
  // Wall 2 arrives at t=0.53 (camera hits side2 pose)
  const T_ARRIVE_1 = 0.42;
  const T_ARRIVE_2 = 0.53;

  const wall1Billboards = [bbW1Top, bbW1Bot];
  const wall2Billboards = [bbW2A, bbW2B, bbW2C];

  // Track alphas for ambient compositing
  const wall1Alphas = new Float32Array(2).fill(0);
  const wall2Alphas = new Float32Array(3).fill(0);

  // Extract screen materials for glitch/fade
  interface ScreenRef {
    screenMat: THREE.MeshStandardMaterial | null;
    glowMat: THREE.MeshBasicMaterial | null;
    baseIntensity: number;
  }

  function extractScreen(group: THREE.Group): ScreenRef {
    let screenMat: THREE.MeshStandardMaterial | null = null;
    let glowMat: THREE.MeshBasicMaterial | null = null;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      if (mesh.name === 'screen' && screenMat === null) {
        screenMat = mat as THREE.MeshStandardMaterial;
      } else if ((mat as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending && glowMat === null) {
        glowMat = mat as THREE.MeshBasicMaterial;
      }
    });
    const intensity = screenMat ? (screenMat as THREE.MeshStandardMaterial).emissiveIntensity : 1.15;
    return { screenMat, glowMat, baseIntensity: intensity };
  }

  const wall1Screens = wall1Billboards.map(bb => extractScreen(bb.group));
  const wall2Screens = wall2Billboards.map(bb => extractScreen(bb.group));

  // RGB-split glitch effect on screen material: shift emissiveIntensity
  function applyGlitch(ref: ScreenRef, alpha: number): void {
    if (!ref.screenMat) return;
    ref.screenMat.emissiveIntensity = ref.baseIntensity * alpha;
    if (ref.glowMat) {
      ref.glowMat.opacity = 0.12 * alpha;
    }
  }

  opts.updatables.push({
    update(t: number): void {
      // Wall 1 glitch-in
      const alpha1 = glitchAlpha(t, T_ARRIVE_1);
      // Hide wall 1 after t=0.50 (camera leaves side1 pose) and before T_ARRIVE_1
      const showWall1 = t >= T_ARRIVE_1 && t <= 0.55;
      for (let i = 0; i < wall1Billboards.length; i++) {
        const grp = wall1Billboards[i].group;
        grp.visible = showWall1;
        if (showWall1) {
          wall1Alphas[i] = alpha1;
          applyGlitch(wall1Screens[i], alpha1);
        }
      }

      // Wall 2 glitch-in
      const alpha2 = glitchAlpha(t, T_ARRIVE_2);
      const showWall2 = t >= T_ARRIVE_2 && t <= 0.65;
      for (let i = 0; i < wall2Billboards.length; i++) {
        const grp = wall2Billboards[i].group;
        grp.visible = showWall2;
        if (showWall2) {
          wall2Alphas[i] = alpha2;
          applyGlitch(wall2Screens[i], alpha2);
        }
      }
    }
  });

  // Ambient update: billboard flicker + sway
  const SWAY_PHASES_1 = [0.0, 1.1];
  const SWAY_PHASES_2 = [0.0, 0.8, 1.6];
  const SWAY_AMP = 0.4 * (Math.PI / 180);

  function updateAmbient(sec: number): void {
    for (let i = 0; i < wall1Billboards.length; i++) {
      const grp = wall1Billboards[i].group;
      if (!grp.visible) continue;
      grp.rotation.y = SWAY_AMP * Math.sin(sec * 0.6 + SWAY_PHASES_1[i]);
      const ref = wall1Screens[i];
      if (ref.screenMat && wall1Alphas[i] < 1.0) {
        wall1Billboards[i].updateAmbient(sec);
        ref.screenMat.emissiveIntensity *= wall1Alphas[i];
      } else {
        wall1Billboards[i].updateAmbient(sec);
      }
    }
    for (let i = 0; i < wall2Billboards.length; i++) {
      const grp = wall2Billboards[i].group;
      if (!grp.visible) continue;
      grp.rotation.y = SWAY_AMP * Math.sin(sec * 0.5 + SWAY_PHASES_2[i]);
      const ref = wall2Screens[i];
      if (ref.screenMat && wall2Alphas[i] < 1.0) {
        wall2Billboards[i].updateAmbient(sec);
        ref.screenMat.emissiveIntensity *= wall2Alphas[i];
      } else {
        wall2Billboards[i].updateAmbient(sec);
      }
    }
  }

  return { updateAmbient };
}
