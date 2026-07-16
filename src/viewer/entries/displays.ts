/**
 * Viewer entry: displays
 *
 * Shows a small representative subset of the content display surfaces that
 * buildDisplays() produces — one of each kind arranged in a flat gallery so
 * the billboard + holo panel visuals can be reviewed in isolation.
 *
 * Usage: `npm run shoot -- --viewer displays`
 */

import * as THREE from 'three';
import { registerAsset } from '../registry';
import { buildDisplays } from '../../world/displays';
import type { DisplayAnchor } from '../../world/cityLayout';

registerAsset('displays', () => {
  // One anchor of each kind, arranged in a row along X, all facing +Z.
  const faceZ = new THREE.Quaternion(); // identity → local +Z faces viewer at z>0

  const anchors: DisplayAnchor[] = [
    { pos: new THREE.Vector3(-32, 12, 0), quat: faceZ, kind: 'aboutHero' },
    { pos: new THREE.Vector3(-14,  6, 0), quat: faceZ, kind: 'aboutSign' },
    { pos: new THREE.Vector3(  4, 12, 0), quat: faceZ, kind: 'projBig' },
    { pos: new THREE.Vector3( 20,  8, 0), quat: faceZ, kind: 'projSmall' },
    { pos: new THREE.Vector3( 36, 12, 0), quat: faceZ, kind: 'research' },
  ];

  const displays = buildDisplays(anchors);

  // Add a simple ambient light so the billboard structure is readable.
  const ambient = new THREE.AmbientLight(0x223355, 1.5);
  displays.group.add(ambient);

  // A few neon point lights to add depth.
  const neonColors = [0xb7f5e9, 0xff2bd6, 0xffb347] as const;
  neonColors.forEach((c, i) => {
    const pt = new THREE.PointLight(c, 3, 50);
    pt.position.set(-20 + i * 22, 10, 6);
    displays.group.add(pt);
  });

  return {
    group: displays.group,
    updateAmbient(sec: number): void {
      displays.updateAmbient(sec);
    },
  };
});

// 'displaysAll' — uses the full 11-anchor set from cityLayout so every content
// slot is exercised side-by-side.
registerAsset('displaysAll', () => {
  const faceZ = new THREE.Quaternion();
  const PITCH_X = 18;
  let x = 0;

  function next(kind: DisplayAnchor['kind'], y = 10): DisplayAnchor {
    const anchor: DisplayAnchor = { pos: new THREE.Vector3(x, y, 0), quat: faceZ, kind };
    x += PITCH_X;
    return anchor;
  }

  const anchors: DisplayAnchor[] = [
    next('aboutHero', 14),
    next('aboutSign', 8),
    next('aboutSign', 8),
    next('aboutSign', 8),
    next('projBig',   18),
    next('projBig',   18),
    next('projSmall', 12),
    next('projSmall', 12),
    next('projSmall', 12),
    next('research',  18),
    next('research',  18),
  ];

  const displays = buildDisplays(anchors);

  const ambient = new THREE.AmbientLight(0x223355, 1.5);
  displays.group.add(ambient);

  const neonColors = [0xb7f5e9, 0xff2bd6, 0xffb347] as const;
  neonColors.forEach((c, i) => {
    const pt = new THREE.PointLight(c, 4, 80);
    pt.position.set(x * 0.3 * i / 2, 14, 8);
    displays.group.add(pt);
  });

  return {
    group: displays.group,
    updateAmbient(sec: number): void {
      displays.updateAmbient(sec);
    },
  };
});
