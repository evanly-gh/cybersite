import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { AD_SIZES, makeAd, type AdFormat } from '../../content/adGenerator';

/**
 * Task 13: the billboard system — 5 ad formats x 3 mounts. These are THE vibe
 * carriers of the neon city (spec §5.2): the city will hold ~120 of them, so every
 * build stays within a hard budget of 4 draw calls:
 *
 *   1. screen        — emissive ad plane (the only bright thing)
 *   2. dark merged   — frame box, back-panel greeble, mount structure, ladder,
 *                      catwalk, brackets... every non-emissive part, vertex-colored
 *                      so steel/concrete/rust tints coexist in one material
 *   3. accent merged — tiny amber maintenance lights + roof spotlight cone gizmos
 *   4. glow merged   — additive halo plane behind the screen + downward light-spill
 *                      plane (stand/roof), vertex-alpha gradients, ~12% peak opacity
 *
 * Section-content displays (About / Projects / Research) reuse this module by
 * passing their own `texture` — this is the single screen/frame implementation for
 * the whole site, which is why `setTexture` exists.
 */

export type BillboardMount = 'stand' | 'wall' | 'roof';

export interface BillboardOptions {
  format: AdFormat;
  mount: BillboardMount;
  widthM?: number;
  texture?: THREE.Texture;
}

export interface Billboard {
  group: THREE.Group;
  setTexture(t: THREE.Texture): void;
  updateAmbient(sec: number): void;
}

/** Default screen widths in meters (1 unit = 1 m); heights follow the ad aspect. */
export const DEFAULT_WIDTH_M: Record<AdFormat, number> = {
  landscape: 12,
  portrait: 4.5,
  square: 5,
  strip: 24,
  vcard: 3.6
};

// ---------------------------------------------------------------------------------
// Palette — structure tints derived from theme colors only (lerps between theme
// tokens, same approach streets.ts uses for asphalt/concrete). Emissive/glow colors
// are strictly magenta/amber/teal families; tron-cyan is reserved for the biker.
// ---------------------------------------------------------------------------------

function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

// Iteration 2: steels lightened (round-1 renders showed mounts vanishing into pure
// black even under the viewer's key light — the silhouette must read at night).
const STEEL = mix(COLORS.shadowBlue, COLORS.moonlight, 0.16);
const STEEL_DARK = mix(COLORS.shadowBlue, COLORS.moonlight, 0.06);
const FRAME_DARK = mix(COLORS.shadowBlue, COLORS.void, 0.55);
const CONCRETE = mix(COLORS.shadowBlue, COLORS.moonlight, 0.22);
const RUST = mix(COLORS.sodiumAmber, COLORS.void, 0.68);
const HAZARD_AMBER = mix(COLORS.sodiumAmber, COLORS.void, 0.25);
const DEAD_PIXEL = mix(COLORS.void, COLORS.shadowBlue, 0.35);

const GLOW_FAMILIES: readonly number[] = [COLORS.signalMagenta, COLORS.sodiumAmber, COLORS.holoTeal];

/**
 * Iteration 3: derive the halo/spill/trim color from the ad texture itself (round-2
 * renders showed e.g. a magenta light-spill under a teal screen — real signage light
 * matches its source). Samples a few pixels off the texture's backing canvas and
 * lifts them to neon luminance; falls back to the rng family pick when the texture
 * has no readable 2D canvas (render targets, image bitmaps, test stubs).
 */
function deriveGlowColor(tex: THREE.Texture, fallback: number): number {
  const img = tex.image as HTMLCanvasElement | undefined;
  try {
    if (img && typeof img.getContext === 'function') {
      const ctx = img.getContext('2d');
      const w = img.width | 0;
      const h = img.height | 0;
      if (ctx && typeof ctx.getImageData === 'function' && w > 4 && h > 4) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (const [u, v] of [
          [0.12, 0.15],
          [0.5, 0.5],
          [0.88, 0.85]
        ]) {
          const d = ctx.getImageData(Math.floor(u * (w - 1)), Math.floor(v * (h - 1)), 1, 1).data;
          r += d[0];
          g += d[1];
          b += d[2];
        }
        if (r + g + b > 45) {
          const c = new THREE.Color(r / 765, g / 765, b / 765);
          const hsl = { h: 0, s: 0, l: 0 };
          c.getHSL(hsl);
          c.setHSL(hsl.h, Math.min(1, Math.max(hsl.s, 0.45)), 0.6);
          return c.getHex();
        }
      }
    }
  } catch {
    /* cross-origin or stubbed canvas — fall through to the family pick */
  }
  return fallback;
}

// ---------------------------------------------------------------------------------
// Merge plumbing — clones of shared unit geometries, per-part vertex colors, one
// mergeGeometries call per material category => one real draw call each.
// ---------------------------------------------------------------------------------

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).toNonIndexed();
const UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 10).toNonIndexed();

interface Part {
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  color: number;
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function box(
  list: Part[],
  color: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  ry = 0,
  rz = 0
): void {
  _euler.set(rx, ry, rz);
  _quat.setFromEuler(_euler);
  _pos.set(x, y, z);
  _scale.set(sx, sy, sz);
  list.push({ geom: UNIT_BOX, matrix: new THREE.Matrix4().compose(_pos, _quat, _scale), color });
}

function cyl(
  list: Part[],
  color: number,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  rx = 0,
  rz = 0
): void {
  _euler.set(rx, 0, rz);
  _quat.setFromEuler(_euler);
  _pos.set(x, y, z);
  _scale.set(radius * 2, height, radius * 2);
  list.push({ geom: UNIT_CYL, matrix: new THREE.Matrix4().compose(_pos, _quat, _scale), color });
}

/** Box strut from point a to point b (Y axis of the unit box aligned to a->b). */
function strut(list: Part[], color: number, a: THREE.Vector3, b: THREE.Vector3, thick: number): void {
  const dir = b.clone().sub(a);
  const len = dir.length();
  if (len < 1e-6) return;
  dir.divideScalar(len);
  _quat.setFromUnitVectors(Y_AXIS, dir);
  _pos.copy(a).add(b).multiplyScalar(0.5);
  _scale.set(thick, len, thick);
  list.push({ geom: UNIT_BOX, matrix: new THREE.Matrix4().compose(_pos, _quat, _scale), color });
}

/** Emissive cone gizmo centered at `pos`, unit-cone +Y axis aimed along `dir`. */
function cone(list: Part[], color: number, pos: THREE.Vector3, dir: THREE.Vector3, radius: number, height: number): void {
  _quat.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
  _scale.set(radius * 2, height, radius * 2);
  list.push({ geom: UNIT_CONE, matrix: new THREE.Matrix4().compose(pos, _quat, _scale), color });
}

/** Merges parts into one mesh with baked per-part vertex colors (RGB). */
function mergeParts(parts: Part[], material: THREE.Material): THREE.Mesh {
  const geoms = parts.map((p) => {
    const g = p.geom.clone();
    g.applyMatrix4(p.matrix);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color(p.color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geoms);
  if (!merged) throw new Error('billboards: failed to merge parts');
  for (const g of geoms) g.dispose();
  return new THREE.Mesh(merged, material);
}

// ---------------------------------------------------------------------------------
// Glow planes — RGBA vertex colors (itemSize 4 => three.js vertex alpha) so the halo
// and the light-spill gradient merge into ONE additive draw call.
// ---------------------------------------------------------------------------------

interface GlowPart {
  geom: THREE.BufferGeometry;
}

/**
 * Halo plane 15% larger than the screen, just behind the frame body: its rim extends
 * past the frame silhouette and reads as area-light fill leaking around the billboard.
 * Radial vertex-alpha falloff, ~12% peak opacity — subtle by design (house rule:
 * screens bright, halos subtle).
 */
function haloPlane(w: number, h: number, z: number, color: number, peak = 0.12): GlowPart {
  const g = new THREE.PlaneGeometry(w * 1.15, h * 1.15, 8, 8);
  const posAttr = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const count = posAttr.count;
  const colors = new Float32Array(count * 4);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    const u = uv.getX(i) * 2 - 1;
    const v = uv.getY(i) * 2 - 1;
    const d = Math.min(1, Math.sqrt(u * u + v * v));
    const a = peak * Math.pow(1 - d, 1.6);
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  g.translate(0, 0, z);
  return { geom: g.toNonIndexed() };
}

/**
 * Downward "light spill" sheet: a gradient quad slanting from the screen's bottom lip
 * down/forward to the ground plane, brightest at the screen, alpha->0 at the ground.
 * Only stand/roof mounts get one (wall billboards spill onto the wall via the halo).
 */
function spillPlane(
  w: number,
  yTop: number,
  zTop: number,
  yBot: number,
  zBot: number,
  color: number,
  peak = 0.13 // it2: 0.10 invisible; it3: 0.16 read as a solid curtain on tall screens
): GlowPart {
  const g = new THREE.PlaneGeometry(1, 1, 4, 6);
  const posAttr = g.getAttribute('position');
  const count = posAttr.count;
  const colors = new Float32Array(count * 4);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    const nx = posAttr.getX(i); // -0.5..0.5
    const t = posAttr.getY(i) + 0.5; // 0 bottom .. 1 top
    posAttr.setXYZ(
      i,
      nx * w,
      THREE.MathUtils.lerp(yBot, yTop, t),
      THREE.MathUtils.lerp(zBot, zTop, t)
    );
    // it3: stronger edge falloff — hard side edges made the spill read as a slab
    const edgeFade = 1 - Math.pow(Math.abs(nx) * 2, 1.6) * 0.85;
    const a = peak * Math.pow(t, 1.5) * edgeFade;
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = a;
  }
  posAttr.needsUpdate = true;
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return { geom: g.toNonIndexed() };
}

function mergeGlow(parts: GlowPart[], material: THREE.Material): THREE.Mesh {
  const merged = mergeGeometries(parts.map((p) => p.geom));
  if (!merged) throw new Error('billboards: failed to merge glow parts');
  return new THREE.Mesh(merged, material);
}

// ---------------------------------------------------------------------------------
// Deterministic flicker noise — hash bursts keyed to integer ticks of `sec` so the
// screenshot harness (?sec=) reproduces exact frames.
// ---------------------------------------------------------------------------------

function hash01(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

/** Neon-flicker level in [0.12, 1]: mostly a subtle shimmer, occasional hard dropouts. */
function flickerLevel(sec: number, seed: number): number {
  const t = sec * 24;
  const tick = Math.floor(t);
  const gate = hash01(tick * 127.1 + seed);
  if (gate > 0.8) {
    // dropout burst — depth varies per tick, sometimes near-black
    const depth = hash01(tick * 311.7 + seed * 1.7);
    return 0.12 + 0.55 * depth;
  }
  return 0.92 + 0.08 * Math.sin(sec * 9 + seed);
}

// ---------------------------------------------------------------------------------
// Screen assembly — everything attached to the screen box itself, built in
// screen-local coordinates (screen center at origin, facing +Z), then transformed
// into place by `placement` (translation + optional Y rotation for flag mounts).
// ---------------------------------------------------------------------------------

interface ScreenSpec {
  w: number;
  h: number;
  frameDepth: number;
  lip: number;
}

function buildScreenAssembly(
  rng: Rng,
  spec: ScreenSpec,
  dark: Part[],
  accent: Part[],
  glow: GlowPart[],
  glowColor: number
): void {
  const { w, h, frameDepth, lip } = spec;
  const backZ = -frameDepth / 2;

  // Frame body: one dark box behind the screen plane.
  box(dark, FRAME_DARK, 0, 0, 0, w + lip * 2, h + lip * 2, frameDepth);

  // Corner mount brackets — small proud steel angle plates.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      box(
        dark,
        STEEL,
        sx * (w / 2 + lip * 0.4),
        sy * (h / 2 + lip * 0.4),
        0,
        0.22,
        0.22,
        frameDepth + 0.06
      );
    }
  }

  // Back-panel greeble: ribs (horizontal for wide formats, vertical for tall).
  const wide = w >= h;
  const nRibs = rng.int(3, 6);
  for (let i = 0; i < nRibs; i++) {
    const f = (i + 0.5) / nRibs - 0.5;
    if (wide) {
      box(dark, STEEL_DARK, 0, f * h * 0.9, backZ - 0.05, w * 0.92, 0.09, 0.1);
    } else {
      box(dark, STEEL_DARK, f * w * 0.9, 0, backZ - 0.05, 0.09, h * 0.92, 0.1);
    }
  }

  // Junction box + cable drop hanging off the back panel.
  const jx = rng.range(-w * 0.32, w * 0.32);
  const jy = rng.range(-h * 0.4, -h * 0.05);
  box(dark, STEEL_DARK, jx, jy, backZ - 0.16, 0.45, 0.6, 0.22);
  cyl(dark, FRAME_DARK, jx, jy - 0.3 - (h * 0.4) / 2, backZ - 0.14, 0.035, h * 0.4);

  // 2-4 tiny amber maintenance lights along the top frame edge.
  const nLights = rng.int(2, 4);
  for (let i = 0; i < nLights; i++) {
    const f = nLights === 1 ? 0 : (i / (nLights - 1) - 0.5) * 0.82;
    const lx = f * w;
    const topY = h / 2 + lip;
    box(dark, STEEL_DARK, lx, topY + 0.09, 0.05, 0.06, 0.18, 0.06);
    box(accent, COLORS.sodiumAmber, lx, topY + 0.21, 0.05, 0.1, 0.07, 0.1);
  }

  // Iteration 2: neon trim tube around the frame in the billboard's glow family —
  // round-1 renders showed the "thin dark frame" reading as nothing at all at night;
  // the classic cyberpunk sign has a lit border giving the frame its silhouette.
  // rng picks full perimeter vs. top+bottom rails only.
  // (Iteration 3: tube thinned 0.06 -> 0.04 — round-2 renders showed the border
  // blooming into a fat fairy-light blob instead of a crisp neon line.)
  const trimZ = frameDepth / 2 + 0.008;
  const tw2 = w + lip * 2;
  const th2 = h + lip * 2;
  const tube = 0.04;
  box(accent, glowColor, 0, th2 / 2 - tube, trimZ, tw2 * 0.995, tube, 0.03);
  box(accent, glowColor, 0, -th2 / 2 + tube, trimZ, tw2 * 0.995, tube, 0.03);
  if (rng.chance(0.65)) {
    box(accent, glowColor, tw2 / 2 - tube, 0, trimZ, tube, th2 * 0.995, 0.03);
    box(accent, glowColor, -tw2 / 2 + tube, 0, trimZ, tube, th2 * 0.995, 0.03);
  }

  // Halo — the fake area-light fill (additive, subtle) just behind the frame body.
  glow.push(haloPlane(w, h, backZ - 0.03, glowColor));

  // Rust streaks bleeding down from the frame's bottom corners and bracket welds —
  // thin weathering plates just proud of the frame's front face.
  const nStreaks = rng.int(2, 4);
  for (let i = 0; i < nStreaks; i++) {
    const sx = rng.range(-w * 0.46, w * 0.46);
    const streakH = rng.range(0.3, 0.9);
    box(
      dark,
      RUST,
      sx,
      -h / 2 - lip + 0.02 - streakH / 2,
      frameDepth / 2 - 0.14,
      rng.range(0.12, 0.3),
      streakH,
      0.03
    );
  }

  // One unlucky screen in ~14 gets a dead-pixel band: a dark strip floating a few mm
  // in front of the emissive plane (0 extra draw calls — it lives in the dark merge).
  if (rng.chance(0.07)) {
    const bandY = rng.range(-h * 0.35, h * 0.35);
    box(dark, DEAD_PIXEL, 0, bandY, frameDepth / 2 + 0.016, w * rng.range(0.55, 0.98), h * rng.range(0.04, 0.09), 0.004);
  }

  // Pigeon row — a few small dark blobs perched on the top edge (~40% of builds).
  if (rng.chance(0.4)) {
    const nBirds = rng.int(2, 5);
    for (let i = 0; i < nBirds; i++) {
      const px = rng.range(-w * 0.45, w * 0.45);
      const topY = h / 2 + lip;
      box(dark, STEEL_DARK, px, topY + 0.07, rng.range(-0.05, 0.08), 0.09, 0.12, 0.16);
      box(dark, STEEL_DARK, px + 0.05, topY + 0.16, 0.06, 0.05, 0.06, 0.06); // head
    }
  }
}

/** Applies placement (rotation about Y + translation) to every part added after `from`. */
function place(parts: Part[], from: number, placement: THREE.Matrix4): void {
  for (let i = from; i < parts.length; i++) parts[i].matrix.premultiply(placement);
}

function placeGlow(parts: GlowPart[], from: number, placement: THREE.Matrix4): void {
  for (let i = from; i < parts.length; i++) parts[i].geom.applyMatrix4(placement);
}

// ---------------------------------------------------------------------------------
// Mounts
// ---------------------------------------------------------------------------------

/** Freestanding: steel post(s) + cross bracing + base plates + service ladder. */
function buildStand(rng: Rng, spec: ScreenSpec, dark: Part[], glow: GlowPart[], glowColor: number): THREE.Matrix4 {
  const { w, h, frameDepth } = spec;
  const clearance = spec.w >= 18 ? rng.range(4.6, 5.4) : rng.range(2.6, 3.4);
  const cy = clearance + h / 2;
  const placement = new THREE.Matrix4().makeTranslation(0, cy, 0);

  const twoPosts = w >= 8 ? true : rng.chance(0.4);
  const postZ = -frameDepth / 2 - 0.28;
  const postTop = cy + h * 0.3;
  const postXs = twoPosts ? [-(w / 2 - Math.min(1.6, w * 0.16)), w / 2 - Math.min(1.6, w * 0.16)] : [0];

  for (const px of postXs) {
    box(dark, STEEL, px, postTop / 2, postZ, 0.42, postTop, 0.36);
    // base plate + anchor bolts
    box(dark, CONCRETE, px, 0.05, postZ, 1.15, 0.1, 0.95);
    // Iteration 2: amber hazard bands wrapping the post base (street-furniture
    // detail — round-1 renders showed post bases as featureless black stubs).
    box(dark, HAZARD_AMBER, px, 0.55, postZ, 0.46, 0.16, 0.4);
    box(dark, HAZARD_AMBER, px, 0.95, postZ, 0.46, 0.16, 0.4);
    for (const bx of [-0.42, 0.42]) {
      for (const bz of [-0.32, 0.32]) {
        box(dark, STEEL_DARK, px + bx, 0.13, postZ + bz, 0.08, 0.07, 0.08);
      }
    }
    // connector stubs post -> frame back
    box(dark, STEEL_DARK, px, cy + h * 0.25, postZ + 0.2, 0.3, 0.24, 0.24);
    box(dark, STEEL_DARK, px, cy - h * 0.25, postZ + 0.2, 0.3, 0.24, 0.24);
    // cable conduit running down the post face, with couplers
    cyl(dark, FRAME_DARK, px + 0.26, postTop * 0.5, postZ, 0.05, postTop * 0.96);
    const nCouplers = Math.max(2, Math.floor(postTop / 1.6));
    for (let i = 1; i <= nCouplers; i++) {
      cyl(dark, STEEL_DARK, px + 0.26, (postTop * 0.96 * i) / (nCouplers + 1), postZ, 0.075, 0.09);
    }
  }

  if (twoPosts) {
    const [a, b] = postXs;
    const midY = clearance * 0.55;
    box(dark, STEEL_DARK, 0, midY, postZ, b - a, 0.22, 0.22);
    // X diagonal braces between posts
    strut(dark, STEEL_DARK, new THREE.Vector3(a, midY, postZ), new THREE.Vector3(b, clearance * 0.98, postZ), 0.12);
    strut(dark, STEEL_DARK, new THREE.Vector3(b, midY, postZ), new THREE.Vector3(a, clearance * 0.98, postZ), 0.12);
  } else {
    // single pole: T spreader behind the frame + two diagonal struts
    box(dark, STEEL_DARK, 0, cy, postZ + 0.1, Math.min(w * 0.7, 4), 0.26, 0.2);
    strut(
      dark,
      STEEL_DARK,
      new THREE.Vector3(0, clearance * 0.7, postZ),
      new THREE.Vector3(Math.min(w * 0.3, 1.6), cy - h * 0.2, postZ + 0.08),
      0.1
    );
    strut(
      dark,
      STEEL_DARK,
      new THREE.Vector3(0, clearance * 0.7, postZ),
      new THREE.Vector3(-Math.min(w * 0.3, 1.6), cy - h * 0.2, postZ + 0.08),
      0.1
    );
  }

  // Service ladder up the first post (rails + rungs).
  const lpx = postXs[0];
  const ladderZ = postZ - 0.42;
  const ladderTop = clearance + 0.4;
  for (const rx of [-0.2, 0.2]) {
    box(dark, STEEL_DARK, lpx + rx, ladderTop / 2 + 0.2, ladderZ, 0.06, ladderTop - 0.4 + 0.4, 0.06);
  }
  for (let y = 0.45; y < ladderTop; y += 0.36) {
    box(dark, STEEL_DARK, lpx, y, ladderZ, 0.44, 0.05, 0.05);
  }

  // Light spill: screen bottom lip down/forward to the ground.
  glow.push(
    spillPlane(w * 0.95, cy - h / 2 - 0.1, frameDepth / 2 + 0.05, 0.02, frameDepth / 2 + clearance * 0.6, glowColor)
  );

  return placement;
}

/** Building-side: flush standoff brackets, or a perpendicular flag arm (portrait/vcard). */
function buildWall(
  rng: Rng,
  spec: ScreenSpec,
  format: AdFormat,
  dark: Part[],
  glow: GlowPart[],
  glowColor: number
): { placement: THREE.Matrix4; screenRotY: number } {
  const { w, h, frameDepth, lip } = spec;
  const canFlag = format === 'portrait' || format === 'vcard';
  const flag = canFlag && rng.chance(0.5);

  if (!flag) {
    // Flush: screen floats `standoff` off the wall (wall = z=0 plane, faces +Z).
    const standoff = 0.32;
    const zC = standoff + frameDepth / 2;
    const placement = new THREE.Matrix4().makeTranslation(0, 0, zC);
    const nPerSide = w >= 10 ? 3 : 2;
    for (let i = 0; i < nPerSide; i++) {
      const fx = (i / (nPerSide - 1) - 0.5) * (w * 0.8);
      for (const sy of [-1, 1]) {
        box(dark, STEEL, fx, sy * h * 0.38, standoff / 2, 0.16, 0.16, standoff + 0.08);
        box(dark, STEEL_DARK, fx, sy * h * 0.38, 0.03, 0.32, 0.32, 0.06); // wall plate
      }
    }
    return { placement, screenRotY: 0 };
  }

  // Flag mount: screen perpendicular to the wall, hung off two horizontal arms.
  const gap = 0.5;
  const zC = gap + w / 2;
  const rotY = -Math.PI / 2; // screen normal -> +X
  const placement = new THREE.Matrix4()
    .makeRotationY(rotY)
    .premultiply(new THREE.Matrix4().makeTranslation(0, 0, zC));
  const armY = [h / 2 + lip * 0.5, -h / 2 - lip * 0.5];
  for (const ay of armY) {
    box(dark, STEEL, 0, ay, (gap + w) / 2, 0.14, 0.14, gap + w + 0.2);
  }
  box(dark, STEEL_DARK, 0, 0, 0.06, 0.5, h * 0.7, 0.12); // wall mounting plate
  // diagonal tie from wall above down to the outer top arm end
  strut(
    dark,
    STEEL_DARK,
    new THREE.Vector3(0, h / 2 + lip + 1.1, 0.05),
    new THREE.Vector3(0, armY[0], gap + w * 0.85),
    0.09
  );
  return { placement, screenRotY: rotY };
}

/** Rooftop: A-frame truss + catwalk with railing + 2 spotlight arms w/ cone gizmos. */
function buildRoof(
  rng: Rng,
  spec: ScreenSpec,
  dark: Part[],
  accent: Part[],
  glow: GlowPart[],
  glowColor: number
): THREE.Matrix4 {
  const { w, h, frameDepth, lip } = spec;
  const screenBottom = rng.range(1.3, 2.0);
  const cy = screenBottom + h / 2;
  const yTop = cy + h / 2 + lip;
  const placement = new THREE.Matrix4().makeTranslation(0, cy, 0);

  const backReach = -Math.max(2, h * 0.55);
  const nLegs = Math.max(2, Math.round(w / 6) + 1);
  const legSpan = w * 0.86;
  for (let i = 0; i < nLegs; i++) {
    const lx = nLegs === 1 ? 0 : (i / (nLegs - 1) - 0.5) * legSpan;
    // vertical member under the frame
    box(dark, STEEL, lx, yTop / 2, -frameDepth / 2 - 0.2, 0.22, yTop, 0.22);
    // diagonal back leg (the "A")
    strut(
      dark,
      STEEL,
      new THREE.Vector3(lx, 0.1, backReach),
      new THREE.Vector3(lx, yTop * 0.92, -frameDepth / 2 - 0.24),
      0.18
    );
    // roof feet
    box(dark, CONCRETE, lx, 0.08, -frameDepth / 2 - 0.2, 0.55, 0.16, 0.5);
    box(dark, CONCRETE, lx, 0.08, backReach, 0.55, 0.16, 0.5);
  }
  // horizontal chords tying the legs together
  box(dark, STEEL_DARK, 0, 0.35, -frameDepth / 2 - 0.2, legSpan + 0.3, 0.14, 0.14);
  box(dark, STEEL_DARK, 0, yTop * 0.5, -frameDepth / 2 - 0.2, legSpan + 0.3, 0.14, 0.14);
  box(dark, STEEL_DARK, 0, 0.35, backReach, legSpan + 0.3, 0.14, 0.14);

  // Catwalk along the screen's bottom edge (front) + railing.
  const walkY = screenBottom - 0.5;
  const walkZ = frameDepth / 2 + 0.42;
  box(dark, STEEL_DARK, 0, walkY, walkZ, w + 1, 0.07, 0.75);
  const nPosts = Math.max(2, Math.round(w / 2.2));
  for (let i = 0; i <= nPosts; i++) {
    const px = (i / nPosts - 0.5) * w;
    box(dark, STEEL_DARK, px, walkY + 0.45, walkZ + 0.32, 0.05, 0.9, 0.05);
  }
  box(dark, STEEL_DARK, 0, walkY + 0.9, walkZ + 0.32, w + 1, 0.06, 0.06); // top rail
  box(dark, STEEL_DARK, 0, walkY + 0.5, walkZ + 0.32, w + 1, 0.04, 0.04); // mid rail

  // Iteration 3: magenta hazard beacon on the frame top — rooftop billboards sit at
  // skyline height; aircraft-warning beacons are standard cyberpunk rooftop grammar.
  box(dark, STEEL_DARK, 0, yTop + 0.14, -frameDepth / 2 - 0.2, 0.07, 0.28, 0.07);
  box(accent, COLORS.signalMagenta, 0, yTop + 0.34, -frameDepth / 2 - 0.2, 0.13, 0.13, 0.13);

  // 2 spotlight arms reaching forward/up from the frame top, cones aimed at screen.
  for (const sx of [-1, 1]) {
    const ax = sx * w * 0.3;
    const armEnd = new THREE.Vector3(ax, yTop + 0.75, 1.15);
    strut(dark, STEEL_DARK, new THREE.Vector3(ax, yTop - 0.1, 0.05), armEnd, 0.09);
    box(dark, STEEL_DARK, armEnd.x, armEnd.y, armEnd.z, 0.3, 0.24, 0.3);
    const aim = new THREE.Vector3(ax * 0.5, cy + h * 0.1, frameDepth / 2)
      .sub(armEnd)
      .normalize();
    cone(accent, COLORS.sodiumAmber, armEnd.clone().add(aim.clone().multiplyScalar(0.28)), aim, 0.16, 0.34);
  }

  // Light spill: screen bottom lip down to the roof surface in front.
  glow.push(
    spillPlane(w * 0.95, screenBottom - 0.1, frameDepth / 2 + 0.05, 0.05, frameDepth / 2 + screenBottom * 0.9 + 0.8, glowColor)
  );

  return placement;
}

// ---------------------------------------------------------------------------------
// buildBillboard — the binding interface.
// ---------------------------------------------------------------------------------

export function buildBillboard(rng: Rng, o: BillboardOptions): Billboard {
  const format = o.format;
  const w = o.widthM ?? DEFAULT_WIDTH_M[format];
  const [tw, th] = AD_SIZES[format];
  const h = (w * th) / tw;

  const spec: ScreenSpec = {
    w,
    h,
    frameDepth: THREE.MathUtils.clamp(0.25 + w * 0.012, 0.28, 0.6),
    lip: THREE.MathUtils.clamp(0.1 + w * 0.012, 0.12, 0.3)
  };

  // Texture first: the glow color is sampled from it. The family pick is ALWAYS
  // drawn so the rng stream stays identical whether or not sampling succeeds.
  const texture = o.texture ?? makeAd(format, rng);
  const glowColor = deriveGlowColor(texture, rng.pick(GLOW_FAMILIES));
  const dark: Part[] = [];
  const accent: Part[] = [];
  const glow: GlowPart[] = [];

  // --- mount first (it decides where the screen sits) ------------------------------
  let placement: THREE.Matrix4;
  let screenRotY = 0;
  if (o.mount === 'stand') {
    placement = buildStand(rng, spec, dark, glow, glowColor);
  } else if (o.mount === 'roof') {
    placement = buildRoof(rng, spec, dark, accent, glow, glowColor);
  } else {
    const res = buildWall(rng, spec, format, dark, glow, glowColor);
    placement = res.placement;
    screenRotY = res.screenRotY;
  }

  // --- screen assembly in screen-local space, then placed --------------------------
  const darkFrom = dark.length;
  const accentFrom = accent.length;
  const glowFrom = glow.length;
  buildScreenAssembly(rng, spec, dark, accent, glow, glowColor);
  place(dark, darkFrom, placement);
  place(accent, accentFrom, placement);
  placeGlow(glow, glowFrom, placement);

  // --- behaviors decided at build time (all rng draws happen NOW, not in update) ---
  const flickers = rng.chance(0.08);
  const flickerSeed = rng.range(0, 100);
  const scrolls = format === 'strip' && rng.chance(0.5);

  // --- materials & meshes -----------------------------------------------------------
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 1.15,
    roughness: 0.4,
    metalness: 0,
    side: screenRotY !== 0 ? THREE.DoubleSide : THREE.FrontSide
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat);
  screen.name = 'screen';
  const screenLocal = new THREE.Matrix4().makeTranslation(0, 0, spec.frameDepth / 2 + 0.012);
  screenLocal.premultiply(placement);
  screenLocal.decompose(screen.position, screen.quaternion, screen.scale);

  const darkMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.3
  });
  const structure = mergeParts(dark, darkMat);
  structure.name = 'structure';

  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  });
  const glowMesh = mergeGlow(glow, glowMat);
  glowMesh.name = 'glow';
  glowMesh.renderOrder = 2;

  const group = new THREE.Group();
  group.add(structure, screen, glowMesh);

  if (accent.length > 0) {
    // Unlit + vertex-colored so amber maintenance dots, the family-colored neon
    // trim and the spotlight cones share ONE draw call with distinct colors; the
    // >1 base color pushes them over the bloom threshold like true emissives.
    const accentMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    accentMat.color.setScalar(1.55); // iteration 3: 2.0 over-bloomed the trim
    const accents = mergeParts(accent, accentMat);
    accents.name = 'accents';
    group.add(accents);
  }

  group.userData.format = format;
  group.userData.mount = o.mount;
  group.userData.scroll = scrolls;
  group.userData.flickers = flickers;

  let screenTex: THREE.Texture = texture;
  // The default screen texture is created internally (via makeAd) and is
  // owned by this module; a caller-provided texture (o.texture) is not.
  let screenTexOwned = o.texture === undefined;
  function applyScrollWrap(t: THREE.Texture): void {
    if (scrolls) {
      t.wrapS = THREE.RepeatWrapping;
      t.needsUpdate = true;
    }
  }
  applyScrollWrap(screenTex);

  function setTexture(t: THREE.Texture): void {
    if (screenTexOwned && screenTex !== t) {
      screenTex.dispose();
    }
    screenTex = t;
    screenTexOwned = false;
    applyScrollWrap(t);
    screenMat.emissiveMap = t;
    screenMat.needsUpdate = true;
  }

  const baseIntensity = screenMat.emissiveIntensity;
  function updateAmbient(sec: number): void {
    if (flickers) {
      const level = flickerLevel(sec, flickerSeed);
      screenMat.emissiveIntensity = baseIntensity * level;
      glowMat.opacity = level;
    }
    if (scrolls) {
      screenTex.offset.x = (sec * 0.02) % 1;
    }
  }

  return { group, setTexture, updateAmbient };
}
