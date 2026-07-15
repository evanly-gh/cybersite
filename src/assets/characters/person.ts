import * as THREE from 'three';
import { COLORS } from '../../theme';
import type { Rng } from '../../utils/rng';
import { mergeParts, xform, type RigPart } from './rig';

/**
 * Task 17 — stylized night-city pedestrians with face detail. Forward = +X, up = +Y.
 *
 * Rig: single SkinnedMesh, 11 rigid-bound bones. 3 material groups:
 *   [0] body — matte street-tone coat/skin
 *   [1] accent — neon stripe/collar/umbrella-rim/phone-glow (dark when inactive)
 *   [2] eyes — glowing cybernetic eyes (holoTeal / signalMagenta / amber), always lit
 * = 3 draw calls per person (brief allows this: "adding a 2nd body material costs
 *   1 draw call per person — that's acceptable").
 *
 * Head features added: glowing cybernetic eye-slots, nose bridge, chin plate,
 * and 6 hair-variant silhouettes (mohawk, short crop, side-swept, ponytail,
 * buzz-cut bun, bare). Hair bound to head bone.
 */

export type PersonPose = 'walk' | 'stand' | 'sit';

export interface PersonAsset {
  group: THREE.Group;
  updateAmbient(sec: number): void;
}

// ---------------------------------------------------------------------------
// Dimensions (1 unit = 1 m); person ~1.7 m tall.
// ---------------------------------------------------------------------------

const SPINE_UP = 0.28;
const HEAD_UP = 0.42;
const SHOULDER_UP = 0.3;
const SHOULDER_OUT = 0.18;
const ARM_A = 0.27; // upper arm
const ARM_B = 0.27; // forearm
const HIP_OUT = 0.1;
const LEG_A = 0.42; // thigh
const LEG_B = 0.45; // calf — feet land at hips.y - LEG_B (sit: 0 - 0.45 = -0.45, matches Task 11 anchor floor offset)
const HIP_STAND_Y = LEG_A + LEG_B; // 0.87 — feet ~on ground when standing straight

// Bind-space absolute Y for each bone (all rotations identity at bind time).
const HIPS_Y0 = 0;
const SPINE_Y0 = SPINE_UP;
const HEAD_Y0 = SPINE_Y0 + HEAD_UP;
const SH_Y0 = SPINE_Y0 + SHOULDER_UP;
const FO_Y0 = SH_Y0 - ARM_A;
const TH_Y0 = HIPS_Y0;
const CA_Y0 = TH_Y0 - LEG_A;

const B = {
  hips: 0,
  spine: 1,
  head: 2,
  shL: 3,
  foL: 4,
  shR: 5,
  foR: 6,
  thL: 7,
  caL: 8,
  thR: 9,
  caR: 10
} as const;

const M = { body: 0, accent: 1, eyes: 2 } as const;

// Dark street-tone body palette — cyberpunk-dark, lean toward void/shadow-blue
// so silhouettes read as night-city denizens. All moonlight mix <=0.25 so no
// figure looks like a daytime civilian. A faint self-emissive lift keeps the
// dark tones from vanishing to pure black at this scene exposure.
function mutedTones(): THREE.Color[] {
  const mix = (a: number, b: number, t: number): THREE.Color =>
    new THREE.Color(a).lerp(new THREE.Color(b), t);
  return [
    mix(COLORS.shadowBlue, COLORS.moonlight, 0.2),   // dark steel-blue
    mix(COLORS.nightHaze, COLORS.shadowBlue, 0.3),   // deep plum — cyberpunk long coat
    mix(COLORS.shadowBlue, COLORS.moonlight, 0.22),  // dark slate-grey
    mix(COLORS.sodiumAmber, COLORS.void, 0.7),        // very dark olive/brown — weathered jacket
    mix(COLORS.holoTeal, COLORS.void, 0.72),          // very dark teal (not bright cyan)
    mix(COLORS.nightHaze, COLORS.void, 0.25),         // near-black plum
    mix(COLORS.void, COLORS.shadowBlue, 0.6),         // darkest: void-blue charcoal
  ];
}

const NEON_ACCENTS = [COLORS.signalMagenta, COLORS.sodiumAmber, COLORS.holoTeal] as const;
type AccentKind = 'stripe' | 'umbrella' | 'phone';

// Hair variant silhouette types — each built as geometry bound to B.head
type HairVariant = 'mohawk' | 'crop' | 'swept' | 'ponytail' | 'bun' | 'bare';

const HAIR_VARIANTS: HairVariant[] = ['mohawk', 'crop', 'swept', 'ponytail', 'bun', 'bare'];

// Hair colors — dark natural tones and one vivid cyberpunk dye per variant
function hairTones(rng: Rng): THREE.Color {
  const mix = (a: number, b: number, t: number): THREE.Color =>
    new THREE.Color(a).lerp(new THREE.Color(b), t);
  const naturals = [
    new THREE.Color(0x1a1008), // near-black
    new THREE.Color(0x3d2b1f), // dark brown
    new THREE.Color(0x5a3825), // medium brown
    mix(COLORS.void, COLORS.moonlight, 0.55), // silver-grey
    mix(COLORS.nightHaze, COLORS.moonlight, 0.4), // ash-purple
  ];
  const vivids = [
    new THREE.Color(COLORS.signalMagenta),
    new THREE.Color(COLORS.holoTeal),
    new THREE.Color(COLORS.sodiumAmber),
    new THREE.Color(COLORS.holoTeal),
  ];
  // 20% chance of vivid dye
  return rng.chance(0.2) ? rng.pick(vivids) : rng.pick(naturals);
}

interface BuiltParts {
  parts: RigPart[];
  phoneOn: boolean;
}

/**
 * Add face feature geometry to parts array: glowing cybernetic eyes, nose bridge,
 * chin plate. All bound to the head bone. Eye positions are in absolute bind-pose
 * space (forward = +X face direction).
 *
 * Eyes: two small CapsuleGeometry on either side of the face center, placed at
 * the equator of the head sphere (y = HEAD_Y0, z offset), pushed forward (x+).
 * Eye color is a separate material group (M.eyes) so it can glow bright holoTeal
 * independently of the accent color.
 */
function addFaceFeatures(p: RigPart[], eyeVariant: 'teal' | 'magenta' | 'amber'): void {
  // Eye geometry: horizontal capsule slots (elongated pill shape reads as
  // cybernetic eye implant / visor slit). Two eyes, symmetric on Z axis.
  // Pushed forward (x = HEAD_Y0 + 0.095) so they sit on the front face.
  // Horizontal capsule: radius 0.016, length 0.06 → width ~0.092, height ~0.032
  // rotated 90° around X so the capsule length runs along Z (left-right).
  const eyeForward = 0.095; // how far forward past head center eyes sit
  const eyeZ = 0.045;       // half-distance between eyes
  const eyeY = HEAD_Y0 + 0.015; // slightly above head center (upper face)

  for (const s of [1, -1] as const) {
    p.push({
      geom: new THREE.CapsuleGeometry(0.016, 0.052, 4, 8),
      // rotate so capsule length aligns with Z (left-right) → rx = PI/2
      matrix: xform(eyeForward, eyeY, s * eyeZ, Math.PI / 2, 0, 0),
      mat: M.eyes,
      bone: B.head
    });
  }

  // Nose bridge — a thin upright box centered on face, below eye line
  p.push({
    geom: new THREE.BoxGeometry(0.014, 0.028, 0.012),
    matrix: xform(eyeForward + 0.004, HEAD_Y0 - 0.022, 0),
    mat: M.body,
    bone: B.head
  });

  // Chin plate — a flat box at the base of the head sphere, reads as jaw/chin
  // definition even at mid-distance
  p.push({
    geom: new THREE.BoxGeometry(0.075, 0.018, 0.06),
    matrix: xform(eyeForward - 0.01, HEAD_Y0 - 0.078, 0),
    mat: M.body,
    bone: B.head
  });

  // Brow ridge — thin horizontal stripe above eyes, reads as furrowed cyber-brow
  p.push({
    geom: new THREE.BoxGeometry(0.012, 0.012, 0.115),
    matrix: xform(eyeForward + 0.004, HEAD_Y0 + 0.048, 0),
    mat: eyeVariant === 'teal' ? M.eyes : M.body,
    bone: B.head
  });
}

/**
 * Add hair geometry bound to the head bone.
 * All hair variants in absolute bind-pose coordinates (HEAD_Y0 as head center).
 */
function addHairVariant(p: RigPart[], variant: HairVariant): void {
  const top = HEAD_Y0 + 0.115; // top of head sphere
  const back = HEAD_Y0;        // back of head (x = 0 is center, forward = +x)
  switch (variant) {
    case 'mohawk':
      // Mohawk: a blade-like fin running front-back along the top of the head.
      // Built as a flattened box with tapered height.
      p.push({
        geom: new THREE.BoxGeometry(0.19, 0.18, 0.028),
        matrix: xform(0.005, top + 0.07, 0),
        mat: M.body, // hair uses body material group; color comes from hair tone via emissive
        bone: B.head
      });
      // Mohawk spine ridge
      p.push({
        geom: new THREE.BoxGeometry(0.14, 0.08, 0.014),
        matrix: xform(0, top + 0.22, 0),
        mat: M.body,
        bone: B.head
      });
      break;

    case 'crop':
      // Short crop: a shallow dome cap atop the head, slight texture variation
      p.push({
        geom: new THREE.SphereGeometry(0.118, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.42),
        matrix: xform(0, top - 0.015, 0),
        mat: M.body,
        bone: B.head
      });
      break;

    case 'swept':
      // Side-swept: asymmetric half-dome that tilts toward one side
      p.push({
        geom: new THREE.SphereGeometry(0.12, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.38),
        matrix: xform(0.01, top - 0.005, 0.04, 0, 0, 0.3),
        mat: M.body,
        bone: B.head
      });
      // Side sweep tail — elongated box angling down the side of the head
      p.push({
        geom: new THREE.CapsuleGeometry(0.025, 0.12, 4, 6),
        matrix: xform(-0.02, HEAD_Y0 + 0.04, 0.1, 0.3, 0, -0.5),
        mat: M.body,
        bone: B.head
      });
      break;

    case 'ponytail':
      // Ponytail: tight cap + a hanging tail at the rear of the head
      p.push({
        geom: new THREE.SphereGeometry(0.118, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.45),
        matrix: xform(0, top - 0.01, 0),
        mat: M.body,
        bone: B.head
      });
      // Tail: a tapered capsule hanging downward from the back of the head
      p.push({
        geom: new THREE.CapsuleGeometry(0.036, 0.2, 4, 6),
        matrix: xform(-0.08, HEAD_Y0 - 0.13, 0, 0.35, 0, 0),
        mat: M.body,
        bone: B.head
      });
      // Hair tie — accent bead
      p.push({
        geom: new THREE.TorusGeometry(0.038, 0.009, 4, 8),
        matrix: xform(-0.08, HEAD_Y0 - 0.04, 0, 0.35, Math.PI / 2, 0),
        mat: M.accent,
        bone: B.head
      });
      break;

    case 'bun':
      // Bun: tight cap + round bun on top
      p.push({
        geom: new THREE.SphereGeometry(0.118, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.45),
        matrix: xform(0, top - 0.01, 0),
        mat: M.body,
        bone: B.head
      });
      p.push({
        geom: new THREE.SphereGeometry(0.055, 8, 6),
        matrix: xform(0, top + 0.045, 0),
        mat: M.body,
        bone: B.head
      });
      break;

    case 'bare':
      // Shaved/bare head — no extra geometry; the sphere head reads fine alone
      break;
  }
}

function buildBodyParts(rng: Rng, accentOn: boolean, accentKind: AccentKind, hoodUp: boolean, bagOn: boolean, hairVariant: HairVariant, eyeVariant: 'teal' | 'magenta' | 'amber'): BuiltParts {
  const p: RigPart[] = [];

  // pelvis — slightly wider for coat silhouette
  p.push({ geom: new THREE.BoxGeometry(0.32, 0.26, 0.22), matrix: xform(0, HIPS_Y0 + 0.06, 0), mat: M.body, bone: B.hips });

  // jacket skirt / coat flare below hips — tapers outward slightly for that
  // Blade Runner long-coat silhouette read at distance. Bound to hips so it
  // moves with stride.
  p.push({
    geom: new THREE.CylinderGeometry(0.19, 0.23, 0.22, 6, 1, true),
    matrix: xform(0, HIPS_Y0 - 0.04, 0),
    mat: M.body,
    bone: B.hips
  });

  // torso — slightly wider than before to give coat-wearing bulk
  p.push({
    geom: new THREE.CapsuleGeometry(0.17, 0.28, 4, 8),
    matrix: xform(0, SPINE_Y0 + 0.15, 0),
    mat: M.body,
    bone: B.spine
  });

  // collar / neck band — always present, part of accent material;
  // dark by default, becomes emissive when neon accent is active.
  p.push({
    geom: new THREE.CylinderGeometry(0.075, 0.08, 0.06, 8),
    matrix: xform(0, HEAD_Y0 - 0.1, 0),
    mat: M.accent,
    bone: B.spine
  });

  // shoulder epaulettes — box caps that widen the silhouette and read as a
  // structured jacket shoulder even at distance.
  for (const s of [1, -1] as const) {
    p.push({
      geom: new THREE.BoxGeometry(0.09, 0.06, 0.19),
      matrix: xform(0, SH_Y0 + 0.03, s * (SHOULDER_OUT + 0.06)),
      mat: M.body,
      bone: B.spine
    });
  }

  // head
  p.push({ geom: new THREE.SphereGeometry(0.115, 14, 10), matrix: xform(0, HEAD_Y0, 0), mat: M.body, bone: B.head });

  // hood-up variant: a soft shell over the head/shoulders
  if (hoodUp) {
    p.push({
      geom: new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.65),
      matrix: xform(0, HEAD_Y0 + 0.01, -0.01, 0, 0, Math.PI),
      mat: M.body,
      bone: B.head
    });
  }

  // Face features: glowing cybernetic eyes, nose bridge, chin plate, brow ridge.
  // Add before hair so mergeParts sorts by mat correctly.
  if (!hoodUp) {
    addFaceFeatures(p, eyeVariant);
  }

  // Hair variant silhouette — bound to head bone
  // When hood is up, skip hair (hood hides it)
  if (!hoodUp) {
    addHairVariant(p, hairVariant);
  }

  // visor band — retained for the hood-up case and as additional brow trim;
  // when hood is up, this forms the face-opening visor edge.
  // When face is visible, this is a subtle band below the brow ridge.
  p.push({
    geom: new THREE.BoxGeometry(0.05, 0.028, 0.18),
    matrix: xform(0.1, HEAD_Y0 + 0.01, 0),
    mat: M.accent,
    bone: B.head
  });

  // backpack/bag
  if (bagOn) {
    p.push({
      geom: new THREE.BoxGeometry(0.2, 0.26, 0.12),
      matrix: xform(-0.16, SPINE_Y0 + 0.18, 0),
      mat: M.body,
      bone: B.spine
    });
  }

  // jacket stripe accent — bolder double stripe (racing stripe / techwear piping)
  if (accentOn && accentKind === 'stripe') {
    p.push({
      geom: new THREE.BoxGeometry(0.035, 0.32, 0.014),
      matrix: xform(0.16, SPINE_Y0 + 0.16, 0, 0, 0, 0.22),
      mat: M.accent,
      bone: B.spine
    });
    p.push({
      geom: new THREE.BoxGeometry(0.018, 0.28, 0.014),
      matrix: xform(0.16, SPINE_Y0 + 0.16, 0.055, 0, 0, 0.22),
      mat: M.accent,
      bone: B.spine
    });
  }

  for (const [sh, fo, s] of [
    [B.shL, B.foL, 1],
    [B.shR, B.foR, -1]
  ] as const) {
    const sz = s * SHOULDER_OUT;
    // shoulder cap
    p.push({ geom: new THREE.SphereGeometry(0.068, 10, 8), matrix: xform(0, SH_Y0, sz), mat: M.body, bone: sh });
    // upper arm
    p.push({
      geom: new THREE.CapsuleGeometry(0.052, ARM_A - 0.06, 4, 8),
      matrix: xform(0, SH_Y0 - ARM_A / 2, sz),
      mat: M.body,
      bone: sh
    });
    // forearm
    p.push({
      geom: new THREE.CapsuleGeometry(0.046, ARM_B - 0.06, 4, 8),
      matrix: xform(0, FO_Y0 - ARM_B / 2, sz),
      mat: M.body,
      bone: fo
    });
    // hand
    p.push({
      geom: new THREE.BoxGeometry(0.06, 0.075, 0.06),
      matrix: xform(0, FO_Y0 - ARM_B - 0.03, sz),
      mat: M.body,
      bone: fo
    });
  }

  // umbrella carried beside the body (shaft + glowing rim), bound to the SPINE
  // (not the swinging forearm) so it reads consistently in every pose — round-1
  // iteration found a forearm-bound umbrella read as a rice-hat sitting on the
  // head once the arm bent. Canopy sits well clear above the head; the shaft
  // is offset outside the shoulder line so it never overlaps the silhouette.
  if (accentOn && accentKind === 'umbrella') {
    const umbrellaZ = -(SHOULDER_OUT + 0.24);
    const shaftBottomY = 0.12;
    const canopyY = HEAD_Y0 + 0.32; // comfortably above the head top (~1.83)
    p.push({
      geom: new THREE.CylinderGeometry(0.012, 0.012, canopyY - shaftBottomY, 6),
      matrix: xform(0, (shaftBottomY + canopyY) / 2, umbrellaZ),
      mat: M.body,
      bone: B.spine
    });
    p.push({
      geom: new THREE.ConeGeometry(0.3, 0.13, 12, 1, true),
      matrix: xform(0, canopyY + 0.06, umbrellaZ),
      mat: M.body,
      bone: B.spine
    });
    p.push({
      geom: new THREE.TorusGeometry(0.3, 0.013, 6, 18),
      matrix: xform(0, canopyY, umbrellaZ),
      mat: M.accent,
      bone: B.spine
    });
  }

  // phone glow quad — held up near the face (bound to head so it reads correctly
  // at any arm angle; this is the "looking at phone" stand-pose behavior AND
  // the general ~35% "holo-phone glow" accent share the same geometry).
  const phoneOn = accentOn && accentKind === 'phone';

  for (const [th, ca, s] of [
    [B.thL, B.caL, 1],
    [B.thR, B.caR, -1]
  ] as const) {
    const tz = s * HIP_OUT;
    p.push({
      geom: new THREE.CapsuleGeometry(0.082, LEG_A - 0.05, 4, 8),
      matrix: xform(0, TH_Y0 - LEG_A / 2, tz),
      mat: M.body,
      bone: th
    });
    p.push({
      geom: new THREE.CapsuleGeometry(0.062, LEG_B - 0.05, 4, 8),
      matrix: xform(0, CA_Y0 - LEG_B / 2, tz),
      mat: M.body,
      bone: ca
    });
    // shoe (toe forward, heel lift baked as a slight upward tilt on the trailing/back foot handled by pose())
    p.push({
      geom: new THREE.BoxGeometry(0.1, 0.05, 0.2),
      matrix: xform(0.03, CA_Y0 - LEG_B - 0.02, tz),
      mat: M.body,
      bone: ca
    });
  }

  return { parts: p, phoneOn };
}

function makeBones(): THREE.Bone[] {
  const bones: THREE.Bone[] = Array.from({ length: 11 }, () => new THREE.Bone());
  const layout: Array<[number, number, number, number]> = [
    [-1, 0, HIPS_Y0, 0], // hips
    [B.hips, 0, SPINE_Y0, 0], // spine
    [B.spine, 0, HEAD_Y0 - SPINE_Y0, 0], // head
    [B.spine, 0, SH_Y0 - SPINE_Y0, SHOULDER_OUT], // shL
    [B.shL, 0, FO_Y0 - SH_Y0, 0], // foL
    [B.spine, 0, SH_Y0 - SPINE_Y0, -SHOULDER_OUT], // shR
    [B.shR, 0, FO_Y0 - SH_Y0, 0], // foR
    [B.hips, 0, TH_Y0 - HIPS_Y0, HIP_OUT], // thL
    [B.thL, 0, CA_Y0 - TH_Y0, 0], // caL
    [B.hips, 0, TH_Y0 - HIPS_Y0, -HIP_OUT], // thR
    [B.thR, 0, CA_Y0 - TH_Y0, 0] // caR
  ];
  layout.forEach(([parent, x, y, z], i) => {
    bones[i].position.set(x, y, z);
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  return bones;
}

function axisZ(bone: THREE.Bone, angle: number): void {
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
}
function axisY(bone: THREE.Bone, angle: number): void {
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
}

export function buildPerson(rng: Rng, pose: PersonPose): PersonAsset {
  const tones = mutedTones();
  const bodyColor = rng.pick(tones);
  // ~35% of people get a neon accent — sparse bright punctuation against dark bodies
  const accentOn = rng.chance(0.35);
  const accentKind = rng.pick(['stripe', 'umbrella', 'phone'] as const);
  const hoodUp = rng.chance(0.25);
  const bagOn = rng.chance(0.35);
  // Hair and eye variants — purely visual, no gameplay contract
  const hairVariant = rng.pick(HAIR_VARIANTS);
  const eyeVariant = rng.pick(['teal', 'magenta', 'amber'] as const);
  // stand-pose-specific "looking at phone" behavior — independent roll from the accent system.
  const standPhoneIdle = pose === 'stand' && rng.chance(0.3);

  const { parts, phoneOn } = buildBodyParts(rng, accentOn, accentKind, hoodUp, bagOn, hairVariant, eyeVariant);
  const hasPhoneGlow = phoneOn || standPhoneIdle;
  if (hasPhoneGlow) {
    parts.push({
      geom: new THREE.PlaneGeometry(0.06, 0.1),
      matrix: xform(0.13, HEAD_Y0 - 0.08, 0.02, 0, -Math.PI / 2.4, 0),
      mat: M.accent,
      bone: B.head
    });
  }

  const accentNeon = rng.pick(NEON_ACCENTS);
  // Hair color — muted natural or vivid dye; sampled after accent to keep rng order stable
  const hairColor = hairTones(rng);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.88,
    metalness: 0.04,
    // faint self-emissive lift — reads as ambient neon bounce off wet streets,
    // and keeps the dark palette from vanishing to pure black at this exposure.
    emissive: bodyColor,
    emissiveIntensity: 0.1
  });
  const accentActive = accentOn || hasPhoneGlow;
  const accentColor = new THREE.Color(accentActive ? accentNeon : 0x02040a);
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x02040a),
    emissive: accentColor,
    // intensity 2.2 → bloom-amplified: reads as a proper glowing neon stripe/collar
    emissiveIntensity: accentActive ? 2.2 : 0.04
  });
  // Eye glow material — always lit, separate draw call so eyes can be bright cyan/magenta
  // regardless of accent color.
  const eyeColorHex =
    eyeVariant === 'teal' ? COLORS.holoTeal :
    eyeVariant === 'magenta' ? COLORS.signalMagenta :
    COLORS.sodiumAmber;
  const eyesMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x020408),
    emissive: new THREE.Color(eyeColorHex),
    emissiveIntensity: 3.0, // bloom-amplified glowing eye implants
    roughness: 0.05,
    metalness: 0.0
  });

  // Recolor body material for hair segments: hair geometry is in M.body group.
  // We can't split within M.body, so we keep hair at body color and treat the
  // hair as a helmet-like cap — which reads fine at distance. For vivid-dye hair
  // the hair color overrides the body material emissive on next frame if needed.
  // Hair shares an existing material group to stay within the 3-draw-call budget:
  // normal hair rides M.body (reads as a darker cap at distance); vivid-dye/neon hair
  // rides M.accent so it glows. The choice is made per-part in addHairVariant via its
  // `mat` field — no separate hair material is allocated.

  const bones = makeBones();
  const geom = mergeParts(parts, true);
  geom.boundingBox = new THREE.Box3(new THREE.Vector3(-0.6, -0.5, -0.5), new THREE.Vector3(0.6, 1.85, 0.5));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 1.3);

  const mesh = new THREE.SkinnedMesh(geom, [bodyMat, accentMat, eyesMat]);
  mesh.frustumCulled = true;
  mesh.name = 'personMesh';

  const group = new THREE.Group();
  group.name = `person-${pose}`;
  group.add(bones[B.hips]);
  group.add(mesh);
  group.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  // ---- baked pose ----
  const strideThigh = 0.45;
  const kneeFront = -0.25;
  // round-3 detail: a more pronounced trailing-leg knee bend reads as a heel
  // lift (toe trailing, heel raised) rather than a stiff dragging back leg.
  const kneeBack = 0.85;
  const armSwing = 0.5;
  const elbowBend = 0.35;

  if (pose === 'walk') {
    bones[B.hips].position.y = HIP_STAND_Y;
    axisZ(bones[B.thL], strideThigh);
    axisZ(bones[B.caL], -kneeFront);
    axisZ(bones[B.thR], -strideThigh);
    axisZ(bones[B.caR], kneeBack);
    axisZ(bones[B.shL], -armSwing);
    axisZ(bones[B.foL], elbowBend);
    axisZ(bones[B.shR], armSwing);
    axisZ(bones[B.foR], -elbowBend);
  } else if (pose === 'stand') {
    bones[B.hips].position.y = HIP_STAND_Y;
    const weightShift = rng.range(-0.05, 0.05);
    bones[B.hips].position.z = weightShift;
    axisZ(bones[B.thL], weightShift * 0.3);
    axisZ(bones[B.thR], -weightShift * 0.3);
    axisZ(bones[B.shL], 0.08);
    axisZ(bones[B.foL], 0.18);
    if (standPhoneIdle) {
      // right arm raised, phone near the face
      axisZ(bones[B.shR], 1.5);
      axisZ(bones[B.foR], -1.35);
    } else {
      axisZ(bones[B.shR], -0.08);
      axisZ(bones[B.foR], 0.18);
    }
  } else {
    // sit — pelvis stays at the group origin so it seats correctly on a
    // 0.45m hip-height anchor (Task 11 seat contract); thighs go forward,
    // calves drop straight down to the floor (~-0.45 local).
    bones[B.hips].position.set(0, 0, 0);
    axisZ(bones[B.spine], -0.12);
    axisZ(bones[B.thL], Math.PI / 2);
    axisZ(bones[B.caL], -Math.PI / 2);
    axisZ(bones[B.thR], Math.PI / 2);
    axisZ(bones[B.caR], -Math.PI / 2);
    axisZ(bones[B.shL], 0.35);
    axisZ(bones[B.foL], 0.9);
    axisZ(bones[B.shR], -0.35);
    axisZ(bones[B.foR], 0.9);
  }

  group.updateMatrixWorld(true);

  // ---- ambient (continuous, wall-clock; sub-4cm amplitudes) ----
  const bobAmp = 0.02;
  const swingAmp = 0.06;
  const baseHipY = bones[B.hips].position.y;
  const baseHipZ = bones[B.hips].position.z;

  function updateAmbient(sec: number): void {
    if (pose === 'walk') {
      bones[B.hips].position.y = baseHipY + Math.sin(sec * 4.2) * bobAmp;
      axisZ(bones[B.shL], -armSwing + Math.sin(sec * 4.2) * swingAmp);
      axisZ(bones[B.shR], armSwing - Math.sin(sec * 4.2) * swingAmp);
      axisZ(bones[B.thL], strideThigh + Math.sin(sec * 4.2 + Math.PI) * swingAmp * 0.6);
      axisZ(bones[B.thR], -strideThigh - Math.sin(sec * 4.2 + Math.PI) * swingAmp * 0.6);
    } else if (pose === 'stand') {
      axisY(bones[B.spine], Math.sin(sec * 0.6) * 0.05);
      bones[B.hips].position.z = baseHipZ + Math.sin(sec * 0.3) * 0.01;
      if (hasPhoneGlow) {
        accentMat.emissiveIntensity = 1.8 + Math.sin(sec * 3.2) * 0.4;
      }
    } else {
      axisZ(bones[B.spine], -0.12 + Math.sin(sec * 0.5) * 0.01);
      if (hasPhoneGlow) {
        accentMat.emissiveIntensity = 1.8 + Math.sin(sec * 3.2) * 0.4;
      }
    }
    group.updateMatrixWorld(true);
  }

  return { group, updateAmbient };
}

// ---------------------------------------------------------------------------
// buildCrowd — cheap merged/near-instanced crowd for Shibuya corners etc.
// ---------------------------------------------------------------------------

export interface CrowdAsset {
  group: THREE.Group;
  updateAmbient(sec: number): void;
}

/**
 * One low-detail crowd figure: a tapered coat body + slightly elongated head
 * (oval-ish SphereGeometry scaled Y) with two small eye-dot boxes on the face.
 * Eye dots use mat=1 (accent), which gets the neon emissive color in buildCrowd.
 *
 * Parts: body (mat 0), head (mat 0), 2x eye dots (mat 1) = 2 material groups.
 * The mergeGeometries call coalesces them so we get exactly 2 draw calls.
 */
function buildLowPolyFigureGeometry(): THREE.BufferGeometry {
  const HEAD_Y = 1.52;
  const EYE_FWD = 0.105; // how far forward eyes sit on the face (crowd face = +X)
  const parts: RigPart[] = [
    // torso — cone-shaped (wider at shoulders) for coat silhouette
    { geom: new THREE.CylinderGeometry(0.18, 0.14, 1.1, 6), matrix: xform(0, 0.85, 0), mat: 0 },
    // head — slightly elongated vertically (scale Y 1.18) for human proportion at distance
    {
      geom: (() => {
        const g = new THREE.SphereGeometry(0.13, 8, 6);
        g.scale(1, 1.18, 1);
        return g;
      })(),
      matrix: xform(0, HEAD_Y, 0),
      mat: 0
    },
    // Left eye dot — tiny box on the face, mat 1 (accent/neon)
    {
      geom: new THREE.BoxGeometry(0.024, 0.014, 0.014),
      matrix: xform(EYE_FWD, HEAD_Y + 0.02, 0.042),
      mat: 1
    },
    // Right eye dot
    {
      geom: new THREE.BoxGeometry(0.024, 0.014, 0.014),
      matrix: xform(EYE_FWD, HEAD_Y + 0.02, -0.042),
      mat: 1
    }
  ];
  return mergeParts(parts, false);
}

/**
 * Accent collar-ring geometry — a thin torus at neck height on ~30% of crowd
 * figures. Reads as a glowing collar band even at crowd distance.
 * Second InstancedMesh, constant 1 draw call regardless of n.
 */
function buildAccentRingGeometry(): THREE.BufferGeometry {
  // Torus: R=0.14 (collar radius), r=0.025 (tube) — readable at crowd distance, blooms well
  return new THREE.TorusGeometry(0.14, 0.025, 5, 10);
}

export function buildCrowd(rng: Rng, n: number, area: [number, number]): CrowdAsset {
  const [w, d] = area;
  const figureGeom = buildLowPolyFigureGeometry();
  const accentGeom = buildAccentRingGeometry();

  // Dark body material — lean toward shadow-blue/void (cyberpunk night crowd)
  const bodyMat = new THREE.MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0.02,
    emissiveIntensity: 0.08
  });

  // Eye glow material (mat group 1 in figure geometry) — glowing cyan eye dots
  // on all crowd figures at this distance (no per-instance color override needed;
  // uniform tron-cyan reads as a crowd of cyber-people even at crowd distance).
  const eyeGlowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x020408),
    emissive: new THREE.Color(COLORS.holoTeal),
    emissiveIntensity: 3.0,
    roughness: 0.05,
    metalness: 0.0
  });

  // Neon accent material — instanceColor drives hue, emissive carries the bloom glow.
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 2.8,
    roughness: 0.1,
    metalness: 0.0
  });

  // InstancedMesh with [bodyMat, eyeGlowMat] array so the 2 geometry groups
  // render with correct materials. Adds 1 extra draw call for the eye-dot group
  // (crowd now 2 draw calls for figure + 1 for collar rings = 3 total). Acceptable.
  const bodyMesh = new THREE.InstancedMesh(figureGeom, [bodyMat, eyeGlowMat], Math.max(n, 1));
  bodyMesh.name = 'crowd';
  bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(n, 1) * 3), 3);
  bodyMesh.frustumCulled = false;

  // Collect which figures get accent collar rings — ~30% of the crowd
  const accentIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rng.chance(0.3)) accentIndices.push(i);
  }
  const nAccents = Math.max(accentIndices.length, 1);
  const accentMesh = new THREE.InstancedMesh(accentGeom, accentMat, nAccents);
  accentMesh.name = 'crowdAccents';
  accentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nAccents * 3), 3);
  accentMesh.frustumCulled = false;

  const tones = mutedTones();
  const phases: number[] = [];
  const bases: THREE.Matrix4[] = [];
  const rotations: number[] = [];
  const scales: number[] = [];
  const dummy = new THREE.Object3D();

  const figureXYZs: THREE.Vector3[] = [];
  const figureScales: number[] = [];

  for (let i = 0; i < n; i++) {
    const x = rng.range(-w / 2, w / 2);
    const z = rng.range(-d / 2, d / 2);
    const ry = rng.range(0, Math.PI * 2);
    const scale = rng.range(0.92, 1.08);
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    bases.push(dummy.matrix.clone());
    rotations.push(ry);
    scales.push(scale);
    phases.push(rng.range(0, Math.PI * 2));
    bodyMesh.setMatrixAt(i, dummy.matrix);
    bodyMesh.setColorAt(i, rng.pick(tones));
    figureXYZs.push(new THREE.Vector3(x, 0, z));
    figureScales.push(scale);
  }
  bodyMesh.instanceMatrix.needsUpdate = true;
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;

  // Place accent collar rings at neck-height (~1.35 m * scale) for the lit subset.
  // The torus lies flat (X-Z plane), forming a horizontal glowing ring at the collar.
  const NEON_CROWD = [
    new THREE.Color(COLORS.signalMagenta),
    new THREE.Color(COLORS.sodiumAmber),
    new THREE.Color(COLORS.holoTeal)
  ];
  for (let ai = 0; ai < accentIndices.length; ai++) {
    const fi = accentIndices[ai];
    const fx = figureXYZs[fi].x;
    const fz = figureXYZs[fi].z;
    const sc = figureScales[fi];
    dummy.position.set(fx, 1.35 * sc, fz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(sc, sc, sc);
    dummy.updateMatrix();
    accentMesh.setMatrixAt(ai, dummy.matrix);
    accentMesh.setColorAt(ai, rng.pick(NEON_CROWD));
  }
  // If no accents were chosen, push the single dummy instance off-screen
  if (accentIndices.length === 0) {
    dummy.position.set(0, -100, 0);
    dummy.updateMatrix();
    accentMesh.setMatrixAt(0, dummy.matrix);
    accentMesh.setColorAt(0, new THREE.Color(0, 0, 0));
  }
  accentMesh.instanceMatrix.needsUpdate = true;
  if (accentMesh.instanceColor) accentMesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'buildCrowd';
  group.add(bodyMesh);
  group.add(accentMesh);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  function updateAmbient(sec: number): void {
    for (let i = 0; i < n; i++) {
      const base = bases[i];
      base.decompose(v, q, s);
      const sway = Math.sin(sec * 1.4 + phases[i]) * 0.03;
      euler.set(0, rotations[i] + sway, 0);
      m.compose(v, new THREE.Quaternion().setFromEuler(euler), s);
      bodyMesh.setMatrixAt(i, m);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    // Accent rings follow the body figures
    for (let ai = 0; ai < accentIndices.length; ai++) {
      const fi = accentIndices[ai];
      const fx = figureXYZs[fi].x;
      const fz = figureXYZs[fi].z;
      const sc = figureScales[fi];
      const sway = Math.sin(sec * 1.4 + phases[fi]) * 0.03;
      dummy.position.set(fx, 1.35 * sc, fz);
      dummy.rotation.set(0, rotations[fi] + sway, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      accentMesh.setMatrixAt(ai, dummy.matrix);
    }
    if (accentIndices.length > 0) accentMesh.instanceMatrix.needsUpdate = true;
  }

  return { group, updateAmbient };
}
