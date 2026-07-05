import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { mergeParts, xform, type RigPart } from './rig';

/**
 * Task 17 — city dogs. Box body + head + 4 legs + a wagging tail, walked
 * beside an owner or sitting at their feet. Two size classes (small/large),
 * chosen at random per build. Single SkinnedMesh; fur is 1 material, and a
 * round-3 iteration detail — a 25%-chance glowing collar — adds a second
 * material group, so the budget stays at <= 2 draw calls.
 */

export type DogPose = 'walk' | 'sit';

export interface DogAsset {
  group: THREE.Group;
  updateAmbient(sec: number): void;
}

const B = { hips: 0, head: 1, tail: 2, legFL: 3, legFR: 4, legBL: 5, legBR: 6 } as const;

interface DogSize {
  bodyLen: number;
  bodyH: number;
  bodyW: number;
  legLen: number;
  shoulderY: number; // hips bone height off the ground, standing
}

const SMALL: DogSize = { bodyLen: 0.5, bodyH: 0.22, bodyW: 0.18, legLen: 0.24, shoulderY: 0.32 };
const LARGE: DogSize = { bodyLen: 0.72, bodyH: 0.3, bodyW: 0.24, legLen: 0.34, shoulderY: 0.46 };

// Round-1 iteration: mixing straight into towerBody/skyHorizon read as pure
// black on the night backdrop and the dog disappeared. Mix toward moonlight
// instead so fur stays muted but legible (tan / grey / dark-brindle range).
function mutedFur(): THREE.Color[] {
  const mix = (a: number, b: number, t: number): THREE.Color =>
    new THREE.Color(a).lerp(new THREE.Color(b), t);
  return [
    mix(COLORS.sodiumAmber, COLORS.void, 0.45), // tan/brown
    mix(COLORS.moonlight, COLORS.shadowBlue, 0.4), // warm grey
    mix(COLORS.shadowBlue, COLORS.moonlight, 0.3), // steel-grey
    mix(COLORS.nightHaze, COLORS.moonlight, 0.35) // dark brindle
  ];
}

function makeBones(size: DogSize): THREE.Bone[] {
  const bones: THREE.Bone[] = Array.from({ length: 7 }, () => new THREE.Bone());
  const halfLen = size.bodyLen / 2;
  const halfW = size.bodyW / 2 + 0.02;
  const layout: Array<[number, number, number, number]> = [
    [-1, 0, size.shoulderY, 0], // hips (bind = standing shoulder height, root of the rig)
    [B.hips, halfLen * 0.85, size.bodyH * 0.25, 0], // head
    [B.hips, -halfLen - 0.02, size.bodyH * 0.1, 0], // tail
    [B.hips, halfLen * 0.7, -size.shoulderY, halfW], // legFL
    [B.hips, halfLen * 0.7, -size.shoulderY, -halfW], // legFR
    [B.hips, -halfLen * 0.7, -size.shoulderY, halfW], // legBL
    [B.hips, -halfLen * 0.7, -size.shoulderY, -halfW] // legBR
  ];
  layout.forEach(([parent, x, y, z], i) => {
    bones[i].position.set(x, y, z);
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  return bones;
}

function buildParts(size: DogSize, collarOn: boolean): RigPart[] {
  const p: RigPart[] = [];
  const halfLen = size.bodyLen / 2;
  const halfW = size.bodyW / 2 + 0.02;

  // body
  p.push({
    geom: new THREE.BoxGeometry(size.bodyLen, size.bodyH, size.bodyW),
    matrix: xform(0, size.shoulderY, 0),
    mat: 0,
    bone: B.hips
  });
  // head + snout
  p.push({
    geom: new THREE.BoxGeometry(size.bodyH * 0.75, size.bodyH * 0.7, size.bodyW * 0.85),
    matrix: xform(halfLen * 0.85, size.shoulderY + size.bodyH * 0.25, 0),
    mat: 0,
    bone: B.head
  });
  // round-3 detail: a glowing collar at the base of the neck (25% chance).
  if (collarOn) {
    p.push({
      geom: new THREE.TorusGeometry(size.bodyH * 0.42, size.bodyH * 0.05, 6, 14),
      matrix: xform(halfLen * 0.55, size.shoulderY + size.bodyH * 0.22, 0, 0, Math.PI / 2, 0),
      mat: 1,
      bone: B.head
    });
  }
  p.push({
    geom: new THREE.BoxGeometry(size.bodyH * 0.5, size.bodyH * 0.35, size.bodyW * 0.55),
    matrix: xform(halfLen * 0.85 + size.bodyH * 0.5, size.shoulderY + size.bodyH * 0.12, 0),
    mat: 0,
    bone: B.head
  });
  // ears (small triangular-ish boxes)
  for (const s of [1, -1]) {
    p.push({
      geom: new THREE.BoxGeometry(0.03, size.bodyH * 0.3, size.bodyW * 0.22),
      matrix: xform(
        halfLen * 0.85 - size.bodyH * 0.15,
        size.shoulderY + size.bodyH * 0.55,
        s * size.bodyW * 0.35,
        0,
        0,
        s * 0.2
      ),
      mat: 0,
      bone: B.head
    });
  }
  // tail (capsule, wags in updateAmbient) — geometry is authored in ABSOLUTE
  // (from-hips) bind coordinates, same convention as every other part above;
  // the tail bone's own bind position is (-halfLen - 0.02, shoulderY + bodyH*0.1, 0).
  p.push({
    geom: new THREE.CapsuleGeometry(size.bodyH * 0.09, size.bodyLen * 0.32, 3, 6),
    matrix: xform(-halfLen - 0.02, size.shoulderY + size.bodyH * 0.1, 0, 0, 0, Math.PI / 2 - 0.3),
    mat: 0,
    bone: B.tail
  });

  // legs — each leg bone's bind position already carries its own X (front/back)
  // and Z (left/right) offset (see makeBones); the geometry matrix below must
  // therefore be authored in the SAME absolute (from-hips) coordinates as
  // everything else, not as a bone-local offset, or all four legs collapse to
  // the origin (round-1 bug: every leg rendered stacked under the body center).
  const legXZ: Array<[number, number, number]> = [
    [B.legFL, halfLen * 0.7, halfW],
    [B.legFR, halfLen * 0.7, -halfW],
    [B.legBL, -halfLen * 0.7, halfW],
    [B.legBR, -halfLen * 0.7, -halfW]
  ];
  for (const [leg, lx, lz] of legXZ) {
    p.push({
      geom: new THREE.BoxGeometry(size.bodyH * 0.32, size.legLen, size.bodyH * 0.32),
      matrix: xform(lx, -size.legLen / 2, lz),
      mat: 0,
      bone: leg
    });
    // paw
    p.push({
      geom: new THREE.BoxGeometry(size.bodyH * 0.36, size.bodyH * 0.16, size.bodyH * 0.4),
      matrix: xform(lx + 0.01, -size.legLen - 0.02, lz),
      mat: 0,
      bone: leg
    });
  }

  return p;
}

function axisZ(bone: THREE.Bone, angle: number): void {
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
}
function axisY(bone: THREE.Bone, angle: number): void {
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
}

const COLLAR_NEON = [COLORS.signalMagenta, COLORS.sodiumAmber, COLORS.holoTeal] as const;

export function buildDog(rng: Rng, pose: DogPose): DogAsset {
  const size = rng.chance(0.5) ? SMALL : LARGE;
  const furColor = rng.pick(mutedFur());
  const collarOn = rng.chance(0.25);
  const mat = new THREE.MeshStandardMaterial({
    color: furColor,
    roughness: 0.95,
    metalness: 0.0,
    emissive: furColor,
    emissiveIntensity: 0.12
  });
  const collarColor = new THREE.Color(rng.pick(COLLAR_NEON));
  const collarMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x02040a),
    emissive: collarColor,
    emissiveIntensity: collarOn ? 1.3 : 0
  });

  const bones = makeBones(size);
  const geom = mergeParts(buildParts(size, collarOn), true);
  geom.boundingBox = new THREE.Box3(
    new THREE.Vector3(-size.bodyLen, -0.05, -size.bodyW),
    new THREE.Vector3(size.bodyLen, size.shoulderY + size.bodyH + 0.15, size.bodyW)
  );
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, size.shoulderY * 0.6, 0), size.bodyLen + 0.3);

  const mesh = new THREE.SkinnedMesh(geom, [mat, collarMat]);
  mesh.frustumCulled = false;
  mesh.name = 'dogMesh';

  const group = new THREE.Group();
  group.name = `dog-${pose}`;
  group.add(bones[B.hips]);
  group.add(mesh);
  group.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const strideLeg = 0.4;
  const strideKnee = 0.3;

  if (pose === 'walk') {
    // diagonal trot: FL+BR forward, FR+BL back
    axisZ(bones[B.legFL], strideLeg);
    axisZ(bones[B.legBR], strideLeg);
    axisZ(bones[B.legFR], -strideLeg);
    axisZ(bones[B.legBL], -strideLeg);
  } else {
    // sit — haunches down, front legs straight, body pitched back slightly
    bones[B.hips].position.y = size.shoulderY - size.legLen * 0.45;
    axisZ(bones[B.hips], -0.18);
    axisZ(bones[B.legBL], 1.4);
    axisZ(bones[B.legBR], 1.4);
    axisZ(bones[B.legFL], -0.12);
    axisZ(bones[B.legFR], -0.12);
    axisZ(bones[B.head], 0.18);
  }

  group.updateMatrixWorld(true);

  const baseHipY = bones[B.hips].position.y;
  const baseHipRot = pose === 'sit' ? -0.18 : 0;

  function updateAmbient(sec: number): void {
    // tail wag, continuous in both poses
    axisY(bones[B.tail], Math.sin(sec * 6) * 0.5);

    if (pose === 'walk') {
      bones[B.hips].position.y = baseHipY + Math.sin(sec * 5) * 0.015;
      axisZ(bones[B.legFL], strideLeg * Math.cos(sec * 5));
      axisZ(bones[B.legBR], strideLeg * Math.cos(sec * 5));
      axisZ(bones[B.legFR], -strideLeg * Math.cos(sec * 5));
      axisZ(bones[B.legBL], -strideLeg * Math.cos(sec * 5));
      void strideKnee;
    } else {
      axisZ(bones[B.hips], baseHipRot + Math.sin(sec * 0.8) * 0.01);
    }
    group.updateMatrixWorld(true);
  }

  return { group, updateAmbient };
}
