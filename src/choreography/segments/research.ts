/**
 * Task I — Research segment (t 0.62 – 0.79)
 *
 * ARCHITECTURE — GROUND-LEVEL NEON CANYON (rewritten from the old elevated skyway):
 *  - The bike rides at ground level (y=0) from researchEntry (240,0,-420) through
 *    researchMid (240,0,-600) toward researchEnd (240,0,-800). At frac=0.65 (see below)
 *    the bike covers z=-420 → ~-667 across t 0.62→0.79.
 *  - Camera is LOW to the ground (y≈2m) and TRAILS the bike by ~9m, looking sharply
 *    UPWARD (look target y≈17m) at the towering canyon walls and the research holo-panels
 *    mounted high on them. The biker sits low in-frame; towers loom overhead.
 *  - This is the OPPOSITE of the old shot (which was elevated, leading, looking down/back).
 *
 * CAMERA GEOMETRY (pure f(t), scrub-safe):
 *  u(t)   = uStart + (t-0.62)/0.17 * (uAt79 - uStart)          [frac=0.65 span]
 *  bike   = roadFrame(u).pos
 *  camPos = (240, CAM_Y=2.0, bike.z + CAM_BEHIND=9)            [absolute low y, on road x]
 *  look   = (240, LOOK_Y=17, camPos.z - LOOK_AHEAD=38)         [aimed UP the canyon]
 *  fov    = 70                                                  [wide, canyon-immersive]
 *  Camera x is pinned to 240 (road center, within the required [238,242] no-clip band).
 *
 *  IMPORTANT — speed handoff constraint: the finale segment hardcodes its t=0.79 boundary
 *  as u = researchEntry + 0.65*(researchEnd - researchEntry). We MUST keep frac=0.65 here
 *  so the bike position is continuous across the research→finale handoff.
 *
 * RESEARCH HOLO-PANEL ANCHORS (cityLayout.ts researchCanyon — high on the canyon walls,
 * already yaw-oriented to face the road via rotY=±π/2):
 *    [0]: (233, 24, -480) rotY=+π/2  (west wall, faces +X toward road)
 *    [1]: (247, 26, -560) rotY=-π/2  (east wall, faces -X toward road)
 *    [2]: (233, 22, -650) rotY=+π/2  (west wall)
 *    [3]: (247, 28, -730) rotY=-π/2  (east wall)
 *
 *  Content mapping (best full-frame legibility windows land on the middle anchors):
 *    anchor[0] → Garnish A (coordinate readout, RESEARCH 01)   reads first, t≈0.62-0.66
 *    anchor[1] → Panel 1   (RESUME.research[0], Mobile Intel)  reads t≈0.645-0.705 (center)
 *    anchor[2] → Panel 2   (RESUME.research[1], LLM HW Bench)  reads t≈0.70-0.76 (center)
 *    anchor[3] → Garnish B (coordinate readout, RESEARCH 02)   reads last, t≈0.73-0.79
 *
 * PANEL ORIENTATION:
 *  The anchors already yaw the panels to face the road. On top of that we add a fixed
 *  DOWNWARD pitch (rotation.x = DOWN_TILT ≈ 38°) so each screen leans DOWN toward the low
 *  camera and its text reads clearly from below. No dynamic billboarding — canyon walls
 *  don't move, so a fixed orientation is correct and cheaper.
 *
 * FADE TIMING:
 *  Recomputed for the new low camera. Each panel fades in as it enters frame ahead of the
 *  camera and fades out as the camera slides beneath it (panel rises out the top). The
 *  five verification t's (0.62/0.66/0.70/0.74/0.78) each hit at least one full-alpha panel.
 *
 * SPEED KEYS:
 *  Gentle constant u-rate: t 0.62→0.79 advances u by 65% of the canyon length.
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
// Camera model constants (low-to-ground, looking UP the canyon)
// ---------------------------------------------------------------------------

const T_START = 0.62;
const T_END = 0.79;
const SEG_LEN = T_END - T_START;

const CAM_X = 240;        // pinned to road center (within required [238,242] no-clip band)
const CAM_Y = 2.0;        // low to the ground (design 1.2–2.5m)
const CAM_BEHIND = 9;     // camera trails the bike by 9m (camZ = bikeZ + 9)
const LOOK_Y = 17;        // look target height — aims UP at towers/panels (design 15–28m)
const LOOK_AHEAD = 38;    // look point is 38m further up-canyon (lookZ = camZ - 38)
const CAM_FOV = 70;       // wide, canyon-immersive (design 64–72)
const DOWN_TILT = 38 * (Math.PI / 180); // panel forward-lean toward the low camera

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** Bike arc-length parameter u at scroll t. Pure f(t). */
function bikeUAtT(t: number, uStart: number, uAt79: number): number {
  const frac = THREE.MathUtils.clamp((t - T_START) / SEG_LEN, 0, 1);
  return THREE.MathUtils.clamp(uStart + frac * (uAt79 - uStart), 0, 1);
}

// ---------------------------------------------------------------------------
// Canvas texture drawers
// ---------------------------------------------------------------------------

/**
 * Large landscape research panel (1280×720).
 * Eyebrow ≥28px, body ≥28px for legibility.
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

    // Background — lit holo teal-navy (brighter than the old near-black so the panel
    // reads as an illuminated screen against the city's bright ad grids, not a dark slab).
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#123043');
    bg.addColorStop(1, '#0a1c2b');
    ctx.fillStyle = bg;
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

    // Body — 30px Rajdhani
    ctx.font = '30px "Rajdhani"';
    ctx.fillStyle = '#e4f5f0';
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

    ctx.fillStyle = '#123043';
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
  // frac MUST stay 0.65 — the finale segment hardcodes the same value for its handoff.
  const uStart = ROUTE_U.researchEntry;
  const uEnd   = ROUTE_U.researchEnd;
  const uAt79  = uStart + 0.65 * (uEnd - uStart);

  bike.addSpeedKeys([
    { t: T_START, u: uStart },
    { t: T_END,   u: uAt79  }
  ]);

  // ---- Step 2: Camera keys (low, trailing, looking UP the canyon) ----
  const T_KEYS = [0.62, 0.64, 0.66, 0.68, 0.70, 0.72, 0.74, 0.76, 0.78, 0.79];

  type CamKey = { t: number; pos: THREE.Vector3; look: THREE.Vector3 };
  const camKeys: CamKey[] = T_KEYS.map((tKey) => {
    const u = bikeUAtT(tKey, uStart, uAt79);
    const bikePos = roadFrame(u).pos;
    // Camera: low, pinned to road center, trailing the bike by CAM_BEHIND.
    const camZ = bikePos.z + CAM_BEHIND;
    const pos = new THREE.Vector3(CAM_X, CAM_Y, camZ);
    // Look target: high above and up-canyon → the lens tilts UP at towers + panels.
    const look = new THREE.Vector3(CAM_X, LOOK_Y, camZ - LOOK_AHEAD);
    return { t: tKey, pos, look };
  });

  rig.addKeys(camKeys.map((k, i) => ({
    t: k.t,
    pose: { pos: k.pos, look: k.look, fov: CAM_FOV, roll: 0 },
    ease: i === 0 ? easeInOutQuad : undefined
  })));

  // ---- Step 3: Displays (browser-only) ----
  if (typeof document === 'undefined') {
    return { updateAmbient: () => {} };
  }

  const rng = makeRng(1337 + 29);

  // ---- Panel + garnish textures ----
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
  const garnishATex = drawGarnishTexture('LAB NODE', 'X:233  Y:22  Z:-650  // UW MOB.INT.LAB');
  const garnishBTex = drawGarnishTexture('BENCH NODE', 'X:247  Y:28  Z:-730  // LLM HW BENCH');

  // ---- Billboards (landscape). Panels 16m wide (h≈9m); garnishes 6m. ----
  const PANEL_W = 16;
  const panelH = PANEL_W * (720 / 1280); // ≈7.9m
  const bbPanel1  = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: PANEL_W, texture: panel1Tex });
  const bbPanel2  = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: PANEL_W, texture: panel2Tex });
  const bbGarnishA = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 6, texture: garnishATex });
  const bbGarnishB = buildBillboard(rng, { format: 'landscape', mount: 'wall', widthM: 6, texture: garnishBTex });

  // ---- Anchor parenting ----
  // The researchCanyon anchors already yaw each panel to face the road (rotY=±π/2).
  // We add ONLY a fixed downward pitch (rotation.x = DOWN_TILT) so the screen leans DOWN
  // toward the low camera. A small local -y offset drops the panel center into the readable
  // band while it still towers overhead. World center Y = anchorY + localY (yaw is about Y,
  // so the local Y offset maps straight to world Y).
  //
  // Content is placed on the anchors the camera actually reaches for a close read (bike
  // stops at z≈-658 with frac=0.65). The two big panels get the earliest, most central
  // read windows; the two garnishes book-end the run.
  //   index 0 (west, z=-480) → Panel 1   (RESUME.research[0])  read t≈0.62-0.66
  //   index 1 (east, z=-560) → Panel 2   (RESUME.research[1])  read t≈0.66-0.71
  //   index 2 (west, z=-650) → Garnish A                       read t≈0.74-0.78
  //   index 3 (east, z=-730) → Garnish B                       read t≈0.78-0.79 (far tail)

  // Local +z under each anchor points toward the road (west rotY=+π/2 → +x; east
  // rotY=-π/2 → -x; both toward x=240). A +z offset floats the panel OFF the wall,
  // out over the canyon, so it reads as a free-floating research holo-panel distinct
  // from the building ad-grids behind it.
  const PANEL_FLOAT = 4.5;
  const GARNISH_FLOAT = 3.0;

  // Panel 1 — anchor[0]
  const panelGroup1 = new THREE.Group();
  panelGroup1.name = 'researchPanel1';
  panelGroup1.position.set(0, -3, PANEL_FLOAT);
  panelGroup1.rotation.x = DOWN_TILT;
  anchors.researchCanyon[0].add(panelGroup1);
  const { group: truss1, thrusters: thrusters1 } = buildFloatingTruss(PANEL_W, panelH);
  panelGroup1.add(truss1);
  panelGroup1.add(bbPanel1.group);

  // Panel 2 — anchor[1]
  const panelGroup2 = new THREE.Group();
  panelGroup2.name = 'researchPanel2';
  panelGroup2.position.set(0, -3, PANEL_FLOAT);
  panelGroup2.rotation.x = DOWN_TILT;
  anchors.researchCanyon[1].add(panelGroup2);
  const { group: truss2, thrusters: thrusters2 } = buildFloatingTruss(PANEL_W, panelH);
  panelGroup2.add(truss2);
  panelGroup2.add(bbPanel2.group);

  // Garnish A — anchor[2]
  const garnishGroupA = new THREE.Group();
  garnishGroupA.name = 'researchGarnishA';
  garnishGroupA.position.set(0, -2, GARNISH_FLOAT);
  garnishGroupA.rotation.x = DOWN_TILT;
  anchors.researchCanyon[2].add(garnishGroupA);
  garnishGroupA.add(bbGarnishA.group);

  // Garnish B — anchor[3]
  const garnishGroupB = new THREE.Group();
  garnishGroupB.name = 'researchGarnishB';
  garnishGroupB.position.set(0, -2, GARNISH_FLOAT);
  garnishGroupB.rotation.x = DOWN_TILT;
  anchors.researchCanyon[3].add(garnishGroupB);
  garnishGroupB.add(bbGarnishB.group);

  // ---- Visibility / fade timing (recomputed for the low trailing camera) ----
  // Each panel enters frame ahead of the camera, holds full alpha while readable, then
  // fades as the camera slides beneath it (panel exits the top of frame). The five
  // verification t's each hit at least one full-alpha display:
  //   t=0.62 → Panel 1 ;  t=0.66 → Panel 1→2 crossfade ;  t=0.70 → Panel 2 ;
  //   t=0.74 → Garnish A ;  t=0.78 → Garnish A→B.
  // Index order: [0]=Panel 1, [1]=Panel 2, [2]=Garnish A, [3]=Garnish B.
  type FadeRange = { show: number; fadeIn: number; fadeOut: number; hide: number };
  const FADE_RANGES: FadeRange[] = [
    { show: 0.615, fadeIn: 0.620, fadeOut: 0.655, hide: 0.672 }, // 0: Panel 1  (z=-480)
    { show: 0.648, fadeIn: 0.662, fadeOut: 0.712, hide: 0.726 }, // 1: Panel 2  (z=-560)
    { show: 0.712, fadeIn: 0.726, fadeOut: 0.772, hide: 0.784 }, // 2: Garnish A (z=-650)
    { show: 0.756, fadeIn: 0.770, fadeOut: 0.792, hide: 0.796 }  // 3: Garnish B (z=-730)
  ];

  const panelGroups  = [panelGroup1, panelGroup2, garnishGroupA, garnishGroupB];
  const billboards   = [bbPanel1, bbPanel2, bbGarnishA, bbGarnishB];
  const allThrusters: THREE.Mesh[][] = [thrusters1, thrusters2, [], []];
  const BASE_Y = [-3, -3, -2, -2];

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
    // Boost above the billboard default (0.95) so research panels read as bright,
    // primary content against the city's own neon ad grids on the canyon walls.
    const intensity = 1.7;
    return { screenMat, glowMat, baseIntensity: intensity };
  }

  const screenRefs = billboards.map((bb) => extractScreen(bb.group));
  const alphas = new Float32Array(4).fill(0);

  // Start all hidden
  panelGroups.forEach((g) => { g.visible = false; });

  function fadeAlpha(t: number, r: FadeRange): number {
    if (t < r.show || t > r.hide) return 0;
    if (t < r.fadeIn)  return easeInOutQuad((t - r.show)   / Math.max(r.fadeIn  - r.show,   1e-6));
    if (t > r.fadeOut) return easeInOutQuad(1 - (t - r.fadeOut) / Math.max(r.hide - r.fadeOut, 1e-6));
    return 1;
  }

  // Scroll-driven updatable: show/hide + fade (orientation is fixed — no billboarding).
  opts.updatables.push({
    update(t: number): void {
      for (let i = 0; i < 4; i++) {
        const grp = panelGroups[i];
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
      }
    }
  });

  // ---- Ambient (wall-clock): gentle holographic bob + thruster pulse + flicker ----
  const BOB_AMP     = 0.15; // subtle vertical shimmer (wall-mounted, so kept small)
  const BOB_PHASES  = [0.0, 1.35, 0.8, 2.15];

  function updateAmbient(sec: number): void {
    for (let i = 0; i < 4; i++) {
      const grp = panelGroups[i];
      if (!grp.visible) continue;

      // Subtle Y bob around the panel's base offset.
      const bob = BOB_AMP * Math.sin(sec * 0.52 + BOB_PHASES[i]);
      grp.position.y = BASE_Y[i] + bob;

      // Thruster glow pulse (panels only)
      const thrs = allThrusters[i];
      if (thrs.length > 0) {
        const pulse = 0.4 + 0.12 * Math.sin(sec * 1.8 + BOB_PHASES[i]);
        for (const thr of thrs) {
          const mat = thr.material as THREE.MeshBasicMaterial;
          mat.opacity = pulse * alphas[i];
        }
      }

      // Billboard ambient (flicker), re-scaled by current fade alpha.
      const ref = screenRefs[i];
      billboards[i].updateAmbient(sec);
      if (ref.screenMat && alphas[i] < 1.0) {
        ref.screenMat.emissiveIntensity *= alphas[i];
      }
    }
  }

  return { updateAmbient };
}
