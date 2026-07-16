/**
 * NeoCity viewer entry
 *
 * Lays out a handful of KitBash NeoCity pieces in a row so they can be
 * screenshot-inspected with `npm run shoot -- --viewer neocity`.
 *
 * Because `loadNeoCity` is async and `registerAsset` expects a sync factory,
 * the group is populated lazily: the factory returns a placeholder group
 * immediately, then the async load resolves and adds the real pieces.
 * The screenshot harness waits for the `update()` tick so pieces will
 * be present by the time the shot is taken.
 */

import * as THREE from 'three';
import { registerAsset } from '../registry';
import { loadNeoCity, applyNeonMaterials } from '../../assets/buildings/neocity';
import { makeRng } from '../../utils/rng';
import type { Rng } from '../../utils/rng';

// ---------------------------------------------------------------------------
// Layout spec: which pieces to show and where
// ---------------------------------------------------------------------------

interface SlotSpec {
  name: string;
  /** X offset in the row (metres) */
  x: number;
}

const LAYOUT: SlotSpec[] = [
  // Two tall towers at the left
  { name: 'KB3D_NEC_BldgLG_A_Main',  x: -30 },
  { name: 'KB3D_NEC_BldgLG_B_Main',  x:   0 },
  // Neon sign piece — best for checking emissive glow
  { name: 'KB3D_NEC_BldgSM_C_NeonSignA', x: 25 },
  // Small building with emissive detail
  { name: 'KB3D_NEC_BldgSM_A_Main',  x: 35 },
  // A piece without emissive to verify body-only path
  { name: 'KB3D_NEC_BldgSM_C_Fan',   x: 42 },
];

// ---------------------------------------------------------------------------
// registerAsset('neocity')
// ---------------------------------------------------------------------------

registerAsset('neocity', (rng: Rng) => {
  const group = new THREE.Group();

  // Placeholder ambient light so the scene isn't black while loading
  const ambient = new THREE.AmbientLight(0x223355, 1.5);
  group.add(ambient);

  // Kick off the async load; populate group when ready.
  loadNeoCity().then((lib) => {
    for (const slot of LAYOUT) {
      // Try the requested piece name; fall back gracefully if not in lib.
      let pieceGroup = lib.get(slot.name);

      if (!pieceGroup) {
        // If the named piece isn't available, pick ANY loaded piece as a stand-in
        const available = Object.values(lib.pieces).find((p) => p.scene !== null);
        if (available) {
          pieceGroup = available.scene!.clone(true) as THREE.Group;
          applyNeonMaterials(pieceGroup, makeRng(slot.x | 0));
        }
      }

      if (!pieceGroup) continue;

      pieceGroup.position.x = slot.x;
      // Sit on the ground plane
      pieceGroup.position.y = 0;
      group.add(pieceGroup);
    }
  }).catch((err) => {
    console.warn('[neocity viewer] loadNeoCity failed:', err);
  });

  // Neon point lights scattered through the row for glow effect in screenshots
  const neonColors = [0xb7f5e9, 0xff2bd6, 0xffb347];
  for (let i = 0; i < 3; i++) {
    const pt = new THREE.PointLight(neonColors[i % neonColors.length], 3, 25);
    pt.position.set(-20 + i * 20, 8, 5);
    group.add(pt);
  }

  return {
    group,
    updateAmbient(_sec: number) {
      // Nothing to animate; pieces are static in this viewer.
    },
  };
});
