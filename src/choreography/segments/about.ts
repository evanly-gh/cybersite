/**
 * Task 26 — About segment (t 0.10 – 0.28)
 *
 * Registers:
 *  - Camera: t 0.10 chase → t 0.12 hold at side pose in the street corridor looking
 *    at the −Z wall display cluster → hold through t 0.26 → t 0.28 drift to chase
 *  - Bike speed keys: aboutStart → aboutEnd
 *  - 5 flat PlaneGeometry holo screens on the −Z About wall, facing +Z (camera side)
 *    Staggered fade/scale-in t 0.11–0.15
 *
 * Geometry note:
 *  aboutWall anchors: x ∈ {-180, -80, 20, 120}, y=6, z=-11.5, rotY=π/2
 *  Anchor rotY=π/2 makes local +Z → world +X. We place PlaneGeometry children with
 *  their own world-space positions (via the anchor's world position) and face them +Z
 *  using a counter-rotation of -π/2 in anchor-local space.
 *
 * Camera: pos (-80, 6, 9), look (-80, 9, -11.5), fov 65 — centred on paragraph panel.
 *  The street corridor (z -11 to +11) provides clear line of sight.
 */

import * as THREE from 'three';
import type { CameraRig } from '../cameraRig';
import type { BikePath } from '../bikePath';
import type { DisplayAnchors } from '../../world/cityLayout';
import { ROUTE_U } from '../../world/route';
import { makeCanvasTexture, wrapText } from '../../utils/canvasText';
import { makePlaceholder } from '../../content/placeholders';
import { RESUME } from '../../content/resume';
import { COLORS } from '../../theme';

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
// Holo screen builder — a flat PlaneGeometry with CanvasTexture, facing +Z
// Mounted as a child of an aboutWall anchor (rotY=π/2).
// We rotate the group -π/2 to counter the anchor rotation → screen faces world +Z.
// ---------------------------------------------------------------------------

interface HoloScreen {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
}

function buildHoloScreen(texture: THREE.CanvasTexture, wM: number, hM: number): HoloScreen {
  const geom = new THREE.PlaneGeometry(wM, hM);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,          // starts invisible; updatable fades in
    depthWrite: false,
    side: THREE.FrontSide
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'aboutScreen';

  // Additive halo glow plane behind the screen (same size, slightly larger, additive)
  const haloMat = new THREE.MeshBasicMaterial({
    color: COLORS.holoTeal,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  });
  const haloGeom = new THREE.PlaneGeometry(wM * 1.08, hM * 1.08);
  const haloMesh = new THREE.Mesh(haloGeom, haloMat);
  haloMesh.position.z = -0.05; // slightly behind screen
  haloMesh.name = 'aboutHalo';

  const group = new THREE.Group();
  group.add(haloMesh, mesh);

  // Counter-rotate: anchor rotY=π/2 makes local +Z = world +X.
  // Adding -π/2 in local space → net rotation 0 → local +Z = world +Z (faces camera).
  group.rotation.y = -Math.PI / 2;

  return { group, mat };
}

// ---------------------------------------------------------------------------
// Canvas texture drawers
// ---------------------------------------------------------------------------

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
    ctx.font = 'bold 108px Unbounded, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // RGB split
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

    ctx.font = '500 48px Rajdhani, sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText('CS + ECON @ UW  —  ML / EDGE INFERENCE', pad, H * 0.82);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  });
}

function drawParagraphTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);
    const pad = 20;

    ctx.fillStyle = '#0a0e1aee';
    ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Corner ticks
    const tick = 14;
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]] as Array<[number, number]>) {
      const sx = cx === 0 ? 1 : -1, sy = cy === 0 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + sx * tick, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + sy * tick); ctx.stroke();
    }

    let y = 22;
    ctx.font = '13px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.fillText('// ABOUT', pad, y);
    y += 30;

    ctx.font = 'bold 30px "Unbounded"';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '0px';
    ctx.fillText(RESUME.name.toUpperCase(), pad, y);
    y += 44;

    ctx.strokeStyle = accent + '66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y - 10);
    ctx.lineTo(W - pad, y - 10);
    ctx.stroke();

    // Body at 30px — ~46 chars/line at 1024px
    ctx.font = '30px "Rajdhani", sans-serif';
    ctx.fillStyle = '#d8e8e4';
    ctx.letterSpacing = '0px';
    const contentWidth = W - pad * 2;
    const lines = wrapText(ctx, RESUME.about.paragraph, contentWidth);
    for (const line of lines) {
      ctx.fillText(line, pad, y);
      y += 38;
      if (y > H - 18) break;
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let sy = 0; sy < H; sy += 4) {
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }
  });
}

function drawFaceTexture(): THREE.CanvasTexture {
  const W = 1024, H = 640;
  return makeCanvasTexture(W, H, (ctx) => {
    const accent = hex(COLORS.holoTeal);
    const faceH = 490;

    ctx.fillStyle = '#0a0c18';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = hex(COLORS.shadowBlue);
    ctx.fillRect(0, 0, W, faceH);

    const vignette = ctx.createRadialGradient(W/2, faceH/2, faceH*0.15, W/2, faceH/2, faceH*0.9);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, faceH);

    const m = 16;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m, m); ctx.lineTo(W - m, faceH - m);
    ctx.moveTo(W - m, m); ctx.lineTo(m, faceH - m);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 12]);
    ctx.strokeRect(m, m, W - m*2, faceH - m*2);
    ctx.restore();

    ctx.font = '28px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FACE PORTRAIT', W/2, faceH/2 - 20);
    ctx.font = '20px "Share Tech Mono"';
    ctx.fillStyle = accent + 'aa';
    ctx.fillText('upload 800 × 1000', W/2, faceH/2 + 20);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let sy = 0; sy < faceH; sy += 4) {
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }
    ctx.restore();

    // Name plate
    ctx.fillStyle = '#07080fcc';
    ctx.fillRect(0, faceH, W, H - faceH);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, faceH); ctx.lineTo(W, faceH); ctx.stroke();

    ctx.font = 'bold 50px "Unbounded", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hex(COLORS.moonlight);
    ctx.fillText(RESUME.name.toUpperCase(), W/2, faceH + (H - faceH) * 0.38);
    ctx.font = '22px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.fillText('CS + ECON @ UW', W/2, faceH + (H - faceH) * 0.75);
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
  // Perpendicular shot: camera in the street corridor (z=+9, clear of all buildings),
  // between anchor 1 (x=-80) and anchor 2 (x=20) → camera x=-50, looking at wall.
  // Two-step transition at t=0.10→0.11→0.12 to avoid Catmull-Rom spline overshoot
  // clipping through the +Z-side buildings.
  // Elevated perpendicular side camera: y=18 clears the HI-VOLT billboard (y≈8-10),
  // and angles down onto our panels which are at y=10 (anchor y=6 + offset 4).
  // Camera at x=-50 centers between anchor 1 (x=-80) and anchor 2 (x=20).
  const camPos = new THREE.Vector3(-50, 18, 9);
  const camLook = new THREE.Vector3(-50, 10, -11.5);

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
        // Step up and across: intermediate keyframe to avoid spline clipping into buildings
        pos: new THREE.Vector3(-130, 12, 8),
        look: new THREE.Vector3(-80, 10, -11.5),
        fov: 62,
        roll: 0
      },
      ease: easeInOutQuad
    },
    {
      t: 0.13,
      pose: { pos: camPos.clone(), look: camLook.clone(), fov: 65, roll: 0 },
      ease: easeInOutQuad
    },
    {
      t: 0.26,
      pose: { pos: camPos.clone(), look: camLook.clone(), fov: 65, roll: 0 }
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
  bike.addSpeedKeys([
    { t: 0.10, u: ROUTE_U.aboutStart + 0.02 },
    { t: 0.28, u: ROUTE_U.aboutEnd + 0.01 }
  ]);

  // ---- Displays (browser-only) ----
  if (typeof document === 'undefined') return;

  const wallAnchors = anchors.aboutWall;
  // Anchor positions (world): [0]=(-180,6,-11.5) [1]=(-80,6,-11.5) [2]=(20,6,-11.5) [3]=(120,6,-11.5)
  // Anchor rotY=π/2 → local +Z = world +X. Counter-rotate group by -π/2 → screen faces world +Z.

  // Displays raised to y-offset=6 → world y=12, to be above the HI-VOLT ad billboard
  // (which is at approx y=8-10) and visible from elevated camera (y=18).

  // ---- Display 0: banner strip (anchor 0, x=-180) ----
  const bannerScreen = buildHoloScreen(drawBannerTexture(), 18, 2.25);
  bannerScreen.group.position.set(0, 6, 0); // world y=12
  wallAnchors[0].add(bannerScreen.group);

  // ---- Display 1: paragraph landscape (anchor 1, x=-80) ----
  const paraScreen = buildHoloScreen(drawParagraphTexture(), 14, 7);
  paraScreen.group.position.set(0, 6, 0); // world y=12
  wallAnchors[1].add(paraScreen.group);

  // ---- Display 2: face panel (anchor 2, x=20) ----
  const faceScreen = buildHoloScreen(drawFaceTexture(), 10, 6.25);
  faceScreen.group.position.set(0, 6, 0); // world y=12
  wallAnchors[2].add(faceScreen.group);

  // ---- Display 3: misc placeholder 0 (anchor 3, x=120, offset west) ----
  const misc0Tex = makePlaceholder(RESUME.about.misc[0]);
  const misc0Screen = buildHoloScreen(misc0Tex, 6, 4.5);
  misc0Screen.group.position.set(0, 6, -4); // world y=12, x=116
  wallAnchors[3].add(misc0Screen.group);

  // ---- Display 4: misc placeholder 1 (anchor 3, x=120, offset east) ----
  const misc1Tex = makePlaceholder(RESUME.about.misc[1]);
  const misc1Screen = buildHoloScreen(misc1Tex, 6, 4.5);
  misc1Screen.group.position.set(0, 6, 4); // world y=12, x=124
  wallAnchors[3].add(misc1Screen.group);

  // ---- Fade/scale-in (t 0.11–0.15, staggered) — pure f(t), scrub-safe ----
  const FADE: Array<[number, number]> = [
    [0.110, 0.125],
    [0.115, 0.130],
    [0.120, 0.135],
    [0.125, 0.140],
    [0.130, 0.145]
  ];

  const screens: HoloScreen[] = [bannerScreen, paraScreen, faceScreen, misc0Screen, misc1Screen];

  // Collect all materials in each screen group for opacity
  const allMats: THREE.MeshBasicMaterial[][] = screens.map(s => {
    const mats: THREE.MeshBasicMaterial[] = [];
    s.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material) mats.push(mesh.material as THREE.MeshBasicMaterial);
    });
    return mats;
  });

  // Start invisible
  for (const s of screens) {
    s.group.visible = false;
    s.group.scale.setScalar(0.9);
  }

  opts.updatables.push({
    update(t: number): void {
      for (let i = 0; i < screens.length; i++) {
        const [tStart, tEnd] = FADE[i];
        const grp = screens[i].group;
        if (t < tStart) {
          grp.visible = false;
          grp.scale.setScalar(0.9);
        } else if (t >= tEnd) {
          grp.visible = true;
          grp.scale.setScalar(1.0);
          for (const m of allMats[i]) m.opacity = m.blending === THREE.AdditiveBlending ? 0.06 : 1;
        } else {
          const p = easeInOutQuad((t - tStart) / (tEnd - tStart));
          grp.visible = true;
          grp.scale.setScalar(0.9 + 0.1 * p);
          for (const m of allMats[i]) {
            m.opacity = m.blending === THREE.AdditiveBlending ? p * 0.06 : p;
          }
        }
      }
    }
  });
}
