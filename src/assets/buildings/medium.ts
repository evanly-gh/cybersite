import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import type { GeometryPart } from '../../utils/merge';
import { makeCanvasTexture } from '../../utils/canvasText';
import { makeAd } from '../../content/adGenerator';
import {
  FLOOR_H,
  boxPart,
  mergeOne,
  addTierFacades,
  makeWindowTexture,
  makeBodyMat,
  makeWindowMat,
  makeGlowMat,
  makeBeaconMat
} from './tall';

/**
 * Task 10: the three mid-height Ring 0/1 fill buildings — apartment block, holo-ticker
 * office, and open parking structure. Seen from 10-60m by a moving camera, so detail
 * density (balconies, ticker text, deck clutter) matters more than silhouette drama.
 *
 * Reuses tall.ts's shared facade/merge machinery (same house style: one draw call per
 * material category, textures via makeCanvasTexture, colors only from theme COLORS).
 * Draw-call budget: <=6 draw calls per building (mergeOne per category).
 */

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------------
// Local helpers (kept in this file — tall.ts's addRailing/addWaterTank/addRoofBoxes
// are internal to that module, not exported, so small equivalents live here).
// ---------------------------------------------------------------------------------

/** Low parapet/railing rim (4 bars + corner+mid posts) around a rectangular roof/deck. */
function addRailing(parts: GeometryPart[], w: number, d: number, y: number, railH = 1.1): void {
  const t = 0.12;
  const yc = y + railH - t / 2;
  parts.push(
    boxPart(new THREE.Vector3(0, yc, d / 2 - t / 2), new THREE.Vector3(w, t, t)),
    boxPart(new THREE.Vector3(0, yc, -d / 2 + t / 2), new THREE.Vector3(w, t, t)),
    boxPart(new THREE.Vector3(w / 2 - t / 2, yc, 0), new THREE.Vector3(t, t, d)),
    boxPart(new THREE.Vector3(-w / 2 + t / 2, yc, 0), new THREE.Vector3(t, t, d))
  );
  const posts: Array<[number, number]> = [
    [w / 2 - t / 2, d / 2 - t / 2],
    [-w / 2 + t / 2, d / 2 - t / 2],
    [w / 2 - t / 2, -d / 2 + t / 2],
    [-w / 2 + t / 2, -d / 2 + t / 2],
    [0, d / 2 - t / 2],
    [0, -d / 2 + t / 2]
  ];
  for (const [px, pz] of posts) {
    parts.push(boxPart(new THREE.Vector3(px, y + railH / 2, pz), new THREE.Vector3(t, railH, t)));
  }
}

/** Rooftop water tank on 4 legs w/ conical cap (reduced version of tall.ts's tank). */
function addWaterTank(parts: GeometryPart[], x: number, z: number, y: number, r: number): { capY: number } {
  const legH = 1.1;
  const bodyH = r * 1.9;
  const cyl = new THREE.CylinderGeometry(r, r, bodyH, 10);
  parts.push({ geom: cyl, matrix: new THREE.Matrix4().makeTranslation(x, y + legH + bodyH / 2, z), mat: 0 });
  const cap = new THREE.ConeGeometry(r * 1.05, r * 0.55, 10);
  parts.push({ geom: cap, matrix: new THREE.Matrix4().makeTranslation(x, y + legH + bodyH + r * 0.27, z), mat: 0 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(
      boxPart(
        new THREE.Vector3(x + Math.cos(a) * r * 0.7, y + legH / 2, z + Math.sin(a) * r * 0.7),
        new THREE.Vector3(0.14, legH, 0.14)
      )
    );
  }
  return { capY: y + legH + bodyH + r * 0.55 };
}

/** Scattered rooftop AC/mechanical boxes. */
function addRoofBoxes(parts: GeometryPart[], rng: Rng, w: number, d: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const bw = rng.range(1.0, 2.2);
    const bd = rng.range(0.9, 1.8);
    const bh = rng.range(0.7, 1.4);
    const x = rng.range(-w / 2 + bw, w / 2 - bw);
    const z = rng.range(-d / 2 + bd, d / 2 - bd);
    parts.push(boxPart(new THREE.Vector3(x, y + bh / 2, z), new THREE.Vector3(bw, bh, bd), rng.range(0, Math.PI)));
  }
}

/** Satellite-dish farm (reduced tall.ts pattern): 2-3 small dishes on short mast stubs. */
function addDishFarm(parts: GeometryPart[], rng: Rng, w: number, d: number, y: number, count: number): void {
  const dishGeom = new THREE.SphereGeometry(0.7, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.6);
  for (let i = 0; i < count; i++) {
    const dx = rng.range(-w / 2 + 1, w / 2 - 1);
    const dz = rng.range(-d / 2 + 1, d / 2 - 1);
    const m = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + rng.range(-0.5, 0.2), rng.range(0, Math.PI * 2), 0))
      .setPosition(dx, y + 0.9, dz);
    parts.push({ geom: dishGeom, matrix: m, mat: 0 });
    parts.push(boxPart(new THREE.Vector3(dx, y + 0.45, dz), new THREE.Vector3(0.12, 0.9, 0.12)));
  }
}

// ---------------------------------------------------------------------------------
// (a) Apartment block — 22x14, ~12 floors
// ---------------------------------------------------------------------------------

/**
 * Balcony grid apartment. Street face (+Z) carries a per-floor balcony grid (slab +
 * railing, rng-populated with laundry lines, plants, storage boxes; ~30% empty). A
 * stairwell tower proud of the -X face has a red^H^H^H amber EXIT glow (palette has no
 * red — same substitution tall.ts's beacons use). Roof: water tower, dish farm,
 * clothesline. AC condenser boxes sit under ~60% of front windows. Ground floor has two
 * shopfronts with backlit square ads.
 *
 * ~6 draw calls: body, windows, accent (laundry/plants, diffuse), ads, amber glow,
 * beacons (blinking water-tower marker lamp).
 */
export function buildApartment(rng: Rng, floors = 12): THREE.Group {
  const group = new THREE.Group();
  group.name = 'apartment';

  const w = 22;
  const d = 14;
  const totalH = floors * FLOOR_H;
  const groundH = FLOOR_H * 1.1; // slightly taller ground floor for shopfronts

  const bodyParts: GeometryPart[] = [];
  const windowParts: GeometryPart[] = [];
  const accentParts: GeometryPart[] = [];
  const adParts: GeometryPart[] = [];
  const amberParts: GeometryPart[] = [];

  bodyParts.push(boxPart(new THREE.Vector3(0, totalH / 2, 0), new THREE.Vector3(w, totalH, d)));
  bodyParts.push(boxPart(new THREE.Vector3(0, totalH + 0.2, 0), new THREE.Vector3(w + 0.4, 0.4, d + 0.4)));

  // Facades on back + sides (front face gets its own facade too, mostly hidden behind
  // the balcony grid but visible through/around slabs).
  addTierFacades(windowParts, rng, w - 0.4, d - 0.4, totalH - groundH - 1, groundH, 0.24);

  // --- Balcony grid on the street (+Z) face ---
  const balCols = 5;
  const balRows = floors - 2; // skip ground + roof floor
  const balW = 3.4;
  const balD = 1.3;
  const spanW = w - 2;
  for (let r = 0; r < balRows; r++) {
    const fy = groundH + r * FLOOR_H + 0.15;
    for (let c = 0; c < balCols; c++) {
      const cx = -spanW / 2 + balW / 2 + (c * (spanW - balW)) / (balCols - 1);
      const cz = d / 2 + balD / 2 + 0.05;
      // Slab
      bodyParts.push(boxPart(new THREE.Vector3(cx, fy, cz), new THREE.Vector3(balW, 0.12, balD)));
      // Railing (3 sides, no back — building face is the back)
      const railH = 0.95;
      const t = 0.08;
      bodyParts.push(
        boxPart(new THREE.Vector3(cx, fy + railH / 2, cz + balD / 2 - t / 2), new THREE.Vector3(balW, railH, t)),
        boxPart(new THREE.Vector3(cx - balW / 2 + t / 2, fy + railH / 2, cz), new THREE.Vector3(t, railH, balD)),
        boxPart(new THREE.Vector3(cx + balW / 2 - t / 2, fy + railH / 2, cz), new THREE.Vector3(t, railH, balD))
      );

      // rng contents: 30% empty, else laundry / plant / storage boxes.
      if (rng.chance(0.3)) continue;
      const kind = rng.pick(['laundry', 'plant', 'boxes'] as const);
      if (kind === 'laundry') {
        const lineY = fy + railH + 0.1;
        bodyParts.push(
          boxPart(new THREE.Vector3(cx, lineY, cz - balD / 2 + 0.15), new THREE.Vector3(balW * 0.85, 0.03, 0.03))
        );
        const nCloth = rng.int(2, 4);
        for (let i = 0; i < nCloth; i++) {
          const cx2 = cx - balW * 0.4 + (i * (balW * 0.8)) / Math.max(1, nCloth - 1);
          accentParts.push(
            boxPart(
              new THREE.Vector3(cx2, lineY - 0.3, cz - balD / 2 + 0.15),
              new THREE.Vector3(0.4, 0.5, 0.02),
              rng.range(-0.15, 0.15)
            )
          );
        }
      } else if (kind === 'plant') {
        accentParts.push(
          boxPart(new THREE.Vector3(cx + balW * 0.3, fy + 0.35, cz), new THREE.Vector3(0.35, 0.7, 0.35))
        );
      } else {
        const nBoxes = rng.int(1, 3);
        for (let i = 0; i < nBoxes; i++) {
          const bx = cx - balW * 0.3 + i * 0.35;
          accentParts.push(
            boxPart(new THREE.Vector3(bx, fy + 0.2, cz - balD * 0.15), new THREE.Vector3(0.35, 0.4, 0.35))
          );
        }
      }
    }
  }

  // AC condenser units under ~60% of front windows (mounted on the wall between
  // balcony rows, i.e. at floor sill height, offset from the balcony columns).
  for (let r = 0; r < balRows; r++) {
    const fy = groundH + r * FLOOR_H + 0.3;
    for (let c = 0; c < balCols + 1; c++) {
      if (!rng.chance(0.6)) continue;
      const cx = -spanW / 2 + (c * spanW) / balCols;
      bodyParts.push(
        boxPart(new THREE.Vector3(cx, fy, d / 2 + 0.22), new THREE.Vector3(0.55, 0.35, 0.35))
      );
    }
  }

  // Round-2 detail (missing vs a Cyberpunk 2077 mid-block: facades read as pure window
  // wallpaper with nothing breaking the grid): a dark drainage/service pipe run proud of
  // the +X side facade, ground to roof, with elbow joints every few floors.
  {
    const pipeX = w / 2 + 0.28;
    const pipeZ = d * rng.range(-0.2, 0.2);
    bodyParts.push(boxPart(new THREE.Vector3(pipeX, totalH / 2, pipeZ), new THREE.Vector3(0.22, totalH, 0.22)));
    for (let f = 3; f < floors; f += 4) {
      bodyParts.push(boxPart(new THREE.Vector3(pipeX + 0.05, f * FLOOR_H, pipeZ), new THREE.Vector3(0.32, 0.18, 0.32)));
    }
  }

  // --- Stairwell tower on the -X face, proud of the main body, with EXIT glow. ---
  const stW = 2.6;
  const stD = 3.2;
  const stH = totalH + 1.6;
  const stX = -w / 2 - stW / 2 - 0.1;
  bodyParts.push(boxPart(new THREE.Vector3(stX, stH / 2, 0), new THREE.Vector3(stW, stH, stD)));
  amberParts.push(
    boxPart(new THREE.Vector3(stX - stW / 2 - 0.05, 2.3, 0), new THREE.Vector3(0.06, 0.5, 1.2)),
    // small repeated landing glow up the stairwell face (frosted stairwell windows)
    ...Array.from({ length: floors - 1 }, (_, i) =>
      boxPart(
        new THREE.Vector3(stX - stW / 2 - 0.03, groundH + i * FLOOR_H + 1.6, 0),
        new THREE.Vector3(0.04, 1.4, 0.5)
      )
    )
  );

  // --- Roof: water tower, dish farm, clothesline. ---
  const { capY } = addWaterTank(bodyParts, w * 0.22, -d * 0.2, totalH + 0.3, 1.3);
  addDishFarm(bodyParts, rng, w * 0.5, d * 0.6, totalH + 0.3, 2);
  addRoofBoxes(bodyParts, rng, w * 0.4, d * 0.5, totalH + 0.3, 2);
  addRailing(bodyParts, w - 0.6, d - 0.6, totalH + 0.3, 0.9);
  // Round-2 detail (missing: parapet edge reads as a bare ledge at close range):
  // pigeon spikes along the front parapet edge — a row of thin rng-jittered spikes.
  {
    const spikeCount = 14;
    for (let i = 0; i < spikeCount; i++) {
      const sx = -w / 2 + 0.6 + (i * (w - 1.2)) / (spikeCount - 1);
      bodyParts.push(
        boxPart(new THREE.Vector3(sx, totalH + 0.5 + 0.09, d / 2 - 0.35), new THREE.Vector3(0.03, 0.18, 0.03), rng.range(-0.2, 0.2))
      );
    }
  }
  // Round-3 detail (missing vs a Cyberpunk 2077 mid-block: the roof reads as isolated
  // clutter with nothing tying it together): a sagging service cable strung from the
  // water-tower cap to the dish-farm mast area, approximated as 3 short segments that
  // droop toward the middle (a cheap catenary).
  {
    const cableAX = w * 0.22;
    const cableAZ = -d * 0.2;
    const cableBX = w * 0.1;
    const cableBZ = d * 0.15;
    const cableAY = capY - 0.3;
    const cableBY = totalH + 1.1;
    const segs = 3;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const midT = (t0 + t1) / 2;
      const sag = Math.sin(midT * Math.PI) * 0.6;
      const x0 = cableAX + (cableBX - cableAX) * t0;
      const z0 = cableAZ + (cableBZ - cableAZ) * t0;
      const x1 = cableAX + (cableBX - cableAX) * t1;
      const z1 = cableAZ + (cableBZ - cableAZ) * t1;
      const y = cableAY + (cableBY - cableAY) * midT - sag;
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      bodyParts.push(
        boxPart(new THREE.Vector3((x0 + x1) / 2, y, (z0 + z1) / 2), new THREE.Vector3(0.05, 0.05, segLen), yaw)
      );
    }
  }
  // Clothesline: 2 posts + line + a few cloth quads.
  const clX = -w * 0.28;
  const clZ0 = -d * 0.32;
  const clZ1 = d * 0.1;
  const postH = 1.3;
  bodyParts.push(
    boxPart(new THREE.Vector3(clX, totalH + 0.3 + postH / 2, clZ0), new THREE.Vector3(0.1, postH, 0.1)),
    boxPart(new THREE.Vector3(clX, totalH + 0.3 + postH / 2, clZ1), new THREE.Vector3(0.1, postH, 0.1)),
    boxPart(
      new THREE.Vector3(clX, totalH + 0.3 + postH, (clZ0 + clZ1) / 2),
      new THREE.Vector3(0.03, 0.03, clZ1 - clZ0)
    )
  );
  for (let i = 0; i < 3; i++) {
    const cz = clZ0 + ((clZ1 - clZ0) * (i + 0.5)) / 3;
    accentParts.push(
      boxPart(new THREE.Vector3(clX, totalH + 0.3 + postH - 0.3, cz), new THREE.Vector3(0.35, 0.4, 0.02))
    );
  }

  // --- Ground floor: two shopfronts with square ads. ---
  const shopH = groundH - 0.3;
  const shopY = shopH / 2 + 0.1;
  const shopXs = [-w * 0.28, w * 0.12];
  const adTex = makeAd('square', rng);
  for (const sx of shopXs) {
    bodyParts.push(boxPart(new THREE.Vector3(sx, shopY, d / 2 + 0.06), new THREE.Vector3(4.2, shopH, 0.15)));
    const adGeom = new THREE.PlaneGeometry(2.6, 2.6);
    adParts.push({
      geom: adGeom,
      matrix: new THREE.Matrix4().makeTranslation(sx, shopY, d / 2 + 0.16),
      mat: 0
    });
    amberParts.push(boxPart(new THREE.Vector3(sx, shopY + shopH / 2 + 0.05, d / 2 + 0.1), new THREE.Vector3(4.4, 0.08, 0.2)));
  }
  // Round-3 detail (missing vs a Cyberpunk 2077 mid-block: the entrance between the two
  // shopfronts is unmarked): a small backlit street-address plaque flush with the wall,
  // amber, at eye height beside the entry gap.
  amberParts.push(
    boxPart(new THREE.Vector3((shopXs[0] + shopXs[1]) / 2 - 1.6, 1.7, d / 2 + 0.08), new THREE.Vector3(0.6, 0.4, 0.06))
  );

  const windowTex = makeWindowTexture(rng, {
    litRatio: rng.range(0.5, 0.65),
    coolRatio: 0.45,
    peakRatio: 0.06,
    dimLo: 0.25,
    dimHi: 0.55,
    dirt: true
  });

  group.add(mergeOne(bodyParts, makeBodyMat(), 'body'));
  group.add(mergeOne(windowParts, makeWindowMat(windowTex), 'windows'));
  group.add(
    mergeOne(
      accentParts,
      new THREE.MeshStandardMaterial({ color: COLORS.moonlight, roughness: 0.9, metalness: 0 }),
      'accent'
    )
  );
  group.add(
    mergeOne(
      adParts,
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: adTex,
        emissiveIntensity: 2.0,
        roughness: 0.9
      }),
      'ads'
    )
  );
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 2.0), 'amber'));

  // Blinking marker lamp on the water-tower cap (city assembly / viewer blink pass).
  const beaconGeom = new THREE.SphereGeometry(0.22, 8, 6);
  const beacons = mergeOne(
    [{ geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(w * 0.22, capY, -d * 0.2), mat: 0 }],
    makeBeaconMat(),
    'beacons'
  );
  group.add(beacons);

  group.userData.roofY = totalH;
  group.userData.footprint = [w, d];
  group.userData.beacons = [beacons];
  return group;
}

// ---------------------------------------------------------------------------------
// (b) Office holo tower — 26x18, ~14 floors
// ---------------------------------------------------------------------------------

/** Curtain-wall office window texture: tighter litRatio, strongly cool-biased. */
function makeCurtainWallTexture(rng: Rng): THREE.CanvasTexture {
  return makeWindowTexture(rng, {
    litRatio: rng.range(0.5, 0.65),
    coolRatio: 0.8,
    peakRatio: 0.05,
    dimLo: 0.2,
    dimHi: 0.45,
    dirt: false
  });
}

/**
 * Office holo tower. Curtain-wall facade (cooler, tighter feel via high coolRatio) wraps
 * a slab body; a wraparound additive holo-ticker band (double-sided, offset proud of the
 * facade, `userData.ticker` tagged for UV-scroll animation) rings the tower at
 * mid-height; ground floor has a recessed amber-lit lobby; roof carries a glass
 * observatory box (transparent, teal edge trim) + vent cluster.
 *
 * ~6 draw calls: body, windows, ticker, amber glow, teal glow, glass.
 */
export function buildOfficeHolo(rng: Rng, floors = 14): THREE.Group {
  const group = new THREE.Group();
  group.name = 'officeHolo';

  const w = 26;
  const d = 18;
  const totalH = floors * FLOOR_H;
  const lobbyH = FLOOR_H * 1.3;

  const bodyParts: GeometryPart[] = [];
  const windowParts: GeometryPart[] = [];
  const tickerParts: GeometryPart[] = [];
  const amberParts: GeometryPart[] = [];
  const tealParts: GeometryPart[] = [];
  const glassParts: GeometryPart[] = [];

  bodyParts.push(boxPart(new THREE.Vector3(0, totalH / 2, 0), new THREE.Vector3(w, totalH, d)));
  bodyParts.push(boxPart(new THREE.Vector3(0, totalH + 0.25, 0), new THREE.Vector3(w + 0.4, 0.5, d + 0.4)));
  addTierFacades(windowParts, rng, w - 0.4, d - 0.4, totalH - lobbyH - 1, lobbyH, 0.24);

  // --- Recessed lobby: inset box + amber interior glow spilling out the recess. ---
  bodyParts.push(boxPart(new THREE.Vector3(0, lobbyH / 2, d / 2 - 0.6), new THREE.Vector3(w * 0.6, lobbyH, 1.2)));
  amberParts.push(
    boxPart(new THREE.Vector3(0, lobbyH * 0.5, d / 2 - 1.15), new THREE.Vector3(w * 0.56, lobbyH * 0.82, 0.1)),
    boxPart(new THREE.Vector3(0, lobbyH + 0.1, d / 2 - 0.6), new THREE.Vector3(w * 0.62, 0.1, 1.3))
  );

  // --- Wraparound holo ticker band: 4 faces, slight outward offset, additive, double
  // sided, single strip-ad texture so all 4 sides share one material/draw call. UVs
  // scaled ~2x around so the ad text tiles legibly rather than stretching once per face.
  const tickerY = totalH * 0.42;
  const tickerH = 3.2;
  const gap = 0.35;
  const adTex = makeAd('strip', rng);
  adTex.wrapS = THREE.RepeatWrapping;
  const faceSpecs: Array<[number, number, number, number]> = [
    [w, 0, d / 2 + gap, 0],
    [w, 0, -d / 2 - gap, Math.PI],
    [d, w / 2 + gap, 0, Math.PI / 2],
    [d, -w / 2 - gap, 0, -Math.PI / 2]
  ];
  for (const [faceW, x, z, rotY] of faceSpecs) {
    const geom = new THREE.PlaneGeometry(faceW, tickerH);
    const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i));
    const quat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotY);
    tickerParts.push({
      geom,
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, tickerY, z), quat, new THREE.Vector3(1, 1, 1)),
      mat: 0
    });
  }
  // Mount rails top/bottom of the ticker band (reads as a physical fixture).
  for (const side of [1, -1]) {
    bodyParts.push(
      boxPart(new THREE.Vector3(0, tickerY + side * (tickerH / 2 + 0.15), d / 2 + gap), new THREE.Vector3(w + 0.6, 0.15, 0.2)),
      boxPart(new THREE.Vector3(0, tickerY + side * (tickerH / 2 + 0.15), -d / 2 - gap), new THREE.Vector3(w + 0.6, 0.15, 0.2)),
      boxPart(new THREE.Vector3(w / 2 + gap, tickerY + side * (tickerH / 2 + 0.15), 0), new THREE.Vector3(0.2, 0.15, d + 0.6)),
      boxPart(new THREE.Vector3(-w / 2 - gap, tickerY + side * (tickerH / 2 + 0.15), 0), new THREE.Vector3(0.2, 0.15, d + 0.6))
    );
  }

  // Round-2 detail (missing vs a Cyberpunk 2077 mid-block: the -X side face is a bare
  // curtain wall with nothing at human/mid scale): a zigzag fire escape — alternating
  // switchback platforms + diagonal stair boxes + a thin rail lip, floor to floor.
  {
    const feX = -w / 2 - 0.18;
    const platD = 1.1;
    const platW = 2.2;
    const jog = 1.0; // small lateral switchback offset — this is a fire escape, not a ramp
    for (let f = 1; f < floors; f++) {
      const fy = f * FLOOR_H;
      const side = f % 2 === 0 ? 1 : -1;
      const pz = side * jog;
      bodyParts.push(boxPart(new THREE.Vector3(feX, fy, pz), new THREE.Vector3(0.5, 0.08, platW)));
      bodyParts.push(boxPart(new THREE.Vector3(feX, fy + 0.35, pz + side * (platW / 2 - 0.05)), new THREE.Vector3(0.5, 0.7, 0.06)));
      // Diagonal stair run up to the next platform: a thin slab pitched about X so it
      // spans the floor-to-floor rise between the two switchback landings.
      const nextSide = (f + 1) % 2 === 0 ? 1 : -1;
      const nextPz = nextSide * jog;
      const midZ = (pz + nextPz) / 2;
      const runLen = Math.hypot(FLOOR_H, nextPz - pz);
      const pitch = Math.atan2(nextPz - pz, FLOOR_H);
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
      bodyParts.push({
        geom: new THREE.BoxGeometry(1, 1, 1),
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(feX, fy + FLOOR_H / 2, midZ),
          quat,
          new THREE.Vector3(0.5, 0.06, runLen)
        ),
        mat: 0
      });
    }
  }

  // --- Roof: glass observatory box (transparent, teal edge trim) + vent cluster. ---
  const obsW = 10;
  const obsD = 8;
  const obsH = 3.6;
  const obsY = totalH + 0.5 + obsH / 2;
  glassParts.push(boxPart(new THREE.Vector3(0, obsY, 0), new THREE.Vector3(obsW, obsH, obsD)));
  // Teal edge frame: 4 vertical edge bars + top/bottom rim.
  const halfW = obsW / 2;
  const halfD = obsD / 2;
  for (const [ex, ez] of [
    [halfW, halfD],
    [halfW, -halfD],
    [-halfW, halfD],
    [-halfW, -halfD]
  ] as Array<[number, number]>) {
    tealParts.push(boxPart(new THREE.Vector3(ex, obsY, ez), new THREE.Vector3(0.14, obsH, 0.14)));
  }
  tealParts.push(
    boxPart(new THREE.Vector3(0, obsY + obsH / 2, halfD), new THREE.Vector3(obsW, 0.1, 0.1)),
    boxPart(new THREE.Vector3(0, obsY + obsH / 2, -halfD), new THREE.Vector3(obsW, 0.1, 0.1)),
    boxPart(new THREE.Vector3(halfW, obsY + obsH / 2, 0), new THREE.Vector3(0.1, 0.1, obsD)),
    boxPart(new THREE.Vector3(-halfW, obsY + obsH / 2, 0), new THREE.Vector3(0.1, 0.1, obsD))
  );
  addRoofBoxes(bodyParts, rng, w * 0.55, d * 0.4, totalH + 0.5, 3);
  addRailing(bodyParts, w - 0.6, d - 0.6, totalH + 0.5);
  // Round-3 detail (missing vs a Cyberpunk 2077 mid-block: the roofline is just the
  // observatory + vent boxes, no rooftop machinery cantilevering off the edge): a
  // window-washer davit crane — mast + horizontal jib arm reaching out past the front
  // (+Z) parapet, a classic office-tower roofline silhouette element.
  {
    const craneX = -w * 0.32;
    const craneZ = d / 2 - 0.4;
    const craneMastH = 2.4;
    const jibLen = 3.2;
    bodyParts.push(
      boxPart(new THREE.Vector3(craneX, totalH + 0.5 + craneMastH / 2, craneZ), new THREE.Vector3(0.22, craneMastH, 0.22)),
      boxPart(
        new THREE.Vector3(craneX, totalH + 0.5 + craneMastH, craneZ + jibLen / 2),
        new THREE.Vector3(0.16, 0.16, jibLen)
      ),
      // back-stay brace
      boxPart(
        new THREE.Vector3(craneX, totalH + 0.5 + craneMastH * 0.6, craneZ - 0.9),
        new THREE.Vector3(0.12, 0.12, 1.9),
        Math.PI / 5
      )
    );
    tealParts.push(
      boxPart(new THREE.Vector3(craneX, totalH + 0.5 + craneMastH + 0.05, craneZ + jibLen - 0.15), new THREE.Vector3(0.2, 0.12, 0.2))
    );
  }
  // small teal warning lamps on the vent cluster edge so the roof clutter reads at night
  tealParts.push(
    boxPart(new THREE.Vector3(w * 0.34, totalH + 1.1, d * 0.34), new THREE.Vector3(0.18, 0.18, 0.18)),
    boxPart(new THREE.Vector3(-w * 0.34, totalH + 1.1, -d * 0.34), new THREE.Vector3(0.18, 0.18, 0.18))
  );
  // Round-3 detail (missing vs a Cyberpunk 2077 mid-block: no human-scale access route
  // up to the roof machinery): a caged maintenance ladder up the -Z face from the top
  // curtain-wall floor to the roof deck — 2 rails + rungs.
  {
    const ladderX = w * 0.2;
    const ladderZ = -d / 2 - 0.1;
    const ladderBaseY = totalH - FLOOR_H * 2;
    const ladderH = totalH + 0.5 - ladderBaseY;
    for (const rx of [-0.22, 0.22]) {
      bodyParts.push(
        boxPart(new THREE.Vector3(ladderX + rx, ladderBaseY + ladderH / 2, ladderZ), new THREE.Vector3(0.05, ladderH, 0.05))
      );
    }
    const rungs = Math.round(ladderH / 0.35);
    for (let i = 0; i < rungs; i++) {
      bodyParts.push(
        boxPart(new THREE.Vector3(ladderX, ladderBaseY + i * 0.35, ladderZ), new THREE.Vector3(0.5, 0.03, 0.03))
      );
    }
  }

  const windowTex = makeCurtainWallTexture(rng);

  group.add(mergeOne(bodyParts, makeBodyMat(), 'body'));
  group.add(mergeOne(windowParts, makeWindowMat(windowTex, 1.8), 'windows'));
  const tickerMesh = mergeOne(
    tickerParts,
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: adTex,
      emissiveIntensity: 2.2,
      roughness: 1,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }),
    'ticker'
  );
  group.add(tickerMesh);
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 2.2), 'amber'));
  group.add(mergeOne(tealParts, makeGlowMat(COLORS.holoTeal, 1.8), 'teal'));
  // Note: removed transmission:0.4 (it triggered an expensive transmissive rendering pass
  // that multiplied draw calls per officeHolo placement; replaced with simple transparency).
  group.add(
    mergeOne(
      glassParts,
      new THREE.MeshStandardMaterial({
        color: COLORS.holoTeal,
        transparent: true,
        opacity: 0.22,
        roughness: 0.1,
        metalness: 0.2,
        side: THREE.DoubleSide
      }),
      'glass'
    )
  );

  group.userData.roofY = totalH;
  group.userData.footprint = [w, d];
  group.userData.ticker = tickerMesh;
  return group;
}

// ---------------------------------------------------------------------------------
// (c) Parking structure — 34x22 (elongated), ~7 decks
// ---------------------------------------------------------------------------------

/** Concrete deck texture w/ rng oil-stain blotches (diffuse, no emissive). */
function makeDeckTexture(rng: Rng): THREE.CanvasTexture {
  const size = 256;
  return makeCanvasTexture(size, size, (ctx) => {
    ctx.fillStyle = hex(COLORS.shadowBlue);
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = hex(COLORS.void);
    for (let i = 0; i < 5; i++) {
      // faint expansion-joint lines
      const y = (i / 5) * size + rng.range(-4, 4);
      ctx.fillRect(0, y, size, 2);
    }
    const stains = rng.int(6, 11);
    for (let i = 0; i < stains; i++) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const r = rng.range(6, 22);
      ctx.globalAlpha = rng.range(0.25, 0.55);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * rng.range(0.5, 0.9), rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/**
 * Open parking structure. Each of `decks` levels is a floor slab + perimeter columns +
 * low parapet, with 2-5 rng-placed car silhouettes (dark boxes, dim amber tail lights).
 * A helical ramp (approximated as a stack of short rotated tread segments spiraling
 * around a central drum) sits at one end; the roof deck carries lamp poles and a big
 * magenta neon "P" sign on a short tower.
 *
 * ~5 draw calls (room to grow under the 6 budget for iteration passes): body (columns,
 * parapets, ramp, cars, lamp masts), deck (oil-stain floor texture), amber glow (tail
 * lights + lamp heads), magenta glow (P sign), beacons (blinking rooftop lamp).
 */
export function buildParking(rng: Rng, decks = 7): THREE.Group {
  const group = new THREE.Group();
  group.name = 'parking';

  const w = 34;
  const d = 22;
  const deckH = FLOOR_H;
  const totalH = decks * deckH;

  const bodyParts: GeometryPart[] = [];
  const deckParts: GeometryPart[] = [];
  const amberParts: GeometryPart[] = [];
  const magentaParts: GeometryPart[] = [];
  // Parked-car silhouettes get one of two body-color variants. `carColors[0]` matches
  // makeBodyMat()'s color exactly, so those cars stay merged into `bodyParts` at zero
  // extra draw-call cost; `carColors[1]` (shadowBlue) needs its own tinted material, so
  // those cars route into `carAltParts` and get merged as one extra mesh (+1 draw call,
  // keeping the parking build at 6 of the 6-call budget).
  const carAltParts: GeometryPart[] = [];

  // Perimeter columns (grid: 4 along length, 2 along depth), full height.
  const colXs = [-w / 2 + 1, -w / 6, w / 6, w / 2 - 1];
  const colZs = [-d / 2 + 1, d / 2 - 1];
  for (const cx of colXs) {
    for (const cz of colZs) {
      bodyParts.push(boxPart(new THREE.Vector3(cx, totalH / 2, cz), new THREE.Vector3(0.6, totalH, 0.6)));
    }
  }

  const carColors = [COLORS.towerBody, COLORS.shadowBlue];
  let camPos: THREE.Vector3 | undefined;
  for (let level = 0; level <= decks; level++) {
    const y = level * deckH;
    // Floor slab (deck-textured, incl. roof deck) — skip ground-level slab (it's the
    // street), decks 1..decks are elevated floors, plus the roof deck itself at `decks`.
    if (level > 0) {
      const geom = new THREE.PlaneGeometry(w - 1.2, d - 1.2);
      geom.rotateX(-Math.PI / 2);
      deckParts.push({ geom, matrix: new THREE.Matrix4().makeTranslation(0, y + 0.02, 0), mat: 0 });
      bodyParts.push(boxPart(new THREE.Vector3(0, y - deckH / 2 + 0.02, 0), new THREE.Vector3(w - 0.8, 0.22, d - 0.8)));
    }
    if (level < decks) {
      // Low parapet around each open deck's perimeter.
      addRailing(bodyParts, w - 0.4, d - 0.4, y, 0.85);
      // Round-2 detail (missing vs a Cyberpunk 2077 mid-block: the open decks read as a
      // solid dark box — nothing signals they're hollow inside): a dim amber wall-wash
      // strip along the underside of each deck's leading edge, like real garage safety
      // lighting, so the negative space between floors registers at a distance.
      amberParts.push(
        boxPart(new THREE.Vector3(0, y + 0.05, d / 2 - 0.5), new THREE.Vector3(w - 1.2, 0.04, 0.06)),
        boxPart(new THREE.Vector3(0, y + 0.05, -d / 2 + 0.5), new THREE.Vector3(w - 1.2, 0.04, 0.06))
      );

      // 2-5 cars per deck.
      const nCars = rng.int(2, 5);
      const usedX = new Set<number>();
      for (let i = 0; i < nCars; i++) {
        let cx = 0;
        let attempts = 0;
        do {
          cx = rng.range(-w / 2 + 4, w / 2 - 4);
          attempts++;
        } while ([...usedX].some((ux) => Math.abs(ux - cx) < 3) && attempts < 8);
        usedX.add(cx);
        const cz = rng.pick([-d / 2 + 3.5, d / 2 - 3.5]);
        const carW = rng.range(1.7, 1.9);
        const carLen = rng.range(3.8, 4.4);
        const carH = rng.range(1.3, 1.5);
        const rot = rng.chance(0.5) ? 0 : Math.PI;
        const carColorIdx = rng.int(0, carColors.length - 1);
        const carParts = carColorIdx === 0 ? bodyParts : carAltParts;
        carParts.push(
          boxPart(new THREE.Vector3(cx, y + carH / 2 + 0.05, cz), new THREE.Vector3(carW, carH, carLen), 0),
          boxPart(new THREE.Vector3(cx, y + carH + 0.25, cz), new THREE.Vector3(carW * 0.75, carH * 0.4, carLen * 0.45))
        );
        // Dim amber tail lights at one end.
        const lightZ = cz + (rot === 0 ? -carLen / 2 : carLen / 2) * (rng.chance(0.5) ? 1 : -1);
        amberParts.push(
          boxPart(new THREE.Vector3(cx - carW * 0.35, y + carH * 0.55, lightZ), new THREE.Vector3(0.2, 0.14, 0.06)),
          boxPart(new THREE.Vector3(cx + carW * 0.35, y + carH * 0.55, lightZ), new THREE.Vector3(0.2, 0.14, 0.06))
        );
      }
    }
  }

  // --- Helical ramp: a stack of short tread segments spiraling up a drum at the -X end.
  const rampX = -w / 2 + 3.5;
  const rampZ = d / 2 - 4;
  const rampR = 3.2;
  const segCount = 28;
  const rampTotalH = totalH;
  for (let i = 0; i < segCount; i++) {
    const t = i / segCount;
    const a = t * Math.PI * 2 * (rampTotalH / (deckH * 3)); // ~3 full turns per deck-ish
    const y = t * rampTotalH + 0.3;
    bodyParts.push(
      boxPart(
        new THREE.Vector3(rampX + Math.cos(a) * rampR, y, rampZ + Math.sin(a) * rampR),
        new THREE.Vector3(2.4, 0.18, 1.4),
        -a
      )
    );
  }
  // Central drum (open cylinder shell) the ramp winds around.
  const drumGeom = new THREE.CylinderGeometry(0.5, 0.5, rampTotalH, 8, 1, true);
  bodyParts.push({
    geom: drumGeom,
    matrix: new THREE.Matrix4().makeTranslation(rampX, rampTotalH / 2, rampZ),
    mat: 0
  });

  // Round-2 detail (missing vs a Cyberpunk 2077 mid-block: nothing at ground level
  // signals this is a paid parking structure, not just a dark undercroft): a ticket
  // booth (small lit box) + a boom barrier arm across the entrance lane at street level.
  {
    const boothX = w / 2 - 5;
    const boothZ = -d / 2 + 1.6;
    bodyParts.push(boxPart(new THREE.Vector3(boothX, 1.1, boothZ), new THREE.Vector3(1.4, 2.2, 1.4)));
    amberParts.push(
      boxPart(new THREE.Vector3(boothX, 1.3, boothZ + 0.72), new THREE.Vector3(1.0, 0.8, 0.06))
    );
    const armPivotX = boothX - 0.8;
    const armLen = 3.4;
    bodyParts.push(boxPart(new THREE.Vector3(armPivotX, 0.9, boothZ), new THREE.Vector3(0.18, 0.9, 0.18)));
    bodyParts.push(
      boxPart(
        new THREE.Vector3(armPivotX - armLen / 2, 1.55, boothZ),
        new THREE.Vector3(armLen, 0.08, 0.1)
      )
    );
    // Alternating amber/moonlight stripe accents on the arm (a couple of dim marker
    // blocks read as reflective barrier-arm striping).
    amberParts.push(
      boxPart(new THREE.Vector3(armPivotX - armLen * 0.3, 1.55, boothZ), new THREE.Vector3(0.35, 0.1, 0.12)),
      boxPart(new THREE.Vector3(armPivotX - armLen * 0.75, 1.55, boothZ), new THREE.Vector3(0.35, 0.1, 0.12))
    );

    // Round-3 detail (missing vs a Cyberpunk 2077 mid-block: a paid entrance with no
    // surveillance is unconvincing): a security camera on a short gooseneck mount above
    // the booth, with a tiny blinking status LED (tagged into the beacon blink pass).
    camPos = new THREE.Vector3(boothX + 0.9, 2.6, boothZ + 0.5);
    bodyParts.push(
      boxPart(new THREE.Vector3(boothX + 0.75, 2.3, boothZ + 0.5), new THREE.Vector3(0.08, 0.5, 0.08)),
      boxPart(camPos, new THREE.Vector3(0.35, 0.16, 0.16))
    );
  }

  // --- Rooftop lamp poles (4 corners-ish) + big magenta "P" sign tower. ---
  const roofY = totalH;
  const lampPositions: Array<[number, number]> = [
    [-w / 2 + 3, -d / 2 + 3],
    [w / 2 - 3, -d / 2 + 3],
    [-w / 2 + 3, d / 2 - 3],
    [w / 2 - 3, d / 2 - 3]
  ];
  const lampH = 3.2;
  for (const [lx, lz] of lampPositions) {
    bodyParts.push(boxPart(new THREE.Vector3(lx, roofY + lampH / 2, lz), new THREE.Vector3(0.14, lampH, 0.14)));
    amberParts.push(boxPart(new THREE.Vector3(lx, roofY + lampH + 0.1, lz), new THREE.Vector3(0.3, 0.2, 0.3)));
  }

  // Round-3 detail (missing vs a Cyberpunk 2077 mid-block: the roof deck's open edge is
  // just the low parapet — no safety fencing above it like a real rooftop parking level):
  // a chain-link-style fence (thin post + 2 rails, no actual mesh weave at this scale)
  // running the roof deck's perimeter above the parapet.
  {
    const fenceH = 1.6;
    const fenceY = roofY + 0.85;
    const postSpacing = 4;
    const perim: Array<[number, number, number, number]> = [
      [w - 0.4, 0, d / 2 - 0.2, 0], // along +Z edge (width run)
      [w - 0.4, 0, -d / 2 + 0.2, 0], // along -Z edge
      [d - 0.4, w / 2 - 0.2, 0, Math.PI / 2], // along +X edge (depth run)
      [d - 0.4, -w / 2 + 0.2, 0, Math.PI / 2] // along -X edge
    ];
    for (const [len, cx, cz, rotY] of perim) {
      bodyParts.push(boxPart(new THREE.Vector3(cx, fenceY + fenceH / 2, cz), new THREE.Vector3(0.04, fenceH, len), rotY));
      const nPosts = Math.max(2, Math.round(len / postSpacing));
      for (let i = 0; i <= nPosts; i++) {
        const off = -len / 2 + (i * len) / nPosts;
        const px = rotY === 0 ? cx + off : cx;
        const pz = rotY === 0 ? cz : cz + off;
        bodyParts.push(boxPart(new THREE.Vector3(px, fenceY + fenceH / 2, pz), new THREE.Vector3(0.06, fenceH, 0.06)));
      }
    }
  }

  // P sign: short tower + a big flat "P" built from 3 boxes (vertical stroke + 2-box
  // loop), magenta emissive, facing the street (+Z).
  const signTowerH = 3.5;
  const signX = w / 2 - 2.5;
  bodyParts.push(boxPart(new THREE.Vector3(signX, roofY + signTowerH / 2, 0), new THREE.Vector3(1.6, signTowerH, 1.6)));
  const pBaseY = roofY + signTowerH + 1.8;
  const pZ = d / 2 - 0.3;
  magentaParts.push(
    boxPart(new THREE.Vector3(signX, pBaseY, pZ), new THREE.Vector3(0.5, 3.6, 0.25)), // vertical stroke
    boxPart(new THREE.Vector3(signX + 0.55, pBaseY + 0.9, pZ), new THREE.Vector3(0.6, 0.4, 0.25)), // loop top
    boxPart(new THREE.Vector3(signX + 0.55, pBaseY + 0.1, pZ), new THREE.Vector3(0.6, 0.4, 0.25)), // loop bottom
    boxPart(new THREE.Vector3(signX + 0.85, pBaseY + 0.5, pZ), new THREE.Vector3(0.25, 0.9, 0.25)) // loop side
  );

  const deckTex = makeDeckTexture(rng);
  deckTex.wrapS = THREE.RepeatWrapping;
  deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.repeat.set(2, 1.3);

  group.add(mergeOne(bodyParts, makeBodyMat(), 'body'));
  if (carAltParts.length > 0) {
    group.add(
      mergeOne(
        carAltParts,
        new THREE.MeshStandardMaterial({ color: carColors[1], roughness: 0.85, metalness: 0.15 }),
        'carsAlt'
      )
    );
  }
  group.add(
    mergeOne(
      deckParts,
      new THREE.MeshStandardMaterial({ map: deckTex, color: 0xffffff, roughness: 0.95, metalness: 0.05 }),
      'deck'
    )
  );
  group.add(mergeOne(amberParts, makeGlowMat(COLORS.sodiumAmber, 1.8), 'amber'));
  group.add(mergeOne(magentaParts, makeGlowMat(COLORS.signalMagenta, 2.6), 'signMagenta'));

  // Blinking rooftop lamp (aviation-style marker on the P-sign tower) + the security
  // camera's status LED, sharing the same blink pass.
  const beaconGeom = new THREE.SphereGeometry(0.2, 8, 6);
  const beaconGeomSmall = new THREE.SphereGeometry(0.08, 6, 5);
  const beaconParts: GeometryPart[] = [
    { geom: beaconGeom, matrix: new THREE.Matrix4().makeTranslation(signX, roofY + signTowerH + 0.3, 0), mat: 0 }
  ];
  if (camPos) {
    beaconParts.push({ geom: beaconGeomSmall, matrix: new THREE.Matrix4().makeTranslation(camPos.x + 0.2, camPos.y, camPos.z), mat: 0 });
  }
  const beacons = mergeOne(beaconParts, makeBeaconMat(), 'beacons');
  group.add(beacons);

  group.userData.roofY = roofY;
  group.userData.footprint = [w, d];
  group.userData.beacons = [beacons];
  return group;
}
