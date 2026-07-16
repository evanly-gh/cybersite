import * as THREE from 'three';
import type { Rng } from '../utils/rng';
import { roadFrame, ZONES } from '../world/route';
import { ROAD_HALF_WIDTH } from '../world/streets';
import {
  buildSedan,
  buildHatchback,
  buildKeiVan,
  buildGTCoupe,
  buildCrossover,
  type CarAsset,
} from '../assets/vehicles/cars';
import { buildHoverA, buildHoverB, type HoverAsset } from '../assets/vehicles/hover';
import { buildCrowd } from '../assets/characters/person';
import { buildMetro, type MetroAsset } from '../assets/metro/metro';

// ──────────────────────────────────────────────────────────────────────────────
// Public interface
// ──────────────────────────────────────────────────────────────────────────────

export interface Traffic {
  group: THREE.Group;
  update(t: number): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Number of ground cars (brief: ~20-26). */
const N_GROUND_CARS = 23;

/** Number of hover vehicles (brief: ~5). */
const N_HOVER = 5;

/** Hover car ride height above ground (y offset from route sample). */
const HOVER_MIN_Y = 6;
const HOVER_MAX_Y = 12;

/** Lane band for ground cars: fits within ±ROAD_HALF_WIDTH using 3 virtual lanes. */
const LANE_OFFSETS = [-4.5, 0, 4.5]; // binormal offsets (m) in the ±7 corridor

/** Ground car speeds expressed as full-route wraps per unit t. */
const GROUND_SPEED_MIN = 0.6;
const GROUND_SPEED_MAX = 1.4;

/** Hover car speeds (slightly faster). */
const HOVER_SPEED_MIN = 0.8;
const HOVER_SPEED_MAX = 1.8;

/** Shibuya crossing — sample midpoint of turn zone for crowd placement. */
const SHIBUYA_T = (ZONES.turn[0] + ZONES.turn[1]) / 2;

/** Number of pedestrians in each crowd cluster at Shibuya. */
const CROWD_N = 24;

/** Area (width × depth in m) for each crowd cluster. */
const CROWD_AREA: [number, number] = [18, 12];

// Reusable dummy for matrix computation
const _dummy = new THREE.Object3D();

// ──────────────────────────────────────────────────────────────────────────────
// Internal data per vehicle
// ──────────────────────────────────────────────────────────────────────────────

interface GroundSlot {
  asset: CarAsset;
  /** Phase in [0,1] — added to t*speed before wrapping, so vehicles start at different positions. */
  phase: number;
  /** Full-route wraps per unit t. */
  speed: number;
  /** Lateral offset along road binormal (m). */
  laneOffset: number;
}

interface HoverSlot {
  asset: HoverAsset;
  phase: number;
  speed: number;
  laneOffset: number;
  /** Fixed height above the route y. */
  rideY: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// buildTraffic
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Builds the full traffic system: ground cars, hover vehicles, Shibuya crowds,
 * and metro. All positions are pure functions of t (scrub-safe).
 *
 * @param rng - Seeded RNG; all randomness is consumed at build time, never at runtime.
 */
export function buildTraffic(rng: Rng): Traffic {
  const group = new THREE.Group();
  group.name = 'traffic';

  // ── Ground cars ────────────────────────────────────────────────────────────
  const groundBuilders = [
    buildSedan,
    buildHatchback,
    buildKeiVan,
    buildGTCoupe,
    buildCrossover,
  ] as const;

  const groundSlots: GroundSlot[] = [];
  for (let i = 0; i < N_GROUND_CARS; i++) {
    // Pick builder deterministically from rng
    const builder = rng.pick(groundBuilders);
    const asset = builder(rng);
    const phase = rng.range(0, 1);
    const speed = rng.range(GROUND_SPEED_MIN, GROUND_SPEED_MAX);
    const laneOffset = rng.pick(LANE_OFFSETS);
    groundSlots.push({ asset, phase, speed, laneOffset });
    group.add(asset.group);
  }

  // ── Hover vehicles ─────────────────────────────────────────────────────────
  const hoverBuilders = [buildHoverA, buildHoverB] as const;

  const hoverSlots: HoverSlot[] = [];
  for (let i = 0; i < N_HOVER; i++) {
    const builder = rng.pick(hoverBuilders);
    const asset = builder(rng);
    const phase = rng.range(0, 1);
    const speed = rng.range(HOVER_SPEED_MIN, HOVER_SPEED_MAX);
    // Hover vehicles use a wider lateral band (can extend beyond road boundary)
    const laneOffset = rng.range(-ROAD_HALF_WIDTH - 4, ROAD_HALF_WIDTH + 4);
    const rideY = rng.range(HOVER_MIN_Y, HOVER_MAX_Y);
    hoverSlots.push({ asset, phase, speed, laneOffset, rideY });
    group.add(asset.group);
  }

  // ── Shibuya crossing crowds ────────────────────────────────────────────────
  // Sample the crossing centre from the route
  const shibuyaFrame = roadFrame(SHIBUYA_T);
  const shibuyaCentre = shibuyaFrame.pos.clone();
  shibuyaCentre.y = 0; // pin to ground

  // Build 3 crowd clusters: one on each side of the intersection + one in centre
  const crowdOffsets: [number, number, number][] = [
    // [binormal_offset, forward_offset, lateral_offset]
    // Left sidewalk cluster
    [-(ROAD_HALF_WIDTH + 5), 0, 0],
    // Right sidewalk cluster
    [(ROAD_HALF_WIDTH + 5), 0, 0],
    // Offset cluster to the crossing's other arm (route tangent direction)
    [0, 20, 0],
  ];

  for (const [bOff, _fOff, _latOff] of crowdOffsets) {
    const crowd = buildCrowd(rng, CROWD_N, CROWD_AREA);

    // Position relative to Shibuya centre, offset along binormal and tangent
    const clusterPos = shibuyaCentre.clone();
    clusterPos.addScaledVector(shibuyaFrame.binormal, bOff);
    clusterPos.addScaledVector(shibuyaFrame.tangent, _fOff);

    crowd.group.position.copy(clusterPos);
    group.add(crowd.group);
  }

  // ── Metro ──────────────────────────────────────────────────────────────────
  const metro: MetroAsset = buildMetro(rng);
  group.add(metro.group);

  // ── update: pure function of t ─────────────────────────────────────────────
  // Pre-declare temporaries used inside update to avoid per-frame allocation
  const _tangent = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _quat = new THREE.Quaternion();

  function update(t: number): void {
    // Ground cars: position = route sample at ((t * speed + phase) mod 1)
    for (const slot of groundSlots) {
      const routeT = ((t * slot.speed + slot.phase) % 1 + 1) % 1;
      const frame = roadFrame(routeT);

      // Position: route position + lateral lane offset along binormal
      const pos = frame.pos.clone().addScaledVector(frame.binormal, slot.laneOffset);
      // Keep cars on the ground (clamp y to >= 0 on non-elevated sections)
      pos.y = Math.max(pos.y, 0);

      slot.asset.group.position.copy(pos);

      // Orient along tangent (forward = +X for cars, so we align local +X → tangent)
      _tangent.copy(frame.tangent).normalize();
      // Build quaternion: local +X → tangent, up → worldUp
      const right = new THREE.Vector3().crossVectors(_tangent, _up).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(right, _tangent).normalize();
      const rotMatrix = new THREE.Matrix4().makeBasis(_tangent, correctedUp, right);
      _quat.setFromRotationMatrix(rotMatrix);
      slot.asset.group.quaternion.copy(_quat);

      // Advance wheel spin (t-based, deterministic)
      slot.asset.update(t);
    }

    // Hover vehicles: same logic but with elevated y
    for (const slot of hoverSlots) {
      const routeT = ((t * slot.speed + slot.phase) % 1 + 1) % 1;
      const frame = roadFrame(routeT);

      const pos = frame.pos.clone().addScaledVector(frame.binormal, slot.laneOffset);
      // Hover rides at fixed height above ground (independent of route ramp y)
      pos.y = slot.rideY;

      slot.asset.group.position.copy(pos);

      _tangent.copy(frame.tangent).normalize();
      const right2 = new THREE.Vector3().crossVectors(_tangent, _up).normalize();
      const correctedUp2 = new THREE.Vector3().crossVectors(right2, _tangent).normalize();
      const rotMatrix2 = new THREE.Matrix4().makeBasis(_tangent, correctedUp2, right2);
      _quat.setFromRotationMatrix(rotMatrix2);
      slot.asset.group.quaternion.copy(_quat);

      // Hover bob is baked into asset.update(t)
      // We need to apply BOTH our position assignment AND the hover's internal bob.
      // The hover asset sets group.position.y in its update(), so we save our target pos,
      // call update, then re-apply x/z (the hover bob only modifies y).
      const targetX = pos.x;
      const targetZ = pos.z;
      slot.asset.update(t);
      // Restore our world-space x/z after hover's update() (which may reset position.y only)
      slot.asset.group.position.x = targetX;
      slot.asset.group.position.z = targetZ;
      // The hover bob's y is relative — add our ride height to the bob offset
      slot.asset.group.position.y += slot.rideY;
      // Re-apply quaternion (update() may also modify rotation for sway)
      // The hover sway is small (rx/rz) and local to the craft's orientation.
      // We keep it: slot.asset.group.rotation.x and .z from the hover are in craft local space.
    }

    // Metro: deterministic update
    metro.update(t);
  }

  // Prime the system at t=0 so bounding boxes initialize correctly
  update(0);

  return { group, update };
}
