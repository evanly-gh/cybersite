import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import type { GeometryPart } from '../../utils/merge';
import { makeCanvasTexture } from '../../utils/canvasText';
import {
  FLOOR_H,
  boxPart,
  mergeOne,
  addTierFacades,
  makeWindowTexture,
  makeWindowMat,
  makeGlowMat,
  makeBeaconMat
} from './tall';

/**
 * Task 9 (part 2/2): the corporate monolith — the Arasaka-style landmark visible from
 * About street. Obsidian 4-segment taper (46x46 -> 30x30), near-black high-metalness
 * skin, sparse dim cool windows (20% lit), a holo-teal hex-triangle "MAM" sigil on two
 * faces near the crown, a 12m amber-lit atrium base behind 6 entry pylons, and a crown
 * with 3 aviation beacons + a slowly-precessing teal halo ring (`userData.halo`).
 * 6 draw calls: metal body, windows, sigil, amber atrium, halo, beacons.
 */

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/**
 * The invented MAM Industries corporate sigil: an angular hexagon containing an upward
 * triangle (alternate hex vertices) with a compressed inner core — "compress everything"
 * — plus corner ticks and the MAM letterform. Drawn holo-teal on black so the emissive
 * plane reads as a crisp glowing mark, not a billboard.
 */
function makeSigilTexture(): THREE.CanvasTexture {
  const S = 512;
  return makeCanvasTexture(S, S, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, S, S);

    const teal = hex(COLORS.holoTeal);
    const cx = S / 2;
    const cy = S * 0.4;
    const r = S * 0.3;

    ctx.strokeStyle = teal;
    ctx.fillStyle = teal;
    ctx.shadowColor = teal;
    ctx.shadowBlur = 18;
    ctx.lineJoin = 'miter';

    // Hexagon (flat-top), thick angular outline.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    ctx.lineWidth = 14;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();

    // Upward triangle on alternate vertices (0, 2, 4).
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.lineTo(pts[4][0], pts[4][1]);
    ctx.closePath();
    ctx.stroke();

    // Compressed core: small solid inverted triangle at the centroid.
    const cr = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(cx, cy + cr);
    ctx.lineTo(cx - cr * 0.87, cy - cr * 0.5);
    ctx.lineTo(cx + cr * 0.87, cy - cr * 0.5);
    ctx.closePath();
    ctx.fill();

    // Corner ticks off the hexagon's left/right vertices.
    ctx.lineWidth = 6;
    for (const i of [1, 2, 4, 5]) {
      const [px, py] = pts[i];
      const dx = px < cx ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(px + dx * 14, py);
      ctx.lineTo(px + dx * 34, py);
      ctx.stroke();
    }

    // Letterform.
    ctx.shadowBlur = 12;
    ctx.font = `bold ${Math.round(S * 0.15)}px "Unbounded", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MAM', cx, S * 0.84);
    ctx.font = `${Math.round(S * 0.045)}px "Share Tech Mono", monospace`;
    ctx.fillText('I N D U S T R I E S', cx, S * 0.93);
    ctx.shadowBlur = 0;

    // Registration ticks in the bottom corners. The left one doubles as the UV target
    // for the setback seam-light boxes (see tealPatchUVs) so those strips can ride the
    // sigil material — teal seams with no extra draw call. Drawn at reduced alpha so
    // the seams stay dimmer than the sigil itself.
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, S - 24, 24, 24);
    ctx.fillRect(S - 24, S - 24, 24, 24);
    ctx.globalAlpha = 1;
  });
}

/** Remaps every UV on a geometry into the sigil texture's bottom-left teal tick. */
function tealPatchUVs<T extends THREE.BufferGeometry>(geom: T): T {
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02, 0.02);
  return geom;
}

/**
 * Corporate monolith, ~52 floors (fixed design — no floors param).
 * Contract: origin at ground center, `userData.roofY`, `userData.footprint`,
 * `userData.beacons: Mesh[]`, `userData.halo: Mesh` (city assembly slow-rotates it).
 */
export function buildMonolith(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'monolith';

  const floors = 52;
  const totalH = floors * FLOOR_H; // 166.4
  const segFloors = [16, 14, 12, 10];
  const segW = [46, 41, 35.5, 30];
  const atriumH = 12;

  const bodyParts: GeometryPart[] = [];
  const windowParts: GeometryPart[] = [];
  const amberParts: GeometryPart[] = [];
  const sigilParts: GeometryPart[] = [];

  // --- Base atrium: recessed glass core + 6 entry pylons; tower overhangs above.
  const coreW = segW[0] - 7;
  bodyParts.push(boxPart(new THREE.Vector3(0, atriumH / 2, 0), new THREE.Vector3(coreW, atriumH, coreW)));
  // Amber light spill: glowing lobby walls on all four core faces + thin apron strips
  // where the light pools on the plaza outside each face.
  for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const wall = new THREE.PlaneGeometry(coreW - 2, atriumH - 2.5);
    const off = new THREE.Vector3(0, (atriumH - 2.5) / 2 + 0.5, coreW / 2 + 0.06).applyQuaternion(q);
    amberParts.push({ geom: wall, matrix: new THREE.Matrix4().compose(off, q, new THREE.Vector3(1, 1, 1)), mat: 0 });
    // apron strip on the ground just outside the overhang edge
    const apron = new THREE.PlaneGeometry(segW[0] - 4, 3);
    const aq = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    const apos = new THREE.Vector3(0, 0.02, segW[0] / 2 + 1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    amberParts.push({ geom: apron, matrix: new THREE.Matrix4().compose(apos, aq, new THREE.Vector3(1, 1, 1)), mat: 0 });
  }
  // 6 entry pylons across the +Z face (the About-street side), holding up the overhang.
  for (let i = 0; i < 6; i++) {
    const x = -segW[0] / 2 + 4 + (i * (segW[0] - 8)) / 5;
    bodyParts.push(boxPart(new THREE.Vector3(x, atriumH / 2, segW[0] / 2 - 1.5), new THREE.Vector3(1.4, atriumH, 1.4)));
  }
  // Round-3 detail (SAW: the entry face reads as bare pylons in front of a glow — no
  // sense of an actual entrance): low canopy slab over the doors + two teal wayfinding
  // strips flanking the entry (UV-pinned to the sigil's teal tick, no extra material).
  bodyParts.push(boxPart(new THREE.Vector3(0, 5.6, segW[0] / 2 - 2.6), new THREE.Vector3(coreW * 0.55, 0.45, 4.4)));
  for (const sx of [1, -1]) {
    sigilParts.push({
      geom: tealPatchUVs(new THREE.BoxGeometry(1, 1, 1)),
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(sx * coreW * 0.3, 2.6, coreW / 2 + 0.12),
        new THREE.Quaternion(),
        new THREE.Vector3(0.18, 5.2, 0.18)
      ),
      mat: 0
    });
  }

  // --- 4 tapered segments (segment 1 starts atop the atrium's air gap: its box begins
  // at atriumH, so the tower visibly floats on the lit lobby + pylons).
  let y = atriumH;
  const segTops: number[] = [];
  for (let s = 0; s < 4; s++) {
    const h = segFloors[s] * FLOOR_H - (s === 0 ? atriumH : 0);
    const w = segW[s];
    bodyParts.push(boxPart(new THREE.Vector3(0, y + h / 2, 0), new THREE.Vector3(w, h, w)));
    // Round-3 BUG FIX (SAW: windows never appeared in r1 OR r2 — the shaft stayed a
    // featureless void even after brightening): with facade size w-0.6 a 0.16 gap put
    // the planes at w/2-0.14, i.e. BURIED INSIDE the body box. 0.36 puts them 0.06
    // proud of the face like the other two towers.
    addTierFacades(windowParts, rng, w - 0.6, w - 0.6, h - 2, y + 0.6, 0.36);
    // Chamfered transition collar at each step + parapet lip.
    bodyParts.push(boxPart(new THREE.Vector3(0, y + h + 0.4, 0), new THREE.Vector3(w + 0.4, 0.8, w + 0.4)));
    y += h;
    segTops.push(y);
    // Round-2 detail (SAW: the 4-segment taper is invisible — the tower reads as one
    // black slab): dim teal seam strips ride each collar (and the crown parapet),
    // tracing the setbacks so the taper reads at night. UV-pinned to the sigil
    // texture's teal tick -> merged into the sigil mesh, no extra draw call.
    const seam = tealPatchUVs(new THREE.BoxGeometry(1, 1, 1));
    sigilParts.push({
      geom: seam,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(0, y + 0.4, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(w + 0.8, 0.12, w + 0.8)
      ),
      mat: 0
    });
  }

  // Vertical corner fins up the top two segments — sharpens the obsidian silhouette.
  for (let s = 2; s < 4; s++) {
    const w = segW[s];
    const segBase = segTops[s - 1];
    const h = segTops[s] - segBase;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        bodyParts.push(
          boxPart(new THREE.Vector3(sx * (w / 2 + 0.15), segBase + h / 2, sz * (w / 2 + 0.15)), new THREE.Vector3(0.5, h + 2, 0.5))
        );
      }
    }
  }

  // --- Sigil planes near the crown on the +Z and +X faces of the top segment.
  const sigilTex = makeSigilTexture();
  const sigilSize = 15;
  const sigilY = totalH - 12;
  const topW = segW[3];
  const sigilGeom = new THREE.PlaneGeometry(sigilSize, sigilSize);
  sigilParts.push(
    { geom: sigilGeom, matrix: new THREE.Matrix4().makeTranslation(0, sigilY, topW / 2 + 0.35), mat: 0 },
    {
      geom: sigilGeom,
      matrix: new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(topW / 2 + 0.35, sigilY, 0),
      mat: 0
    }
  );

  // --- Crown: center mast + 3 aviation beacons (corners + mast tip).
  const mastH = 7;
  bodyParts.push(boxPart(new THREE.Vector3(0, totalH + mastH / 2, 0), new THREE.Vector3(0.6, mastH, 0.6)));
  // Round-3 detail: crown mechanical plant (cooling blocks) so the roof under the halo
  // isn't a bare plane when the ride's high camera looks down at the landmark.
  bodyParts.push(
    boxPart(new THREE.Vector3(-topW / 4, totalH + 1.1, -topW / 5), new THREE.Vector3(6, 2.2, 4), 0.3),
    boxPart(new THREE.Vector3(topW / 5, totalH + 0.9, topW / 4), new THREE.Vector3(4, 1.8, 3), -0.2)
  );

  // --- Materials & merge (one draw call per category).
  const metalMat = new THREE.MeshStandardMaterial({
    color: COLORS.towerBody,
    metalness: 0.9,
    roughness: 0.32
  });
  // Round-2 calibration (SAW: at dimLo 0.15/intensity 1.6 the 20% lit windows were
  // invisible — the whole shaft read as a void): raise per-window level + intensity.
  // Still far sparser/dimmer than the city-fill towers.
  const windowTex = makeWindowTexture(rng, {
    litRatio: 0.2,
    coolRatio: 0.92,
    peakRatio: 0.02,
    dimLo: 0.32,
    dimHi: 0.6
  });

  group.add(mergeOne(bodyParts, metalMat, 'body'));
  group.add(mergeOne(windowParts, makeWindowMat(windowTex, 2.0), 'windows'));
  // Round-2 calibration (SAW: full-face amber lobby walls were the brightest thing in
  // frame — house rule says only small areas at peak): dimmer atrium intensity.
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.1), 'atrium'));
  group.add(
    mergeOne(
      sigilParts,
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: sigilTex,
        emissiveIntensity: 2.2,
        roughness: 0.9
      }),
      'sigil'
    )
  );

  // Halo ring: thin teal torus floating above the crown, baked horizontal inside a
  // tilted holder so the assembly's `halo.rotation.y += dt * rate` precesses visibly.
  const haloGeom = new THREE.TorusGeometry(topW * 0.42, 0.22, 6, 64);
  haloGeom.rotateX(Math.PI / 2);
  const halo = new THREE.Mesh(haloGeom, makeGlowMat(COLORS.holoTeal, 2.4));
  halo.name = 'halo';
  const haloHolder = new THREE.Group();
  haloHolder.position.set(0, totalH + 5, 0);
  haloHolder.rotation.x = 0.16;
  haloHolder.add(halo);
  group.add(haloHolder);

  const beaconGeom = new THREE.SphereGeometry(0.4, 8, 6);
  const beacons = mergeOne(
    [
      { geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(0, totalH + mastH + 0.4, 0), mat: 0 },
      { geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(topW / 2 - 1, totalH + 0.9, topW / 2 - 1), mat: 0 },
      { geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(-topW / 2 + 1, totalH + 0.9, -topW / 2 + 1), mat: 0 }
    ],
    makeBeaconMat(),
    'beacons'
  );
  group.add(beacons);

  group.userData.roofY = totalH;
  group.userData.footprint = [segW[0], segW[0]];
  group.userData.beacons = [beacons];
  group.userData.halo = halo;
  return group;
}
