import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { makeCanvasTexture } from '../../utils/canvasText';

/**
 * Task 15 — hover cars: sleek teardrop hover coupe (A) + boxy sky-taxi (B).
 * Forward = +X, up = +Y, +Z = car's right. Origin at ground/flight-path center.
 *
 * No wheels. `update(t)` bobs the whole craft ±0.4 m at two incommensurate
 * frequencies seeded by `userData.bobSeed` (golden-ratio spaced so the motion
 * never repeats over any practical scroll length), adds a slight attitude sway,
 * and pulses the thruster-ring emissive intensity — all purely a function of
 * `t`, so the same `t` always yields the same pose (no per-frame randomness).
 *
 * Palette rule: tron-cyan is RESERVED for the biker. These glow teal/magenta/amber.
 */

export interface HoverAsset {
  group: THREE.Group;
  update: (t: number) => void;
}

interface Part {
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  mat: number;
}

function xform(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
}

function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const sorted = [...parts].sort((a, b) => a.mat - b.mat);
  const geoms: THREE.BufferGeometry[] = [];
  const runs: Array<{ mat: number; count: number }> = [];
  for (const p of sorted) {
    let g = p.geom.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(p.matrix);
    const n = g.getAttribute('position').count;
    geoms.push(g);
    const last = runs[runs.length - 1];
    if (last && last.mat === p.mat) last.count += n;
    else runs.push({ mat: p.mat, count: n });
  }
  const merged = mergeGeometries(geoms);
  if (!merged) throw new Error('hover: geometry merge failed');
  merged.clearGroups();
  let start = 0;
  for (const r of runs) {
    merged.addGroup(start, r.count, r.mat);
    start += r.count;
  }
  return merged;
}

const GOLDEN = 1.618033988749895;

/** Deterministic incommensurate bob offset (±amp), seeded so every craft bobs differently. */
function bobY(t: number, seed: number, amp = 0.4): number {
  const f1 = 0.35 + 0.25 * ((seed * 0.6180339887) % 1);
  const f2 = f1 * GOLDEN;
  return amp * (0.62 * Math.sin(t * f1 * Math.PI * 2 + seed) + 0.38 * Math.sin(t * f2 * Math.PI * 2 + seed * 1.7));
}

function attitudeSway(t: number, seed: number): { rx: number; rz: number } {
  const f = 0.22 + 0.1 * ((seed * 0.3819660113) % 1);
  return {
    rx: THREE.MathUtils.degToRad(2.2) * Math.sin(t * f * Math.PI * 2 + seed * 2.1),
    rz: THREE.MathUtils.degToRad(3.0) * Math.sin(t * f * GOLDEN * Math.PI * 2 + seed * 0.7)
  };
}

function thrusterPulse(t: number, seed: number, base: number, amp: number): number {
  return base + amp * (0.5 + 0.5 * Math.sin(t * (2.4 + 0.3 * (seed % 1)) * Math.PI * 2 + seed));
}

/** Torus ring + additive inner disc (glow core), merged: ring uses `ringMat`, disc `glowMat`. */
function thrusterRingParts(r: number, ringMat: number, glowMat: number): Part[] {
  return [
    { geom: new THREE.TorusGeometry(r, r * 0.16, 10, 24), matrix: xform(0, 0, 0), mat: ringMat },
    { geom: new THREE.CircleGeometry(r * 0.82, 20), matrix: xform(0, 0, 0), mat: glowMat }
  ];
}

// ---------------------------------------------------------------------------
// Hover A — sleek teardrop cab, 4 corner thrusters
// ---------------------------------------------------------------------------

const HA = { hull: 0, tealGlow: 1, strobe: 2, glass: 3, softGlow: 4 } as const;

function buildHoverAStatic(rng: Rng): Part[] {
  const parts: Part[] = [];

  // teardrop cab: stretched capsule tapering to a point at the tail
  parts.push({ geom: new THREE.CapsuleGeometry(0.55, 1.6, 8, 14), matrix: xform(0, 0, 0, 0, 0, Math.PI / 2), mat: HA.hull });
  parts.push({ geom: new THREE.ConeGeometry(0.4, 0.9, 12), matrix: xform(-1.55, 0, 0, 0, 0, -Math.PI / 2), mat: HA.hull });
  // canopy glass dome
  parts.push({ geom: new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.1), matrix: xform(0.35, 0.35, 0), mat: HA.glass });

  // belly glow (teal, thin soft strip — dim, doesn't compete with the thrusters)
  parts.push({ geom: new THREE.BoxGeometry(2.2, 0.02, 0.3), matrix: xform(0, -0.5, 0), mat: HA.softGlow });

  // landing skids
  for (const z of [1, -1]) {
    parts.push({ geom: new THREE.BoxGeometry(1.6, 0.05, 0.06), matrix: xform(0, -0.68, z * 0.5), mat: HA.hull });
    for (const x of [-0.6, 0.6]) {
      parts.push({ geom: new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), matrix: xform(x, -0.58, z * 0.5), mat: HA.hull });
    }
  }

  // 4 corner thruster rings (torus + additive inner disc) at the wingtip pods
  const corners: Array<[number, number]> = [
    [0.9, 0.75],
    [0.9, -0.75],
    [-0.95, 0.65],
    [-0.95, -0.65]
  ];
  for (const [x, z] of corners) {
    for (const part of thrusterRingParts(0.26, HA.hull, HA.tealGlow)) {
      part.matrix.premultiply(xform(x, -0.1, z, Math.PI / 2, 0, 0));
      parts.push(part);
    }
    // heat-haze quad behind the thruster (small, dim, additive-feeling wash — iteration detail)
    parts.push({ geom: new THREE.CircleGeometry(0.15, 12), matrix: xform(x, -0.1, z + Math.sign(z) * 0.1, Math.PI / 2, 0, 0), mat: HA.softGlow });
  }

  // wingtip nav strobes (small emissive spheres, magenta/amber per rng — iteration detail)
  for (const [x, z] of corners) {
    parts.push({ geom: new THREE.SphereGeometry(0.045, 8, 6), matrix: xform(x, 0.15, z * 1.15), mat: HA.strobe });
  }

  // interior HUD glow (faint teal wash inside the canopy — iteration detail)
  parts.push({ geom: new THREE.CircleGeometry(0.09, 12), matrix: xform(0.3, 0.3, 0, 0, 0, 0), mat: HA.softGlow });

  // rng greeble: hull panel seams
  const nSeams = rng.int(2, 4);
  for (let i = 0; i < nSeams; i++) {
    parts.push({
      geom: new THREE.BoxGeometry(0.4, 0.008, 0.008),
      matrix: xform(rng.range(-1, 0.8), rng.range(-0.2, 0.3), rng.range(-0.5, 0.5)),
      mat: HA.hull
    });
  }

  return parts;
}

export function buildHoverA(rng: Rng): HoverAsset {
  const bobSeed = rng.range(0, 1000);
  // Moderate metalness/roughness — full mirror-metal reads as pure black with no env map.
  const hullColor = new THREE.Color(COLORS.towerBody).lerp(new THREE.Color(COLORS.shadowBlue), 0.55);
  const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, metalness: 0.1, roughness: 0.75 });
  const teal = new THREE.Color(COLORS.holoTeal);
  const tealGlowMat = new THREE.MeshStandardMaterial({ color: 0x021014, emissive: teal, emissiveIntensity: 0.9 });
  const strobeColor = rng.chance(0.5) ? new THREE.Color(COLORS.signalMagenta) : new THREE.Color(COLORS.sodiumAmber);
  const strobeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: strobeColor, emissiveIntensity: 0.9 });
  // roughness kept moderate — a mirror-smooth canopy dome creates a directional-light
  // specular hotspot that blows past the bloom threshold into a giant blown-out orb
  // at this asset's close viewing distance.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x081018, metalness: 0.05, roughness: 0.75, transparent: true, opacity: 0.75 });
  // Dim companion to tealGlowMat — belly glow / heat-haze / interior HUD, kept low so
  // the bright thruster rings stay the visual focus instead of one blown-out blob.
  const softGlowMat = new THREE.MeshStandardMaterial({ color: 0x020a0a, emissive: teal, emissiveIntensity: 0.35, transparent: true, opacity: 0.6 });

  const mats: THREE.Material[] = [];
  mats[HA.hull] = hullMat;
  mats[HA.tealGlow] = tealGlowMat;
  mats[HA.strobe] = strobeMat;
  mats[HA.glass] = glassMat;
  mats[HA.softGlow] = softGlowMat;

  const staticGeom = mergeParts(buildHoverAStatic(rng));
  const staticMesh = new THREE.Mesh(staticGeom, mats);
  staticMesh.name = 'hoverAStatic';

  const group = new THREE.Group();
  group.name = 'hoverA';
  group.add(staticMesh);
  group.userData.bobSeed = bobSeed;

  function update(t: number): void {
    group.position.y = bobY(t, bobSeed);
    const sway = attitudeSway(t, bobSeed);
    group.rotation.x = sway.rx;
    group.rotation.z = sway.rz;
    // Kept modest (well under the bloom threshold headroom) — this asset sits close
    // to the camera, so a hot pulse here blows the whole thruster cluster into one
    // washed-out orb instead of reading as four distinct glowing rings.
    tealGlowMat.emissiveIntensity = thrusterPulse(t, bobSeed, 0.55, 0.35);
    strobeMat.emissiveIntensity = thrusterPulse(t, bobSeed + 11, 0.5, 0.4);
  }
  update(0);

  return { group, update };
}

// ---------------------------------------------------------------------------
// Hover B — boxy sky-taxi, 2 rear ring turbines, front lift vanes, roof sign
// ---------------------------------------------------------------------------

const HB = { hull: 0, magenta: 1, turbine: 2, glass: 3, sign: 4, softGlow: 5 } as const;

/** "TAXI 空" holo sign texture — vcard-style ad on the roof. */
function makeTaxiSignTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(256, 96, (ctx) => {
    ctx.fillStyle = '#0a0410';
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = `#${new THREE.Color(COLORS.signalMagenta).getHexString()}`;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 248, 88);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px "Unbounded", sans-serif';
    ctx.fillText('TAXI', 128, 48);
    ctx.font = '28px sans-serif';
    ctx.fillStyle = `#${new THREE.Color(COLORS.holoTeal).getHexString()}`;
    ctx.fillText('空', 128, 82);
  });
}

function buildHoverBStatic(rng: Rng): Part[] {
  const parts: Part[] = [];

  // boxy cab
  parts.push({ geom: new THREE.BoxGeometry(2.6, 0.7, 1.3), matrix: xform(0, 0, 0), mat: HB.hull });
  parts.push({ geom: new THREE.BoxGeometry(1.2, 0.4, 1.15), matrix: xform(0.2, 0.5, 0), mat: HB.hull });
  // windshield + side glass band
  parts.push({ geom: new THREE.BoxGeometry(1.0, 0.36, 1.2), matrix: xform(0.25, 0.5, 0), mat: HB.glass });
  parts.push({ geom: new THREE.BoxGeometry(2.4, 0.24, 1.32), matrix: xform(-0.05, 0.05, 0), mat: HB.glass });

  // magenta trim glow (bumper strips, front + rear)
  parts.push({ geom: new THREE.BoxGeometry(0.05, 0.08, 1.28), matrix: xform(1.32, -0.1, 0), mat: HB.magenta });
  parts.push({ geom: new THREE.BoxGeometry(0.05, 0.08, 1.28), matrix: xform(-1.32, -0.1, 0), mat: HB.magenta });
  parts.push({ geom: new THREE.BoxGeometry(2.5, 0.02, 0.03), matrix: xform(0, -0.36, 0.66), mat: HB.magenta });
  parts.push({ geom: new THREE.BoxGeometry(2.5, 0.02, 0.03), matrix: xform(0, -0.36, -0.66), mat: HB.magenta });

  // front lift vanes (angled slats ahead of the cab)
  for (let i = 0; i < 4; i++) {
    parts.push({
      geom: new THREE.BoxGeometry(0.03, 0.3, 0.9),
      matrix: xform(1.15 + i * 0.05, -0.05, 0, 0, 0, THREE.MathUtils.degToRad(20)),
      mat: HB.hull
    });
  }

  // 2 large rear ring turbines
  for (const z of [0.75, -0.75]) {
    for (const part of thrusterRingParts(0.42, HB.hull, HB.turbine)) {
      part.matrix.premultiply(xform(-1.4, 0, z, 0, Math.PI / 2, 0));
      parts.push(part);
    }
    // heat-haze quad behind each turbine — small and dim so it doesn't overpower the ring
    parts.push({ geom: new THREE.CircleGeometry(0.22, 12), matrix: xform(-1.75, 0, z, 0, Math.PI / 2, 0), mat: HB.softGlow });
  }

  // roof "TAXI 空" holo sign (vcard ad), double-sided
  parts.push({ geom: new THREE.PlaneGeometry(1.0, 0.36), matrix: xform(0, 0.78, 0, -Math.PI / 2, 0, 0), mat: HB.sign });

  // rng greeble: rivets/panel lines
  const nRivets = rng.int(3, 6);
  for (let i = 0; i < nRivets; i++) {
    parts.push({
      geom: new THREE.BoxGeometry(0.03, 0.03, 0.03),
      matrix: xform(rng.range(-1.1, 1.1), rng.range(-0.2, 0.3), rng.pick([0.66, -0.66])),
      mat: HB.hull
    });
  }

  return parts;
}

export function buildHoverB(rng: Rng): HoverAsset {
  const bobSeed = rng.range(0, 1000) + 500; // offset from hover-A's seed range
  const hullColor = new THREE.Color(COLORS.shadowBlue).lerp(new THREE.Color(COLORS.void), 0.15);
  const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, metalness: 0.1, roughness: 0.75 });
  const magenta = new THREE.Color(COLORS.signalMagenta);
  const magentaMat = new THREE.MeshStandardMaterial({ color: 0x0a0006, emissive: magenta, emissiveIntensity: 1.1 });
  const turbineColor = rng.chance(0.5) ? new THREE.Color(COLORS.holoTeal) : new THREE.Color(COLORS.sodiumAmber);
  const turbineMat = new THREE.MeshStandardMaterial({ color: 0x020a0a, emissive: turbineColor, emissiveIntensity: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x081018, metalness: 0.05, roughness: 0.75, transparent: true, opacity: 0.7 });
  const signTex = makeTaxiSignTexture();
  const signMat = new THREE.MeshStandardMaterial({ color: 0x0a0410, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 1.0, map: signTex, side: THREE.DoubleSide });
  // Dim companion to turbineMat — heat-haze only, kept low so the rings stay the focus.
  const softGlowMat = new THREE.MeshStandardMaterial({ color: 0x020a0a, emissive: turbineColor, emissiveIntensity: 0.3, transparent: true, opacity: 0.6 });

  const mats: THREE.Material[] = [];
  mats[HB.hull] = hullMat;
  mats[HB.magenta] = magentaMat;
  mats[HB.turbine] = turbineMat;
  mats[HB.glass] = glassMat;
  mats[HB.sign] = signMat;
  mats[HB.softGlow] = softGlowMat;

  const staticGeom = mergeParts(buildHoverBStatic(rng));
  const staticMesh = new THREE.Mesh(staticGeom, mats);
  staticMesh.name = 'hoverBStatic';

  const group = new THREE.Group();
  group.name = 'hoverB';
  group.add(staticMesh);
  group.userData.bobSeed = bobSeed;

  function update(t: number): void {
    group.position.y = bobY(t, bobSeed);
    const sway = attitudeSway(t, bobSeed);
    group.rotation.x = sway.rx;
    group.rotation.z = sway.rz;
    turbineMat.emissiveIntensity = thrusterPulse(t, bobSeed, 0.55, 0.35);
    signMat.emissiveIntensity = 0.85 + 0.15 * Math.sin(t * 3 + bobSeed);
  }
  update(0);

  return { group, update };
}
