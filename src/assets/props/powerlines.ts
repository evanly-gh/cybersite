import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { type GeometryPart } from '../../utils/merge';
import { boxPart, mergeOne, makeBodyMat, makeGlowMat } from '../buildings/tall';

/**
 * Task 18 (part 3/4): utility poles + sagging catenary power runs — the tangled overhead
 * wire mess that crosses every back-street in the reference (Kowloon / Blade Runner
 * alley clutter).
 *
 * `buildPowerRun(rng, from, to, poles)` plants `poles` poles evenly between `from` and
 * `to` (XZ positions; pole bases sit on the ground at those points), each with crossarms,
 * ceramic insulator studs, a junction box and one rng silhouette detail
 * (shoe-pair over the wire / a row of roosting birds / a tangled cable clump). Between
 * consecutive poles it strings 3 catenary wires (TubeGeometry) per span that sag under
 * gravity, plus a service drop line off each pole.
 *
 * Draw calls: dark steel/wood body (poles + crossarms + junction) / insulator glow /
 * wires — 3 merged meshes.
 */

const WIRE_R = 0.04;
const CROSSARM_Y = [-0.4, -1.3]; // two crossarms below the pole top
const POLE_H = 9;

/** Sagging catenary between two anchor points: a mid control point dropped by `sag`. */
function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number): THREE.TubeGeometry {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  mid.y -= sag;
  const q1 = new THREE.Vector3().lerpVectors(a, mid, 0.5);
  q1.y -= sag * 0.35;
  const q2 = new THREE.Vector3().lerpVectors(mid, b, 0.5);
  q2.y -= sag * 0.35;
  const curve = new THREE.CatmullRomCurve3([a, q1, mid, q2, b]);
  return new THREE.TubeGeometry(curve, 24, WIRE_R, 5, false);
}

/** Adds one pole (body parts + insulator studs) at `base`, returns the wire anchor points. */
function addPole(
  rng: Rng,
  body: GeometryPart[],
  studs: GeometryPart[],
  base: THREE.Vector3,
  armAxis: THREE.Vector3
): THREE.Vector3[] {
  const topY = base.y + POLE_H;
  // pole
  const cyl = new THREE.CylinderGeometry(0.16, 0.22, POLE_H, 8);
  body.push({ geom: cyl, matrix: new THREE.Matrix4().setPosition(base.x, base.y + POLE_H / 2, base.z), mat: 0 });

  const anchors: THREE.Vector3[] = [];
  const perp = armAxis.clone(); // unit vector along which crossarms extend
  for (const cy of CROSSARM_Y) {
    const y = topY + cy;
    const armLen = 2.4;
    // crossarm box oriented along armAxis
    const rotY = Math.atan2(perp.x, perp.z);
    body.push(boxPart(new THREE.Vector3(base.x, y, base.z), new THREE.Vector3(0.14, 0.14, armLen), rotY));
    // 3 insulator studs per crossarm (center + both ends) — anchors for the 3 wires
    for (const off of [-armLen / 2 + 0.2, 0, armLen / 2 - 0.2]) {
      const p = new THREE.Vector3(base.x + perp.x * off, y + 0.16, base.z + perp.z * off);
      studs.push({
        geom: new THREE.CylinderGeometry(0.08, 0.1, 0.22, 6),
        matrix: new THREE.Matrix4().setPosition(p.x, p.y, p.z),
        mat: 0
      });
      anchors.push(p.clone());
    }
  }

  // junction box on the pole
  body.push(boxPart(new THREE.Vector3(base.x + 0.2, base.y + POLE_H * 0.55, base.z), new THREE.Vector3(0.4, 0.7, 0.3)));

  // one rng silhouette detail near the top
  const detail = rng.int(0, 2);
  const dy = topY - 0.7;
  if (detail === 0) {
    // shoe-pair slung over the wire: two small boxes + a connecting droop
    for (const s of [-0.12, 0.12]) {
      body.push(boxPart(new THREE.Vector3(base.x + perp.x * 0.8 + s * perp.z, dy - 0.5, base.z + perp.z * 0.8 - s * perp.x), new THREE.Vector3(0.28, 0.12, 0.1)));
    }
  } else if (detail === 1) {
    // row of roosting birds on the top crossarm
    const n = rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const off = -1.0 + i * (2.0 / (n - 1));
      body.push(boxPart(new THREE.Vector3(base.x + perp.x * off, topY + CROSSARM_Y[0] + 0.35, base.z + perp.z * off), new THREE.Vector3(0.1, 0.16, 0.1)));
    }
  } else {
    // tangled cable clump hanging off the junction box
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Vector3(base.x + 0.2, base.y + POLE_H * 0.55 + rng.range(-0.2, 0.2), base.z);
      const b = new THREE.Vector3(base.x + 0.2 + rng.range(-0.4, 0.4), base.y + POLE_H * 0.55 - rng.range(0.6, 1.2), base.z + rng.range(-0.4, 0.4));
      const curve = new THREE.CatmullRomCurve3([a, new THREE.Vector3().lerpVectors(a, b, 0.5).add(new THREE.Vector3(rng.range(-0.2, 0.2), -0.2, 0)), b]);
      body.push({ geom: new THREE.TubeGeometry(curve, 8, 0.03, 4, false), matrix: new THREE.Matrix4(), mat: 0 });
    }
  }

  return anchors;
}

export function buildPowerRun(
  rng: Rng,
  from: THREE.Vector3,
  to: THREE.Vector3,
  poles: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'powerRun';

  const body: GeometryPart[] = [];
  const studs: GeometryPart[] = [];
  const wires: GeometryPart[] = [];

  const n = Math.max(2, poles);
  // crossarms run perpendicular to the run direction (horizontal)
  const runDir = new THREE.Vector3().subVectors(to, from);
  runDir.y = 0;
  runDir.normalize();
  const armAxis = new THREE.Vector3(-runDir.z, 0, runDir.x); // horizontal perpendicular

  const anchorsPerPole: THREE.Vector3[][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = new THREE.Vector3().lerpVectors(from, to, t);
    // slight rng jitter on cross-street placement so the line isn't ruler-straight
    base.add(armAxis.clone().multiplyScalar(rng.range(-0.3, 0.3)));
    anchorsPerPole.push(addPole(rng, body, studs, base, armAxis));
  }

  // 3 wires per span (use the 3 studs of the TOP crossarm: indices 0,1,2)
  const spanLen = new THREE.Vector3().subVectors(to, from).length() / (n - 1);
  for (let i = 0; i < n - 1; i++) {
    const a = anchorsPerPole[i];
    const b = anchorsPerPole[i + 1];
    for (let w = 0; w < 3; w++) {
      const sag = spanLen * rng.range(0.06, 0.1);
      wires.push({ geom: catenary(a[w], b[w], sag), matrix: new THREE.Matrix4(), mat: 0 });
    }
    // one lower-crossarm wire too (index 3 = first stud of bottom arm) for density
    wires.push({ geom: catenary(a[3], b[3], spanLen * 0.11), matrix: new THREE.Matrix4(), mat: 0 });
  }

  // service drop lines: from each pole's junction area down toward a nearby "building"
  for (let i = 0; i < n; i++) {
    const a = anchorsPerPole[i][1]; // center top stud
    const drop = new THREE.Vector3(
      a.x + armAxis.x * rng.range(3, 5),
      from.y + 3.2,
      a.z + armAxis.z * rng.range(3, 5)
    );
    wires.push({ geom: catenary(a, drop, 1.2), matrix: new THREE.Matrix4(), mat: 0 });
  }

  group.add(mergeOne(body, makeBodyMat(), 'poles'));
  group.add(mergeOne(studs, makeGlowMat(COLORS.holoTeal, 0.8), 'insulators'));
  group.add(
    mergeOne(
      wires,
      new THREE.MeshStandardMaterial({ color: COLORS.void, roughness: 0.9, metalness: 0.1 }),
      'wires'
    )
  );

  return group;
}
