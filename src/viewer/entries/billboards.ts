import * as THREE from 'three';
import { registerAsset } from '../registry';
import { COLORS } from '../../theme';
import {
  buildBillboard,
  DEFAULT_WIDTH_M,
  type BillboardMount
} from '../../assets/billboards/billboards';
import type { AdFormat } from '../../content/adGenerator';

/**
 * Task 13 verification: `billboardGallery` — all 15 format x mount combos on one
 * grid. Rows (z) = mounts, columns (x) = formats. Wall mounts get a stub wall slab
 * to hang on; roof mounts get a stub rooftop pedestal — both viewer-only props (the
 * per-billboard <=4 draw-call budget applies to buildBillboard, not this test rig).
 * updateAmbient is passed through so the harness' ?sec= drives flicker/UV scroll.
 */

const FORMATS: AdFormat[] = ['landscape', 'portrait', 'square', 'strip', 'vcard'];
const MOUNTS: BillboardMount[] = ['stand', 'wall', 'roof'];
const GAP = 5;
const ROW_PITCH = 26;

registerAsset('billboardGallery', (rng) => {
  const group = new THREE.Group();
  const updates: Array<(sec: number) => void> = [];

  const propMat = new THREE.MeshStandardMaterial({
    color: mixHex(COLORS.shadowBlue, COLORS.void, 0.45),
    roughness: 0.9,
    metalness: 0.1
  });

  MOUNTS.forEach((mount, row) => {
    const z = -row * ROW_PITCH;
    let x = 0;
    for (const format of FORMATS) {
      const w = DEFAULT_WIDTH_M[format];
      const cx = x + w / 2;
      const bb = buildBillboard(rng, { format, mount });
      updates.push(bb.updateAmbient);

      // screen height (same math as billboards.ts) for wall/roof placement
      const box = new THREE.Box3().setFromObject(bb.group);
      const bbH = box.max.y - box.min.y;

      if (mount === 'wall') {
        // wall slab standing on the ground; billboard origin on its front face
        const slabW = w + 4;
        const slabH = bbH + 5;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, slabH, 0.8), propMat);
        slab.position.set(cx, slabH / 2, z - 0.4);
        group.add(slab);
        bb.group.position.set(cx, bbH / 2 + 2.5, z);
      } else if (mount === 'roof') {
        // rooftop pedestal — a stub building top
        const pedH = 5;
        const ped = new THREE.Mesh(new THREE.BoxGeometry(w + 3, pedH, 8), propMat);
        ped.position.set(cx, pedH / 2, z - 1);
        group.add(ped);
        bb.group.position.set(cx, pedH, z - 1);
      } else {
        bb.group.position.set(cx, 0, z);
      }

      group.add(bb.group);
      x += w + GAP;
    }
  });

  return {
    group,
    updateAmbient(sec: number): void {
      for (const u of updates) u(sec);
    }
  };
});

// Single stand-mounted landscape at the origin, for close-up detail shots.
registerAsset('billboardCloseup', (rng) => {
  const bb = buildBillboard(rng, { format: 'landscape', mount: 'stand' });
  return { group: bb.group, updateAmbient: bb.updateAmbient };
});

// Roof-mounted landscape on a stub pedestal — A-frame/catwalk/spotlight review.
registerAsset('billboardRoof', (rng) => {
  const group = new THREE.Group();
  const ped = new THREE.Mesh(
    new THREE.BoxGeometry(16, 4, 9),
    new THREE.MeshStandardMaterial({ color: mixHex(COLORS.shadowBlue, COLORS.void, 0.45), roughness: 0.9 })
  );
  ped.position.set(0, 2, -1);
  const bb = buildBillboard(rng, { format: 'landscape', mount: 'roof' });
  bb.group.position.set(0, 4, -1);
  group.add(ped, bb.group);
  return { group, updateAmbient: bb.updateAmbient };
});

// Wall portrait forced to the perpendicular flag-arm variant (retries rng picks).
registerAsset('billboardWallFlag', (rng) => {
  let bb = buildBillboard(rng, { format: 'portrait', mount: 'wall' });
  for (let i = 0; i < 11; i++) {
    const screen = bb.group.getObjectByName('screen')!;
    if (Math.abs(new THREE.Euler().setFromQuaternion(screen.quaternion).y) > 0.1) break;
    bb = buildBillboard(rng, { format: 'portrait', mount: 'wall' });
  }
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(8, 16, 0.8),
    new THREE.MeshStandardMaterial({ color: mixHex(COLORS.shadowBlue, COLORS.void, 0.45), roughness: 0.9 })
  );
  wall.position.set(0, 8, -0.4);
  bb.group.position.set(0, 9, 0);
  const group = new THREE.Group();
  group.add(wall, bb.group);
  return { group, updateAmbient: bb.updateAmbient };
});

function mixHex(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}
