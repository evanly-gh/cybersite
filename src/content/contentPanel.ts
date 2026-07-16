/**
 * contentPanel.ts
 * Renders résumé content (about hero, bio, projects, research) as CanvasTextures
 * suitable for use as emissiveMap on in-world display meshes.
 *
 * All canvas/document access is deferred to inside functions — never at module-eval time.
 */
import * as THREE from 'three';
import { makeCanvasTexture, drawPanel, wrapText } from '../utils/canvasText';
import { makePlaceholder } from './placeholders';
import { RESUME } from './resume';
import { COLORS } from '../theme';
import type { Project } from './resume';

// Palette helpers — convert the numeric COLORS to CSS hex strings.
function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

const TEAL    = hex(COLORS.holoTeal);      // #b7f5e9
const MAGENTA = hex(COLORS.signalMagenta); // #ff2bd6
const AMBER   = hex(COLORS.sodiumAmber);   // #ffb347
const MOON    = hex(COLORS.moonlight);     // #f5f0e6
const BG      = hex(COLORS.shadowBlue) + 'ee'; // #101426ee

// Canvas dimensions for each panel type.
const ABOUT_W = 800;
const ABOUT_H = 1000;
const BIO_W   = 1024;
const BIO_H   = 512;
const PROJ_W  = 1280;
const PROJ_H  = 720;
const RES_W   = 1280;
const RES_H   = 720;

/**
 * About-hero panel: portrait placeholder + "Evan Li" name + tagline.
 */
export function makeAboutHeroTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(ABOUT_W, ABOUT_H, (ctx) => {
    // Dark base panel with teal accent.
    drawPanel(ctx, {
      w: ABOUT_W,
      h: ABOUT_H,
      eyebrow: 'ABOUT',
      title: RESUME.name,
      bg: BG,
      accent: TEAL,
      align: 'center',
    });

    // Portrait image area — draw placeholder visuals (dashed border + label).
    const imgW = ABOUT_W - 64;
    const imgH = Math.round(imgW * (RESUME.about.faceImage.h / RESUME.about.faceImage.w));
    const imgX = 32;
    const imgY = 100;

    // Clamp so the image area stays within the canvas.
    const clampedH = Math.min(imgH, ABOUT_H - imgY - 120);

    // Draw a bordered image slot.
    ctx.save();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(imgX, imgY, imgW, clampedH);
    ctx.restore();

    // Label inside the image slot.
    ctx.font = '12px "Share Tech Mono"';
    ctx.fillStyle = TEAL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(RESUME.about.faceImage.label, ABOUT_W / 2, imgY + clampedH / 2);

    // Tagline below the portrait.
    const tagY = imgY + clampedH + 32;
    ctx.font = '14px "Rajdhani"';
    ctx.fillStyle = AMBER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const tagLines = wrapText(ctx, RESUME.tagline, ABOUT_W - 64);
    let lineY = tagY;
    for (const line of tagLines) {
      ctx.fillText(line, ABOUT_W / 2, lineY);
      lineY += 20;
    }

    // Magenta accent line below tagline.
    ctx.save();
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(32, lineY + 8);
    ctx.lineTo(ABOUT_W - 32, lineY + 8);
    ctx.stroke();
    ctx.restore();
  });
}

/**
 * Bio panel: the about paragraph, word-wrapped.
 */
export function makeBioTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(BIO_W, BIO_H, (ctx) => {
    drawPanel(ctx, {
      w: BIO_W,
      h: BIO_H,
      eyebrow: 'BIO',
      title: 'About',
      body: RESUME.about.paragraph,
      bg: BG,
      accent: TEAL,
      align: 'left',
    });
  });
}

/**
 * Project panel: image slot + title + stack badge + blurb.
 */
export function makeProjectTexture(p: Project): THREE.CanvasTexture {
  return makeCanvasTexture(PROJ_W, PROJ_H, (ctx) => {
    // Base panel — eyebrow + title drawn by drawPanel.
    drawPanel(ctx, {
      w: PROJ_W,
      h: PROJ_H,
      eyebrow: 'PROJECT',
      title: p.title,
      bg: BG,
      accent: MAGENTA,
      align: 'left',
    });

    const padding = 16;
    let y = 80; // below drawPanel title region

    // Stack badge row.
    ctx.font = '12px "Share Tech Mono"';
    ctx.fillStyle = AMBER;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(p.stack, padding, y);
    y += 24;

    // Blurb (word-wrapped).
    ctx.font = '14px "Rajdhani"';
    ctx.fillStyle = MOON;
    const blurbLines = wrapText(ctx, p.blurb, PROJ_W - padding * 2);
    for (const line of blurbLines) {
      ctx.fillText(line, padding, y);
      y += 20;
    }

    y += 12;

    // Image slot placeholder area in the remaining space.
    const imgAreaH = Math.max(40, PROJ_H - y - 24);
    const imgAreaW = PROJ_W - padding * 2;

    ctx.save();
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(padding, y, imgAreaW, imgAreaH);
    ctx.restore();

    // Crosshair diagonals inside image slot.
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + imgAreaW, y + imgAreaH);
    ctx.moveTo(padding + imgAreaW, y);
    ctx.lineTo(padding, y + imgAreaH);
    ctx.stroke();
    ctx.restore();

    // Label.
    ctx.font = '11px "Share Tech Mono"';
    ctx.fillStyle = MAGENTA;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.image.label, PROJ_W / 2, y + imgAreaH / 2);
  });
}

/**
 * Research panel: same shape as project panel but with teal accent.
 */
export function makeResearchTexture(p: Project): THREE.CanvasTexture {
  return makeCanvasTexture(RES_W, RES_H, (ctx) => {
    drawPanel(ctx, {
      w: RES_W,
      h: RES_H,
      eyebrow: 'RESEARCH',
      title: p.title,
      bg: BG,
      accent: TEAL,
      align: 'left',
    });

    const padding = 16;
    let y = 80;

    // Stack badge.
    ctx.font = '12px "Share Tech Mono"';
    ctx.fillStyle = AMBER;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(p.stack, padding, y);
    y += 24;

    // Blurb.
    ctx.font = '14px "Rajdhani"';
    ctx.fillStyle = MOON;
    const blurbLines = wrapText(ctx, p.blurb, RES_W - padding * 2);
    for (const line of blurbLines) {
      ctx.fillText(line, padding, y);
      y += 20;
    }

    y += 12;

    // Image slot.
    const imgAreaH = Math.max(40, RES_H - y - 24);
    const imgAreaW = RES_W - padding * 2;

    ctx.save();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(padding, y, imgAreaW, imgAreaH);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + imgAreaW, y + imgAreaH);
    ctx.moveTo(padding + imgAreaW, y);
    ctx.lineTo(padding, y + imgAreaH);
    ctx.stroke();
    ctx.restore();

    ctx.font = '11px "Share Tech Mono"';
    ctx.fillStyle = TEAL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.image.label, RES_W / 2, y + imgAreaH / 2);
  });
}
