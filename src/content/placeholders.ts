import * as THREE from 'three';
import { makeCanvasTexture } from '../utils/canvasText';
import { COLORS } from '../theme';
import type { ImageSlot } from './resume';

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/**
 * Fits `text` inside `maxWidth` by shrinking the font size (never below `minPx`).
 * Returns the font size (px) that was used.
 */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  startPx: number,
  minPx: number,
  maxWidth: number
): number {
  let px = startPx;
  while (px > minPx) {
    ctx.font = `${px}px "${family}"`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 1;
  }
  ctx.font = `${px}px "${family}"`;
  return px;
}

/**
 * Renders a shadow-blue "upload me" placeholder panel: dashed holo-teal border,
 * faint crosshair diagonals, and a centered mono label reading
 * `${label} — upload ${w}×${h}` (wrapped to two lines if it would clip).
 */
export function makePlaceholder(slot: ImageSlot): THREE.CanvasTexture {
  const { w, h, label } = slot;

  return makeCanvasTexture(w, h, (ctx) => {
    const margin = Math.max(8, Math.round(Math.min(w, h) * 0.02));

    // Shadow-blue base fill with a subtle radial vignette toward the edges.
    ctx.fillStyle = hex(COLORS.shadowBlue);
    ctx.fillRect(0, 0, w, h);

    const vignette = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.15,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.7
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // Crosshair diagonals corner-to-corner, faint holo-teal.
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = hex(COLORS.holoTeal);
    ctx.lineWidth = Math.max(1, Math.round(Math.min(w, h) * 0.003));
    ctx.beginPath();
    ctx.moveTo(margin, margin);
    ctx.lineTo(w - margin, h - margin);
    ctx.moveTo(w - margin, margin);
    ctx.lineTo(margin, h - margin);
    ctx.stroke();
    ctx.restore();

    // Dashed holo-teal border.
    ctx.save();
    ctx.strokeStyle = hex(COLORS.holoTeal);
    ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    ctx.setLineDash([Math.round(w * 0.02), Math.round(w * 0.012)]);
    ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
    ctx.restore();

    // Centered mono label: "${label} — upload ${w}×${h}", wrapped to fit.
    const full = `${label} — upload ${w}×${h}`;
    const maxTextWidth = w - margin * 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hex(COLORS.holoTeal);

    const startPx = Math.round(Math.min(w, h) * 0.055);
    const minPx = 10;
    let px = fitFont(ctx, full, 'Share Tech Mono', startPx, minPx, maxTextWidth);

    if (ctx.measureText(full).width > maxTextWidth) {
      // Still doesn't fit on one line at the minimum size — split label / dims.
      const dimsLine = `upload ${w}×${h}`;
      px = fitFont(ctx, label, 'Share Tech Mono', startPx, minPx, maxTextWidth);
      const px2 = fitFont(ctx, dimsLine, 'Share Tech Mono', px, minPx, maxTextWidth);
      const lineGap = Math.max(px, px2) * 1.3;
      ctx.font = `${px}px "Share Tech Mono"`;
      ctx.fillText(label, w / 2, h / 2 - lineGap / 2);
      ctx.font = `${px2}px "Share Tech Mono"`;
      ctx.fillText(dimsLine, w / 2, h / 2 + lineGap / 2);
    } else {
      ctx.font = `${px}px "Share Tech Mono"`;
      ctx.fillText(full, w / 2, h / 2);
    }

    // Faint scanlines to match the holo aesthetic.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const step = Math.max(3, Math.round(h / 150));
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  });
}
