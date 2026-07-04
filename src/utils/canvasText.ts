import * as THREE from 'three';

/**
 * Creates a THREE.CanvasTexture from a canvas and drawing function
 * @param w - Canvas width
 * @param h - Canvas height
 * @param draw - Function to draw on the canvas context
 * @returns A CanvasTexture with SRGBColorSpace and anisotropy 4
 */
export function makeCanvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');

  draw(ctx);

  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Wraps text to fit within a given width
 * @param ctx - Canvas context
 * @param text - Text to wrap
 * @param maxWidth - Maximum width in pixels
 * @returns Array of text lines
 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const { width } = ctx.measureText(testLine);

    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Panel drawing options
 */
export interface PanelOptions {
  w: number;
  h: number;
  eyebrow?: string;
  title?: string;
  body?: string;
  accent?: string;
  bg?: string;
  align?: 'left' | 'center';
}

/**
 * Draws a house-style panel on the canvas context
 * Features: background, accent border with corner ticks, eyebrow, title, body, scanlines
 * @param ctx - Canvas context
 * @param o - Panel options
 */
export function drawPanel(ctx: CanvasRenderingContext2D, o: PanelOptions): void {
  const { w, h, align = 'left' } = o;
  const accent = o.accent ?? '#B7F5E9';
  const bg = o.bg ?? '#101426ee';
  const eyebrow = o.eyebrow ?? '';
  const title = o.title ?? '';
  const body = o.body ?? '';

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Border and corner ticks (2px accent border)
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, w, h);

  // Corner ticks (small lines at corners)
  const tickLength = 12;
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tickLength, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, tickLength);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(w, 0);
  ctx.lineTo(w - tickLength, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(w, 0);
  ctx.lineTo(w, tickLength);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(tickLength, h);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h - tickLength);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(w, h);
  ctx.lineTo(w - tickLength, h);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(w, h);
  ctx.lineTo(w, h - tickLength);
  ctx.stroke();

  // Text positioning
  let y = 16;
  const padding = 16;
  const contentWidth = w - padding * 2;

  // Eyebrow in Share Tech Mono, uppercase, letter-spaced
  if (eyebrow) {
    ctx.font = '12px "Share Tech Mono"';
    ctx.fillStyle = accent;
    ctx.letterSpacing = '2px';
    ctx.textAlign = align === 'center' ? 'center' : 'left';
    const eyebrowX = align === 'center' ? w / 2 : padding;
    ctx.fillText(eyebrow.toUpperCase(), eyebrowX, y);
    y += 24;
  }

  // Title in Unbounded
  if (title) {
    ctx.font = 'bold 20px "Unbounded"';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '0px';
    ctx.textAlign = align === 'center' ? 'center' : 'left';
    const titleX = align === 'center' ? w / 2 : padding;
    ctx.fillText(title, titleX, y);
    y += 32;
  }

  // Body in Rajdhani with word-wrap
  if (body) {
    ctx.font = '14px "Rajdhani"';
    ctx.fillStyle = '#cccccc';
    ctx.letterSpacing = '0px';
    ctx.textAlign = align === 'center' ? 'center' : 'left';

    const lines = wrapText(ctx, body, contentWidth);
    for (const line of lines) {
      const bodyX = align === 'center' ? w / 2 : padding;
      ctx.fillText(line, bodyX, y);
      y += 18;
    }
  }

  // Scanlines every 4px at 5% alpha
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let scanY = 0; scanY < h; scanY += 4) {
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(w, scanY);
    ctx.stroke();
  }
}
