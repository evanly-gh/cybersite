import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { type GeometryPart } from '../../utils/merge';
import { boxPart, mergeOne, makeBodyMat, makeGlowMat } from '../buildings/tall';

/**
 * Task 18 (part 1/4): tower cranes over the Blade Runner 2049 skyline gap sites.
 *
 * A tower crane = square lattice mast → slewing top with a horizontal jib (load boom)
 * and a shorter counter-jib carrying concrete counterweight blocks → an A-frame apex
 * with pendant ties → a trolley on the jib from which the hook block and a dangling
 * I-beam load hang. The `swinging` variant pendulums that load ±4° about the trolley
 * cable pivot in `updateAmbient` (wall-clock seconds), the way a suspended load drifts.
 *
 * Night mood: near-black steel bodies (towerBody), the readable elements are the GLOWS —
 * amber hazard warning stripes, the lit operator cab window, and synth-red aviation
 * beacons at the jib tips + apex (synth red = signalMagenta per the palette rule; theme
 * has no true red and tron-cyan is reserved for the biker).
 *
 * Draw-call budget: everything static merges into 4 meshes (steel / amber glow / cab
 * window / beacons). The swinging load is its own small merged mesh parented to an
 * animated pivot Object3D.
 */

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const Y_UP = new THREE.Vector3(0, 1, 0);

/** A box beam stretched + oriented to span from `a` to `b` (square cross-section `t`). */
function strut(a: THREE.Vector3, b: THREE.Vector3, t: number, mat = 0): GeometryPart {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 1e-4;
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.clone().normalize());
  return {
    geom: unitBox,
    matrix: new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(t, len, t)),
    mat
  };
}

/** A short cylinder (used for hook-block sheaves / pendant nodes). */
function cylPart(center: THREE.Vector3, r: number, h: number, mat = 0): GeometryPart {
  const geom = new THREE.CylinderGeometry(r, r, h, 8);
  return { geom, matrix: new THREE.Matrix4().setPosition(center.x, center.y, center.z), mat };
}

/**
 * Square lattice mast rising from y=0 to y=height: 4 corner chords, horizontal rings
 * every `segH`, and X-diagonals on all four faces per segment. Reads as real tower-crane
 * steelwork instead of a solid pole.
 */
function addMast(parts: GeometryPart[], height: number, width: number, segH: number): void {
  const h = width / 2;
  const corners: Array<[number, number]> = [
    [h, h],
    [h, -h],
    [-h, h],
    [-h, -h]
  ];
  const chordT = 0.16;
  for (const [x, z] of corners) {
    parts.push(boxPart(new THREE.Vector3(x, height / 2, z), new THREE.Vector3(chordT, height, chordT)));
  }
  const nseg = Math.max(1, Math.round(height / segH));
  const realSeg = height / nseg;
  // Adjacency pairs around the square perimeter (the 4 side faces).
  const faces: Array<[[number, number], [number, number]]> = [
    [corners[0], corners[1]],
    [corners[1], corners[3]],
    [corners[3], corners[2]],
    [corners[2], corners[0]]
  ];
  for (let i = 0; i <= nseg; i++) {
    const y = i * realSeg;
    for (const [c0, c1] of faces) {
      parts.push(strut(new THREE.Vector3(c0[0], y, c0[1]), new THREE.Vector3(c1[0], y, c1[1]), 0.1));
    }
  }
  for (let i = 0; i < nseg; i++) {
    const y0 = i * realSeg;
    const y1 = (i + 1) * realSeg;
    for (const [c0, c1] of faces) {
      // one diagonal per face, alternating direction so the web zig-zags up the tower
      const flip = i % 2 === 0;
      const a = new THREE.Vector3(c0[0], flip ? y0 : y1, c0[1]);
      const b = new THREE.Vector3(c1[0], flip ? y1 : y0, c1[1]);
      parts.push(strut(a, b, 0.08));
    }
  }
}

/**
 * Horizontal triangular-section boom along X from `x0` to `x1` at top height `yTop`:
 * two top chords at z=±zHalf, one bottom chord at (yTop-depth, z=0), plus vertical posts
 * and diagonal webs per panel. Used for both the jib and the counter-jib.
 */
function addBoom(
  parts: GeometryPart[],
  x0: number,
  x1: number,
  yTop: number,
  zHalf: number,
  depth: number,
  panel: number
): void {
  const yBot = yTop - depth;
  const topZ = [zHalf, -zHalf];
  // chords
  for (const z of topZ) {
    parts.push(strut(new THREE.Vector3(x0, yTop, z), new THREE.Vector3(x1, yTop, z), 0.12));
  }
  parts.push(strut(new THREE.Vector3(x0, yBot, 0), new THREE.Vector3(x1, yBot, 0), 0.12));

  const dir = Math.sign(x1 - x0) || 1;
  const len = Math.abs(x1 - x0);
  const npanel = Math.max(1, Math.round(len / panel));
  const realPanel = len / npanel;
  for (let i = 0; i <= npanel; i++) {
    const x = x0 + dir * i * realPanel;
    // triangular cross-frame: top rail + two legs down to the bottom chord
    parts.push(strut(new THREE.Vector3(x, yTop, zHalf), new THREE.Vector3(x, yTop, -zHalf), 0.09));
    parts.push(strut(new THREE.Vector3(x, yTop, zHalf), new THREE.Vector3(x, yBot, 0), 0.08));
    parts.push(strut(new THREE.Vector3(x, yTop, -zHalf), new THREE.Vector3(x, yBot, 0), 0.08));
    if (i < npanel) {
      const xn = x0 + dir * (i + 1) * realPanel;
      // diagonal web on both top chords + bottom
      parts.push(strut(new THREE.Vector3(x, yTop, zHalf), new THREE.Vector3(xn, yBot, 0), 0.07));
      parts.push(strut(new THREE.Vector3(x, yTop, -zHalf), new THREE.Vector3(xn, yBot, 0), 0.07));
    }
  }
}

export interface CraneAsset {
  group: THREE.Group;
  updateAmbient(sec: number): void;
}

/**
 * @param rng     seeded generator (jib length, trolley position, load size, phase).
 * @param swinging if true the hanging load pendulums ±4° in updateAmbient.
 */
export function buildCrane(rng: Rng, swinging = false): CraneAsset {
  const group = new THREE.Group();
  group.name = swinging ? 'craneSwinging' : 'crane';

  const steel: GeometryPart[] = [];
  const amber: GeometryPart[] = []; // hazard stripes + cab surround glow
  const windowP: GeometryPart[] = []; // lit cab window
  const beaconP: GeometryPart[] = []; // synth-red aviation beacons

  // --- dimensions ---
  const mastH = rng.range(22, 27);
  const mastW = 1.7;
  const jibLen = rng.range(26, 32);
  const counterLen = jibLen * 0.36;
  const boomY = mastH + 1.4; // top chord height of the jib
  const boomDepth = 1.6;
  const zHalf = 0.7;

  // --- base cross footing on a gravel pad ---
  const padR = 7.5;
  const pad = new THREE.CylinderGeometry(padR, padR, 0.25, 20);
  steel.push({ geom: pad, matrix: new THREE.Matrix4().setPosition(0, 0.12, 0), mat: 0 });
  // cross footing beams under the mast
  for (const rotY of [0, Math.PI / 2]) {
    steel.push(boxPart(new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(6.4, 0.7, 0.9), rotY));
  }
  // ballast blocks on the footing ends
  for (const [sx, sz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ] as Array<[number, number]>) {
    steel.push(boxPart(new THREE.Vector3(sx * 2.7, 0.85, sz * 2.7), new THREE.Vector3(1.2, 1.0, 1.2)));
  }

  // --- lattice mast ---
  addMast(steel, mastH, mastW, 2.2);

  // --- slewing platform on top ---
  steel.push(boxPart(new THREE.Vector3(0, mastH + 0.3, 0), new THREE.Vector3(mastW + 0.6, 0.6, mastW + 0.6)));

  // --- jib (load boom, +X) and counter-jib (-X) ---
  addBoom(steel, 0.4, jibLen, boomY, zHalf, boomDepth, 2.4);
  addBoom(steel, -0.4, -counterLen, boomY, zHalf, boomDepth * 0.9, 2.2);

  // --- counterweight blocks on the counter-jib tail ---
  for (let i = 0; i < 3; i++) {
    steel.push(
      boxPart(
        new THREE.Vector3(-counterLen + 0.4 + i * 0.9, boomY - boomDepth - 0.7, 0),
        new THREE.Vector3(0.8, 2.2, 2.6)
      )
    );
  }

  // --- A-frame apex + pendant ties ---
  const apexY = boomY + 5.5;
  const apex = new THREE.Vector3(0, apexY, 0);
  steel.push(
    strut(new THREE.Vector3(1.0, mastH + 0.6, 0), apex, 0.14),
    strut(new THREE.Vector3(-1.0, mastH + 0.6, 0), apex, 0.14)
  );
  // pendant ties: apex → two points along the jib, apex → counter-jib tail
  steel.push(
    strut(apex, new THREE.Vector3(jibLen * 0.55, boomY, 0), 0.06),
    strut(apex, new THREE.Vector3(jibLen * 0.95, boomY, 0), 0.06),
    strut(apex, new THREE.Vector3(-counterLen + 0.6, boomY, 0), 0.06)
  );

  // --- operator cab under the slewing platform, lit window facing +X ---
  const cabY = mastH - 1.1;
  steel.push(boxPart(new THREE.Vector3(1.4, cabY, 0), new THREE.Vector3(2.0, 2.0, 2.0)));
  // window glass on +X and +Z/-Z faces (glowing amber-warm interior)
  windowP.push(
    boxPart(new THREE.Vector3(2.45, cabY + 0.2, 0), new THREE.Vector3(0.08, 1.1, 1.5)),
    boxPart(new THREE.Vector3(1.4, cabY + 0.2, 1.05), new THREE.Vector3(1.5, 1.1, 0.08)),
    boxPart(new THREE.Vector3(1.4, cabY + 0.2, -1.05), new THREE.Vector3(1.5, 1.1, 0.08))
  );

  // --- hazard warning stripes (amber): mast base band + jib-tip band + counterweight edge ---
  amber.push(
    boxPart(new THREE.Vector3(0, 1.4, mastW / 2 + 0.09), new THREE.Vector3(mastW * 0.9, 0.5, 0.06)),
    boxPart(new THREE.Vector3(0, 1.4, -mastW / 2 - 0.09), new THREE.Vector3(mastW * 0.9, 0.5, 0.06)),
    boxPart(new THREE.Vector3(mastW / 2 + 0.09, 1.4, 0), new THREE.Vector3(0.06, 0.5, mastW * 0.9)),
    boxPart(new THREE.Vector3(-mastW / 2 - 0.09, 1.4, 0), new THREE.Vector3(0.06, 0.5, mastW * 0.9))
  );
  // jib-tip nose band
  amber.push(
    boxPart(new THREE.Vector3(jibLen - 0.3, boomY, zHalf + 0.05), new THREE.Vector3(0.9, 0.2, 0.08)),
    boxPart(new THREE.Vector3(jibLen - 0.3, boomY, -zHalf - 0.05), new THREE.Vector3(0.9, 0.2, 0.08))
  );
  // counterweight face band
  amber.push(boxPart(new THREE.Vector3(-counterLen + 1.3, boomY - boomDepth - 0.7, 1.35), new THREE.Vector3(2.6, 0.35, 0.06)));

  // --- synth-red beacons: jib tip, counter-jib tail, apex ---
  const beaconGeom = new THREE.SphereGeometry(0.32, 8, 6);
  for (const p of [
    new THREE.Vector3(jibLen, boomY + 0.3, 0),
    new THREE.Vector3(-counterLen, boomY + 0.3, 0),
    new THREE.Vector3(0, apexY + 0.35, 0)
  ]) {
    beaconP.push({ geom: beaconGeom, matrix: new THREE.Matrix4().setPosition(p.x, p.y, p.z), mat: 0 });
  }

  // --- material stacks on the gravel pad (rebar/beam bundles) ---
  for (let s = 0; s < 2; s++) {
    const sx = s === 0 ? 4.6 : -4.6;
    const sz = rng.range(-2, 2);
    const rotY = rng.range(-0.3, 0.3);
    const nbeam = rng.int(4, 6);
    for (let b = 0; b < nbeam; b++) {
      const row = Math.floor(b / 3);
      const col = b % 3;
      steel.push(
        boxPart(
          new THREE.Vector3(sx + (col - 1) * 0.42 * Math.cos(rotY), 0.35 + row * 0.4, sz + (col - 1) * 0.42 * Math.sin(rotY)),
          new THREE.Vector3(0.35, 0.35, 5.5),
          rotY
        )
      );
    }
  }

  group.add(mergeOne(steel, makeBodyMat(), 'steel'));
  group.add(mergeOne(amber, makeGlowMat(COLORS.sodiumAmber, 2.2), 'hazard'));
  group.add(mergeOne(windowP, makeGlowMat(COLORS.sodiumAmber, 1.6), 'cabWindow'));
  group.add(mergeOne(beaconP, makeGlowMat(COLORS.signalMagenta, 3), 'beacons'));

  // --- trolley + hanging load on an animated pivot ---
  const trolleyX = rng.range(jibLen * 0.5, jibLen * 0.75);
  const cablePivotY = boomY - boomDepth; // bottom chord — cables leave from here
  const loadPivot = new THREE.Object3D();
  loadPivot.position.set(trolleyX, cablePivotY, 0);
  group.add(loadPivot);

  const loadParts: GeometryPart[] = [];
  // two hoist cables down to the hook block
  const hookTopY = -8.5; // relative to pivot
  const hookY = hookTopY - 0.6;
  for (const cz of [0.18, -0.18]) {
    loadParts.push(strut(new THREE.Vector3(0, 0, cz), new THREE.Vector3(0, hookTopY, cz), 0.05));
  }
  // hook block (sheave housing) + sheave cylinder
  loadParts.push(boxPart(new THREE.Vector3(0, hookTopY - 0.3, 0), new THREE.Vector3(0.5, 0.6, 0.5)));
  loadParts.push(cylPart(new THREE.Vector3(0, hookTopY - 0.3, 0), 0.22, 0.55));
  // rigging slings down to the I-beam load
  const beamY = hookY - 1.6;
  for (const bx of [1.3, -1.3]) {
    loadParts.push(strut(new THREE.Vector3(0, hookY, 0), new THREE.Vector3(bx, beamY + 0.3, 0), 0.04));
  }
  // dangling I-beam: top flange, web, bottom flange (spans X ~3.4m)
  const beamLen = rng.range(3.0, 4.0);
  loadParts.push(
    boxPart(new THREE.Vector3(0, beamY + 0.28, 0), new THREE.Vector3(beamLen, 0.12, 0.5)),
    boxPart(new THREE.Vector3(0, beamY, 0), new THREE.Vector3(beamLen, 0.44, 0.1)),
    boxPart(new THREE.Vector3(0, beamY - 0.28, 0), new THREE.Vector3(beamLen, 0.12, 0.5))
  );
  const loadMesh = mergeOne(loadParts, makeBodyMat(), 'load');
  loadPivot.add(loadMesh);
  // trolley car sitting on the jib bottom chord at the pivot (static — does not swing)
  const trolley = mergeOne(
    [boxPart(new THREE.Vector3(trolleyX, cablePivotY + 0.35, 0), new THREE.Vector3(1.0, 0.5, 1.4))],
    makeBodyMat(),
    'trolley'
  );
  group.add(trolley);

  const phase = rng.range(0, Math.PI * 2);
  const swingAmp = THREE.MathUtils.degToRad(4);

  return {
    group,
    updateAmbient(sec: number): void {
      if (!swinging) return;
      loadPivot.rotation.z = swingAmp * Math.sin(sec * 0.9 + phase);
    }
  };
}
