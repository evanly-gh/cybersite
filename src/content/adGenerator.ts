import * as THREE from 'three';
import { makeCanvasTexture, wrapText } from '../utils/canvasText';
import { COLORS } from '../theme';
import type { Rng } from '../utils/rng';

export type AdFormat = 'landscape' | 'portrait' | 'square' | 'strip' | 'vcard';

export const AD_SIZES: Record<AdFormat, [number, number]> = {
  landscape: [1024, 576],
  portrait: [512, 1194],
  square: [512, 512],
  strip: [2048, 256],
  vcard: [512, 768]
};

// Ad backgrounds are always drawn from one of these three families — NEVER tron-cyan,
// which is reserved for the biker/protagonist per the palette rule.
type ColorFamily = 'magenta' | 'amber' | 'teal';
const FAMILY_KEYS: readonly ColorFamily[] = ['magenta', 'amber', 'teal'];
const FAMILY_BASE: Record<ColorFamily, number> = {
  magenta: COLORS.signalMagenta,
  amber: COLORS.sodiumAmber,
  teal: COLORS.holoTeal
};

type GlyphFn = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  accent: string,
  ink: string
) => void;

interface Brand {
  name: string;
  slogan: string;
  glyph: GlyphFn;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** Linearly interpolates two 0xRRGGBB colors (t=0 -> a, t=1 -> b); returns an rgb() string. */
function mixHex(a: number, b: number, t: number): string {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bch = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bch})`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexPoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function drawHexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const pts = hexPoints(cx, cy, r);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

// --- Brand glyphs (drawn with canvas paths, never photography) --------------------

const glyphHexGrid: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  const r = size * 0.16;
  const dist = r * Math.sqrt(3);
  ctx.lineWidth = size * 0.012;
  ctx.strokeStyle = ink;
  ctx.fillStyle = accent;
  drawHexPath(ctx, cx, cy, r);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = cx + dist * Math.cos(a);
    const y = cy + dist * Math.sin(a);
    drawHexPath(ctx, x, y, r);
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
};

const glyphLightningCan: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  const cw = size * 0.5;
  const ch = size * 0.92;
  const x = cx - cw / 2;
  const y = cy - ch / 2;
  roundRectPath(ctx, x, y, cw, ch, size * 0.08);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.lineWidth = size * 0.015;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + ch * 0.14);
  ctx.lineTo(x + cw, y + ch * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + cw * 0.1, y + ch * 0.2);
  ctx.lineTo(cx - cw * 0.16, y + ch * 0.58);
  ctx.lineTo(cx + cw * 0.02, y + ch * 0.58);
  ctx.lineTo(cx - cw * 0.12, y + ch * 0.92);
  ctx.lineTo(cx + cw * 0.22, y + ch * 0.42);
  ctx.lineTo(cx + cw * 0.02, y + ch * 0.42);
  ctx.closePath();
  ctx.fillStyle = ink;
  ctx.fill();
};

const glyphRamenBowl: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  const bw = size * 0.72;
  const bh = size * 0.34;
  ctx.beginPath();
  ctx.ellipse(cx, cy, bw / 2, bh / 2, 0, 0, Math.PI);
  ctx.lineTo(cx - bw * 0.34, cy + bh * 0.45);
  ctx.quadraticCurveTo(cx, cy + bh * 0.72, cx + bw * 0.34, cy + bh * 0.45);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.lineWidth = size * 0.012;
  ctx.strokeStyle = ink;
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.01;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * bw * 0.16, cy - bh * 0.05);
    ctx.quadraticCurveTo(cx + i * bw * 0.16 + size * 0.03, cy - bh * 0.4, cx + i * bw * 0.16, cy - bh * 0.7);
    ctx.stroke();
  }

  // arrow through the bowl — a vector-search pun.
  const x0 = cx - bw * 0.5;
  const y0 = cy + bh * 0.4;
  const x1 = cx + bw * 0.5;
  const y1 = cy - bh * 0.6;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = size * 0.02;
  ctx.stroke();
  const angle = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - size * 0.07 * Math.cos(angle - 0.5), y1 - size * 0.07 * Math.sin(angle - 0.5));
  ctx.lineTo(x1 - size * 0.07 * Math.cos(angle + 0.5), y1 - size * 0.07 * Math.sin(angle + 0.5));
  ctx.closePath();
  ctx.fillStyle = ink;
  ctx.fill();
};

const glyphAfterimageChevrons: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  const n = 4;
  for (let i = 0; i < n; i++) {
    const off = i * size * 0.1;
    ctx.globalAlpha = 1 - i * 0.2;
    ctx.strokeStyle = i === 0 ? ink : accent;
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.28 - off, cy - size * 0.32);
    ctx.lineTo(cx + size * 0.16 - off, cy);
    ctx.lineTo(cx - size * 0.28 - off, cy + size * 0.32);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

const glyphBolt: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  ctx.beginPath();
  ctx.moveTo(cx + size * 0.1, cy - size * 0.42);
  ctx.lineTo(cx - size * 0.2, cy + size * 0.04);
  ctx.lineTo(cx + size * 0.02, cy + size * 0.04);
  ctx.lineTo(cx - size * 0.12, cy + size * 0.42);
  ctx.lineTo(cx + size * 0.24, cy - size * 0.02);
  ctx.lineTo(cx + size * 0.02, cy - size * 0.02);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.lineWidth = size * 0.015;
  ctx.strokeStyle = ink;
  ctx.stroke();
};

const glyphTransitLoop: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  const r = size * 0.32;
  ctx.lineWidth = size * 0.045;
  ctx.strokeStyle = accent;
  ctx.setLineDash([size * 0.05, size * 0.045]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(cx + r, cy, size * 0.055, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
};

const glyphOrbitFork: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  ctx.strokeStyle = accent;
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * 0.36, size * 0.15, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.02;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + size * 0.44 + i * size * 0.05, cy - size * 0.2);
    ctx.lineTo(cx + size * 0.44 + i * size * 0.05, cy + size * 0.02);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx + size * 0.44, cy + size * 0.02);
  ctx.lineTo(cx + size * 0.44, cy + size * 0.3);
  ctx.stroke();
};

const glyphKanji: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  ctx.font = `bold ${Math.round(size * 0.66)}px "Unbounded", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent;
  ctx.fillText('旅', cx, cy + size * 0.02);
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = ink;
  ctx.strokeRect(cx - size * 0.38, cy - size * 0.42, size * 0.76, size * 0.84);
};

const glyphSynthWave: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  ctx.strokeStyle = accent;
  ctx.lineWidth = size * 0.025;
  ctx.beginPath();
  for (let x = -0.4; x <= 0.4; x += 0.02) {
    const px = cx + x * size;
    const py = cy - size * 0.06 + Math.sin(x * Math.PI * 4) * size * 0.12;
    if (x === -0.4) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.15, cy + size * 0.24);
  ctx.lineTo(cx + size * 0.15, cy + size * 0.24);
  ctx.lineTo(cx, cy + size * 0.4);
  ctx.closePath();
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.02;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.4);
  ctx.lineTo(cx, cy + size * 0.5);
  ctx.stroke();
};

const glyphCreditChip: GlyphFn = (ctx, cx, cy, size, accent, ink) => {
  const cw = size * 0.52;
  const ch = size * 0.36;
  roundRectPath(ctx, cx - cw / 2, cy - ch / 2, cw, ch, size * 0.045);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.015;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - cw * 0.3, cy - ch * 0.15);
  ctx.lineTo(cx - cw * 0.05, cy - ch * 0.15);
  ctx.lineTo(cx - cw * 0.05, cy + ch * 0.15);
  ctx.lineTo(cx + cw * 0.3, cy + ch * 0.15);
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.012;
  ctx.stroke();
};

const BRANDS: Brand[] = [
  { name: 'MAM INDUSTRIES', slogan: 'compress everything.', glyph: glyphHexGrid },
  { name: 'Q4_K_M ENERGY', slogan: 'quantized for speed.', glyph: glyphLightningCan },
  { name: 'PGVECTOR RAMEN', slogan: 'nearest-neighbor noodles.', glyph: glyphRamenBowl },
  { name: 'SANDEVISTAN TUNE-UPS', slogan: 'outrun your afterimage.', glyph: glyphAfterimageChevrons },
  { name: '髙電 HI-VOLT', slogan: 'never brownout.', glyph: glyphBolt },
  { name: 'NIGHT LOOP TRANSIT', slogan: 'the city never stops.', glyph: glyphTransitLoop },
  { name: 'ORBITAL EATS', slogan: 'delivery in orbit.', glyph: glyphOrbitFork },
  { name: 'KANJI HOTEL 旅', slogan: 'rest between routes.', glyph: glyphKanji },
  { name: 'SYNTH BAR', slogan: 'analog warmth, digital proof.', glyph: glyphSynthWave },
  { name: 'EDGE CREDIT', slogan: 'inference on layaway.', glyph: glyphCreditChip }
];

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, family: ColorFamily): void {
  const base = FAMILY_BASE[family];
  // Mix toward the dark theme colors rather than lightening toward white: holoTeal is
  // already near-white, so lightening it (as the bright gradient stop) blew every teal
  // ad out to a solid white blob once bloom picked it up. Mixing toward shadow-blue /
  // void instead keeps every family's gradient legibly dark regardless of source hue.
  const bright = mixHex(base, COLORS.shadowBlue, 0.35);
  const dark = mixHex(base, COLORS.void, 0.8);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, bright);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, ink: string): void {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const step = Math.max(3, Math.round(h / 120));
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Shrinks font size until `text` wraps to at most `maxLines`, then draws it. Returns block height. */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  family: string,
  weight: string,
  startPx: number,
  minPx: number,
  maxLines: number,
  color: string,
  align: 'center' | 'left'
): number {
  let px = startPx;
  let lines: string[] = [text];
  while (px > minPx) {
    ctx.font = `${weight} ${px}px "${family}"`;
    lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
    px -= 1;
  }
  ctx.font = `${weight} ${px}px "${family}"`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const lineHeight = px * 1.25;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, y + i * lineHeight);
  });
  return lines.length * lineHeight;
}

function layoutVertical(ctx: CanvasRenderingContext2D, w: number, h: number, brand: Brand, accent: string, ink: string): void {
  const pad = w * 0.1;
  const glyphSize = Math.min(w, h) * 0.4;
  const glyphCy = h * 0.28;
  brand.glyph(ctx, w / 2, glyphCy, glyphSize, accent, ink);

  let y = glyphCy + glyphSize * 0.66;
  const nameHeight = drawWrapped(
    ctx,
    brand.name,
    w / 2,
    y,
    w - pad * 2,
    'Unbounded',
    'bold',
    Math.round(w * 0.095),
    16,
    2,
    ink,
    'center'
  );
  y += nameHeight + h * 0.025;
  drawWrapped(
    ctx,
    brand.slogan,
    w / 2,
    y,
    w - pad * 2,
    'Share Tech Mono',
    'normal',
    Math.round(w * 0.045),
    12,
    2,
    accent,
    'center'
  );
}

function layoutHorizontal(ctx: CanvasRenderingContext2D, w: number, h: number, brand: Brand, accent: string, ink: string): void {
  const glyphSize = Math.min(h * 0.62, w * 0.3);
  const cx = w * 0.02 + glyphSize * 0.62;
  brand.glyph(ctx, cx, h / 2, glyphSize, accent, ink);

  const textX = cx + glyphSize * 0.6;
  const maxTextWidth = w - textX - w * 0.04;
  let y = h * 0.4;
  const nameHeight = drawWrapped(
    ctx,
    brand.name,
    textX,
    y,
    maxTextWidth,
    'Unbounded',
    'bold',
    Math.round(h * 0.17),
    16,
    2,
    ink,
    'left'
  );
  y += nameHeight + h * 0.03;
  drawWrapped(
    ctx,
    brand.slogan,
    textX,
    y,
    maxTextWidth,
    'Share Tech Mono',
    'normal',
    Math.round(h * 0.095),
    12,
    2,
    accent,
    'left'
  );
}

/**
 * Draws one fake billboard ad: rng-picked brand + rng-picked color family
 * (magenta/amber/teal — never tron-cyan), 2-color gradient bg, a canvas-path glyph,
 * brand name (Unbounded) + slogan (mono), scanlines and a 2px border. Portrait/vcard/
 * square use a vertical stacked layout; landscape/strip use a horizontal glyph-left
 * layout.
 */
export function makeAd(format: AdFormat, rng: Rng): THREE.CanvasTexture {
  const [w, h] = AD_SIZES[format];
  const brand = rng.pick(BRANDS);
  const family = rng.pick(FAMILY_KEYS);

  return makeCanvasTexture(w, h, (ctx) => {
    drawBackground(ctx, w, h, family);
    const base = FAMILY_BASE[family];
    const accent = mixHex(base, 0xffffff, 0.18);
    const ink = hex(COLORS.moonlight);

    if (format === 'landscape' || format === 'strip') {
      layoutHorizontal(ctx, w, h, brand, accent, ink);
    } else {
      layoutVertical(ctx, w, h, brand, accent, ink);
    }

    drawFrame(ctx, w, h, ink);
  });
}
