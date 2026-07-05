import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import type { GeometryPart } from '../../utils/merge';
import { makeCanvasTexture } from '../../utils/canvasText';
import { makeAd } from '../../content/adGenerator';
import {
  FLOOR_H,
  boxPart,
  mergeOne,
  addTierFacades,
  makeWindowTexture,
  makeWindowMat,
  makeGlowMat,
  makeBodyMat
} from './tall';

/**
 * Task 11: the street-life set — storefront row, fancy restaurant, ramen shop, bar.
 * These are the four buildings the camera passes CLOSEST to, so they carry the
 * highest detail-per-meter of any building task (Jesse Zhou ramen-shop-asset density
 * is the reference). Every venue exports `userData.seats`: an array of bare
 * `THREE.Object3D` anchor nodes (no geometry of their own) at seated-hip-height
 * (~0.45m) with **local +Z = the direction the seated person faces** — Task 17's city
 * assembly parents a person rig directly onto each anchor. `userData.roofY` and
 * `userData.footprint` follow the tall.ts/special.ts contract so rooftop-clutter and
 * placement code can treat every building module uniformly.
 *
 * Draw-call budget (house rule): storefront row <=6, the three venues <=8 (extra
 * seating/signage detail earns the higher cap). Every category below is merged into
 * ONE mesh with ONE material via `mergeOne` (same trick as tall.ts/special.ts).
 */

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

// ---------------------------------------------------------------------------------
// Shared small helpers
// ---------------------------------------------------------------------------------

/** Adds a solid per-geometry vertex color so many differently-tinted boxes (awnings,
 *  sandwich boards) can still share ONE draw call via a `vertexColors: true` material. */
function withVertexColor<T extends THREE.BufferGeometry>(geom: T, colorHex: number): T {
  const c = new THREE.Color(colorHex);
  const pos = geom.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geom;
}

function makeVertexColorMat(roughness = 0.7): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0.1 });
}

function makeEmissiveMapMat(tex: THREE.Texture, intensity = 2.0, doubleSide = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: intensity,
    roughness: 0.9,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide
  });
}

/** Additive, transparent ground-glow material for soft light-spill pools (sidewalk
 *  spill, vending-machine wash) — reads as a soft pool rather than a solid card. */
function makeSpillMat(tex: THREE.Texture, intensity = 1.0): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: intensity,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
}

/** Emissive-sphere light string between two points, sagging like a hung cable/garland
 *  (a parabolic droop reads identically to a true catenary at this scale). */
function addLightString(
  parts: GeometryPart[],
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  sag: number,
  count: number,
  r = 0.08
): void {
  const sphere = new THREE.SphereGeometry(r, 6, 5);
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = THREE.MathUtils.lerp(p0.x, p1.x, t);
    const y = THREE.MathUtils.lerp(p0.y, p1.y, t) - sag * Math.sin(Math.PI * t);
    const z = THREE.MathUtils.lerp(p0.z, p1.z, t);
    parts.push({ geom: sphere, matrix: new THREE.Matrix4().makeTranslation(x, y, z), mat: 0 });
  }
}

/** Dark plain cable, slightly sagging, strung between two points — used for hanging
 *  power/signal lines between shop fronts (round-2 street-clutter detail). */
function addCableSag(parts: GeometryPart[], p0: THREE.Vector3, p1: THREE.Vector3, sag: number, segs = 6, r = 0.03): void {
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const a = new THREE.Vector3(
      THREE.MathUtils.lerp(p0.x, p1.x, t0),
      THREE.MathUtils.lerp(p0.y, p1.y, t0) - sag * Math.sin(Math.PI * t0),
      THREE.MathUtils.lerp(p0.z, p1.z, t0)
    );
    const b = new THREE.Vector3(
      THREE.MathUtils.lerp(p0.x, p1.x, t1),
      THREE.MathUtils.lerp(p0.y, p1.y, t1) - sag * Math.sin(Math.PI * t1),
      THREE.MathUtils.lerp(p0.z, p1.z, t1)
    );
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
    const geom = new THREE.CylinderGeometry(r, r, len, 4);
    parts.push({ geom, matrix: new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)), mat: 0 });
  }
}

/** Slouched trash bag (two stacked spheres, slightly squashed) at street level. */
function addTrashBag(parts: GeometryPart[], x: number, z: number, rng: Rng): void {
  const s = rng.range(0.28, 0.4);
  const geom = new THREE.SphereGeometry(s, 6, 5);
  parts.push({
    geom,
    matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(x, s * 0.6, z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 0.72, 1)
    ),
    mat: 0
  });
}

/** Wall-mounted junction box + a couple of proud conduit pipes — round-2 grime detail
 *  that reads at the close range these buildings are seen from. */
function addWallPipes(parts: GeometryPart[], x: number, z: number, h: number, rotY: number, rng: Rng): void {
  parts.push(boxPart(new THREE.Vector3(x, h * rng.range(0.55, 0.8), z), new THREE.Vector3(0.3, 0.4, 0.14), rotY));
  const n = rng.int(1, 2);
  for (let i = 0; i < n; i++) {
    parts.push(
      boxPart(new THREE.Vector3(x + (i - 0.5) * 0.18, h * 0.35, z), new THREE.Vector3(0.06, h * 0.7, 0.06), rotY)
    );
  }
}

/** Neon marquee text. Round-2 fix: v1 used a heavy `ctx.shadowBlur` on the fillText
 *  call to fake a neon glow; combined with the "Unbounded" display font at large sizes
 *  this rendered as a striped/hatched smear instead of legible letterforms (canvas
 *  shadow-blur + custom variable-font glyphs is not a reliable combination). Now the
 *  texture itself is perfectly crisp — the real glow comes entirely from the engine's
 *  bloom pass acting on the emissive material, which is what every other sign in this
 *  file already relies on. */
function makeNeonTextTexture(text: string, color: number, sub?: string, weight: 'thin' | 'bold' = 'bold'): THREE.CanvasTexture {
  const w = 1024;
  const h = 256;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${weight === 'thin' ? '300' : 'bold'} ${h * (weight === 'thin' ? 0.32 : 0.4)}px "Unbounded"`;
    ctx.fillStyle = hex(color);
    ctx.fillText(text, w / 2, h * 0.45);
    if (sub) {
      ctx.font = `${h * 0.13}px "Share Tech Mono"`;
      ctx.fillStyle = hex(COLORS.moonlight);
      ctx.fillText(sub, w / 2, h * 0.78);
    }
  });
}

// ---------------------------------------------------------------------------------
// (a) Storefront row — 4 shops (default), 8m frontage each, 2 floors
// ---------------------------------------------------------------------------------

const SHOP_THEMES = ['electronics', 'pawn', 'noodle', 'clothing', 'pharmacy', 'arcade'] as const;
type ShopTheme = (typeof SHOP_THEMES)[number];

function pickThemes(rng: Rng, n: number): ShopTheme[] {
  const pool = [...SHOP_THEMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: ShopTheme[] = [];
  for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
  return out;
}

const THEME_ACCENT: Record<ShopTheme, number> = {
  electronics: COLORS.holoTeal,
  pawn: COLORS.sodiumAmber,
  noodle: COLORS.sodiumAmber,
  clothing: COLORS.moonlight,
  pharmacy: COLORS.holoTeal,
  arcade: COLORS.signalMagenta
};

const THEME_AWNING: Record<ShopTheme, number> = {
  electronics: COLORS.holoTeal,
  pawn: COLORS.moonlight,
  noodle: COLORS.sodiumAmber,
  clothing: COLORS.signalMagenta,
  pharmacy: COLORS.holoTeal,
  arcade: COLORS.signalMagenta
};

function drawShopSignCell(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellW: number,
  cellH: number,
  theme: ShopTheme,
  rng: Rng
): void {
  const accent = hex(THEME_ACCENT[theme]);
  ctx.save();
  ctx.translate(cellX, 0);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, cellW, cellH);
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4;

  switch (theme) {
    case 'electronics': {
      const cols = 5;
      const rows = 3;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(0.8)) continue;
          const cw = cellW / cols - 6;
          const ch = cellH / rows - 12;
          ctx.globalAlpha = rng.range(0.5, 1);
          ctx.fillStyle = rng.chance(0.6) ? accent : hex(COLORS.signalMagenta);
          ctx.fillRect(6 + c * (cellW / cols), 6 + r * (cellH / rows), cw, ch);
        }
      }
      ctx.globalAlpha = 1;
      ctx.font = `bold ${cellH * 0.16}px "Share Tech Mono"`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.fillText('PIXELMART', cellW / 2, cellH * 0.94);
      break;
    }
    case 'pawn': {
      ctx.strokeRect(cellW * 0.1, cellH * 0.08, cellW * 0.8, cellH * 0.58);
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(cellW * 0.1 + (cellW * 0.8 * i) / 5, cellH * 0.08);
        ctx.lineTo(cellW * 0.1 + (cellW * 0.8 * i) / 5, cellH * 0.66);
        ctx.stroke();
      }
      ctx.font = `bold ${cellH * 0.36}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.fillText('質', cellW / 2, cellH * 0.9);
      break;
    }
    case 'noodle': {
      ctx.beginPath();
      ctx.arc(cellW / 2, cellH * 0.42, cellH * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `bold ${cellH * 0.16}px "Unbounded"`;
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.fillText('NOODLES', cellW / 2, cellH * 0.9);
      break;
    }
    case 'clothing': {
      ctx.font = `bold ${cellH * 0.26}px "Unbounded"`;
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.fillText('MODE', cellW / 2, cellH * 0.48);
      ctx.font = `${cellH * 0.1}px "Share Tech Mono"`;
      ctx.fillText('TAILORED SYNTH', cellW / 2, cellH * 0.68);
      break;
    }
    case 'pharmacy': {
      const cx = cellW / 2;
      const cy = cellH * 0.42;
      const s = cellH * 0.22;
      ctx.lineWidth = s * 0.45;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy);
      ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx, cy + s);
      ctx.stroke();
      ctx.font = `bold ${cellH * 0.13}px "Share Tech Mono"`;
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.fillText('PHARMA 24H', cellW / 2, cellH * 0.88);
      break;
    }
    case 'arcade': {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = rng.chance(0.5) ? accent : hex(COLORS.moonlight);
        ctx.beginPath();
        ctx.arc(cellW * 0.15 + i * (cellW * 0.14), cellH * 0.14, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = `bold ${cellH * 0.24}px "Unbounded"`;
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.fillText('ARCADE', cellW / 2, cellH * 0.55);
      break;
    }
  }
  ctx.restore();
}

/** Draws one sandwich-board cell (single-color line ad) into a shared atlas. */
function drawSandwichBoardCell(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellW: number,
  cellH: number,
  theme: ShopTheme,
  discount: number
): void {
  const accent = hex(THEME_ACCENT[theme]);
  ctx.save();
  ctx.translate(cellX, 0);
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(0, 0, cellW, cellH);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, cellW - 12, cellH - 12);
  ctx.fillStyle = accent;
  ctx.font = `bold ${cellH * 0.14}px "Share Tech Mono"`;
  ctx.textAlign = 'center';
  ctx.fillText('SALE', cellW / 2, cellH * 0.4);
  ctx.fillText(`-${discount}%`, cellW / 2, cellH * 0.62);
  ctx.restore();
}

/** Remaps a plane's U range from [0,1] into cell `i` of `count` equal atlas cells
 *  (same trick as `special.ts`'s `tealPatchUVs`, generalized to N cells). */
function remapUVsToCell<T extends THREE.BufferGeometry>(geom: T, i: number, count: number): T {
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
  for (let v = 0; v < uv.count; v++) uv.setXY(v, (uv.getX(v) + i) / count, uv.getY(v));
  return geom;
}

/**
 * 4-shop storefront row, 8m frontage per shop, 2 floors. Each shop draws a distinct
 * theme from {electronics, pawn, noodle, clothing, pharmacy, arcade} with its own
 * awning color, sign-atlas cell, and interior glow; one shop gets a 2nd-floor balcony.
 * Shared roof carries a parapet, scattered vent boxes, and one rooftop billboard
 * mount (`userData.billboardAnchors`).
 * ~6 draw calls: body, 2F windows, awnings, interior glow, sign atlas, sandwich boards.
 */
export function buildStorefrontRow(rng: Rng, shops = 4): THREE.Group {
  const group = new THREE.Group();
  group.name = 'storefrontRow';

  const bayW = 8;
  const depth = 9;
  const totalW = shops * bayW;
  const totalH = FLOOR_H * 2;

  const bodyParts: GeometryPart[] = [];
  const windowParts: GeometryPart[] = [];
  const awningParts: GeometryPart[] = [];
  const glowParts: GeometryPart[] = [];
  const boardParts: GeometryPart[] = [];

  const themes = pickThemes(rng, shops);
  const seats: THREE.Object3D[] = [];

  bodyParts.push(boxPart(new THREE.Vector3(0, totalH / 2, 0), new THREE.Vector3(totalW, totalH, depth)));
  bodyParts.push(boxPart(new THREE.Vector3(0, totalH + 0.3, 0), new THREE.Vector3(totalW + 0.4, 0.6, depth + 0.4)));

  addTierFacades(windowParts, rng, totalW - 0.6, depth - 0.6, FLOOR_H - 0.8, FLOOR_H + 0.3, 0.32);

  const balconyShop = rng.int(0, shops - 1);
  // Board plan decided up front (fixed rng order) so the atlas draw and the geometry
  // placement below agree on which shops get a sandwich board + what discount shows.
  const hasBoard: boolean[] = [];
  const boardDiscount: number[] = [];
  for (let i = 0; i < shops; i++) {
    hasBoard.push(rng.chance(0.6));
    boardDiscount.push(rng.int(10, 60));
  }

  for (let i = 0; i < shops; i++) {
    const theme = themes[i];
    const cx = -totalW / 2 + bayW * i + bayW / 2;
    const frontZ = depth / 2;

    // recessed door
    bodyParts.push(boxPart(new THREE.Vector3(cx, 1.1, frontZ - 0.15), new THREE.Vector3(1.4, 2.2, 0.3)));

    // interior glow behind the storefront glass — samples this shop's cell in the
    // glass-glow atlas (mullion cross + grime drips baked in, round-1 detail pass;
    // v1 was a flat single-color plane with no glazing detail at all).
    glowParts.push({
      geom: remapUVsToCell(new THREE.PlaneGeometry(bayW - 2, FLOOR_H - 1.2), i, shops),
      matrix: new THREE.Matrix4().makeTranslation(cx, FLOOR_H / 2 + 0.1, frontZ + 0.02),
      mat: 0
    });

    // awning: distinct color box, some angled like canvas awnings
    const awningColor = THEME_AWNING[theme];
    const angled = rng.chance(0.5);
    const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, angled ? -0.28 : 0);
    const awningGeom = withVertexColor(new THREE.BoxGeometry(1, 1, 1), awningColor);
    awningParts.push({
      geom: awningGeom,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(cx, FLOOR_H - 0.15, frontZ + 0.65),
        q,
        new THREE.Vector3(bayW - 0.6, 0.18, 1.4)
      ),
      mat: 0
    });
    // round-3 detail: a row of small drip icicles off the awning's leading edge —
    // without them the awning read as a clean unweathered slab.
    const dripN = rng.int(4, 6);
    for (let dIdx = 0; dIdx < dripN; dIdx++) {
      const dx = cx + rng.range(-bayW / 2 + 0.6, bayW / 2 - 0.6);
      bodyParts.push(
        boxPart(
          new THREE.Vector3(dx, FLOOR_H - 0.32, frontZ + 1.28),
          new THREE.Vector3(0.05, rng.range(0.12, 0.26), 0.05)
        )
      );
    }

    // sandwich board on the sidewalk (round-2 street-life detail) — geometry samples
    // its shop's cell in the shared board atlas built after this loop.
    if (hasBoard[i]) {
      const sbGeom = remapUVsToCell(new THREE.PlaneGeometry(0.8, 1.1), i, shops);
      boardParts.push({
        geom: sbGeom,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(cx + rng.range(-1.5, 1.5), 0.55, frontZ + 1.6),
          new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rng.range(-0.3, 0.3)),
          new THREE.Vector3(1, 1, 1)
        ),
        mat: 0
      });
      // sandwich-board's own A-frame legs (dark, folds into the body category)
      bodyParts.push(boxPart(new THREE.Vector3(cx, 0.28, frontZ + 1.6), new THREE.Vector3(0.06, 0.55, 0.7)));
    }

    // balcony on one shop
    if (i === balconyShop) {
      bodyParts.push(
        boxPart(new THREE.Vector3(cx, FLOOR_H + 0.15, frontZ + 0.9), new THREE.Vector3(bayW - 2, 0.3, 1.6))
      );
      for (const dx of [-1, 1]) {
        bodyParts.push(
          boxPart(
            new THREE.Vector3(cx + (dx * (bayW - 2.4)) / 2, FLOOR_H + 0.7, frontZ + 0.9),
            new THREE.Vector3(0.1, 1.0, 1.6)
          )
        );
      }
      bodyParts.push(
        boxPart(new THREE.Vector3(cx, FLOOR_H + 1.15, frontZ + 1.6), new THREE.Vector3(bayW - 2.4, 0.1, 0.1))
      );
    }

    // wall pipes / junction box near shop boundary — round-2 grime detail
    if (rng.chance(0.5)) {
      addWallPipes(bodyParts, cx + bayW / 2 - 0.3, frontZ + 0.06, totalH, 0, rng);
    }

    // roof vent box near this shop
    if (rng.chance(0.6)) {
      bodyParts.push(
        boxPart(
          new THREE.Vector3(cx + rng.range(-1.5, 1.5), totalH + 0.9, rng.range(-depth / 3, depth / 3)),
          new THREE.Vector3(rng.range(1, 1.8), rng.range(1, 1.6), rng.range(1, 1.6)),
          rng.range(0, Math.PI)
        )
      );
    }

    // curb trash bags between shops
    if (i > 0 && rng.chance(0.55)) {
      addTrashBag(bodyParts, cx - bayW / 2, frontZ + 2.0 + rng.range(0, 0.6), rng);
    }
  }

  // hanging cables strung shop-to-shop along the eave (round-3 detail)
  for (let i = 0; i < shops - 1; i++) {
    const x0 = -totalW / 2 + bayW * (i + 1);
    addCableSag(
      bodyParts,
      new THREE.Vector3(x0, FLOOR_H + 0.4, depth / 2 + 0.1),
      new THREE.Vector3(x0, FLOOR_H + 0.9, depth / 2 - 1.4),
      0.5,
      5
    );
  }

  // sign atlas: one canvas holding all `shops` distinct signs -> ONE draw call
  const cellW = 512;
  const cellH = 160;
  const signTex = makeCanvasTexture(cellW * shops, cellH, (ctx) => {
    for (let i = 0; i < shops; i++) drawShopSignCell(ctx, i * cellW, cellW, cellH, themes[i], rng);
  });
  const signParts: GeometryPart[] = [
    {
      geom: new THREE.PlaneGeometry(totalW - 1, 1.6),
      matrix: new THREE.Matrix4().makeTranslation(0, FLOOR_H + 0.35, depth / 2 + 0.05),
      mat: 0
    }
  ];

  // glass-glow atlas: warm interior light with a mullion cross + grime-drip streaks
  // bleeding down the glass (round-1 detail — v1 was one flat sodium-amber plane per
  // shop with no glazing texture at all).
  const glowCellW = 256;
  const glowCellH = 128;
  const glowTex = makeCanvasTexture(glowCellW * shops, glowCellH, (ctx) => {
    for (let i = 0; i < shops; i++) {
      const accent = hex(THEME_ACCENT[themes[i]]);
      ctx.save();
      ctx.translate(i * glowCellW, 0);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(4, 4, glowCellW - 8, glowCellH - 8);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(glowCellW / 2, 0);
      ctx.lineTo(glowCellW / 2, glowCellH);
      ctx.moveTo(0, glowCellH / 2);
      ctx.lineTo(glowCellW, glowCellH / 2);
      ctx.stroke();
      // grime drips bleeding down from the top sill
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const n = rng.int(3, 6);
      for (let d = 0; d < n; d++) {
        const dx = rng.range(0.08, 0.92) * glowCellW;
        ctx.fillRect(dx, 0, rng.range(3, 7), rng.range(glowCellH * 0.2, glowCellH * 0.6));
      }
      ctx.restore();
    }
  });

  // sandwich-board atlas: one canvas cell per shop, matching hasBoard/boardDiscount
  const boardCellW = 128;
  const boardCellH = 192;
  const boardTex = makeCanvasTexture(boardCellW * shops, boardCellH, (ctx) => {
    for (let i = 0; i < shops; i++) {
      if (hasBoard[i]) drawSandwichBoardCell(ctx, i * boardCellW, boardCellW, boardCellH, themes[i], boardDiscount[i]);
    }
  });

  // billboard mount point on the roof
  const billboardAnchor = new THREE.Object3D();
  billboardAnchor.name = 'billboardAnchor';
  billboardAnchor.position.set(0, totalH + 1.2, -depth / 4);
  group.add(billboardAnchor);

  // round-3 detail: a whip antenna + small satellite dish on the roofline — the spec
  // calls for >=80% of Ring 0-1 buildings to get non-flat tops; a bare parapet + vent
  // boxes read as flat from a distance without a silhouette-breaking mast.
  const antX = totalW / 2 - 2.2;
  const antH = rng.range(1.6, 2.4);
  bodyParts.push(boxPart(new THREE.Vector3(antX, totalH + antH / 2, depth / 4), new THREE.Vector3(0.08, antH, 0.08)));
  bodyParts.push({
    geom: new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2.4),
    matrix: new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + rng.range(-0.3, 0.1), rng.range(0, Math.PI * 2), 0))
      .setPosition(antX - 1.1, totalH + 0.7, depth / 4),
    mat: 0
  });

  group.add(mergeOne(bodyParts, makeBodyMat(), 'body'));
  group.add(
    mergeOne(
      windowParts,
      makeWindowMat(
        makeWindowTexture(rng, { litRatio: 0.55, coolRatio: 0.4, peakRatio: 0.05, dimLo: 0.3, dimHi: 0.6 })
      ),
      'windows'
    )
  );
  group.add(mergeOne(awningParts, makeVertexColorMat(), 'awnings'));
  group.add(mergeOne(glowParts, makeEmissiveMapMat(glowTex, 1.5), 'interiorGlow'));
  group.add(mergeOne(signParts, makeEmissiveMapMat(signTex, 2.0), 'signs'));
  if (boardParts.length) group.add(mergeOne(boardParts, makeEmissiveMapMat(boardTex, 1.4), 'sandwichBoards'));

  group.userData.roofY = totalH;
  group.userData.footprint = [totalW, depth];
  group.userData.seats = seats;
  group.userData.billboardAnchors = [billboardAnchor];
  return group;
}

// ---------------------------------------------------------------------------------
// (b) Fancy restaurant — outdoor terrace, string lights, 10 seats
// ---------------------------------------------------------------------------------

/** Transparent-background arch-window texture: filled amber glow inside a round-top
 *  arch silhouette + a simple mullion cross, alpha-punched so the plane reads as a
 *  window shape rather than a rectangle. */
function makeArchTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 384;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    const marginX = w * 0.12;
    const archTop = h * 0.12;
    const rectBottom = h * 0.95;
    const r = (w - marginX * 2) / 2;
    ctx.fillStyle = hex(COLORS.sodiumAmber);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(marginX, archTop + r);
    ctx.arc(w / 2, archTop + r, r, Math.PI, 0);
    ctx.lineTo(w - marginX, rectBottom);
    ctx.lineTo(marginX, rectBottom);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(w / 2, archTop);
    ctx.lineTo(w / 2, rectBottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(marginX, h * 0.55);
    ctx.lineTo(w - marginX, h * 0.55);
    ctx.stroke();
  });
}

function makeArchMat(tex: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 1.2,
    roughness: 0.6,
    side: THREE.DoubleSide
  });
}

/**
 * Fancy restaurant: 2-floor warm-amber facade with 6 arched windows (3 per floor),
 * a front terrace with hedge planters, a host stand, 5 round tables x 2 chairs
 * (10 seat anchors), a catenary string-light rig on 4 poles, a glowing vcard menu
 * holo-board, and a thin moonlight-neon "ORBITAL EATS" sign.
 * ~7 draw calls: body, arch windows, interior glow, string lights, menu holo, name
 * sign, sandwich-board-free (venues get the extra headroom the house rule allows).
 */
export function buildFancyRestaurant(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fancyRestaurant';

  const w = 14;
  const d = 9;
  const totalH = FLOOR_H * 2;
  const terraceD = 7;
  const terraceZ0 = d / 2;
  const terraceCz = terraceZ0 + terraceD / 2;

  const bodyParts: GeometryPart[] = [];
  const archParts: GeometryPart[] = [];
  const glowParts: GeometryPart[] = [];
  const stringParts: GeometryPart[] = [];
  const seats: THREE.Object3D[] = [];

  bodyParts.push(boxPart(new THREE.Vector3(0, totalH / 2, 0), new THREE.Vector3(w, totalH, d)));
  bodyParts.push(boxPart(new THREE.Vector3(0, totalH + 0.25, 0), new THREE.Vector3(w + 0.4, 0.5, d + 0.4)));

  // warm interior glow washing the ground floor glass
  glowParts.push({
    geom: new THREE.PlaneGeometry(w - 2, FLOOR_H - 1),
    matrix: new THREE.Matrix4().makeTranslation(0, FLOOR_H / 2 + 0.2, d / 2 + 0.03),
    mat: 0
  });

  // arched windows: 3 across each floor
  const archW = 2.4;
  const archH = 3.0;
  for (let f = 0; f < 2; f++) {
    const yc = FLOOR_H * f + archH / 2 + 0.25;
    for (let i = 0; i < 3; i++) {
      const x = -w / 3 + i * (w / 3);
      archParts.push({
        geom: new THREE.PlaneGeometry(archW, archH),
        matrix: new THREE.Matrix4().makeTranslation(x, yc, d / 2 + 0.04),
        mat: 0
      });
      // dark frame surround so the arch reads against the body, not floating
      bodyParts.push(boxPart(new THREE.Vector3(x, yc, d / 2 + 0.01), new THREE.Vector3(archW + 0.2, archH + 0.2, 0.05)));
    }
  }

  // host stand near the terrace entrance
  bodyParts.push(boxPart(new THREE.Vector3(-w / 2 + 1.5, 0.55, terraceZ0 + 0.6), new THREE.Vector3(1.0, 1.1, 0.6)));

  // hedge planters bounding the terrace
  const hedgeY = 0.35;
  for (const side of [1, -1]) {
    bodyParts.push(
      boxPart(new THREE.Vector3(side * (w / 2 - 0.3), hedgeY, terraceCz), new THREE.Vector3(0.6, 0.7, terraceD - 0.4))
    );
  }
  bodyParts.push(
    boxPart(new THREE.Vector3(0, hedgeY, terraceZ0 + terraceD - 0.3), new THREE.Vector3(w - 1, 0.7, 0.6))
  );
  // round-2 detail: small amber path-lights nested in the hedge line — without them
  // the terrace boundary was a solid black silhouette even with the string-light
  // canopy lit above it.
  const pathLightGeom = new THREE.SphereGeometry(0.07, 6, 5);
  const pathLightParts: GeometryPart[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = terraceZ0 + 0.6 + i * ((terraceD - 1.2) / 2);
      pathLightParts.push({
        geom: pathLightGeom,
        matrix: new THREE.Matrix4().makeTranslation(side * (w / 2 - 0.3), hedgeY + 0.4, z),
        mat: 0
      });
    }
  }

  // 4 string-light poles at terrace corners + perimeter catenary garland
  const poleH = 3.0;
  const px = w / 2 - 1;
  const pz0 = terraceZ0 + 0.6;
  const pz1 = terraceZ0 + terraceD - 0.6;
  const poles: THREE.Vector3[] = [
    new THREE.Vector3(-px, poleH, pz0),
    new THREE.Vector3(px, poleH, pz0),
    new THREE.Vector3(px, poleH, pz1),
    new THREE.Vector3(-px, poleH, pz1)
  ];
  for (const p of poles) bodyParts.push(boxPart(new THREE.Vector3(p.x, p.y / 2, p.z), new THREE.Vector3(0.14, p.y, 0.14)));
  for (let i = 0; i < poles.length; i++) addLightString(stringParts, poles[i], poles[(i + 1) % poles.length], 0.5, 8);
  // diagonal cross-strings over the seating for the "canopy of light" look
  addLightString(stringParts, poles[0], poles[2], 0.7, 8);
  addLightString(stringParts, poles[1], poles[3], 0.7, 8);

  // 5 round tables, 2 chairs each = 10 seat anchors
  const tableGeom = new THREE.CylinderGeometry(0.55, 0.5, 0.06, 12);
  const legGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.72, 6);
  const chairGeom = new THREE.BoxGeometry(1, 1, 1);
  const candleGeom = new THREE.SphereGeometry(0.05, 6, 5);
  const candleParts: GeometryPart[] = [];
  const positions: Array<[number, number]> = [
    [-w / 2 + 2.6, terraceZ0 + 1.7],
    [0, terraceZ0 + 1.7],
    [w / 2 - 2.6, terraceZ0 + 1.7],
    [-w / 4, terraceZ0 + terraceD - 1.8],
    [w / 4, terraceZ0 + terraceD - 1.8]
  ];
  for (const [tx, tz] of positions) {
    bodyParts.push({ geom: tableGeom, matrix: new THREE.Matrix4().makeTranslation(tx, 0.75, tz), mat: 0 });
    bodyParts.push({ geom: legGeom, matrix: new THREE.Matrix4().makeTranslation(tx, 0.4, tz), mat: 0 });
    // round-3 detail: a small candle glow on every table — without it the tabletops
    // read as bare disks even with the string-light canopy lit above them.
    candleParts.push({ geom: candleGeom, matrix: new THREE.Matrix4().makeTranslation(tx, 0.83, tz), mat: 0 });
    for (const side of [1, -1]) {
      const chairZ = tz + side * 0.85;
      const anchor = new THREE.Object3D();
      anchor.name = 'seat';
      anchor.position.set(tx, 0.45, chairZ);
      // local +Z = facing direction: chairs face the table at the center.
      anchor.rotation.y = side > 0 ? Math.PI : 0;
      seats.push(anchor);
      group.add(anchor);
      bodyParts.push({
        geom: chairGeom,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(tx, 0.25, chairZ),
          new THREE.Quaternion(),
          new THREE.Vector3(0.42, 0.5, 0.42)
        ),
        mat: 0
      });
    }
  }

  // glowing menu holo-board (vcard format)
  const menuTex = makeAd('vcard', rng);
  const menuParts: GeometryPart[] = [
    {
      geom: new THREE.PlaneGeometry(1.1, 1.65),
      matrix: new THREE.Matrix4().makeTranslation(-w / 2 + 1.5, 1.6, terraceZ0 + 0.62),
      mat: 0
    }
  ];

  // "ORBITAL EATS" — thin elegant moonlight neon
  const nameTex = makeNeonTextTexture('ORBITAL EATS', COLORS.moonlight, undefined, 'thin');
  const nameParts: GeometryPart[] = [
    { geom: new THREE.PlaneGeometry(7, 1.1), matrix: new THREE.Matrix4().makeTranslation(0, totalH + 0.9, d / 2 + 0.05), mat: 0 }
  ];

  const archTex = makeArchTexture();

  group.add(mergeOne(bodyParts, makeBodyMat(), 'body'));
  group.add(mergeOne(archParts, makeArchMat(archTex), 'archWindows'));
  group.add(mergeOne(glowParts, makeGlowMat(COLORS.sodiumAmber, 1.4), 'interiorGlow'));
  group.add(mergeOne(stringParts, makeGlowMat(COLORS.moonlight, 2.0), 'stringLights'));
  group.add(mergeOne(pathLightParts, makeGlowMat(COLORS.sodiumAmber, 2.2), 'pathLights'));
  group.add(mergeOne(candleParts, makeGlowMat(COLORS.sodiumAmber, 2.6), 'candles'));
  group.add(mergeOne(menuParts, makeEmissiveMapMat(menuTex, 1.8), 'menuHolo'));
  group.add(mergeOne(nameParts, makeEmissiveMapMat(nameTex, 2.4), 'nameSign'));

  group.userData.roofY = totalH;
  group.userData.footprint = [w, terraceZ0 + terraceD];
  group.userData.seats = seats;
  return group;
}

// ---------------------------------------------------------------------------------
// (c) Ramen shop — noren, open counter, 6 stools, steam vent, flag sign
// ---------------------------------------------------------------------------------

function makeNorenTexture(rng: Rng): THREE.CanvasTexture {
  const w = 128;
  const h = 384;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = hex(COLORS.signalMagenta);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, w, h * 0.75);
    ctx.globalAlpha = 1;
    ctx.fillStyle = hex(COLORS.moonlight);
    ctx.font = `${h * 0.1}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText('麺', w / 2, h * 0.4);
    void rng;
  });
}

function makeClothMat(tex: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.6,
    roughness: 0.9,
    side: THREE.DoubleSide
  });
}

function makeRamenFlagTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 384;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = hex(COLORS.void);
    ctx.globalAlpha = 0.92;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hex(COLORS.sodiumAmber);
    ctx.shadowColor = hex(COLORS.sodiumAmber);
    ctx.shadowBlur = 14;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.4, w * 0.3, 0, Math.PI, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.4, w * 0.3, w * 0.08, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hex(COLORS.signalMagenta);
    ctx.shadowColor = hex(COLORS.signalMagenta);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w * 0.35, h * 0.16);
    ctx.lineTo(w * 0.62, h * 0.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.42, h * 0.16);
    ctx.lineTo(w * 0.7, h * 0.02);
    ctx.stroke();
    ctx.font = `bold ${h * 0.08}px "Unbounded"`;
    ctx.textAlign = 'center';
    ctx.fillStyle = hex(COLORS.moonlight);
    ctx.shadowColor = hex(COLORS.moonlight);
    ctx.shadowBlur = 8;
    ctx.fillText('PGVECTOR', w / 2, h * 0.72);
    ctx.fillText('RAMEN', w / 2, h * 0.85);
  });
}

function makeMenuStripTexture(rng: Rng): THREE.CanvasTexture {
  const w = 96;
  const h = 256;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(COLORS.moonlight);
    ctx.font = `${h * 0.06}px "Share Tech Mono"`;
    ctx.textAlign = 'left';
    const items = ['SHOYU', 'MISO', 'TONKOTSU', 'VECTOR SPECIAL'];
    items.forEach((it, i) => ctx.fillText(it, 6, 20 + i * (h * 0.08) + rng.range(-2, 2)));
  });
}

/**
 * Ramen shop: single story + attic, noren curtain strips over the open counter,
 * kitchen glow + hanging lantern row, 6 stool seat anchors, a roof steam vent
 * (`userData.steamAnchor`, Task 24 attaches fx there), a magenta+amber bowl/chopsticks
 * flag sign mounted perpendicular to the facade, mono menu strips, and a rooftop
 * glowing vending machine (round-2 street-life detail) beside the side wall.
 * ~7 draw calls: body, noren cloth, amber glow (lanterns+kitchen), flag sign, menu
 * strips, vending machine glow.
 */
export function buildRamenShop(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ramenShop';

  const w = 9;
  const d = 8;
  const h = FLOOR_H;
  const atticH = 1.4;
  const atticW = w - 3;
  const atticD = d - 3;

  const bodyParts: GeometryPart[] = [];
  const clothParts: GeometryPart[] = [];
  const amberParts: GeometryPart[] = [];
  const seats: THREE.Object3D[] = [];

  // shell — open on the +Z (street) face for the counter
  bodyParts.push(boxPart(new THREE.Vector3(-w / 2 + 0.15, h / 2, 0), new THREE.Vector3(0.3, h, d)));
  bodyParts.push(boxPart(new THREE.Vector3(w / 2 - 0.15, h / 2, 0), new THREE.Vector3(0.3, h, d)));
  bodyParts.push(boxPart(new THREE.Vector3(0, h / 2, -d / 2 + 0.15), new THREE.Vector3(w, h, 0.3)));
  bodyParts.push(boxPart(new THREE.Vector3(0, h - 0.1, 0), new THREE.Vector3(w, 0.2, d)));
  bodyParts.push(boxPart(new THREE.Vector3(0, h + atticH / 2, 0), new THREE.Vector3(atticW, atticH, atticD)));
  bodyParts.push(boxPart(new THREE.Vector3(0, h + atticH + 0.15, 0), new THREE.Vector3(atticW + 0.3, 0.3, atticD + 0.3)));

  // open counter along the street edge
  bodyParts.push(boxPart(new THREE.Vector3(0, 0.5, d / 2 - 0.5), new THREE.Vector3(w - 1.2, 1.0, 0.5)));
  bodyParts.push(boxPart(new THREE.Vector3(0, 1.05, d / 2 - 0.5), new THREE.Vector3(w - 1.0, 0.08, 0.7)));

  // 6 stools + seat anchors facing the counter (into the shop, -Z)
  const stoolGeom = new THREE.CylinderGeometry(0.22, 0.2, 0.45, 8);
  for (let i = 0; i < 6; i++) {
    const sx = -w / 2 + 1.2 + i * ((w - 2.4) / 5);
    const sz = d / 2 + 0.7;
    bodyParts.push({ geom: stoolGeom, matrix: new THREE.Matrix4().makeTranslation(sx, 0.22, sz), mat: 0 });
    const anchor = new THREE.Object3D();
    anchor.name = 'seat';
    anchor.position.set(sx, 0.45, sz);
    anchor.rotation.y = Math.PI;
    seats.push(anchor);
    group.add(anchor);
  }

  // hanging lantern row under the eave
  const lanternGeom = new THREE.SphereGeometry(0.18, 8, 6);
  for (let i = 0; i < 5; i++) {
    const lx = -w / 2 + 1 + i * ((w - 2) / 4);
    amberParts.push({ geom: lanternGeom, matrix: new THREE.Matrix4().makeTranslation(lx, h - 0.3, d / 2 + 0.5), mat: 0 });
  }
  // kitchen glow behind the counter
  amberParts.push({
    geom: new THREE.PlaneGeometry(w - 2, h - 1.4),
    matrix: new THREE.Matrix4().makeTranslation(0, h / 2, -d / 2 + 0.4),
    mat: 0
  });

  // noren: 3 cloth strips hung over the entrance end of the counter (NOT the whole
  // open frontage — round-1 fix: v1 spanned the entire counter and blocked the view
  // of the stools/kitchen behind it). Baked rng sway offsets per strip + a small gap
  // between strips so the counter reads through.
  const norenTex = makeNorenTexture(rng);
  const norenTotalW = 2.1;
  const norenStripW = norenTotalW / 3;
  const norenCx = -w / 2 + 1.3;
  const norenTopY = h - 0.35;
  bodyParts.push(boxPart(new THREE.Vector3(norenCx, norenTopY + 0.08, d / 2 + 0.42), new THREE.Vector3(norenTotalW + 0.2, 0.12, 0.1)));
  for (let i = 0; i < 3; i++) {
    const nx = norenCx - norenTotalW / 2 + norenStripW * (i + 0.5);
    const sway = rng.range(-0.14, 0.14);
    clothParts.push({
      geom: new THREE.PlaneGeometry(norenStripW - 0.06, 1.1),
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(nx + sway * 0.5, norenTopY - 0.55, d / 2 + 0.42 + Math.abs(sway) * 0.4),
        new THREE.Quaternion().setFromAxisAngle(Y_AXIS, sway),
        new THREE.Vector3(1, 1, 1)
      ),
      mat: 0
    });
  }

  // steam vent on the attic roof — Task 24's fx pass attaches to this anchor
  const steamAnchor = new THREE.Object3D();
  steamAnchor.name = 'steamAnchor';
  steamAnchor.position.set(0, h + atticH + 0.35, -atticD / 4);
  group.add(steamAnchor);
  bodyParts.push(boxPart(new THREE.Vector3(0, h + atticH + 0.2, -atticD / 4), new THREE.Vector3(0.6, 0.4, 0.6)));

  // bowl+chopsticks flag sign, perpendicular flag-mount off the right wall
  const flagTex = makeRamenFlagTexture();
  const flagParts: GeometryPart[] = [
    {
      geom: new THREE.PlaneGeometry(1.6, 2.4),
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(w / 2 + 0.05, h * 0.85, d / 2 - 1.0),
        new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2),
        new THREE.Vector3(1, 1, 1)
      ),
      mat: 0
    }
  ];
  bodyParts.push(boxPart(new THREE.Vector3(w / 2 + 0.05, h * 0.85, d / 2 - 1.0), new THREE.Vector3(0.5, 0.08, 0.08)));

  // menu strips beside the counter
  const menuStripTex = makeMenuStripTexture(rng);
  const menuParts: GeometryPart[] = [
    { geom: new THREE.PlaneGeometry(0.6, 1.6), matrix: new THREE.Matrix4().makeTranslation(-w / 2 + 0.5, 1.2, d / 2 + 0.05), mat: 0 }
  ];

  // glowing vending machine beside the shop — classic cyberpunk street-life prop
  const vendX = -w / 2 - 0.9;
  const vendZ = d / 2 - 1.2;
  bodyParts.push(boxPart(new THREE.Vector3(vendX, 0.95, vendZ), new THREE.Vector3(0.9, 1.9, 0.7)));

  // utility junction box + sagging power cable from the attic roof down to the
  // vending machine — round-1 street-clutter detail.
  addWallPipes(bodyParts, -w / 2 + 0.15, d / 2 - 2.6, h, -Math.PI / 2, rng);
  addCableSag(
    bodyParts,
    new THREE.Vector3(-w / 2 + 0.2, h + atticH, d / 2 - 2.4),
    new THREE.Vector3(vendX, 1.9, vendZ),
    0.5,
    5
  );
  const vendGlowColor = rng.chance(0.5) ? COLORS.holoTeal : COLORS.signalMagenta;
  const vendingParts: GeometryPart[] = [
    { geom: new THREE.PlaneGeometry(0.7, 1.3), matrix: new THREE.Matrix4().makeTranslation(vendX, 1.0, vendZ + 0.36), mat: 0 }
  ];

  group.add(mergeOne(bodyParts, makeBodyMat(), 'body'));
  group.add(mergeOne(clothParts, makeClothMat(norenTex), 'noren'));
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.6), 'amberGlow'));
  group.add(mergeOne(flagParts, makeEmissiveMapMat(flagTex, 2.2, true), 'flagSign'));
  group.add(mergeOne(menuParts, makeEmissiveMapMat(menuStripTex, 1.6), 'menuStrips'));
  group.add(mergeOne(vendingParts, makeGlowMat(vendGlowColor, 1.8), 'vendingGlow'));

  group.userData.roofY = h + atticH + 0.3;
  group.userData.footprint = [w, d];
  group.userData.seats = seats;
  group.userData.steamAnchor = steamAnchor;
  return group;
}

// ---------------------------------------------------------------------------------
// (d) Bar — huge marquee, porthole, outdoor stools + standing table
// ---------------------------------------------------------------------------------

/** Soft radial-falloff alpha texture for a light-spill pool on the ground — round-1
 *  fix: v1 used a flat opaque plane that read as a solid blown-out card instead of a
 *  soft pool of light. */
function makeSpillTexture(color: number): THREE.CanvasTexture {
  const s = 256;
  return makeCanvasTexture(s, s, (ctx) => {
    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    const c = hex(color);
    grad.addColorStop(0, c);
    grad.addColorStop(0.55, c);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}

function makePortholeTexture(rng: Rng): THREE.CanvasTexture {
  const s = 256;
  return makeCanvasTexture(s, s, (ctx) => {
    ctx.fillStyle = '#050508';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hex(COLORS.sodiumAmber);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, s * 0.3, s, s * 0.4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000000';
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const x = s * (0.25 + i * 0.25);
      ctx.beginPath();
      ctx.arc(x, s * 0.42, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - s * 0.05, s * 0.46, s * 0.1, s * 0.22);
    }
  });
}

function makeBottleWallTexture(rng: Rng): THREE.CanvasTexture {
  const w = 256;
  const h = 160;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, w, h);
    const palette = [COLORS.sodiumAmber, COLORS.holoTeal, COLORS.signalMagenta, COLORS.moonlight];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 12; c++) {
        if (!rng.chance(0.7)) continue;
        ctx.globalAlpha = rng.range(0.4, 0.9);
        ctx.fillStyle = hex(rng.pick(palette));
        ctx.beginPath();
        ctx.arc(10 + c * (w / 12), 14 + r * (h / 5), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  });
}

/**
 * Bar: dark facade, huge flicker-tagged "SYNTH BAR" magenta marquee
 * (`userData.flicker`), a porthole window with silhouettes, a second window glowing
 * with a rng-colored bottle wall, an amber sidewalk light-spill plane, rooftop AC +
 * beer-crate stack, and outdoor seating — 4 stools + 1 standing table (~5 anchors).
 * ~6 draw calls: body, sidewalk spill, porthole, bottle wall, marquee (separate mesh,
 * still one draw call — the city assembly flickers its material directly).
 */
export function buildBar(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bar';

  const w = 10;
  const d = 8;
  const h = FLOOR_H * 1.3;

  const bodyParts: GeometryPart[] = [];
  const spillParts: GeometryPart[] = [];
  const seats: THREE.Object3D[] = [];

  bodyParts.push(boxPart(new THREE.Vector3(0, h / 2, 0), new THREE.Vector3(w, h, d)));
  bodyParts.push(boxPart(new THREE.Vector3(0, h + 0.25, 0), new THREE.Vector3(w + 0.4, 0.5, d + 0.4)));

  // rooftop AC unit + beer-crate stack by the side door
  bodyParts.push(boxPart(new THREE.Vector3(-w / 3, h + 0.7, 0), new THREE.Vector3(1.6, 0.9, 1.4)));
  for (let i = 0; i < 4; i++) {
    bodyParts.push(boxPart(new THREE.Vector3(w / 2 - 0.6, 0.25 + i * 0.42, -d / 2 + 0.6), new THREE.Vector3(0.55, 0.38, 0.4)));
  }
  bodyParts.push(boxPart(new THREE.Vector3(w / 2 - 0.9, 1.1, -d / 2 + 0.15), new THREE.Vector3(1.1, 2.2, 0.25)));
  // round-2 detail: small amber status lights on the AC unit + top crate — without
  // these, both props were pure black silhouettes with no readable identity at night.
  const indicatorGeom = new THREE.SphereGeometry(0.05, 6, 5);
  const indicatorParts: GeometryPart[] = [
    { geom: indicatorGeom, matrix: new THREE.Matrix4().makeTranslation(-w / 3 + 0.7, h + 1.05, 0.55), mat: 0 },
    { geom: indicatorGeom, matrix: new THREE.Matrix4().makeTranslation(w / 2 - 0.6, 0.25 + 3 * 0.42 + 0.22, -d / 2 + 0.6), mat: 0 }
  ];
  // wall pipes near the side door — grime/detail pass
  addWallPipes(bodyParts, w / 2 - 0.15, -d / 2 + 1.8, h, Math.PI / 2, rng);
  // sagging power cable from the rooftop AC down to the crates — round-1 street-clutter
  addCableSag(
    bodyParts,
    new THREE.Vector3(-w / 3, h + 0.4, 0.5),
    new THREE.Vector3(w / 2 - 0.6, h * 0.4, -d / 2 + 0.6),
    0.8,
    6
  );

  // amber sidewalk light spill — round-1 fix: v1 was a flat opaque w*0.9 x 3.5 card
  // that blew out to a solid rectangle; now a soft radial pool, roughly door-width.
  spillParts.push({
    geom: new THREE.PlaneGeometry(4.5, 3.2),
    matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0.02, d / 2 + 1.4),
      new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2),
      new THREE.Vector3(1, 1, 1)
    ),
    mat: 0
  });

  // porthole window with silhouettes
  const portholeTex = makePortholeTexture(rng);
  const portholeParts: GeometryPart[] = [
    { geom: new THREE.CircleGeometry(0.9, 20), matrix: new THREE.Matrix4().makeTranslation(-w / 4, h * 0.6, d / 2 + 0.04), mat: 0 }
  ];
  bodyParts.push(
    boxPart(new THREE.Vector3(-w / 4, h * 0.6, d / 2 + 0.02), new THREE.Vector3(2.0, 2.0, 0.06))
  );

  // bottle-wall glow window
  const bottleTex = makeBottleWallTexture(rng);
  const bottleParts: GeometryPart[] = [
    { geom: new THREE.PlaneGeometry(2.2, 1.4), matrix: new THREE.Matrix4().makeTranslation(w / 4, h * 0.55, d / 2 + 0.04), mat: 0 }
  ];

  // marquee — huge flicker-tagged "SYNTH BAR"
  const marqueeTex = makeNeonTextTexture('SYNTH BAR', COLORS.signalMagenta, 'CYBER COCKTAILS');
  const marqueeMesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, 2.0), makeEmissiveMapMat(marqueeTex, 1.9));
  marqueeMesh.position.set(0, h + 1.4, d / 2 + 0.06);
  marqueeMesh.name = 'marquee';
  group.add(marqueeMesh);
  // marquee frame
  bodyParts.push(boxPart(new THREE.Vector3(0, h + 1.4, d / 2 + 0.02), new THREE.Vector3(w * 0.98, 2.2, 0.08)));

  // 4 outdoor stools
  const stoolGeom = new THREE.CylinderGeometry(0.22, 0.2, 0.45, 8);
  const stoolPositions: Array<[number, number]> = [
    [-w / 2 + 1.5, d / 2 + 1.4],
    [-w / 2 + 3.2, d / 2 + 1.4],
    [w / 2 - 1.5, d / 2 + 1.4],
    [w / 2 - 3.2, d / 2 + 1.4]
  ];
  for (const [sx, sz] of stoolPositions) {
    bodyParts.push({ geom: stoolGeom, matrix: new THREE.Matrix4().makeTranslation(sx, 0.22, sz), mat: 0 });
    const anchor = new THREE.Object3D();
    anchor.name = 'seat';
    anchor.position.set(sx, 0.45, sz);
    anchor.rotation.y = Math.PI;
    seats.push(anchor);
    group.add(anchor);
  }

  // standing table
  const tableX = 0;
  const tableZ = d / 2 + 2.6;
  bodyParts.push({
    geom: new THREE.CylinderGeometry(0.4, 0.35, 0.06, 10),
    matrix: new THREE.Matrix4().makeTranslation(tableX, 1.05, tableZ),
    mat: 0
  });
  bodyParts.push({
    geom: new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6),
    matrix: new THREE.Matrix4().makeTranslation(tableX, 0.55, tableZ),
    mat: 0
  });
  const standAnchor = new THREE.Object3D();
  standAnchor.name = 'seat';
  standAnchor.position.set(tableX, 0.0, tableZ - 0.55);
  standAnchor.rotation.y = Math.PI;
  seats.push(standAnchor);
  group.add(standAnchor);

  group.add(mergeOne(bodyParts, makeBodyMat(), 'body'));
  group.add(mergeOne(spillParts, makeSpillMat(makeSpillTexture(COLORS.sodiumAmber), 0.9), 'spill'));
  group.add(mergeOne(portholeParts, makeEmissiveMapMat(portholeTex, 1.5), 'porthole'));
  group.add(mergeOne(bottleParts, makeEmissiveMapMat(bottleTex, 1.8), 'bottleWall'));
  group.add(mergeOne(indicatorParts, makeGlowMat(COLORS.sodiumAmber, 3), 'indicators'));

  group.userData.roofY = h;
  group.userData.footprint = [w, d];
  group.userData.seats = seats;
  group.userData.flicker = [marqueeMesh];
  return group;
}
