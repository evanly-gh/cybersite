import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { type GeometryPart } from '../../utils/merge';
import { boxPart, mergeOne, makeBodyMat, makeGlowMat } from '../buildings/tall';
import { makeCanvasTexture } from '../../utils/canvasText';
import { makeAd } from '../../content/adGenerator';

/**
 * Task 18 (part 4/4) + Task E upgrades: the street-furniture kit that dresses the
 * sidewalk the bike rides.
 *  - buildStreetLamp: sodium-amber head + additive light cone + sidewalk pool decal.
 *    THE lamps — the amber pools that light the ground (spec §5.5). Exposes
 *    userData.glow for the propYard flicker pass.
 *    Task E: junction box on pole at ~2m, cable drop cylinder.
 *  - buildTrafficLight: 3-lamp head both directions + pedestrian walking-man box.
 *    Task E: pedestrian signal box with canvas glyph already existed; retained.
 *  - buildSteamVent: sidewalk grate + userData.steamAnchor for the fx task.
 *  - buildVendingMachine / buildHydrant / buildTrashHeap: forecourt clutter.
 *    Task E: vending machine gets face texture + indicator strip + base plate;
 *    trash heap gets more geometric variety + puddle decal.
 *  - NEW: buildDumpster, buildConcreteBarrier, buildPhoneBooth.
 *
 * Night mood: near-black bodies, the glows are the point. Colors only from theme COLORS;
 * synth red = signalMagenta (traffic stop lamp); tron-cyan reserved for the biker.
 */

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** Radial glow canvas (bright center → transparent edge) for pool / puddle decals. */
function radialGlowTex(color: number, softness = 1): THREE.CanvasTexture {
  const s = 128;
  return makeCanvasTexture(s, s, (ctx) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, hex(color));
    g.addColorStop(0.4 * softness, hex(color) + 'aa');
    g.addColorStop(1, hex(color) + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Vertical gradient for the light shaft: bright at the top (lamp) → faint at the base. */
function shaftTex(color: number): THREE.CanvasTexture {
  return makeCanvasTexture(8, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, hex(color) + 'ff');
    g.addColorStop(0.5, hex(color) + '55');
    g.addColorStop(1, hex(color) + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 64);
  });
}

/** Ground decal quad (additive, faces up). */
function groundDecal(tex: THREE.CanvasTexture, size: number, y = 0.02, opacity = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

// ---------------------------------------------------------------------------------
// Street lamp
// ---------------------------------------------------------------------------------

/**
 * Sodium-amber street lamp: dark pole + curved arm + lamp head, an additive amber light
 * cone hanging under the head, and a warm pool decal on the sidewalk. The glow head mesh
 * and the cone/pool are exposed on userData.glow so a caller can flicker one lamp.
 * Task E: adds junction box at ~2m on pole + a dangling cable drop cylinder.
 */
export function buildStreetLamp(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'streetLamp';

  const body: GeometryPart[] = [];
  const glowP: GeometryPart[] = [];

  const poleH = rng.range(5.5, 6.5);
  const armLen = 1.6;
  // base + pole
  body.push(boxPart(new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0.5, 0.3, 0.5)));
  const pole = new THREE.CylinderGeometry(0.09, 0.13, poleH, 8);
  body.push({ geom: pole, matrix: new THREE.Matrix4().setPosition(0, poleH / 2, 0), mat: 0 });
  // curved arm (two segments) reaching out +X
  body.push(boxPart(new THREE.Vector3(0.4, poleH - 0.1, 0), new THREE.Vector3(1.0, 0.12, 0.12), 0));
  body.push(boxPart(new THREE.Vector3(armLen, poleH - 0.35, 0), new THREE.Vector3(0.12, 0.6, 0.12)));
  // lamp head (cobra housing) at arm tip
  const headX = armLen;
  const headY = poleH - 0.7;
  body.push(boxPart(new THREE.Vector3(headX, headY + 0.1, 0), new THREE.Vector3(0.7, 0.25, 0.4)));
  // glowing lens underside
  glowP.push(boxPart(new THREE.Vector3(headX, headY - 0.05, 0), new THREE.Vector3(0.5, 0.1, 0.3)));

  // Task E: junction box on the pole at ~2m height
  body.push(boxPart(new THREE.Vector3(0.1, 2.0, 0), new THREE.Vector3(0.22, 0.28, 0.18)));
  // cable drop: thin cylinder from junction box downward
  const cableGeom = new THREE.CylinderGeometry(0.018, 0.018, 1.4, 6);
  body.push({ geom: cableGeom, matrix: new THREE.Matrix4().setPosition(0.1, 1.3, 0.07), mat: 0 });

  const glowMesh = mergeOne(glowP, makeGlowMat(COLORS.sodiumAmber, 2.0), 'lampGlow');

  // Task E: small emissive indicator strip on top of lamp head
  const stripGlow: GeometryPart[] = [];
  stripGlow.push(boxPart(new THREE.Vector3(headX, headY + 0.24, 0), new THREE.Vector3(0.55, 0.06, 0.08)));
  const stripMesh = mergeOne(stripGlow, makeGlowMat(COLORS.holoTeal, 1.8), 'indicatorStrip');

  // additive light cone under the head
  const coneH = headY - 0.1;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.7, coneH, 16, 1, true),
    new THREE.MeshBasicMaterial({
      map: shaftTex(COLORS.sodiumAmber),
      color: COLORS.sodiumAmber,
      transparent: true,
      opacity: 0.10,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  cone.position.set(headX, coneH / 2, 0);
  cone.name = 'lightCone';

  // sidewalk pool decal
  const pool = groundDecal(radialGlowTex(COLORS.sodiumAmber), 3.8, 0.02, 0.7);
  pool.position.set(headX, 0.02, 0);
  pool.name = 'lampPool';

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(glowMesh);
  group.add(stripMesh);
  group.add(cone);
  group.add(pool);

  // expose for flicker: dim these together
  group.userData.glow = { head: glowMesh, cone, pool };
  return group;
}

// ---------------------------------------------------------------------------------
// Traffic light
// ---------------------------------------------------------------------------------

/** 3-lamp signal head facing both directions + a pedestrian walking-man box. */
export function buildTrafficLight(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trafficLight';

  const body: GeometryPart[] = [];
  const red: GeometryPart[] = [];
  const amber: GeometryPart[] = [];
  const green: GeometryPart[] = [];

  const poleH = 5.5;
  body.push(boxPart(new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0.5, 0.3, 0.5)));
  const pole = new THREE.CylinderGeometry(0.11, 0.15, poleH, 8);
  body.push({ geom: pole, matrix: new THREE.Matrix4().setPosition(0, poleH / 2, 0), mat: 0 });
  // mast arm over the road (+X)
  body.push(boxPart(new THREE.Vector3(1.6, poleH - 0.2, 0), new THREE.Vector3(3.2, 0.16, 0.16)));

  // signal head hanging at the arm end, lamps on +X and -X faces
  const headX = 3.0;
  const headTop = poleH - 0.5;
  body.push(boxPart(new THREE.Vector3(headX, headTop - 0.9, 0), new THREE.Vector3(0.5, 1.9, 0.55)));
  const lampR = 0.17;
  const lampGeom = new THREE.CylinderGeometry(lampR, lampR, 0.08, 12);
  for (const dir of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const y = headTop - 0.35 - i * 0.6;
      const m = new THREE.Matrix4()
        .makeRotationZ(Math.PI / 2)
        .setPosition(headX + dir * 0.3, y, 0);
      const part = { geom: lampGeom, matrix: m, mat: 0 };
      if (i === 0) red.push(part);
      else if (i === 1) amber.push(part);
      else green.push(part);
    }
  }

  // pedestrian signal box lower on the pole, walking-man glyph facing +X
  const pedY = 2.6;
  body.push(boxPart(new THREE.Vector3(0.25, pedY, 0), new THREE.Vector3(0.5, 0.7, 0.4)));
  const pedGlyph = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.5),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: makeWalkingManTex(rng),
      emissiveIntensity: 1.4,
      roughness: 0.9
    })
  );
  pedGlyph.position.set(0.51, pedY, 0);
  pedGlyph.name = 'pedGlyph';

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(mergeOne(red, makeGlowMat(COLORS.signalMagenta, 2.6), 'red'));
  group.add(mergeOne(amber, makeGlowMat(COLORS.sodiumAmber, 1.0), 'amber'));
  group.add(mergeOne(green, makeGlowMat(COLORS.holoTeal, 2.6), 'green'));
  group.add(pedGlyph);

  return group;
}

/** Walking-man pedestrian glyph on a dark ground (teal figure). */
function makeWalkingManTex(rng: Rng): THREE.CanvasTexture {
  void rng;
  return makeCanvasTexture(64, 96, (ctx) => {
    ctx.fillStyle = hex(COLORS.void);
    ctx.fillRect(0, 0, 64, 96);
    ctx.fillStyle = hex(COLORS.holoTeal);
    // simplified walking-man: head + torso + striding legs + swinging arms
    ctx.beginPath();
    ctx.arc(30, 20, 8, 0, Math.PI * 2); // head
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = hex(COLORS.holoTeal);
    ctx.lineCap = 'round';
    // torso
    ctx.beginPath();
    ctx.moveTo(30, 30);
    ctx.lineTo(32, 56);
    ctx.stroke();
    // legs (striding)
    ctx.beginPath();
    ctx.moveTo(32, 56);
    ctx.lineTo(20, 84);
    ctx.moveTo(32, 56);
    ctx.lineTo(46, 80);
    ctx.stroke();
    // arms
    ctx.beginPath();
    ctx.moveTo(31, 38);
    ctx.lineTo(18, 48);
    ctx.moveTo(31, 38);
    ctx.lineTo(44, 44);
    ctx.stroke();
  });
}

// ---------------------------------------------------------------------------------
// Steam vent
// ---------------------------------------------------------------------------------

/** Sidewalk grate with a steam anchor Object3D for the fx task to emit from. */
export function buildSteamVent(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'steamVent';

  const body: GeometryPart[] = [];
  const w = rng.range(1.4, 1.9);
  const d = rng.range(1.0, 1.4);
  // frame
  body.push(boxPart(new THREE.Vector3(0, 0.04, 0), new THREE.Vector3(w + 0.2, 0.08, d + 0.2)));
  // grate slats
  const nslat = Math.round(w / 0.16);
  for (let i = 0; i < nslat; i++) {
    const x = -w / 2 + 0.08 + i * (w / nslat);
    body.push(boxPart(new THREE.Vector3(x, 0.08, 0), new THREE.Vector3(0.06, 0.06, d)));
  }
  group.add(mergeOne(body, makeBodyMat(), 'grate'));

  // faint amber underlight so steam catches a warm rim (spec night mood)
  const under = groundDecal(radialGlowTex(COLORS.sodiumAmber, 1.3), Math.max(w, d) * 1.4, 0.05, 0.35);
  group.add(under);

  // steam anchor for the fx task — just above the grate center
  const steamAnchor = new THREE.Object3D();
  steamAnchor.position.set(0, 0.1, 0);
  steamAnchor.name = 'steamAnchor';
  group.add(steamAnchor);
  group.userData.steamAnchor = steamAnchor;

  return group;
}

// ---------------------------------------------------------------------------------
// Vending machine
// ---------------------------------------------------------------------------------

/** Face texture: product cans + brand name + coin slot for a cyberpunk vending machine. */
function makeVendingFaceTex(rng: Rng): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const brand = rng.chance(0.5) ? 'EDGE CREDIT' : 'HI-VOLT';
  const accent = rng.chance(0.5) ? hex(COLORS.signalMagenta) : hex(COLORS.holoTeal);
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = hex(COLORS.void);
    ctx.fillRect(0, 0, w, h);

    // brand name header
    ctx.fillStyle = accent;
    ctx.font = 'bold 18px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.fillText(brand, w / 2, 22);

    // 3–4 drink can rectangles side by side
    const nCans = rng.int(3, 4);
    const canW = 44;
    const canH = 56;
    const startX = (w - nCans * (canW + 8)) / 2;
    const canColors = [COLORS.signalMagenta, COLORS.holoTeal, COLORS.sodiumAmber, COLORS.moonlight];
    for (let i = 0; i < nCans; i++) {
      const cx = startX + i * (canW + 8);
      const cy = 30;
      ctx.fillStyle = hex(canColors[i % canColors.length]);
      ctx.fillRect(cx, cy, canW, canH);
      // darker inner label
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(cx + 4, cy + 14, canW - 8, canH - 22);
    }

    // coin slot
    ctx.fillStyle = hex(COLORS.shadowBlue);
    ctx.fillRect(w / 2 - 16, 92, 32, 6);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(w / 2 - 16, 92, 32, 6);

    // dispensing slot at the bottom
    ctx.fillStyle = hex(COLORS.shadowBlue);
    ctx.fillRect(w / 2 - 30, 106, 60, 14);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(w / 2 - 30, 106, 60, 14);

    // scanlines
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  });
}

/**
 * Glowing drink-vending machine (magenta or teal front panel + product window).
 * Task E: face texture canvas, emissive indicator strip on top, base plate feet.
 */
export function buildVendingMachine(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vendingMachine';

  const body: GeometryPart[] = [];
  const w = 1.1;
  const h = 2.0;
  const d = 0.8;

  // Task E: base plate / feet
  body.push(boxPart(new THREE.Vector3(0, 0.045, 0), new THREE.Vector3(w + 0.08, 0.09, d + 0.06)));
  body.push(boxPart(new THREE.Vector3(0, h / 2 + 0.09, 0), new THREE.Vector3(w, h, d)));
  // recessed product-collection slot
  body.push(boxPart(new THREE.Vector3(0, 0.59, d / 2 + 0.02), new THREE.Vector3(w * 0.6, 0.25, 0.06)));

  // big glowing ad panel on the front (upper 2/3) — kept from original
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.88, h * 0.6),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: makeAd('portrait', rng),
      emissiveIntensity: 1.5,
      roughness: 0.9
    })
  );
  panel.position.set(0, h * 0.62 + 0.09, d / 2 + 0.03);
  panel.name = 'vendPanel';
  group.add(panel);

  // Task E: small product face texture below the ad panel
  const faceTex = makeVendingFaceTex(rng);
  const facePanel = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.88, 0.55),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: faceTex,
      emissiveIntensity: 1.5,
      roughness: 0.9
    })
  );
  facePanel.position.set(0, 0.62, d / 2 + 0.03);
  facePanel.name = 'vendFace';
  group.add(facePanel);

  const accent = rng.chance(0.5) ? COLORS.signalMagenta : COLORS.holoTeal;
  const trim: GeometryPart[] = [];
  const strip: GeometryPart[] = [];
  // vertical glow trim on both front edges
  for (const sx of [1, -1]) {
    trim.push(boxPart(new THREE.Vector3(sx * (w / 2 - 0.04), h * 0.62 + 0.09, d / 2 + 0.02), new THREE.Vector3(0.06, h * 0.62, 0.04)));
  }
  // Task E: emissive indicator strip on top
  strip.push(boxPart(new THREE.Vector3(0, h + 0.13, 0), new THREE.Vector3(w * 0.85, 0.06, 0.06)));

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(mergeOne(trim, makeGlowMat(accent, 2.2), 'trim'));
  group.add(mergeOne(strip, makeGlowMat(accent, 2.5), 'strip'));

  return group;
}

// ---------------------------------------------------------------------------------
// Fire hydrant
// ---------------------------------------------------------------------------------

/** Fire hydrant with bonnet, side nozzles, and a puddle decal at its base. */
export function buildHydrant(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hydrant';

  const body: GeometryPart[] = [];
  const amber: GeometryPart[] = [];
  // barrel
  const barrel = new THREE.CylinderGeometry(0.16, 0.19, 0.7, 12);
  body.push({ geom: barrel, matrix: new THREE.Matrix4().setPosition(0, 0.35, 0), mat: 0 });
  // shoulder + bonnet dome
  body.push({ geom: new THREE.CylinderGeometry(0.2, 0.17, 0.14, 12), matrix: new THREE.Matrix4().setPosition(0, 0.72, 0), mat: 0 });
  const dome = new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  body.push({ geom: dome, matrix: new THREE.Matrix4().setPosition(0, 0.79, 0), mat: 0 });
  // top cap nut
  body.push(boxPart(new THREE.Vector3(0, 0.98, 0), new THREE.Vector3(0.1, 0.1, 0.1), rng.range(0, Math.PI)));
  // two side nozzles + one front
  body.push({ geom: new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), matrix: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.22, 0.5, 0), mat: 0 });
  body.push({ geom: new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), matrix: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(-0.22, 0.5, 0), mat: 0 });
  body.push({ geom: new THREE.CylinderGeometry(0.08, 0.08, 0.16, 8), matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.4, 0.2), mat: 0 });
  // reflective safety band (amber glow)
  amber.push({ geom: new THREE.CylinderGeometry(0.165, 0.165, 0.08, 12), matrix: new THREE.Matrix4().setPosition(0, 0.62, 0), mat: 0 });

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(mergeOne(amber, makeGlowMat(COLORS.sodiumAmber, 1.6), 'band'));

  // puddle decal (leaking) — faint teal sheen
  const puddle = groundDecal(radialGlowTex(COLORS.holoTeal, 1.2), 1.4, 0.015, 0.25);
  puddle.position.set(rng.range(-0.2, 0.2), 0.015, rng.range(0.1, 0.4));
  puddle.name = 'hydrantPuddle';
  group.add(puddle);

  return group;
}

// ---------------------------------------------------------------------------------
// Trash heap
// ---------------------------------------------------------------------------------

/**
 * Pile of bin + bags + boxes — dark clutter with a faint scavenged glow tucked in.
 * Task E: more geometric variety (crushed boxes, cans, paper planes, torn bag),
 * 2-3 slightly different colors, puddle decal underneath.
 */
export function buildTrashHeap(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trashHeap';

  const body: GeometryPart[] = [];
  const glow: GeometryPart[] = [];

  // dumpster / bin
  body.push(boxPart(new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(1.8, 1.2, 1.0)));
  body.push(boxPart(new THREE.Vector3(0, 1.22, 0), new THREE.Vector3(1.85, 0.12, 1.05))); // lid
  // overflowing bags: rounded-ish boxes at rng poses
  const nbag = rng.int(5, 8);
  for (let i = 0; i < nbag; i++) {
    const bx = rng.range(-1.4, 1.6);
    const bz = rng.range(-0.8, 0.9);
    const bs = rng.range(0.35, 0.6);
    body.push(
      boxPart(
        new THREE.Vector3(bx, bs / 2 + rng.range(0, 0.4), bz),
        new THREE.Vector3(bs, bs * rng.range(0.8, 1.1), bs * rng.range(0.9, 1.2)),
        rng.range(0, Math.PI)
      )
    );
  }
  // Task E: crushed boxes (very flat)
  for (let i = 0; i < rng.int(2, 4); i++) {
    body.push(
      boxPart(
        new THREE.Vector3(rng.range(-1.6, 1.8), rng.range(0.04, 0.18), rng.range(-1, 1)),
        new THREE.Vector3(rng.range(0.6, 1.1), rng.range(0.04, 0.12), rng.range(0.4, 0.8)),
        rng.range(0, Math.PI)
      )
    );
  }
  // Task E: can cylinders
  const canGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8);
  for (let i = 0; i < rng.int(3, 6); i++) {
    const m = new THREE.Matrix4()
      .makeRotationZ(rng.chance(0.5) ? Math.PI / 2 : 0)
      .setPosition(rng.range(-1.5, 1.7), rng.range(0.07, 0.5), rng.range(-0.9, 0.9));
    body.push({ geom: canGeom, matrix: m, mat: 0 });
  }
  // Task E: angled thin planes (cardboard / paper)
  for (let i = 0; i < rng.int(2, 3); i++) {
    body.push(
      boxPart(
        new THREE.Vector3(rng.range(-1.5, 1.7), rng.range(0.08, 0.35), rng.range(-0.8, 0.8)),
        new THREE.Vector3(rng.range(0.5, 0.9), 0.03, rng.range(0.3, 0.6)),
        rng.range(0, Math.PI)
      )
    );
  }
  // Task E: torn bag (irregular box, slightly taller)
  body.push(
    boxPart(
      new THREE.Vector3(rng.range(-0.8, 0.8), rng.range(0.2, 0.55), rng.range(-0.6, 0.6)),
      new THREE.Vector3(rng.range(0.35, 0.55), rng.range(0.4, 0.7), rng.range(0.35, 0.55)),
      rng.range(0, Math.PI)
    )
  );
  // one discarded glowing screen / neon offcut buried in the pile
  glow.push(boxPart(new THREE.Vector3(rng.range(-0.8, 0.8), rng.range(0.3, 0.7), rng.range(-0.4, 0.6)), new THREE.Vector3(0.3, 0.2, 0.05), rng.range(0, Math.PI)));

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(mergeOne(glow, makeGlowMat(rng.chance(0.5) ? COLORS.signalMagenta : COLORS.holoTeal, 1.8), 'glow'));

  // Task E: dark glossy puddle underneath
  const puddleTex = makeCanvasTexture(64, 64, (ctx) => {
    ctx.clearRect(0, 0, 64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(10,12,22,0.85)');
    g.addColorStop(0.7, 'rgba(10,12,22,0.45)');
    g.addColorStop(1, 'rgba(10,12,22,0)');
    ctx.fillStyle = g;
    ctx.ellipse(32, 32, 30, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const puddle = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 1.8),
    new THREE.MeshBasicMaterial({
      map: puddleTex,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      roughness: 0.1
    } as THREE.MeshBasicMaterialParameters)
  );
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = 0.01;
  puddle.name = 'trashPuddle';
  group.add(puddle);

  return group;
}

// ---------------------------------------------------------------------------------
// Dumpster (NEW — Task E)
// ---------------------------------------------------------------------------------

/** Graffiti hint texture: abstract shapes on one side. */
function makeGraffitiTex(rng: Rng): THREE.CanvasTexture {
  const w = 128;
  const h = 96;
  const colors = [hex(COLORS.signalMagenta), hex(COLORS.holoTeal), hex(COLORS.sodiumAmber)];
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = hex(COLORS.towerBody);
    ctx.fillRect(0, 0, w, h);
    // a few overlapping colored bezier-ish shapes
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(rng.range(0, w), rng.range(0, h));
      ctx.bezierCurveTo(
        rng.range(0, w), rng.range(0, h),
        rng.range(0, w), rng.range(0, h),
        rng.range(0, w), rng.range(0, h)
      );
      ctx.strokeStyle = colors[rng.int(0, 2)];
      ctx.lineWidth = rng.range(2, 6);
      ctx.stroke();
    }
    // block letters hint
    ctx.fillStyle = colors[rng.int(0, 2)];
    ctx.font = `bold ${rng.int(14, 22)}px "Share Tech Mono"`;
    ctx.textAlign = 'center';
    ctx.fillText('VOID', w / 2, h * 0.6);
  });
}

/**
 * Large street dumpster: body + angled lid + side handles + corner wheels.
 * Task E new prop.
 */
export function buildDumpster(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'dumpster';

  const body: GeometryPart[] = [];
  const bW = 2.0;
  const bH = 1.2;
  const bD = 1.5;

  // main body box (dark green/blue via makeBodyMat — near-black)
  body.push(boxPart(new THREE.Vector3(0, bH / 2, 0), new THREE.Vector3(bW, bH, bD)));
  // bottom rail / base thickening
  body.push(boxPart(new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(bW + 0.06, 0.12, bD + 0.06)));
  // side handles (small cylinder loops on ±Z faces)
  const handleGeom = new THREE.TorusGeometry(0.09, 0.025, 6, 8, Math.PI);
  const hmL = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(-bW * 0.3, bH * 0.72, bD / 2 + 0.03);
  const hmR = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(bW * 0.3, bH * 0.72, bD / 2 + 0.03);
  const hmLb = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(-bW * 0.3, bH * 0.72, -bD / 2 - 0.03);
  const hmRb = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(bW * 0.3, bH * 0.72, -bD / 2 - 0.03);
  body.push({ geom: handleGeom, matrix: hmL, mat: 0 });
  body.push({ geom: handleGeom, matrix: hmR, mat: 0 });
  body.push({ geom: handleGeom, matrix: hmLb, mat: 0 });
  body.push({ geom: handleGeom, matrix: hmRb, mat: 0 });
  // 4 wheels at bottom corners (small cylinders)
  const wheelGeom = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 8);
  for (const [wx, wz] of [[-bW * 0.38, -bD * 0.38], [bW * 0.38, -bD * 0.38], [-bW * 0.38, bD * 0.38], [bW * 0.38, bD * 0.38]]) {
    const wm = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(wx, 0.09, wz);
    body.push({ geom: wheelGeom, matrix: wm, mat: 0 });
  }

  // lid: slightly open plane (~15° angle) hinged at the back
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(bW - 0.05, 0.07, bD - 0.05),
    makeBodyMat()
  );
  lid.position.set(0, bH + 0.04, 0);
  // pivot at back edge: rotate around local back edge
  lid.rotation.x = THREE.MathUtils.degToRad(15);
  lid.position.z -= (bD / 2) * (1 - Math.cos(THREE.MathUtils.degToRad(15)));
  lid.position.y += (bD / 2) * Math.sin(THREE.MathUtils.degToRad(15)) * 0.5;
  lid.name = 'dumpsterLid';
  group.add(lid);

  group.add(mergeOne(body, makeBodyMat(), 'body'));

  // graffiti hint canvas texture on the +Z side face
  const grafTex = makeGraffitiTex(rng);
  const grafPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(bW * 0.8, bH * 0.65),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: grafTex,
      emissiveIntensity: 0.6,
      roughness: 0.95
    })
  );
  grafPanel.position.set(0, bH * 0.5, bD / 2 + 0.01);
  grafPanel.name = 'graffiti';
  group.add(grafPanel);

  return group;
}

// ---------------------------------------------------------------------------------
// Concrete barrier (NEW — Task E)
// ---------------------------------------------------------------------------------

/**
 * Jersey barrier: trapezoidal cross-section, 3.5m long, concrete gray.
 * Uses two stacked boxes to approximate the tapered profile.
 * Task E new prop.
 */
export function buildConcreteBarrier(rng: Rng): THREE.Group {
  void rng;
  const group = new THREE.Group();
  group.name = 'concreteBarrier';

  const body: GeometryPart[] = [];
  const strips: GeometryPart[] = [];

  const length = 3.5;
  const totalH = 0.8;
  const baseW = 0.6;
  const topW = 0.3;

  // lower trapezoidal section (wider): approx 55% of height
  const loH = totalH * 0.55;
  const loW = baseW;
  body.push(boxPart(new THREE.Vector3(0, loH / 2, 0), new THREE.Vector3(length, loH, loW)));
  // upper narrower section: approx 45% of height, sitting on top
  const hiH = totalH * 0.45;
  const hiW = topW;
  body.push(boxPart(new THREE.Vector3(0, loH + hiH / 2, 0), new THREE.Vector3(length, hiH, hiW)));
  // chamfer hint: thin angled-ish strips on the slant (simplified as slanted thin boxes)
  for (const sx of [1, -1]) {
    body.push(
      boxPart(
        new THREE.Vector3(0, loH, sx * (loW / 2 + hiW / 2) / 2 - sx * 0.01),
        new THREE.Vector3(length, 0.06, 0.2),
        0
      )
    );
  }

  // Task E: reflective amber strips near the top on both ±Z sides
  for (const sz of [1, -1]) {
    strips.push(
      boxPart(
        new THREE.Vector3(0, totalH - 0.08, sz * (topW / 2 + 0.01)),
        new THREE.Vector3(length * 0.85, 0.07, 0.03)
      )
    );
  }

  const concreteMat = new THREE.MeshStandardMaterial({
    color: COLORS.shadowBlue,
    roughness: 0.85,
    metalness: 0.05
  });
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1), // placeholder; we use mergeOne
    concreteMat
  );
  void bodyMesh;

  group.add(mergeOne(body, concreteMat, 'body'));
  group.add(mergeOne(strips, makeGlowMat(COLORS.sodiumAmber, 1.6), 'reflStrips'));

  return group;
}

// ---------------------------------------------------------------------------------
// Phone booth / kiosk (NEW — Task E)
// ---------------------------------------------------------------------------------

/** Interior screen canvas: transit info text. */
function makeKioskScreenTex(): THREE.CanvasTexture {
  return makeCanvasTexture(128, 192, (ctx) => {
    ctx.fillStyle = hex(COLORS.void);
    ctx.fillRect(0, 0, 128, 192);

    // header bar
    ctx.fillStyle = hex(COLORS.holoTeal);
    ctx.fillRect(0, 0, 128, 28);
    ctx.fillStyle = hex(COLORS.void);
    ctx.font = 'bold 11px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('NIGHT LOOP', 64, 18);

    // body text lines
    ctx.fillStyle = hex(COLORS.holoTeal);
    ctx.font = '10px "Share Tech Mono"';
    ctx.textAlign = 'left';
    const lines = ['TRANSIT //', 'CONNECTED', '────────', 'LINE 4: ON TIME', 'LINE 7: 2 MIN', '────────', 'SYS: ONLINE'];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 10, 52 + i * 18);
    }

    // blinking cursor hint
    ctx.fillStyle = hex(COLORS.sodiumAmber);
    ctx.fillRect(10, 184, 6, 2);

    // scanlines
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    for (let y = 0; y < 192; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
  });
}

/**
 * Cyberpunk phone-booth / transit kiosk: tall narrow box with a transparent front panel,
 * interior screen, and roof light strip.
 * Task E new prop.
 */
export function buildPhoneBooth(rng: Rng): THREE.Group {
  void rng;
  const group = new THREE.Group();
  group.name = 'phoneBooth';

  const body: GeometryPart[] = [];
  const roofGlow: GeometryPart[] = [];

  const kW = 0.8;
  const kD = 0.8;
  const kH = 2.2;

  // base platform (slightly wider)
  body.push(boxPart(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(kW + 0.12, 0.1, kD + 0.12)));
  // main body sides: back + left + right walls (not front — that's transparent)
  // back wall
  body.push(boxPart(new THREE.Vector3(0, kH / 2 + 0.1, -kD / 2 + 0.03), new THREE.Vector3(kW, kH, 0.06)));
  // left wall
  body.push(boxPart(new THREE.Vector3(-kW / 2 + 0.03, kH / 2 + 0.1, 0), new THREE.Vector3(0.06, kH, kD)));
  // right wall
  body.push(boxPart(new THREE.Vector3(kW / 2 - 0.03, kH / 2 + 0.1, 0), new THREE.Vector3(0.06, kH, kD)));
  // roof
  body.push(boxPart(new THREE.Vector3(0, kH + 0.13, 0), new THREE.Vector3(kW + 0.06, 0.1, kD + 0.06)));

  // transparent front panel
  const frontPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(kW - 0.08, kH - 0.06),
    new THREE.MeshStandardMaterial({
      color: COLORS.holoTeal,
      transparent: true,
      opacity: 0.15,
      roughness: 0.1,
      metalness: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  frontPanel.position.set(0, kH / 2 + 0.1, kD / 2 - 0.02);
  frontPanel.name = 'frontGlass';
  group.add(frontPanel);

  // interior screen (emissive, facing forward through the glass)
  const screenTex = makeKioskScreenTex();
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.48),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: screenTex,
      emissiveIntensity: 1.6,
      roughness: 0.9
    })
  );
  screen.position.set(0, kH * 0.55 + 0.1, kD / 2 - 0.09);
  screen.name = 'kioskScreen';
  group.add(screen);

  // roof light strip
  const roofAccent = rng.chance(0.5) ? COLORS.holoTeal : COLORS.sodiumAmber;
  roofGlow.push(boxPart(new THREE.Vector3(0, kH + 0.19, 0), new THREE.Vector3(kW * 0.7, 0.05, kD * 0.7)));

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(mergeOne(roofGlow, makeGlowMat(roofAccent, 2.2), 'roofLight'));

  return group;
}
