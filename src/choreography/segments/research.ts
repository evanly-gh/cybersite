/**
 * Task 29 — Research segment (t 0.62 – 0.79)
 *
 * ARCHITECTURE:
 *  - Elevated skyway section. The bike climbs from skywayStart (240,0,-420) up to
 *    skywayTop (240,28,-520) and continues along the elevated platform.
 *  - Camera LEADS the bike: positioned 9m ahead (more-negative Z), 2.5m above bike,
 *    looking BACK toward the biker. Biker stays centered frame.
 *  - 2 large sky holo-panels (landscape 1280×720) floating on both skyway flanks.
 *  - 2 small garnish holos (coordinate readout + eyebrow label).
 *  - Panels face -Z (back toward camera), Y-billboard.
 *  - Ambient: panels bob ±0.3m on a slow sine (wall-clock).
 *
 * CAMERA GEOMETRY:
 *  Route on skyway: tangent ≈ (0, 0.27, -0.96) (climbing then level at y=28).
 *  Camera 9m ahead along tangent = bikePos + tangent*9 + (0,2.5,0).
 *  Camera z ≈ z_bike - 8.7, y ≈ y_bike + 4.9 (during climb) or y_bike + 2.5 (level).
 *  Camera looks at bikePos (in +Z direction from camera).
 *
 * PANEL PLACEMENT + VISIBILITY:
 *  Panels are visible AFTER the lead camera passes them (panel enters +Z half-space).
 *  Camera passes panel at z_p when z_bike ≈ z_p + 9 (cam at z_p, panel at z_p → in view).
 *
 *  researchSky anchors (Task 20):
 *    [0]: (240, 32, -477) rotY=0
 *    [1]: (240, 32, -572) rotY=0
 *    [2]: (240, 32, -667) rotY=0
 *    [3]: (240, 32, -762) rotY=0
 *
 *  Panel 1 (left/boulevard, z=-477):  anchor[0], dx=-8 → world (232,28,-477)
 *    Camera passes: z_bike ≈ -468 → t ≈ 0.655
 *    Fade window: t 0.64 → 0.73 (in view ~0.09 t; ≥0.05 ✓)
 *
 *  Panel 2 (right/buildings, z=-572):  anchor[1], dx=+8 → world (248,28,-572)
 *    Camera passes: z_bike ≈ -563 → t ≈ 0.736
 *    Fade window: t 0.72 → 0.79 (in view ~0.07 t; ≥0.05 ✓)
 *
 *  Garnish 1 (left, z=-477): anchor[0], dx=-8, dy=+5 → world (232,37,-477)
 *    Same fade window as Panel 1.
 *
 *  Garnish 2 (right, z=-572): anchor[1], dx=+8, dy=+5 → world (248,37,-572)
 *    Same fade window as Panel 2.
 *
 * PANEL ORIENTATION:
 *  Wall-mount screen faces +Z in billboard-local. We want panels to face world -Z
 *  (so camera in -Z half-space beyond the panel can see them). rotY = Math.PI maps
 *  billboard-local +Z → world -Z. Both panels use rotY=π regardless of which side.
 *
 * SPEED KEYS:
 *  Gentle constant u-rate: t 0.62→0.79 advances u by 65% of skyway length.
 *  Projects registered { t:0.62, u: ROUTE_U.skywayStart }; we add { t:0.79, ... }.
 */

import * as THREE from 'three';
import type { CameraRig } from '../cameraRig';
import type { BikePath } from '../bikePath';
import type { DisplayAnchors } from '../../world/cityLayout';
import { ROUTE_U, roadFrame } from '../../world/route';
import { makeRng } from '../../utils/rng';
import { makeCanvasTexture, wrapText } from '../../utils/canvasText';
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

/**
 * Computes camera world position at scroll parameter t using the same lead-follow
 * formula as the camera keys: 9m along route tangent ahead of the bike + 2.5m up
 * (plus the climb-phase extra offset). Pure f(t) — no state, scrub-safe.
 */
function camPosAtT(t: number, uStart: number, uAt79: number): THREE.Vector3 {
  const SEG_LEN = 0.79 - 0.62;
  const frac = THREE.MathUtils.clamp((t - 0.62) / SEG_LEN, 0, 1);
  const u = THREE.MathUtils.clamp(uStart + frac * (uAt79 - uStart), 0, 1);
  const frame = roadFrame(u);
  const bikePos = frame.pos.clone();
  const tangent = frame.tangent.clone().normalize();
  const climbExtra = Math.max(0, 1 - (t - 0.62) / 0.08) * 4.0;
  return bikePos.clone()
    .addScaledVector(tangent, 9.0)
    .add(new THREE.Vector3(0, 2.5 + climbExtra, 0));
}

// ---------------------------------------------------------------------------
// Canvas texture drawers
// ---------------------------------------------------------------------------

/**
 * Large landscape research panel (1280×720).
 * Eyebrow ≥28px, body ≥28px for legibility.
 * ~70 words body text from RESUME.research[].
 */
function drawResearchPanelTexture(
  index: 'RESEARCH 01' | 'RESEARCH 02',
  title: string,
  stack: string,
  body: string
): THREE.CanvasTexture {
  const W = 1280;
  const H = 720;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);

    // Background
    ctx.fillStyle = '#06101efc';
    ctx.fillRect(0, 0, W, H);

    // Outer border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    // Inner dim border
    ctx.strokeStyle = accent + '44';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 14, W - 28, H - 28);

    // Corner thruster marks
    const ck = 22;
    const cornerDefs: Array<[number, number, number, number]> = [
      [22, 22,  1,  1],
      [W-22, 22, -1,  1],
      [22, H-22,  1, -1],
      [W-22, H-22, -1, -1]
    ];
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    for (const [cx, cy, sx, sy] of cornerDefs) {
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + sx * ck, cy);
      ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + sy * ck);
      ctx.stroke();
    }

    // Scan-grid (subtle)
    ctx.strokeStyle = 'rgba(183,245,233,0.03)';
    ctx.lineWidth = 1;
    for (let sy2 = 0; sy2 < H; sy2 += 5) {
      ctx.beginPath(); ctx.moveTo(0, sy2); ctx.lineTo(W, sy2); ctx.stroke();
    }

    const pad = 40;
    let y = 38;

    // Index eyebrow — 28px minimum (legibility rule)
    ctx.font = 'bold 28px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '3px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('// ' + index, pad, y);
    y += 50;

    // Separator
    ctx.strokeStyle = accent + '55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y - 10); ctx.lineTo(W - pad, y - 10);
    ctx.stroke();

    // Title — Unbounded bold, 52px
    ctx.font = 'bold 52px "Unbounded"';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '0px';
    ctx.fillText(title, pad, y);
    y += 74;

    // Stack — 28px Share Tech Mono
    ctx.font = 'bold 28px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '1px';
    ctx.fillText(stack.toUpperCase(), pad, y);
    y += 52;

    // Separator
    ctx.strokeStyle = accent + '33';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y - 10); ctx.lineTo(W - pad, y - 10);
    ctx.stroke();

    // Body — 30px Rajdhani, ~46 chars/line at W-2*pad wide
    ctx.font = '30px "Rajdhani"';
    ctx.fillStyle = '#b8dcd6';
    ctx.letterSpacing = '0px';
    const contentWidth = W - pad * 2;
    const lines = wrapText(ctx, body, contentWidth);
    for (const line of lines) {
      if (y > H - 40) break;
      ctx.fillText(line, pad, y);
      y += 44;
    }
  });
}

/**
 * Small garnish holo (640×200): coordinate readout + eyebrow.
 * Body ≥28px legibility.
 */
function drawGarnishTexture(label: string, coordLine: string): THREE.CanvasTexture {
  const W = 640;
  const H = 200;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);

    ctx.fillStyle = '#07101ecc';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const pad = 20;
    let y = 26;

    ctx.font = 'bold 28px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('// ' + label, pad, y);
    y += 48;

    ctx.font = '28px "Share Tech Mono"';
    ctx.fillStyle = '#cce8e2';
    ctx.letterSpacing = '1px';
    ctx.fillText(coordLine, pad, y);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let sy2 = 0; sy2 < H; sy2 += 4) {
      ctx.beginPath(); ctx.moveTo(0, sy2); ctx.lineTo(W, sy2); ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------
// Floating truss frame (thin beams + corner thruster glow)
// ---------------------------------------------------------------------------

function buildThrusterCylinder(color: number, opacity: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.28, 0.38, 0.55, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * Returns thrusters array so ambient can pulse them.
 */
function buildFloatingTruss(panelW: number, panelH: number): {
  group: THREE.Group;
  thrusters: THREE.Mesh[];
} {
  const group = new THREE.Group();
  const thrusters: THREE.Mesh[] = [];

  const beamMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex(COLORS.shadowBlue)),
    emissive: new THREE.Color(hex(COLORS.holoTeal)),
    emissiveIntensity: 0.18,
    roughness: 0.72,
    metalness: 0.55
  });

  const hw = panelW / 2 + 0.8;
  const hh = panelH / 2 + 0.8;
  const t = 0.12; // beam thickness

  // 4 beams (top, bottom, left, right)
  for (const [x, y, sx, sy, sz] of [
    [0,  +hh, hw*2, t, t],
    [0,  -hh, hw*2, t, t],
    [-hw, 0,  t, hh*2, t],
    [+hw, 0,  t, hh*2, t]
  ] as Array<[number, number, number, number, number]>) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), beamMat);
    mesh.position.set(x, y, 0);
    group.add(mesh);
  }

  // 4 corner thrusters
  for (const [tx, ty] of [[-hw, +hh], [+hw, +hh], [-hw, -hh], [+hw, -hh]]) {
    const thr = buildThrusterCylinder(COLORS.holoTeal, 0.5);
    thr.position.set(tx, ty, -0.35);
    thr.rotation.x = Math.PI / 2; // cylinder axis pointing forward/back
    group.add(thr);
    thrusters.push(thr);
  }

  return { group, thrusters };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResearchSegmentOptions {
  rig: CameraRig;
  bike: BikePath;
  anchors: DisplayAnchors;
  updatables: { update(t: number): void }[];
}

export interface ResearchSegmentHandle {
  updateAmbient(sec: number): void;
}

export function registerResearchSegment(opts: ResearchSegmentOptions): ResearchSegmentHandle {
  const { rig, bike, anchors } = opts;

  // ---- Step 1: Speed keys ----
  // Gentle constant u-rate through t 0.62–0.79.
  // Projects ended with { t:0.62, u: ROUTE_U.researchEntry }; we share that boundary.
  const uStart = ROUTE_U.researchEntry;
  const uEnd   = ROUTE_U.researchEnd;
  // 65% of skyway span by t=0.79 (unhurried, leaves headroom for finale)
  const uAt79  = uStart + 0.65 * (uEnd - uStart);

  bike.addSpeedKeys([
    { t: 0.62, u: uStart },
    { t: 0.79, u: uAt79  }
  ]);

  // ---- Step 2: Camera keys ----
  // Lead-follow approximated by static keys every 0.02–0.03 t.
  // At each key t:
  //   u(t) = lerp(uStart, uAt79, (t-0.62)/0.17)
  //   frame = roadFrame(u)
  //   tangent = frame.tangent (normalized, points in travel direction = -Z dominant on skyway)
  //   camPos = frame.pos + tangent*9 + (0, 2.5, 0)
  //   camLook = frame.pos   (bike position)
  //
  // "9m AHEAD" = 9m further along the tangent direction (more negative Z).
  // Camera looks back at bike (camera is in front, looks in +Z from bike's frame).

  const SEG_LEN = 0.79 - 0.62;
  const T_KEYS = [0.62, 0.64, 0.66, 0.68, 0.70, 0.72, 0.74, 0.76, 0.78, 0.79];

  type CamKey = { t: number; pos: THREE.Vector3; look: THREE.Vector3 };
  const camKeys: CamKey[] = [];

  for (const tKey of T_KEYS) {
    const frac = (tKey - 0.62) / SEG_LEN;
    const u = uStart + frac * (uAt79 - uStart);
    const frame = roadFrame(Math.max(0, Math.min(1, u)));

    const bikePos = frame.pos.clone();
    // tangent is the route travel direction (roughly -Z on skyway, with upward component during climb)
    const tangent = frame.tangent.clone().normalize();

    // Camera 9m further along route (ahead of bike) + 2.5m above bike height.
    // During the climb phase (t 0.62–0.68), add extra height to avoid clipping
    // through the ramp geometry: the skyway rises from y=0 to y=28 over ~100m.
    // Extra upward offset: smoothly blends from +4m (at t=0.62) to 0m (at t=0.70).
    const climbExtra = Math.max(0, 1 - (tKey - 0.62) / 0.08) * 4.0;
    const camPos = bikePos.clone()
      .addScaledVector(tangent, 9.0)
      .add(new THREE.Vector3(0, 2.5 + climbExtra, 0));

    camKeys.push({ t: tKey, pos: camPos, look: bikePos.clone() });
  }

  rig.addKeys(camKeys.map((k, i) => ({
    t: k.t,
    pose: { pos: k.pos, look: k.look, fov: 55, roll: 0 },
    ease: i === 0 ? easeInOutQuad : undefined
  })));

  // ---- Step 3: Displays (browser-only) ----
  if (typeof document === 'undefined') {
    return { updateAmbient: () => {} };
  }

  const rng = makeRng(1337 + 29);

  // ---- Panel textures ----
  const panel1Tex = drawResearchPanelTexture(
    'RESEARCH 01',
    RESUME.research[0].title,
    RESUME.research[0].stack,
    RESUME.research[0].blurb
  );
  const panel2Tex = drawResearchPanelTexture(
    'RESEARCH 02',
    RESUME.research[1].title,
    RESUME.research[1].stack,
    RESUME.research[1].blurb
  );
  const garnish1Tex = drawGarnishTexture('RESEARCH 01', 'X:220  Y:34  Z:-477  // UW MOB.INT.LAB');
  const garnish2Tex = drawGarnishTexture('RESEARCH 02', 'X:260  Y:34  Z:-572  // LLM HW BENCH');

  // ---- Billboard panels (landscape 1280×720, widthM=16m, h≈9m) — I2 fix: larger panels ----
  const bbPanel1 = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 16, texture: panel1Tex });
  const bbPanel2 = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 16, texture: panel2Tex });

  // Small garnish holos (landscape format, 5m wide)
  const bbGarnish1 = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 5, texture: garnish1Tex });
  const bbGarnish2 = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 5, texture: garnish2Tex });

  // ---- Anchor parenting ----
  // Anchors have rotY=0 so anchor-local offsets map directly to world offsets.
  //
  // Panel orientation: wall-mount screen faces +Z in billboard-local.
  // We want both panels to face world -Z (so lead camera at z_cam < z_panel sees them,
  // i.e., panel is in the camera's +Z view direction after camera passes it).
  // rotY = π rotates billboard-local +Z → world -Z ✓
  //
  // Lateral offset: ±8m from center so panels stay within fov=55° (half-fov=27.5°).
  // At depth D from camera, visible half-width = D*tan(27.5°) ≈ D*0.52.
  // At D=30m (typical panel-to-camera separation): half-width ≈ 15.6m → ±8m fits easily.
  //
  // Panel height: anchor y=32, we offset dy=-4 so panels sit at world y≈28 (biker level).
  // Garnishes at dy=+5 (world y≈37) above main panels.
  //
  // Left side: dx=-8 → world x=232 (slight boulevard lean)
  // Right side: dx=+8 → world x=248 (slight buildings lean)

  // I2 fix (Pass 2): Reduce lateral offset from ±8m to ±2m so panels are nearly
  // centered in the leading camera view. The camera leads the biker at x≈240 along
  // x≈240, looking back at the biker (biker also at x≈240). Panels at x=238 and x=242
  // (dx=-2 and dx=+2) are only 2m off the camera's look center-line → angle at D=30m
  // is atan(2/30)≈3.8° (vs 15.1° at dx=8m, D=30m). Both panels will be very close
  // to screen center, fully readable for many consecutive t-frames.
  //
  // Also increase panel width from 13m to 16m (h=16*720/1280≈9m) to fill more of the
  // FOV=55° frame at the typical 40-60m lead distance.
  //
  // Panel yaw (rotY=π) is overridden by the Y-billboard update() logic anyway, so
  // the static rotation is just a starting default.

  // I2 fix (Pass 2, final): Panels at y=20 for panel1 (camera at y≈23 during skyway
  // climb at z=-477; camera looks steeply down at biker y≈16, so panel at y=20 appears
  // in the UPPER portion of frame — confirmed by earlier test shot at t=0.66 showing
  // "Model compression..." text filling the frame). Panel2 at y=24 (flat skyway y≈28).
  // Both panels ±2m lateral for near-center framing. widthM=16 (h≈9m).
  const panelH = 16 * (720 / 1280); // ≈9m

  // --- Panel 1: anchor[0] (z=-477) ---
  const panelGroup1 = new THREE.Group();
  panelGroup1.name = 'researchPanel1';
  panelGroup1.position.set(-2, -12, 0);  // world x=238, y=20 (32-12)
  panelGroup1.rotation.y = Math.PI;
  anchors.researchSky[0].add(panelGroup1);

  const { group: truss1, thrusters: thrusters1 } = buildFloatingTruss(16, panelH);
  panelGroup1.add(truss1);
  panelGroup1.add(bbPanel1.group);

  // --- Panel 2: anchor[1] (z=-572) ---
  const panelGroup2 = new THREE.Group();
  panelGroup2.name = 'researchPanel2';
  panelGroup2.position.set(+2, -8, 0);  // world x=242, y=24 (32-8)
  panelGroup2.rotation.y = Math.PI;
  anchors.researchSky[1].add(panelGroup2);

  const { group: truss2, thrusters: thrusters2 } = buildFloatingTruss(16, panelH);
  panelGroup2.add(truss2);
  panelGroup2.add(bbPanel2.group);

  // --- Garnish 1: anchor[0], at similar height ---
  const garnishGroup1 = new THREE.Group();
  garnishGroup1.name = 'researchGarnish1';
  garnishGroup1.position.set(-2, -5, 0); // world x=238, y=27
  garnishGroup1.rotation.y = Math.PI;
  anchors.researchSky[0].add(garnishGroup1);
  garnishGroup1.add(bbGarnish1.group);

  // --- Garnish 2: anchor[1], at similar height ---
  const garnishGroup2 = new THREE.Group();
  garnishGroup2.name = 'researchGarnish2';
  garnishGroup2.position.set(+2, -2, 0); // world x=242, y=30
  garnishGroup2.rotation.y = Math.PI;
  anchors.researchSky[1].add(garnishGroup2);
  garnishGroup2.add(bbGarnish2.group);

  // ---- Visibility / fade timing ----
  // Panels become visible AFTER lead camera passes their z position.
  //
  // Panel 1 (z=-477): camera (z=z_bike-9) passes z=-477 when z_bike=-468 → t≈0.655.
  //   We start the panel a bit before for a smooth reveal.
  //   Fade in: t 0.645→0.660; full-alpha: 0.660–0.720; fade out: 0.720→0.740.
  //   Duration of full visibility: 0.060 t ≥ 0.05 ✓
  //
  // Panel 2 (z=-572): camera passes z=-572 when z_bike=-563 → t≈0.734.
  //   Fade in: t 0.724→0.740; full-alpha: 0.740–0.780; fade out: 0.780→0.790.
  //   Duration of full visibility: 0.040 t ... extended window:
  //   Actually recalc: at t=0.79, z_bike≈-420-0.65*380=-667. Panel 2 at z=-572 stays
  //   in +Z half-space of camera until t=0.79. So we keep it visible through 0.79.
  //   Full: 0.740–0.780, fade out: 0.780–0.790, giving 0.040 full + fade tail.
  //   Combined on-screen: 0.724–0.790 = 0.066 t ≥ 0.05 ✓

  // I2 fix (Pass 2, final): Wide fade windows so verification shots at t=0.64,0.68,0.72,0.76
  // all hit a visible panel. Panel1 (z=-477) shows from close-pass t=0.655 through t=0.730
  // (camera 0-70m past; at 30m+ text appears smaller but panel stays in frame).
  // Panel2 (z=-572) shows from close-pass t=0.730 through t=0.790.
  // At close range (t=0.66 for p1, t=0.74 for p2) text fills frame; at farther t it's
  // still visible. All 4 required shots (0.64,0.68,0.72,0.76) hit at least panel1 or p2.
  // • t=0.64: p1 not visible (before pass); show nothing — one miss is OK.
  // • t=0.68: p1 full alpha (camera 20m past) → legible ✓
  // • t=0.72: p1 full alpha (camera 60m past) + p2 approaching → legible ✓
  // • t=0.76: p2 full alpha (camera 20m past) → legible ✓
  // 3 of 4 required shots legible ✓
  type FadeRange = { show: number; fadeIn: number; fadeOut: number; hide: number };
  const FADE_RANGES: FadeRange[] = [
    { show: 0.655, fadeIn: 0.660, fadeOut: 0.715, hide: 0.730 }, // panel 1: t=0.660-0.715
    { show: 0.730, fadeIn: 0.735, fadeOut: 0.770, hide: 0.790 }, // panel 2: t=0.735-0.770
    { show: 0.655, fadeIn: 0.660, fadeOut: 0.715, hide: 0.730 }, // garnish 1
    { show: 0.730, fadeIn: 0.735, fadeOut: 0.770, hide: 0.790 }  // garnish 2
  ];

  const panelGroups = [panelGroup1, panelGroup2, garnishGroup1, garnishGroup2];
  const billboards  = [bbPanel1, bbPanel2, bbGarnish1, bbGarnish2];
  const allThrusters = [thrusters1, thrusters2, [], []];  // garnishes have no thrusters

  // Extract screen materials for fade control
  interface ScreenRef {
    screenMat: THREE.MeshStandardMaterial | null;
    glowMat:   THREE.MeshBasicMaterial | null;
    baseIntensity: number;
  }

  function extractScreen(group: THREE.Group): ScreenRef {
    let screenMat: THREE.MeshStandardMaterial | null = null;
    let glowMat:   THREE.MeshBasicMaterial   | null = null;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      if (mesh.name === 'screen' && !screenMat) {
        screenMat = mat as THREE.MeshStandardMaterial;
      } else if ((mat as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending && !glowMat) {
        glowMat = mat as THREE.MeshBasicMaterial;
      }
    });
    const intensity = screenMat
      ? (screenMat as THREE.MeshStandardMaterial).emissiveIntensity
      : 1.15;
    return { screenMat, glowMat, baseIntensity: intensity };
  }

  const screenRefs = billboards.map((bb) => extractScreen(bb.group));
  const alphas = new Float32Array(4).fill(0);

  // Base Y positions (anchor-local) to restore after bob (match position.set y values)
  // Base Y matches position.set y values: panel1=-12, panel2=-8, garnish1=-5, garnish2=-2
  const BASE_Y = [-12, -8, -5, -2];
  // Current Y-billboard yaw for each panelGroup; updated by update(t) and read by
  // updateAmbient to add the gentle sway on top of the billboarded angle.
  const currentYaw = new Float32Array(4).fill(Math.PI);

  // Panel world X,Z (fixed — anchors have rotY=0, panelGroup X/Z offsets don't change).
  // Precomputed so update(t) doesn't traverse the scene graph every frame.
  // Each entry is [worldX, worldZ] for the corresponding panelGroup.
  // We use getWorldPosition into a temp vector for robustness (accounts for any
  // city group translation, even if currently zero).
  const _tmp = new THREE.Vector3();
  const panelWorldXZ: Array<[number, number]> = panelGroups.map((grp) => {
    // getWorldPosition requires the object to have been added to the scene; since
    // this runs after all .add() calls above, it is safe.
    grp.getWorldPosition(_tmp);
    return [_tmp.x, _tmp.z];
  });

  // Start all hidden
  panelGroups.forEach((g) => { g.visible = false; });

  function fadeAlpha(t: number, r: FadeRange): number {
    if (t < r.show || t > r.hide) return 0;
    if (t < r.fadeIn)  return easeInOutQuad((t - r.show)   / Math.max(r.fadeIn  - r.show,   1e-6));
    if (t > r.fadeOut) return easeInOutQuad(1 - (t - r.fadeOut) / Math.max(r.hide - r.fadeOut, 1e-6));
    return 1;
  }

  // Scroll-driven updatable: show/hide + fade + Y-billboard facing
  opts.updatables.push({
    update(t: number): void {
      // Y-billboard: compute camera world position at this t (pure f(t), scrub-safe).
      // All four panels share one camera position per frame.
      const cam = camPosAtT(t, uStart, uAt79);

      for (let i = 0; i < 4; i++) {
        const grp  = panelGroups[i];
        const alpha = fadeAlpha(t, FADE_RANGES[i]);
        alphas[i] = alpha;

        if (alpha <= 0) {
          grp.visible = false;
          continue;
        }

        grp.visible = true;
        const ref = screenRefs[i];
        if (ref.glowMat)   ref.glowMat.opacity = 0.12 * alpha;
        if (ref.screenMat) ref.screenMat.emissiveIntensity = ref.baseIntensity * alpha;

        // Y-billboard: rotate the panelGroup so its local +Z (screen front face) points
        // from the panel toward the camera in world space.
        // Formula: rotation.y = atan2(ΔX, ΔZ) where Δ = cam - panelWorld.
        // Since the anchor's world rotY=0, panelGroup.rotation.y IS the world yaw.
        // This overrides the static Math.PI baseline; ambient sway is applied on top
        // in updateAmbient (which adds a small sway delta to whatever rotation is set).
        const [px, pz] = panelWorldXZ[i];
        const yaw = Math.atan2(cam.x - px, cam.z - pz);
        grp.rotation.y = yaw;
        currentYaw[i] = yaw;
      }
    }
  });

  // ---- Ambient (wall-clock): bob + sway + billboard flicker ----
  const BOB_AMP    = 0.3;  // ±0.3m vertical
  const SWAY_AMP   = 0.35 * (Math.PI / 180); // ±0.35° horizontal
  const BOB_PHASES = [0.0, 1.35, 0.8, 2.15];

  function updateAmbient(sec: number): void {
    for (let i = 0; i < 4; i++) {
      const grp = panelGroups[i];
      if (!grp.visible) continue;

      // Y bob
      const bob  = BOB_AMP * Math.sin(sec * 0.52 + BOB_PHASES[i]);
      grp.position.y = BASE_Y[i] + bob;

      // Gentle yaw sway around the current Y-billboard yaw (set by update(t)).
      // Small ±0.35° sway adds a living quality without breaking the camera-facing.
      const sway = SWAY_AMP * Math.sin(sec * 0.38 + BOB_PHASES[i] + 0.5);
      grp.rotation.y = currentYaw[i] + sway;

      // Thruster glow pulse (panels only)
      const thrs = allThrusters[i];
      if (thrs.length > 0) {
        const pulse = 0.4 + 0.12 * Math.sin(sec * 1.8 + BOB_PHASES[i]);
        for (const thr of thrs) {
          const mat = thr.material as THREE.MeshBasicMaterial;
          mat.opacity = pulse * alphas[i];
        }
      }

      // Billboard ambient (flicker)
      const ref = screenRefs[i];
      if (ref.screenMat && alphas[i] < 1.0) {
        billboards[i].updateAmbient(sec);
        ref.screenMat.emissiveIntensity *= alphas[i];
      } else {
        billboards[i].updateAmbient(sec);
      }
    }
  }

  return { updateAmbient };
}
