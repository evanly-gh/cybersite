import * as THREE from 'three';
import { registerAsset } from '../registry';
import { RESUME, type ImageSlot } from '../../content/resume';
import { makePlaceholder } from '../../content/placeholders';
import { AD_SIZES, makeAd, type AdFormat } from '../../content/adGenerator';

interface WallCell {
  texture: THREE.Texture;
  w: number;
  h: number;
}

/**
 * Task 5 verification helper: lays `cells` out into a `cols`-wide grid of emissive
 * planes, each fitted (aspect preserved) inside a uniform `cellW`x`cellH` slot so wildly
 * different image aspect ratios (e.g. 512x1194 portrait vs. 2048x256 strip) don't distort
 * the overall grid pitch. Materials are emissive-only (no lit `map`) so brightness is
 * fully controlled by the texture + emissiveIntensity, independent of scene lighting —
 * that's what keeps bloom consistent instead of blowing bright textures out to white.
 * Used by the `adWall` and `placeholderWall` viewer assets only.
 */
export function buildWall(
  cells: WallCell[],
  cols: number,
  cellW: number,
  cellH: number,
  gap: number
): THREE.Group {
  const group = new THREE.Group();
  const rows = Math.ceil(cells.length / cols);
  const pitchX = cellW + gap;
  const pitchY = cellH + gap;
  const totalWidth = cols * pitchX - gap;
  const totalHeight = rows * pitchY - gap;

  cells.forEach((cell, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const fit = Math.min(cellW / cell.w, cellH / cell.h);
    const geo = new THREE.PlaneGeometry(cell.w * fit, cell.h * fit);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: cell.texture,
      emissiveIntensity: 1.1
    });
    const mesh = new THREE.Mesh(geo, mat);
    const x = -totalWidth / 2 + col * pitchX + cellW / 2;
    const y = totalHeight / 2 - row * pitchY - cellH / 2;
    mesh.position.set(x, y, 0);
    group.add(mesh);
  });

  return group;
}

const AD_FORMATS: AdFormat[] = ['landscape', 'portrait', 'square', 'strip', 'vcard'];

// Task 5 verification: 6x2 grid sampling all 5 ad formats + rng-picked brands.
registerAsset('adWall', (rng) => {
  const cells: WallCell[] = Array.from({ length: 12 }, (_, i) => {
    const format = AD_FORMATS[i % AD_FORMATS.length];
    const [w, h] = AD_SIZES[format];
    return { texture: makeAd(format, rng), w, h };
  });
  return buildWall(cells, 6, 3, 3, 0.5);
});

// Task 5 verification: every RESUME ImageSlot rendered as its placeholder texture.
registerAsset('placeholderWall', () => {
  const slots: ImageSlot[] = [
    RESUME.about.faceImage,
    ...RESUME.about.misc,
    ...RESUME.projectsMain.map((p) => p.image),
    ...RESUME.projectsSmall.map((p) => p.image),
    ...RESUME.research.map((p) => p.image)
  ];
  const cells: WallCell[] = slots.map((slot) => ({
    texture: makePlaceholder(slot),
    w: slot.w,
    h: slot.h
  }));
  return buildWall(cells, 5, 3, 3, 0.5);
});
