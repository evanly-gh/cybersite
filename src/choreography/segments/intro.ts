/**
 * Task 25 — Intro segment (t 0.0 – 0.10)
 *
 * Registers:
 *  - Camera keys: high overhead dive → low street chase
 *  - Bike speed keys: introStart → aboutStart+0.02
 *  - In-world intro title panel mounted on city.anchors.introOverhead
 *
 * Camera dive:
 *  t=0.00: high overhead (120, 190, -60) looking down street grid, fov 48
 *  t=0.04: swooping between two talls (20, 40, -18), fov 52
 *  t=0.08: low chase 6m behind bike, fov 60
 *
 * Intro title fades out t=0.03–0.05.
 */

import * as THREE from 'three';
import type { CameraRig } from '../cameraRig';
import type { BikePath } from '../bikePath';
import { ROUTE_U } from '../../world/route';
// CSS color strings for use with CanvasRenderingContext2D
const CSS = {
  moonlight: '#f5f0e6',
  tronCyan: '#00f0ff',
  void: '#07080f'
} as const;

/**
 * Maximum t at which the scroll-hint pulse override applies.
 * Mirrors SCROLL_HINT_REMOVE_T in reducedMotion.ts — the hint is removed once t exceeds this.
 */
const SCROLL_HINT_T_MAX = 0.02;
import type { DisplayAnchors } from '../../world/cityLayout';

// ---------------------------------------------------------------------------
// Intro title panel (in-world CanvasTexture)
// ---------------------------------------------------------------------------

/**
 * Draw the "EVAN LI" intro title panel onto a CanvasTexture.
 * Landscape format (~2.4:1). Returns the texture and a dispose fn.
 */
function drawIntroPanel(): THREE.CanvasTexture {
  const W = 1024;
  const H = 420;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background: dark void with slight blue tint
  ctx.fillStyle = CSS.void;
  ctx.fillRect(0, 0, W, H);

  // Subtle cyan border
  ctx.strokeStyle = CSS.tronCyan;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  // Inner glow border
  ctx.strokeStyle = CSS.tronCyan + '44';
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 12, W - 24, H - 24);

  // Wordmark "EVAN LI" — large Unbounded
  ctx.font = 'bold 140px Unbounded, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // RGB split effect: draw three offset layers
  const cx = W / 2;
  const wordY = H * 0.40;
  ctx.fillStyle = '#ff000033';
  ctx.fillText('EVAN LI', cx - 4, wordY);
  ctx.fillStyle = '#0000ff33';
  ctx.fillText('EVAN LI', cx + 4, wordY);
  ctx.fillStyle = CSS.moonlight;
  ctx.fillText('EVAN LI', cx, wordY);

  // Tagline
  ctx.font = '400 28px Rajdhani, sans-serif';
  ctx.fillStyle = CSS.tronCyan;
  ctx.fillText('FULL-STACK · SYSTEMS · RESEARCH', cx, H * 0.68);

  // Scroll CTA
  ctx.font = '22px "Share Tech Mono", monospace';
  ctx.fillStyle = CSS.moonlight + 'bb';
  ctx.fillText('SCROLL TO RIDE  ▼', cx, H * 0.84);

  // Horizontal separator
  ctx.strokeStyle = CSS.tronCyan + '66';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.12, H * 0.58);
  ctx.lineTo(W * 0.88, H * 0.58);
  ctx.stroke();

  return new THREE.CanvasTexture(canvas);
}

/**
 * Build the in-world intro title as a flat panel mesh parented to the anchor.
 * Returns the mesh so the master can key its material.opacity over t=0.03–0.05.
 *
 * The panel is sized to be readable from the t=0 overhead camera (~440 world units
 * away). 200×80 world units fills roughly half the horizontal field at that distance.
 */
function buildIntroPanelMesh(texture: THREE.Texture): THREE.Mesh {
  const W = 200; // metres wide — legible from t=0 overhead camera (~440u away)
  const H = 80;  // metres tall (maintains ~2.4:1 aspect ratio of the canvas)
  const geom = new THREE.PlaneGeometry(W, H);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'introTitle';
  return mesh;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IntroSegmentOptions {
  rig: CameraRig;
  bike: BikePath;
  anchors: DisplayAnchors;
  updatables: { update(t: number): void }[];
}

export interface IntroSegmentHandle {
  /**
   * Pulse the intro panel's "SCROLL TO RIDE" opacity.
   * Call each rAF frame while the hint is active (t=0 idle).
   * opacity: 0→1 scale applied on top of the base panel opacity.
   *
   * No-op in non-browser environments.
   */
  pulseScrollHint(opacity: number): void;
}

/**
 * Registers intro segment keys and builds in-world intro title.
 * Returns a handle with `pulseScrollHint` for the scroll-hint idle pulse.
 */
export function registerIntroSegment(opts: IntroSegmentOptions): IntroSegmentHandle {
  const { rig, bike, anchors } = opts;

  // ---- Camera keys ----
  // t=0.00: high overhead, wide establishing shot
  // t=0.04: swooping between two tall buildings
  // t=0.08: low chase 6m behind bike
  rig.addKeys([
    {
      t: 0,
      pose: {
        pos: new THREE.Vector3(120, 190, -60),
        look: new THREE.Vector3(-260, 0, 0),
        fov: 48,
        roll: 0
      }
    },
    {
      t: 0.04,
      pose: {
        pos: new THREE.Vector3(20, 40, -18),
        look: new THREE.Vector3(-280, 0, 0),
        fov: 52,
        roll: 0.02 // slight cant for drama
      },
      ease: (x: number) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    },
    {
      t: 0.08,
      pose: {
        pos: new THREE.Vector3(-272, 2, -6), // 6m behind bike at aboutStart
        look: new THREE.Vector3(-260, 1, 0), // looking ahead toward about start
        fov: 60,
        roll: 0
      },
      ease: (x: number) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    }
  ]);

  // ---- Bike speed keys ----
  bike.addSpeedKeys([
    { t: 0, u: ROUTE_U.introStart },
    { t: 0.10, u: ROUTE_U.aboutStart + 0.02 }
  ]);

  // ---- In-world intro title panel ----
  // Only build when a document/canvas is available (browser, not test environment)
  if (typeof document !== 'undefined') {
    const texture = drawIntroPanel();
    const mesh = buildIntroPanelMesh(texture);

    // Mount to the introOverhead anchor (world position: introStart.x+20, 15, 0 = -280, 15, 0).
    // The t=0 camera is at (120, 190, -60) looking at (-260, 0, 0).
    //
    // Strategy: place the panel near the camera's look-at center and face it toward the camera.
    // The panel is offset in anchor-local space to sit near the look-at point (slightly elevated).
    // Anchor local offset: look-at (-260,0,0) relative to anchor (-280,15,0) = (20,-15,0).
    // Raise by 60 world units so it sits at mid-height in the overhead view: (20, 45, 0).
    mesh.position.set(20, 45, 0);

    // Direction from the mesh's world position to the t=0 camera.
    // Mesh world pos ≈ (-280+20, 15+45, 0) = (-260, 60, 0)
    const meshWorldPos = new THREE.Vector3(-260, 60, 0);
    const cameraPos = new THREE.Vector3(120, 190, -60);
    const toCamera = new THREE.Vector3().subVectors(cameraPos, meshWorldPos).normalize();
    // PlaneGeometry normal is +Z; rotate so +Z aligns with toCamera direction.
    const panelQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      toCamera
    );
    mesh.quaternion.copy(panelQuat);
    const anchor = anchors.introOverhead;
    anchor.add(mesh);

    const mat = mesh.material as THREE.MeshBasicMaterial;

    // Track scroll-hint override opacity (0 = no override, use normal fade logic)
    let scrollHintOpacity: number | null = null;

    // Register as an updatable that handles the t=0.03→0.05 fade-out
    opts.updatables.push({
      update(t: number): void {
        // When the scroll hint pulse is active at t=0, honour the hint opacity
        if (scrollHintOpacity !== null && t <= SCROLL_HINT_T_MAX) {
          mat.opacity = scrollHintOpacity;
          mesh.visible = true;
          return;
        }
        if (t <= 0.03) {
          mat.opacity = 1;
          mesh.visible = true;
        } else if (t >= 0.05) {
          mat.opacity = 0;
          mesh.visible = false;
        } else {
          const fade = 1 - (t - 0.03) / 0.02;
          mat.opacity = Math.max(0, Math.min(1, fade));
          mesh.visible = true;
        }
      }
    });

    return {
      pulseScrollHint(opacity: number): void {
        scrollHintOpacity = Math.max(0, Math.min(1, opacity));
      }
    };
  }

  // Non-browser environment: return a no-op handle
  return {
    pulseScrollHint(_opacity: number): void { /* noop */ }
  };
}
