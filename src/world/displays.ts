/**
 * displays.ts
 *
 * Builds content display surfaces for every DisplayAnchor produced by cityLayout.ts:
 *
 *   aboutHero / aboutSign / research  →  solid neon billboard via buildBillboard()
 *   projBig / projSmall               →  holographic translucent panel with glowing frame
 *
 * Content textures come from contentPanel.ts; résumé data from resume.ts.
 * Reserved palette rule: frame/glow colors use holoTeal/signalMagenta/sodiumAmber/moonlight.
 * NEVER tronCyan.
 */

import * as THREE from 'three';
import { makeRng } from '../utils/rng';
import { COLORS } from '../theme';
import type { DisplayAnchor } from './cityLayout';
import { buildBillboard } from '../assets/billboards/billboards';
import {
  makeAboutHeroTexture,
  makeBioTexture,
  makeProjectTexture,
  makeResearchTexture,
} from '../content/contentPanel';
import { RESUME } from '../content/resume';

// ──────────────────────────────────────────────────────────────────────────────
// Public interface
// ──────────────────────────────────────────────────────────────────────────────

export interface Displays {
  group: THREE.Group;
  updateAmbient(sec: number): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Holographic panel helpers
// ──────────────────────────────────────────────────────────────────────────────

// Panel dimensions in metres for big vs. small holo panels.
const HOLO_BIG_W   = 14;
const HOLO_BIG_H   = 8;
const HOLO_SMALL_W = 8;
const HOLO_SMALL_H = 5;

// Frame border in metres.
const FRAME_THICK = 0.08;

// Holo accent colors — NO tronCyan.
const HOLO_ACCENT: readonly number[] = [
  COLORS.holoTeal,
  COLORS.signalMagenta,
  COLORS.sodiumAmber,
];

/**
 * Derives a per-panel accent color from the texture (if it has a readable canvas)
 * or falls back to a pick from the `HOLO_ACCENT` palette.
 */
function deriveHoloAccent(tex: THREE.Texture, fallback: number): number {
  const img = tex.image as HTMLCanvasElement | undefined;
  try {
    if (img && typeof img.getContext === 'function') {
      const ctx = img.getContext('2d');
      const w = img.width | 0;
      const h = img.height | 0;
      if (ctx && typeof ctx.getImageData === 'function' && w > 4 && h > 4) {
        const d = ctx.getImageData(Math.floor(w * 0.1), Math.floor(h * 0.1), 1, 1).data;
        if (d[0] + d[1] + d[2] > 30) {
          const c = new THREE.Color(d[0] / 255, d[1] / 255, d[2] / 255);
          const hsl = { h: 0, s: 0, l: 0 };
          c.getHSL(hsl);
          c.setHSL(hsl.h, Math.max(hsl.s, 0.5), 0.55);
          return c.getHex();
        }
      }
    }
  } catch {
    // cross-origin or stubbed canvas
  }
  return fallback;
}

/**
 * Builds a holographic panel: a translucent emissive content plane + 4 thin
 * glowing edge bars forming a frame. Returns the group and an update function
 * for the decorative flicker/scanline-scroll effect.
 */
function buildHoloPanel(
  texture: THREE.Texture,
  wM: number,
  hM: number,
  accentColor: number,
  seedOffset: number,
): { group: THREE.Group; updateAmbient: (sec: number) => void } {
  const group = new THREE.Group();

  // --- Content plane ---
  const contentMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const contentPlane = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), contentMat);
  contentPlane.name = 'holo_content';
  group.add(contentPlane);

  // --- Scanline overlay (subtle horizontal stripes) ---
  // Use a very thin emissive plane slightly in front of the content.
  const scanMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(accentColor).multiplyScalar(0.08),
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), scanMat);
  scanPlane.name = 'holo_scan';
  scanPlane.position.z = 0.005;
  group.add(scanPlane);

  // --- Glowing frame (4 edge bars) ---
  const frameMat = new THREE.MeshBasicMaterial({
    color: accentColor,
    fog: false,
  });
  const halfW = wM / 2;
  const halfH = hM / 2;

  // top, bottom, left, right bars
  const barDefs: [number, number, number, number][] = [
    [wM + FRAME_THICK * 2, FRAME_THICK, 0,      halfH],    // top
    [wM + FRAME_THICK * 2, FRAME_THICK, 0,      -halfH],   // bottom
    [FRAME_THICK, hM,                   -halfW, 0],         // left
    [FRAME_THICK, hM,                   halfW,  0],         // right
  ];

  for (const [bw, bh, bx, by] of barDefs) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), frameMat);
    bar.name = 'holo_frame';
    bar.position.set(bx, by, 0.002);
    group.add(bar);
  }

  // --- Corner accent dots ---
  const cornerMat = new THREE.MeshBasicMaterial({ color: accentColor, fog: false });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(FRAME_THICK * 3, FRAME_THICK * 3), cornerMat);
      dot.name = 'holo_corner';
      dot.position.set(sx * halfW, sy * halfH, 0.004);
      group.add(dot);
    }
  }

  // --- Flicker state (wall-clock only, decorative) ---
  const seed = seedOffset * 57.3;

  function hash01(n: number): number {
    const s = Math.sin(n) * 43758.5453;
    return s - Math.floor(s);
  }

  let lastSec = -1;
  let currentFlicker = 1.0;
  let scanOffset = 0;

  function updateAmbient(sec: number): void {
    // Subtle opacity flicker (~every 2s bursts)
    if (Math.abs(sec - lastSec) > 0.04) {
      lastSec = sec;
      const tick = Math.floor(sec * 8);
      const gate = hash01(tick * 113.7 + seed);
      if (gate > 0.88) {
        currentFlicker = 0.78 + 0.18 * hash01(tick * 317.1 + seed);
      } else {
        currentFlicker = 0.96 + 0.04 * Math.sin(sec * 7.3 + seed);
      }
      contentMat.opacity = 0.82 * currentFlicker;

      // Scanline vertical scroll
      scanOffset = (sec * 0.04 + seed * 0.01) % 1;
      scanMat.opacity = 0.18 * currentFlicker;
    }
  }

  return { group, updateAmbient };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main builder
// ──────────────────────────────────────────────────────────────────────────────

const DISPLAYS_RNG_SEED = 0xd15a; // displays rng seed

export function buildDisplays(anchors: DisplayAnchor[]): Displays {
  const rng = makeRng(DISPLAYS_RNG_SEED);
  const rootGroup = new THREE.Group();
  rootGroup.name = 'displays';

  const ambientUpdaters: Array<(sec: number) => void> = [];

  // Count anchors by kind to map them to content slots in order.
  const kindCounters: Record<string, number> = {};

  for (const anchor of anchors) {
    const idx = kindCounters[anchor.kind] ?? 0;
    kindCounters[anchor.kind] = idx + 1;

    let anchorGroup: THREE.Group;
    let ambientFn: ((sec: number) => void) | null = null;

    if (anchor.kind === 'aboutHero') {
      // Solid neon billboard — landscape or portrait hero panel.
      const tex = makeAboutHeroTexture();
      const bb = buildBillboard(rng, {
        format: 'portrait',
        mount: 'wall',
        widthM: 10,
        texture: tex,
      });
      anchorGroup = bb.group;
      ambientFn = bb.updateAmbient;

    } else if (anchor.kind === 'aboutSign') {
      // Solid neon billboard — bio (idx=0) or misc signs (idx=1,2).
      const tex = idx === 0 ? makeBioTexture() : makeBioTexture(); // bio for all aboutSign slots
      const bb = buildBillboard(rng, {
        format: 'landscape',
        mount: 'wall',
        widthM: 7,
        texture: tex,
      });
      anchorGroup = bb.group;
      ambientFn = bb.updateAmbient;

    } else if (anchor.kind === 'research') {
      // Solid neon billboard — research[0] or research[1].
      const researchItems = RESUME.research;
      const item = researchItems[idx % researchItems.length];
      const tex = makeResearchTexture(item);
      const bb = buildBillboard(rng, {
        format: 'landscape',
        mount: 'wall',
        widthM: 12,
        texture: tex,
      });
      anchorGroup = bb.group;
      ambientFn = bb.updateAmbient;

    } else if (anchor.kind === 'projBig') {
      // Holographic panel — projectsMain[0] or projectsMain[1].
      const projects = RESUME.projectsMain;
      const item = projects[idx % projects.length];
      const tex = makeProjectTexture(item);
      const accent = deriveHoloAccent(tex, HOLO_ACCENT[idx % HOLO_ACCENT.length]);
      const holo = buildHoloPanel(tex, HOLO_BIG_W, HOLO_BIG_H, accent, idx);
      anchorGroup = holo.group;
      ambientFn = holo.updateAmbient;

    } else {
      // projSmall — projectsSmall[0], [1], [2].
      const projects = RESUME.projectsSmall;
      const item = projects[idx % projects.length];
      const tex = makeProjectTexture(item);
      const accent = deriveHoloAccent(tex, HOLO_ACCENT[idx % HOLO_ACCENT.length]);
      const holo = buildHoloPanel(tex, HOLO_SMALL_W, HOLO_SMALL_H, accent, idx + 10);
      anchorGroup = holo.group;
      ambientFn = holo.updateAmbient;
    }

    // Place + orient the anchor group at the anchor's world position/quaternion.
    anchorGroup.position.copy(anchor.pos);
    anchorGroup.quaternion.copy(anchor.quat);

    rootGroup.add(anchorGroup);
    if (ambientFn) ambientUpdaters.push(ambientFn);
  }

  return {
    group: rootGroup,
    updateAmbient(sec: number): void {
      for (const fn of ambientUpdaters) fn(sec);
    },
  };
}
