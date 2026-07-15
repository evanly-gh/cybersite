import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { type GeometryPart } from '../../utils/merge';
import { boxPart, mergeOne, makeBodyMat, makeGlowMat } from '../buildings/tall';
import { makeCanvasTexture } from '../../utils/canvasText';
import { makeAd } from '../../content/adGenerator';

/**
 * Task 18 (part 2/4): the night gas station — the classic over-lit forecourt island
 * that reads as a bright teal-white pool of light under a black sky (Gregory Crewdson /
 * Blade Runner 2049 truck-stop look).
 *
 * The one thing that MUST be bright: the canopy underside light panel. Everything else is
 * near-black body with readable glows — pump ad screens (square makeAd), the mono price
 * tower, and the kiosk window.
 *
 * Draw calls: body / bright canopy panel / holo-teal glow accents / amber glow / pump
 * screens / price canvas / kiosk window / oil-stain decal — 8 merged meshes.
 */

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** Mono price-board canvas: fake credits/liter figures in Share Tech Mono over dark. */
function makePriceTexture(rng: Rng): THREE.CanvasTexture {
  const w = 256;
  const h = 384;
  const grades = ['REGULR', 'PREMIM', 'SYNTH-X'];
  const prices = [0, 1, 2].map(() => `${rng.int(3, 9)}.${rng.int(10, 99)}`);
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = hex(COLORS.void);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(COLORS.sodiumAmber);
    ctx.font = 'bold 30px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('CREDITS / L', w / 2, 44);
    for (let i = 0; i < 3; i++) {
      const y = 110 + i * 92;
      ctx.textAlign = 'left';
      ctx.fillStyle = hex(COLORS.holoTeal);
      ctx.font = '22px "Share Tech Mono"';
      ctx.fillText(grades[i], 20, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = hex(COLORS.sodiumAmber);
      ctx.font = 'bold 40px "Share Tech Mono"';
      ctx.fillText(prices[i], w - 18, y + 34);
    }
    // scanlines
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  });
}

/** Oil-stain / tyre-scuff decal for the forecourt slab. */
function makeStainTexture(rng: Rng): THREE.CanvasTexture {
  const s = 256;
  return makeCanvasTexture(s, s, (ctx) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      const x = rng.range(0, s);
      const y = rng.range(0, s);
      const r = rng.range(6, 30);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function buildPump(
  rng: Rng,
  body: GeometryPart[],
  hose: GeometryPart[],
  screens: GeometryPart[],
  x: number,
  z: number,
  screenGeom: THREE.PlaneGeometry
): void {
  // island curb
  body.push(boxPart(new THREE.Vector3(x, 0.1, z), new THREE.Vector3(2.6, 0.2, 1.2)));
  // dispenser body
  const bh = 1.7;
  body.push(boxPart(new THREE.Vector3(x, 0.2 + bh / 2, z), new THREE.Vector3(0.7, bh, 0.9)));
  // topper
  body.push(boxPart(new THREE.Vector3(x, 0.2 + bh + 0.15, z), new THREE.Vector3(0.9, 0.3, 1.05)));
  // ad screen on +Z face
  screens.push({
    geom: screenGeom,
    matrix: new THREE.Matrix4().setPosition(x, 0.2 + bh * 0.62, z + 0.47),
    mat: 0
  });
  // nozzle holster post + curved hose to nozzle on -X side
  const nozzleBase = new THREE.Vector3(x - 0.4, 0.2 + bh * 0.5, z);
  hose.push(boxPart(new THREE.Vector3(nozzleBase.x, 0.2 + bh * 0.75, z), new THREE.Vector3(0.12, 0.5, 0.12)));
  // hose as a small catenary curve down to a nozzle block
  const nozzleTip = new THREE.Vector3(x - 0.55, 0.2 + bh * 0.28, z + rng.range(-0.2, 0.2));
  const sag = new THREE.Vector3(x - 0.55, 0.2 + bh * 0.32, z);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(nozzleBase.x, 0.2 + bh * 0.7, z),
    sag,
    nozzleTip
  ]);
  const tube = new THREE.TubeGeometry(curve, 12, 0.05, 6, false);
  hose.push({ geom: tube, matrix: new THREE.Matrix4(), mat: 0 });
  hose.push(boxPart(new THREE.Vector3(nozzleTip.x, nozzleTip.y, nozzleTip.z), new THREE.Vector3(0.12, 0.28, 0.12)));
}

export function buildGasStation(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gasStation';

  const body: GeometryPart[] = [];
  const panel: GeometryPart[] = []; // BRIGHT canopy underside
  const teal: GeometryPart[] = []; // canopy fascia glow band
  const amber: GeometryPart[] = []; // bollards / kiosk trim / air pump
  const hose: GeometryPart[] = [];
  const screens: GeometryPart[] = [];
  const priceP: GeometryPart[] = [];
  const kioskWin: GeometryPart[] = [];

  // --- forecourt slab ---
  const slabW = 20;
  const slabD = 14;
  body.push(boxPart(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(slabW, 0.04, slabD)));

  // --- canopy on 4 columns ---
  const canW = 14;
  const canD = 10;
  const canY = 5.4;
  const colX = canW / 2 - 1.5;
  const colZ = canD / 2 - 1.5;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      body.push(boxPart(new THREE.Vector3(sx * colX, canY / 2, sz * colZ), new THREE.Vector3(0.6, canY, 0.6)));
    }
  }
  // canopy slab (roof + fascia rim)
  body.push(boxPart(new THREE.Vector3(0, canY + 0.55, 0), new THREE.Vector3(canW, 0.7, canD)));
  // fascia teal light band around the rim
  for (const sz of [1, -1]) {
    teal.push(boxPart(new THREE.Vector3(0, canY + 0.35, sz * (canD / 2 + 0.02)), new THREE.Vector3(canW, 0.18, 0.06)));
  }
  for (const sx of [1, -1]) {
    teal.push(boxPart(new THREE.Vector3(sx * (canW / 2 + 0.02), canY + 0.35, 0), new THREE.Vector3(0.06, 0.18, canD)));
  }
  // BRIGHT underside light panel — the signature over-lit forecourt glow
  panel.push(boxPart(new THREE.Vector3(0, canY + 0.12, 0), new THREE.Vector3(canW - 0.6, 0.08, canD - 0.6)));

  // --- 4 pump islands under the canopy (2 rows of 2) ---
  const screenGeom = new THREE.PlaneGeometry(0.62, 0.7);
  const pumpX = [-2.6, 2.6];
  const pumpZ = [-2.4, 2.4];
  for (const px of pumpX) {
    for (const pz of pumpZ) {
      buildPump(rng, body, hose, screens, px, pz, screenGeom);
    }
  }

  // Task E: bollards (4 yellow-ish short cylinders around the pump island)
  const bollardGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 10);
  const bollardPositions: Array<[number, number]> = [
    [-5.2, -4.2], [5.2, -4.2], [-5.2, 4.2], [5.2, 4.2]
  ];
  for (const [bx, bz] of bollardPositions) {
    amber.push({ geom: bollardGeom, matrix: new THREE.Matrix4().setPosition(bx, 0.4, bz), mat: 0 });
  }

  // Task E: oil stain elliptical decals near pumps
  for (let i = 0; i < 3; i++) {
    const oilX = rng.range(-3.5, 3.5);
    const oilZ = rng.range(-2.8, 2.8);
    const oilW = rng.range(1.0, 2.2);
    const oilD = rng.range(0.5, 1.2);
    const oilMesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshStandardMaterial({
        color: 0x050508,
        transparent: true,
        opacity: 0.82,
        roughness: 0.1,
        metalness: 0.05,
        depthWrite: false
      })
    );
    oilMesh.rotation.x = -Math.PI / 2;
    oilMesh.scale.set(oilW, oilD, 1);
    oilMesh.position.set(oilX, 0.06, oilZ);
    oilMesh.name = `oilSpot${i}`;
    group.add(oilMesh);
  }

  // --- price sign tower at the forecourt corner ---
  const signX = slabW / 2 - 1.2;
  const signZ = -slabD / 2 + 1.2;
  body.push(boxPart(new THREE.Vector3(signX, 3.2, signZ), new THREE.Vector3(0.5, 6.4, 0.5)));
  body.push(boxPart(new THREE.Vector3(signX, 6.8, signZ), new THREE.Vector3(2.4, 1.8, 0.7)));
  const priceGeom = new THREE.PlaneGeometry(2.0, 1.5);
  for (const [rot, zoff] of [
    [0, 0.36],
    [Math.PI, -0.36]
  ] as Array<[number, number]>) {
    priceP.push({
      geom: priceGeom,
      matrix: new THREE.Matrix4().makeRotationY(rot).setPosition(signX, 6.8, signZ + zoff),
      mat: 0
    });
  }

  // --- kiosk with glowing window ---
  const kioskX = -slabW / 2 + 3;
  const kioskZ = slabD / 2 - 2.5;
  const kW = 5;
  const kD = 4;
  const kH = 3.2;
  body.push(boxPart(new THREE.Vector3(kioskX, kH / 2, kioskZ), new THREE.Vector3(kW, kH, kD)));
  body.push(boxPart(new THREE.Vector3(kioskX, kH + 0.15, kioskZ), new THREE.Vector3(kW + 0.4, 0.3, kD + 0.4)));
  // storefront glass on the -Z face (facing forecourt), warm interior glow
  kioskWin.push(boxPart(new THREE.Vector3(kioskX, 1.5, kioskZ - kD / 2 - 0.03), new THREE.Vector3(kW - 0.8, 2.0, 0.06)));

  // --- air/water pump post in the corner + oil-stain decal ---
  const airX = slabW / 2 - 2.5;
  const airZ = slabD / 2 - 2;
  body.push(boxPart(new THREE.Vector3(airX, 0.6, airZ), new THREE.Vector3(0.5, 1.2, 0.4)));
  amber.push(boxPart(new THREE.Vector3(airX, 0.9, airZ - 0.22), new THREE.Vector3(0.3, 0.3, 0.05)));

  // oil-stain decal plane just above the slab
  const stainTex = makeStainTexture(rng);
  const stain = new THREE.Mesh(
    new THREE.PlaneGeometry(canW - 1, canD - 1),
    new THREE.MeshBasicMaterial({ map: stainTex, transparent: true, opacity: 0.8, depthWrite: false })
  );
  stain.rotation.x = -Math.PI / 2;
  stain.position.y = 0.05;
  stain.name = 'oilStains';

  // --- merge + materials ---
  group.add(mergeOne(body, makeBodyMat(), 'body'));
  // canopy underside panel: bright cool white-teal, high emissive (the point of the asset)
  group.add(
    mergeOne(
      panel,
      new THREE.MeshStandardMaterial({
        color: COLORS.moonlight,
        emissive: COLORS.moonlight,
        emissiveIntensity: 2.5, // Task E: brighter canopy underside (spec: 2.5)
        roughness: 1,
        metalness: 0
      }),
      'canopyPanel'
    )
  );
  group.add(mergeOne(teal, makeGlowMat(COLORS.holoTeal, 2.0), 'fascia'));
  group.add(mergeOne(amber, makeGlowMat(COLORS.sodiumAmber, 2.0), 'amber'));
  group.add(mergeOne(hose, makeBodyMat(), 'hose'));

  const pumpAd = makeAd('square', rng);
  group.add(
    mergeOne(
      screens,
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: pumpAd,
        emissiveIntensity: 1.8,
        roughness: 0.9
      }),
      'pumpScreens'
    )
  );
  const priceTex = makePriceTexture(rng);
  group.add(
    mergeOne(
      priceP,
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: priceTex,
        emissiveIntensity: 1.9,
        roughness: 0.9,
        side: THREE.DoubleSide
      }),
      'priceBoard'
    )
  );
  group.add(mergeOne(kioskWin, makeGlowMat(COLORS.sodiumAmber, 1.4), 'kioskWindow'));
  group.add(stain);

  return group;
}
