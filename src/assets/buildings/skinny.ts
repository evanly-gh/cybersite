import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import type { GeometryPart } from '../../utils/merge';
import { boxPart, mergeOne, makeGlowMat, makeBeaconMat } from './tall';
import { makeCanvasTexture, drawPanel } from '../../utils/canvasText';
import { buildSatelliteDish } from './rooftop';

/**
 * Task 12 (part 2/2): the two skinny Ring 0/1 towers.
 *  - buildRadioMast: ~50m tapering 3-leg lattice, cross-braced (merged into one body
 *    mesh), 3 dish clusters at varying heights, guy wires to ground anchors, double red
 *    beacons + a top strobe, small base equipment shed.
 *  - buildMonument: ~22m stone plinth + abstract angular striding-figure (stacked
 *    rotated boxes), 4 amber up-light cones, a teal additive halo torus over the head
 *    (`userData.halo`), and a mono-canvas plaque.
 *
 * Draw-call budget mirrors tall.ts/special.ts: everything routes through mergeOne so
 * each tower is a handful of meshes total (body, glow/beacon categories, halo).
 */

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------------
// (a) Radio mast
// ---------------------------------------------------------------------------------

const MAST_H = 50;
const LEG_R_BASE = 3.2;
const LEG_R_TOP = 0.35;

/** Position of leg `i` (0-2, 120° apart) at height `y`, radius interpolated base->top. */
function legPos(i: number, y: number): { x: number; z: number } {
  const t = y / MAST_H;
  const r = THREE.MathUtils.lerp(LEG_R_BASE, LEG_R_TOP, t);
  const a = (i / 3) * Math.PI * 2;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/** ~50m tapering 3-leg lattice mast with cross-bracing, dishes, guy wires, beacons. */
export function buildRadioMast(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'radioMast';

  const bodyParts: GeometryPart[] = [];
  const glowParts: GeometryPart[] = [];
  const stripeParts: GeometryPart[] = [];

  // --- 3 tapering legs, built as stacked thin cylinder segments so the taper reads.
  const legSegs = 14;
  const segH = MAST_H / legSegs;
  for (let leg = 0; leg < 3; leg++) {
    for (let s = 0; s < legSegs; s++) {
      const y0 = s * segH;
      const y1 = y0 + segH;
      const p0 = legPos(leg, y0);
      const p1 = legPos(leg, y1);
      const mid = new THREE.Vector3((p0.x + p1.x) / 2, (y0 + y1) / 2, (p0.z + p1.z) / 2);
      const dir = new THREE.Vector3(p1.x - p0.x, segH, p1.z - p0.z).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const len = Math.hypot(p1.x - p0.x, segH, p1.z - p0.z);
      const rAvg = THREE.MathUtils.lerp(LEG_R_BASE, LEG_R_TOP, (y0 + y1) / 2 / MAST_H);
      const thickness = Math.max(0.06, rAvg * 0.03 + 0.05);
      bodyParts.push({
        geom: new THREE.CylinderGeometry(thickness, thickness, len, 5),
        matrix: new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)),
        mat: 0
      });
    }
  }

  // --- Cross-bracing: thin cylinders connecting legs pairwise at regular height bands
  // (both leg-to-leg braces and diagonal X-braces within each band, classic lattice
  // tower look) — all merged into bodyParts, so bracing adds zero extra draw calls.
  const braceBands = 10;
  for (let b = 0; b <= braceBands; b++) {
    const y = (b / braceBands) * MAST_H * 0.94;
    const pts = [0, 1, 2].map((i) => legPos(i, y));
    for (let i = 0; i < 3; i++) {
      const a = pts[i];
      const bPt = pts[(i + 1) % 3];
      const start = new THREE.Vector3(a.x, y, a.z);
      const end = new THREE.Vector3(bPt.x, y, bPt.z);
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const dir = end.clone().sub(start).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const len = start.distanceTo(end);
      bodyParts.push({
        geom: new THREE.CylinderGeometry(0.05, 0.05, len, 4),
        matrix: new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)),
        mat: 0
      });
    }
    // Diagonal X-brace up to the next band (skip past the top).
    if (b < braceBands) {
      const yNext = ((b + 1) / braceBands) * MAST_H * 0.94;
      const ptsNext = [0, 1, 2].map((i) => legPos(i, yNext));
      for (let i = 0; i < 3; i++) {
        const a = pts[i];
        const bPt = ptsNext[(i + 1) % 3];
        const start = new THREE.Vector3(a.x, y, a.z);
        const end = new THREE.Vector3(bPt.x, yNext, bPt.z);
        const mid = start.clone().add(end).multiplyScalar(0.5);
        const dir = end.clone().sub(start).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const len = start.distanceTo(end);
        bodyParts.push({
          geom: new THREE.CylinderGeometry(0.045, 0.045, len, 4),
          matrix: new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)),
          mat: 0
        });
      }
    }
  }

  // --- Warning stripes: alternating amber/dark bands painted on the lattice legs near
  // the top third (FAA-style obstruction marking) — a small merged glow bucket so the
  // silhouette reads as an aviation obstruction, not just a bare black lattice.
  const stripeBands = 6;
  for (let b = 0; b < stripeBands; b++) {
    if (b % 2 !== 0) continue; // every other band lit
    const y = MAST_H * (0.62 + (b / stripeBands) * 0.32);
    for (let leg = 0; leg < 3; leg++) {
      const p = legPos(leg, y);
      stripeParts.push(
        boxPart(new THREE.Vector3(p.x, y, p.z), new THREE.Vector3(0.4, 0.9, 0.4))
      );
    }
  }

  // --- 3 dish clusters at varying heights (reusing the rooftop kit's parametric dish).
  // Round-2 detail (SAW: the lattice + dishes vanished entirely against the night sky —
  // only the beacons/strobe/stripes read): a small teal rim-glow ring at the base of
  // each dish's mast gives the clusters a lit "active hardware" silhouette instead of
  // disappearing into the dark body mesh.
  const dishHeights = [MAST_H * 0.35, MAST_H * 0.55, MAST_H * 0.75];
  for (const y of dishHeights) {
    const clusterCount = rng.int(1, 2);
    for (let i = 0; i < clusterCount; i++) {
      const heading = rng.range(0, Math.PI * 2);
      const r = THREE.MathUtils.lerp(LEG_R_BASE, LEG_R_TOP, y / MAST_H);
      const mountR = r + 0.4;
      const x = Math.cos(heading) * mountR;
      const z = Math.sin(heading) * mountR;
      buildSatelliteDish(bodyParts, x, z, y, rng.range(0.7, 1.3), heading, rng.range(-0.2, 0.2), glowParts);
      glowParts.push({
        geom: new THREE.TorusGeometry(0.12, 0.03, 5, 10),
        matrix: new THREE.Matrix4().makeTranslation(x, y + 0.02, z),
        mat: 0
      });
    }
  }

  // Round-2 detail (SAW: the whole lattice body is a black silhouette with only the
  // top strobe + mid beacons breaking it): dim amber position marker lights climb the
  // mast at every other brace band (real broadcast towers run FAA marker lights the
  // full height, not just a mid-beacon pair), tying the lattice together at night.
  for (let b = 1; b < braceBands; b += 2) {
    const y = (b / braceBands) * MAST_H * 0.94;
    for (let leg = 0; leg < 3; leg++) {
      const p = legPos(leg, y);
      stripeParts.push({
        geom: new THREE.SphereGeometry(0.09, 6, 5),
        matrix: new THREE.Matrix4().makeTranslation(p.x, y, p.z),
        mat: 0
      });
    }
  }

  // --- Guy wires: thin cylinders from 3 heights on the mast down to ground anchors set
  // back from the base, 3-fold symmetric with the legs. Round-3 detail (SAW: the guy
  // wires are structurally there but read as nothing against the black ground — real
  // tower sites mark every anchor with a low tension light for night visibility): a
  // small amber marker at each anchor block ties the wires' ground end into the lit
  // vocabulary the same way the mast's own position lights do for the legs.
  const anchorDist = 14;
  const guyHeights = [MAST_H * 0.3, MAST_H * 0.55, MAST_H * 0.82];
  for (const y of guyHeights) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const anchor = new THREE.Vector3(Math.cos(a) * anchorDist, 0, Math.sin(a) * anchorDist);
      const top = new THREE.Vector3(Math.cos(a) * 0.6, y, Math.sin(a) * 0.6);
      const mid = anchor.clone().add(top).multiplyScalar(0.5);
      const dir = top.clone().sub(anchor).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const len = anchor.distanceTo(top);
      bodyParts.push({
        geom: new THREE.CylinderGeometry(0.03, 0.03, len, 4),
        matrix: new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)),
        mat: 0
      });
      // Ground anchor block.
      bodyParts.push(boxPart(new THREE.Vector3(anchor.x, 0.15, anchor.z), new THREE.Vector3(0.6, 0.3, 0.6)));
    }
  }
  // One anchor marker light per anchor position (dedupe by outer loop's 3-fold angles —
  // only need the outermost/tallest guy's anchor since all three heights share the same
  // ground point per leg direction).
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    stripeParts.push({
      geom: new THREE.SphereGeometry(0.1, 6, 5),
      matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * anchorDist, 0.32, Math.sin(a) * anchorDist),
      mat: 0
    });
  }

  // Round-3 detail (SAW: the lattice is pure geometric bracing with no sign of human
  // maintenance access): a service ladder of thin rungs up leg 0, from the shed roof to
  // the first dish cluster — grounds the tower as an inhabited structure, not just a
  // silhouette prop.
  const ladderTopY = MAST_H * 0.4;
  const ladderRungs = 16;
  for (let r = 0; r < ladderRungs; r++) {
    const y = (r / ladderRungs) * ladderTopY;
    const p = legPos(0, y);
    const outward = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.22);
    bodyParts.push(
      boxPart(new THREE.Vector3(p.x + outward.x, y, p.z + outward.z), new THREE.Vector3(0.3, 0.03, 0.05))
    );
  }

  // --- Base equipment shed.
  const shedW = 3.5;
  const shedD = 2.6;
  const shedH = 2.4;
  bodyParts.push(boxPart(new THREE.Vector3(LEG_R_BASE + shedW / 2 + 0.6, shedH / 2, 0), new THREE.Vector3(shedW, shedH, shedD)));
  stripeParts.push(
    boxPart(new THREE.Vector3(LEG_R_BASE + 0.62, shedH * 0.55, shedD / 2 - 0.15), new THREE.Vector3(0.06, 0.4, 1.4))
  );
  // Round-2 detail: a small lit doorway on the shed so the base equipment reads at
  // ground level instead of vanishing under the lattice's shadow.
  glowParts.push(
    boxPart(new THREE.Vector3(LEG_R_BASE + shedW + 0.58, 0.9, 0), new THREE.Vector3(0.06, 1.6, 0.9))
  );

  // --- Top strobe platform + double red beacons partway down (aviation obstruction
  // lighting: FAA-style mid-height beacons + a bright top strobe).
  const topPlatformY = MAST_H;
  bodyParts.push({
    geom: new THREE.CylinderGeometry(0.5, 0.6, 0.3, 8),
    matrix: new THREE.Matrix4().makeTranslation(0, topPlatformY, 0),
    mat: 0
  });

  // Aviation beacons use the codebase's documented beacon convention (sodium-amber, per
  // tall.ts's makeBeaconMat / farField's Task 8 precedent — theme has no red); the top
  // strobe reuses the theme's moonlight white rather than a raw hex literal.
  const beaconGeom = new THREE.SphereGeometry(0.32, 8, 6);
  const midY = MAST_H * 0.5;
  const beacons = mergeOne(
    [
      { geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(legPos(0, midY).x, midY, legPos(0, midY).z), mat: 0 },
      { geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(legPos(1, midY).x, midY, legPos(1, midY).z), mat: 0 }
    ],
    makeBeaconMat(),
    'beacons'
  );
  const strobeGeom = new THREE.SphereGeometry(0.4, 8, 6);
  const strobe = mergeOne(
    [{ geom: strobeGeom, matrix: new THREE.Matrix4().makeTranslation(0, topPlatformY + 0.45, 0), mat: 0 }],
    makeGlowMat(COLORS.moonlight, 4),
    'strobe'
  );

  group.add(mergeOne(bodyParts, new THREE.MeshStandardMaterial({ color: COLORS.towerBody, roughness: 0.7, metalness: 0.4 }), 'body'));
  group.add(mergeOne(stripeParts, makeGlowMat(COLORS.sodiumAmber, 1.6), 'stripes'));
  if (glowParts.length > 0) group.add(mergeOne(glowParts, makeGlowMat(COLORS.holoTeal, 1.4), 'glow'));
  group.add(beacons);
  group.add(strobe);

  group.userData.roofY = MAST_H;
  // Footprint must reflect the mast's real ground extent for city layout spacing — the
  // guy-wire anchors reach out to `anchorDist` on all 3 sides, well past the lattice legs.
  group.userData.footprint = [anchorDist * 2, anchorDist * 2];
  group.userData.beacons = [beacons, strobe];
  return group;
}

// ---------------------------------------------------------------------------------
// (b) Monument
// ---------------------------------------------------------------------------------

const MONUMENT_H = 22;

/** Draws a small mono plaque texture ("MEMORIAL" style civic plaque). */
function makePlaqueTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 160;
  return makeCanvasTexture(w, h, (ctx) => {
    drawPanel(ctx, {
      w,
      h,
      accent: hex(COLORS.holoTeal),
      eyebrow: 'CIVIC MONUMENT',
      title: 'THE STRIDER',
      body: 'Erected in memory of the first ascent. Ring 0 authority.',
      align: 'center'
    });
  });
}

/**
 * ~22m stone plinth + abstract angular striding-figure (stacked rotated boxes reading
 * as a stylized figure mid-stride), 4 amber up-light cones lighting the plinth, and a
 * teal additive halo torus hovering over the figure's head (`userData.halo`).
 */
export function buildMonument(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'monument';

  const bodyParts: GeometryPart[] = [];
  const amberParts: GeometryPart[] = [];
  const plaqueParts: GeometryPart[] = [];
  const trimParts: GeometryPart[] = [];

  // --- rng-driven variety (round-3 fix: monuments were all identical since `rng` was
  // unused). Plinth proportions, the figure's stride/pose, and the up-light color all
  // vary per-instance while keeping the tested footprint/roofY contracts fixed (plinthW/
  // plinthD stay 8x8, MONUMENT_H stays 22).
  const strideAmp = rng.range(0.85, 1.2); // how pronounced the stride/lean reads
  const rearLegAngle = rng.range(0.1, 0.26);
  const frontLegAngle = rng.range(-0.4, -0.24);
  const torsoLean = rng.range(-0.22, -0.1);
  const armSwing = rng.range(0.4, 0.62);
  const headTilt = rng.range(-0.16, -0.05);
  const uplightColor = rng.chance(0.5) ? COLORS.sodiumAmber : COLORS.holoTeal;

  // --- Stone plinth: 2-tier base.
  const plinthW = 8;
  const plinthD = 8;
  const plinthH = 3;
  bodyParts.push(boxPart(new THREE.Vector3(0, plinthH / 2, 0), new THREE.Vector3(plinthW, plinthH, plinthD)));
  const plinth2W = plinthW * 0.72;
  const plinth2H = rng.range(1.3, 1.9);
  bodyParts.push(
    boxPart(new THREE.Vector3(0, plinthH + plinth2H / 2, 0), new THREE.Vector3(plinth2W, plinth2H, plinth2W))
  );
  const baseTop = plinthH + plinth2H;

  // --- Abstract angular striding figure: stacked rotated boxes. Legs (mid-stride —
  // one forward, one back), torso leaning into the stride, angled shoulders/head.
  const figH = MONUMENT_H - baseTop - 2; // leave room for halo above the head
  const legH = figH * 0.42;
  const torsoH = figH * 0.38;
  const headH = figH * 0.14;
  const y0 = baseTop;

  // Rear leg (planted, slight backward lean).
  bodyParts.push(
    boxPart(
      new THREE.Vector3(-0.6 * strideAmp, y0 + legH / 2, -0.9 * strideAmp),
      new THREE.Vector3(0.9, legH, 0.7),
      rearLegAngle
    )
  );
  // Front leg (striding forward, more forward lean + wider stance).
  bodyParts.push(
    boxPart(
      new THREE.Vector3(0.9 * strideAmp, y0 + legH * 0.46, 1.1 * strideAmp),
      new THREE.Vector3(0.85, legH * 0.95, 0.7),
      frontLegAngle
    )
  );

  // Torso — leans forward into the stride, offset toward the front leg.
  const torsoY = y0 + legH * 0.85 + torsoH / 2;
  bodyParts.push(
    boxPart(new THREE.Vector3(0.25, torsoY, 0.15), new THREE.Vector3(1.6, torsoH, 1.1), torsoLean)
  );
  // Chest plate accent (slightly rotated for an angular "armor" read).
  bodyParts.push(
    boxPart(new THREE.Vector3(0.35, torsoY + torsoH * 0.15, 0.55), new THREE.Vector3(1.1, torsoH * 0.5, 0.3), torsoLean * 0.6)
  );

  // Arms — one swung back, one forward, both angular slabs.
  const armY = torsoY + torsoH * 0.18;
  bodyParts.push(boxPart(new THREE.Vector3(-1.1, armY, -0.5), new THREE.Vector3(0.4, torsoH * 0.8, 0.4), armSwing));
  bodyParts.push(boxPart(new THREE.Vector3(1.15, armY - torsoH * 0.1, 0.9), new THREE.Vector3(0.4, torsoH * 0.65, 0.4), -armSwing * 1.2));

  // Head — small angular block atop the torso, tilted up as if striding into the wind.
  const headY = torsoY + torsoH / 2 + headH / 2 + 0.1;
  bodyParts.push(boxPart(new THREE.Vector3(0.3, headY, 0.25), new THREE.Vector3(0.7, headH, 0.7), headTilt));

  // Round-2 detail (SAW: the stacked-box figure is a featureless silhouette with no
  // sense of its angular joints): thin teal seam lights trace the torso/chest and
  // shoulder-to-head "joints" — holographic inlay circuitry rather than literal seams,
  // consistent with the halo's teal so the whole figure reads as a lit installation.
  trimParts.push(
    boxPart(new THREE.Vector3(0.3, torsoY - torsoH * 0.42, 0.2), new THREE.Vector3(1.0, 0.05, 0.05), -0.16),
    boxPart(new THREE.Vector3(0.28, torsoY + torsoH * 0.42, 0.6), new THREE.Vector3(0.9, 0.05, 0.05), -0.16),
    boxPart(new THREE.Vector3(0.3, headY - headH * 0.4, 0.28), new THREE.Vector3(0.55, 0.04, 0.55), -0.1)
  );

  // --- 4 amber up-light cones around the plinth, aimed up at the figure. Round-2 fix
  // (SAW: the up-lights were completely invisible — a 0.4-radius cone at 2.4 intensity
  // read as nothing against the void): bigger cones, plus a ground-level glow disc at
  // each base (same "light pool" trick as the monolith's atrium apron) so the up-lights
  // register as a lit ring on the plinth even before the eye finds the small cones.
  const upR = plinthW * 0.42;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * upR;
    const z = Math.sin(a) * upR;
    amberParts.push({
      geom: new THREE.ConeGeometry(0.55, 2.0, 10),
      matrix: new THREE.Matrix4().makeTranslation(x, plinthH + 1.0, z),
      mat: 0
    });
    amberParts.push({
      geom: new THREE.CircleGeometry(0.7, 12),
      matrix: new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
        .setPosition(x, plinthH + 0.02, z),
      mat: 0
    });
    // small lamp housing at the base of each cone
    bodyParts.push({
      geom: new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8),
      matrix: new THREE.Matrix4().makeTranslation(x, plinthH + 0.1, z),
      mat: 0
    });
  }

  // --- Plaque on the plinth face, mono canvas text.
  const plaqueTex = makePlaqueTexture();
  const plaqueW = 3.2;
  const plaqueH = 2.0;
  plaqueParts.push({
    geom: new THREE.PlaneGeometry(plaqueW, plaqueH),
    matrix: new THREE.Matrix4().makeTranslation(0, plinthH * 0.55, plinthD / 2 + 0.02),
    mat: 0
  });

  // --- Halo torus over the head: teal additive ring, tagged for the assembly's
  // slow-precession animation (same pattern as the monolith's halo).
  const headTopY = headY + headH / 2;
  const haloGeom = new THREE.TorusGeometry(1.1, 0.1, 6, 48);
  haloGeom.rotateX(Math.PI / 2);
  const halo = new THREE.Mesh(haloGeom, makeGlowMat(COLORS.holoTeal, 2.6));
  halo.name = 'halo';
  const haloHolder = new THREE.Group();
  haloHolder.position.set(0.3, headTopY + 1.2, 0.25);
  haloHolder.rotation.x = 0.12;
  haloHolder.add(halo);

  group.add(mergeOne(bodyParts, new THREE.MeshStandardMaterial({ color: 0x4a463e, roughness: 0.9, metalness: 0.08 }), 'body'));
  group.add(mergeOne(amberParts, makeGlowMat(uplightColor, 2.4), 'uplights'));
  group.add(mergeOne(trimParts, makeGlowMat(COLORS.holoTeal, 2.0), 'trim'));
  group.add(
    mergeOne(
      plaqueParts,
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: plaqueTex,
        emissiveIntensity: 1.4,
        roughness: 0.9
      }),
      'plaque'
    )
  );
  group.add(haloHolder);

  group.userData.roofY = MONUMENT_H;
  group.userData.footprint = [plinthW, plinthD];
  group.userData.halo = halo;
  return group;
}
