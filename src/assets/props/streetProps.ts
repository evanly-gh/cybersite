import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { type GeometryPart } from '../../utils/merge';
import { boxPart, mergeOne, makeBodyMat, makeGlowMat } from '../buildings/tall';
import { makeCanvasTexture } from '../../utils/canvasText';
import { makeAd } from '../../content/adGenerator';

/**
 * Task 18 (part 4/4): the street-furniture kit that dresses the sidewalk the bike rides.
 *  - buildStreetLamp: sodium-amber head + additive light cone + sidewalk pool decal.
 *    THE lamps — the amber pools that light the ground (spec §5.5). Exposes
 *    userData.glow for the propYard flicker pass.
 *  - buildTrafficLight: 3-lamp head both directions + pedestrian walking-man box.
 *  - buildSteamVent: sidewalk grate + userData.steamAnchor for the fx task.
 *  - buildVendingMachine / buildHydrant / buildTrashHeap: forecourt clutter.
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

  const glowMesh = mergeOne(glowP, makeGlowMat(COLORS.sodiumAmber, 3), 'lampGlow');

  // additive light cone under the head
  const coneH = headY - 0.1;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.7, coneH, 16, 1, true),
    new THREE.MeshBasicMaterial({
      map: shaftTex(COLORS.sodiumAmber),
      color: COLORS.sodiumAmber,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  cone.position.set(headX, coneH / 2, 0);
  cone.name = 'lightCone';

  // sidewalk pool decal
  const pool = groundDecal(radialGlowTex(COLORS.sodiumAmber), 3.8);
  pool.position.set(headX, 0.02, 0);
  pool.name = 'lampPool';

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(glowMesh);
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
      emissiveIntensity: 1.8,
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

/** Glowing drink-vending machine (magenta or teal front panel + product window). */
export function buildVendingMachine(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vendingMachine';

  const body: GeometryPart[] = [];
  const w = 1.1;
  const h = 2.0;
  const d = 0.8;
  body.push(boxPart(new THREE.Vector3(0, h / 2, 0), new THREE.Vector3(w, h, d)));
  // recessed product-collection slot
  body.push(boxPart(new THREE.Vector3(0, 0.5, d / 2 + 0.02), new THREE.Vector3(w * 0.6, 0.25, 0.06)));

  // big glowing ad panel on the front (upper 2/3)
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.88, h * 0.6),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: makeAd('portrait', rng),
      emissiveIntensity: 2.0,
      roughness: 0.9
    })
  );
  panel.position.set(0, h * 0.62, d / 2 + 0.03);
  panel.name = 'vendPanel';
  group.add(panel);

  const accent = rng.chance(0.5) ? COLORS.signalMagenta : COLORS.holoTeal;
  const trim: GeometryPart[] = [];
  // vertical glow trim on both front edges
  for (const sx of [1, -1]) {
    trim.push(boxPart(new THREE.Vector3(sx * (w / 2 - 0.04), h * 0.62, d / 2 + 0.02), new THREE.Vector3(0.06, h * 0.62, 0.04)));
  }
  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(mergeOne(trim, makeGlowMat(accent, 2.2), 'trim'));

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

/** Pile of bin + bags + boxes — dark clutter with a faint scavenged glow tucked in. */
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
  // scattered flat boxes / crates
  for (let i = 0; i < rng.int(2, 4); i++) {
    body.push(
      boxPart(
        new THREE.Vector3(rng.range(-1.6, 1.8), rng.range(0.1, 0.5), rng.range(-1, 1)),
        new THREE.Vector3(rng.range(0.4, 0.8), rng.range(0.3, 0.5), rng.range(0.4, 0.7)),
        rng.range(0, Math.PI)
      )
    );
  }
  // one discarded glowing screen / neon offcut buried in the pile
  glow.push(boxPart(new THREE.Vector3(rng.range(-0.8, 0.8), rng.range(0.3, 0.7), rng.range(-0.4, 0.6)), new THREE.Vector3(0.3, 0.2, 0.05), rng.range(0, Math.PI)));

  group.add(mergeOne(body, makeBodyMat(), 'body'));
  group.add(mergeOne(glow, makeGlowMat(rng.chance(0.5) ? COLORS.signalMagenta : COLORS.holoTeal, 1.8), 'glow'));

  return group;
}
