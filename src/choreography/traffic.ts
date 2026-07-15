import * as THREE from 'three';
import type { Rng } from '../utils/rng';
import { roadFrame, ROUTE_U } from '../world/route';
import {
  buildHatchback,
  buildKeiVan,
  buildSedan,
  buildCrossover,
  buildLamboWedge,
  buildGTCoupe,
  type CarAsset
} from '../assets/vehicles/cars';
import { buildHoverA, buildHoverB, type HoverAsset } from '../assets/vehicles/hover';

/**
 * Task 21 — deterministic, scrub-safe traffic system.
 *
 * Exports `buildTraffic(rng)` which returns `{ group; update(t) }`.
 *
 * Each vehicle is placed on a "lane slot":
 *   u(t) = (u0 + t * laneSpeed) % 1   — modular, scrub-safe
 *   position(t) = roadFrame(u(t)).pos + binormal * (laneOffset + wobble(t))
 *
 * Hover vehicles are wrapped in a parent group so their internal bob/sway
 * (applied to group.position.y / group.rotation) stays relative to the
 * wrapper's world position/orientation rather than fighting with placement math.
 *
 * Car mix: cheap 40%, average 40%, luxury 20%.
 * Max 2 unique builds per vehicle type (pooled/cloned).
 * Ground vehicles: ~28. Hover vehicles: ~5.
 *
 * Sky hover vehicles follow gentle S-curve paths:
 *   lateral sway = sin(t * 2π * 0.8 + phaseOffset) * 3.0 m (along binormal)
 *   y oscillation = baseY + sin(t * 2π * 0.6 + phaseY) * 4.0 m
 */

// Approximate total route arc length — used only for wheel-spin speed feel.
const ROUTE_LENGTH_APPROX = 2000; // metres (intentionally rough)

// ---------------------------------------------------------------------------
// Module-scope pre-allocated vectors for the hot update path (no per-frame alloc)
// ---------------------------------------------------------------------------
const _negTangent = new THREE.Vector3();
const _hoverWorldPos = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Lane wobble: per-car seeded sine, ±0.15 m along binormal
// ---------------------------------------------------------------------------
function laneWobble(t: number, seed: number): number {
  return 0.15 * Math.sin(t * 0.7 * Math.PI * 2 + seed * 6.2831853);
}

// ---------------------------------------------------------------------------
// Vehicle slot descriptors
// ---------------------------------------------------------------------------

interface GroundSlot {
  kind: 'ground';
  asset: CarAsset;
  u0: number;
  /** u/unit-t — positive = same direction as biker, negative = oncoming */
  laneSpeed: number;
  /** metres along frame.binormal */
  laneOffset: number;
  wobbleSeed: number;
  /** wheel rotation speed — rad per unit t */
  wheelSpeed: number;
}

interface HoverSlot {
  kind: 'hover';
  asset: HoverAsset;
  /** Wrapper group handles world placement; asset.group is parented inside it */
  wrapper: THREE.Group;
  u0: number;
  laneSpeed: number;
  laneOffset: number;
  /** additional y above road surface */
  skyY: number;
  wobbleSeed: number;
  /** true = this hover is a sky-lane vehicle (y 22–34); applies S-curve weave */
  isSkyLane: boolean;
  /** per-vehicle phase offset for lateral sway (seeded from rng) */
  phaseOffset: number;
  /** per-vehicle phase offset for y oscillation (seeded from rng) */
  phaseY: number;
}

type VehicleSlot = GroundSlot | HoverSlot;

// ---------------------------------------------------------------------------
// Build pools — max 2 unique builds per type to cap texture/material cost
// ---------------------------------------------------------------------------

type GroundPool = Record<string, CarAsset[]>;
type HoverPool = { A: HoverAsset[]; B: HoverAsset[] };

function getOrBuildGround(
  pool: GroundPool,
  type: string,
  rng: Rng
): CarAsset {
  if (!pool[type]) pool[type] = [];
  const p = pool[type];
  if (p.length < 2) {
    let fresh: CarAsset;
    switch (type) {
      case 'hatchback': fresh = buildHatchback(rng); break;
      case 'keiVan':    fresh = buildKeiVan(rng);    break;
      case 'sedan':     fresh = buildSedan(rng);     break;
      case 'crossover': fresh = buildCrossover(rng); break;
      case 'lambo':     fresh = buildLamboWedge(rng); break;
      default:          fresh = buildGTCoupe(rng);   break;
    }
    p.push(fresh);
    return fresh;
  }
  // Return a proxy that wraps a clone of the pool entry's group but shares the update
  const src = p[rng.int(0, p.length - 1)];
  const cloneGroup = src.group.clone();
  return { group: cloneGroup, update: (t: number) => src.update(t) };
}

function getOrBuildHover(
  pool: HoverPool,
  type: 'A' | 'B',
  rng: Rng
): HoverAsset {
  const p = pool[type];
  if (p.length < 2) {
    const fresh = type === 'A' ? buildHoverA(rng) : buildHoverB(rng);
    p.push(fresh);
    return fresh;
  }
  const src = p[rng.int(0, p.length - 1)];
  const cloneGroup = src.group.clone();
  return { group: cloneGroup, update: (t: number) => src.update(t) };
}

// ---------------------------------------------------------------------------
// Car type selector — cheap 40%, average 40%, luxury 20%
// ---------------------------------------------------------------------------

type GroundType = 'hatchback' | 'keiVan' | 'sedan' | 'crossover' | 'lambo' | 'gt';

function pickCarType(rng: Rng): GroundType {
  const roll = rng();
  if (roll < 0.20) return 'hatchback';
  if (roll < 0.40) return 'keiVan';
  if (roll < 0.60) return 'sedan';
  if (roll < 0.80) return 'crossover';
  return rng.chance(0.5) ? 'lambo' : 'gt';
}

// ---------------------------------------------------------------------------
// Spawn helpers — evenly-spaced u0 values across a route segment
// ---------------------------------------------------------------------------

function spawnPoints(uMin: number, uMax: number, count: number): number[] {
  if (count <= 0) return [];
  const span = uMax - uMin;
  const pts: number[] = [];
  for (let i = 0; i < count; i++) {
    pts.push(uMin + (span * (i + 0.5)) / count);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Orientation helper — build a quaternion from tangent + up
// ---------------------------------------------------------------------------
const _mat4Tmp = new THREE.Matrix4();
const _v3Right = new THREE.Vector3();
const _v3Up2   = new THREE.Vector3();

function orientFromTangent(
  group: THREE.Group | THREE.Object3D,
  tangent: THREE.Vector3,
  up: THREE.Vector3
): void {
  _v3Right.crossVectors(up, tangent).normalize();
  if (_v3Right.lengthSq() < 1e-8) {
    // Tangent parallel to up — use a fallback right
    _v3Right.set(1, 0, 0);
  }
  _v3Up2.crossVectors(tangent, _v3Right).normalize();
  _mat4Tmp.makeBasis(tangent, _v3Up2, _v3Right);
  group.quaternion.setFromRotationMatrix(_mat4Tmp);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TrafficSystem {
  group: THREE.Group;
  update(t: number): void;
}

export function buildTraffic(rng: Rng): TrafficSystem {
  const group = new THREE.Group();
  group.name = 'traffic';

  const slots: VehicleSlot[] = [];
  const groundPool: GroundPool = {};
  const hoverPool: HoverPool = { A: [], B: [] };

  // Use the caller-supplied rng for all slot/vehicle building so the caller
  // fully controls seeding and the result is deterministic relative to rng's state.

  // -----------------------------------------------------------------------
  // Shorthand registrars
  // -----------------------------------------------------------------------

  function addCar(
    u0: number,
    laneSpeed: number,
    laneOffset: number,
    type?: GroundType
  ): void {
    const carType = type ?? pickCarType(rng);
    const asset = getOrBuildGround(groundPool, carType, rng);
    const wobbleSeed = rng.range(0, 100);
    const wheelSpeed = Math.abs(laneSpeed) * ROUTE_LENGTH_APPROX;
    slots.push({ kind: 'ground', asset, u0, laneSpeed, laneOffset, wobbleSeed, wheelSpeed });
    group.add(asset.group);
  }

  function addHoverVehicle(
    u0: number,
    laneSpeed: number,
    laneOffset: number,
    skyY: number,
    type: 'A' | 'B' = 'A',
    isSkyLane = false
  ): void {
    const asset = getOrBuildHover(hoverPool, type, rng);
    const wrapper = new THREE.Group();
    wrapper.name = `hoverWrapper_${slots.length}`;
    wrapper.add(asset.group);
    group.add(wrapper);
    const wobbleSeed = rng.range(0, 100);
    // Per-vehicle phase offsets for S-curve (seeded from rng so they're deterministic)
    const phaseOffset = rng.range(0, Math.PI * 2);
    const phaseY      = rng.range(0, Math.PI * 2);
    slots.push({ kind: 'hover', asset, wrapper, u0, laneSpeed, laneOffset, skyY, wobbleSeed, isSkyLane, phaseOffset, phaseY });
  }

  // -----------------------------------------------------------------------
  // Get route u-ranges at call time (ROUTE_U is computed at module load of route.ts)
  // -----------------------------------------------------------------------
  const uAboutStart   = ROUTE_U.aboutStart;
  const uAboutEnd     = ROUTE_U.shibuyaCenter;
  const uBlvdStart    = ROUTE_U.driftExit;
  const uBlvdEnd      = ROUTE_U.researchEntry;
  // Research canyon: ground-level corridor from researchEntry→researchEnd (formerly elevated skyway)
  const uCanyonStart  = ROUTE_U.researchEntry;
  const uCanyonEnd    = ROUTE_U.researchEnd;
  const uBridgeStart  = ROUTE_U.bridgeStart;
  const uBridgeEnd    = ROUTE_U.bridgeEnd;

  // -----------------------------------------------------------------------
  // ABOUT STREET — 2+2 lanes: ±3.5 m and ±7 m
  // Target: 10 ground cars (including 1 parked)
  // -----------------------------------------------------------------------
  // Inner right (+3.5 m) — same-direction, 3 cars
  for (const u0 of spawnPoints(uAboutStart, uAboutEnd, 3)) {
    addCar(u0, 0.0030, 3.5);
  }
  // Outer right (+7 m) — same-direction, 2 cars
  for (const u0 of spawnPoints(uAboutStart, uAboutEnd, 2)) {
    addCar(u0, 0.0038, 7.0);
  }
  // Inner left (−3.5 m) — oncoming, 3 cars
  for (const u0 of spawnPoints(uAboutStart, uAboutEnd, 3)) {
    addCar(u0, -0.0042, -3.5);
  }
  // Outer left (−7 m) — oncoming, 1 car
  for (const u0 of spawnPoints(uAboutStart, uAboutEnd, 1)) {
    addCar(u0, -0.0035, -7.0);
  }
  // Parked at curb (static, laneSpeed = 0), cheap tier
  addCar(uAboutStart + (uAboutEnd - uAboutStart) * 0.28, 0.0, -9.5, 'keiVan');

  // -----------------------------------------------------------------------
  // BOULEVARD — 2+2 lanes: ±3.5 m and ±7 m
  // Target: 11 ground cars (including 1 parked) + 1 street-level hover taxi
  // -----------------------------------------------------------------------
  // Inner right (+3.5 m), 3 cars, same-direction
  for (const u0 of spawnPoints(uBlvdStart, uBlvdEnd, 3)) {
    addCar(u0, 0.0028, 3.5);
  }
  // Outer right (+7 m), 2 cars, same-direction
  for (const u0 of spawnPoints(uBlvdStart, uBlvdEnd, 2)) {
    addCar(u0, 0.0034, 7.0);
  }
  // Inner left (−3.5 m), 3 cars, oncoming
  for (const u0 of spawnPoints(uBlvdStart, uBlvdEnd, 3)) {
    addCar(u0, -0.0040, -3.5);
  }
  // Outer left (−7 m), 2 cars, oncoming
  for (const u0 of spawnPoints(uBlvdStart, uBlvdEnd, 2)) {
    addCar(u0, -0.0036, -7.0);
  }
  // Parked at right curb (static)
  addCar(uBlvdStart + (uBlvdEnd - uBlvdStart) * 0.6, 0.0, 9.5, 'hatchback');
  // Pulled-over taxi hover at boulevard (street-level, y ≈ 4 m)
  addHoverVehicle(ROUTE_U.shibuyaCenter + 0.025, 0.0, 8.0, 4.0, 'B', false);

  // -----------------------------------------------------------------------
  // RESEARCH CANYON — ground-level corridor (formerly elevated skyway).
  // 1+1 lanes: ±3.5 m. Narrow canyon road, sparse traffic.
  // Target: 4 ground cars (no hover — canyon walls block sky-lane lines)
  // -----------------------------------------------------------------------
  for (const u0 of spawnPoints(uCanyonStart, uCanyonEnd, 2)) {
    addCar(u0, 0.0025, 3.5);
  }
  for (const u0 of spawnPoints(uCanyonStart, uCanyonEnd, 2)) {
    addCar(u0, -0.0032, -3.5);
  }

  // -----------------------------------------------------------------------
  // BRIDGE — 2+2 sparse: ±3.5 m. Long open bridge, few cars.
  // Target: 3 cars
  // -----------------------------------------------------------------------
  for (const u0 of spawnPoints(uBridgeStart, uBridgeEnd, 2)) {
    addCar(u0, 0.0022, 3.5);
  }
  for (const u0 of spawnPoints(uBridgeStart, uBridgeEnd, 1)) {
    addCar(u0, -0.0028, -3.5);
  }

  // -----------------------------------------------------------------------
  // SKY LANES — 4 hovers (2 above About street, 2 above Boulevard)
  // y 22–34, gentle S-curves above each street (isSkyLane = true)
  // -----------------------------------------------------------------------
  // Sky lane 1: above About street, y = 22 m, rightward offset
  for (const u0 of spawnPoints(uAboutStart, uAboutEnd, 1)) {
    addHoverVehicle(u0, 0.0048, 8.0, 22.0, 'A', true);
  }
  // Sky lane 2: above boulevard, y = 28 m, oncoming
  for (const u0 of spawnPoints(uBlvdStart, uBlvdEnd, 1)) {
    addHoverVehicle(u0, -0.0042, -9.0, 28.0, 'B', true);
  }
  // Sky lane 3: above boulevard, y = 34 m, same-direction
  for (const u0 of spawnPoints(uBlvdStart + 0.02, uBlvdEnd, 1)) {
    addHoverVehicle(u0, 0.0036, 11.0, 34.0, 'A', true);
  }
  // Sky lane 4: above About street, y = 26 m (second pass)
  for (const u0 of spawnPoints(uAboutStart + 0.05, uAboutEnd - 0.05, 1)) {
    addHoverVehicle(u0, -0.0040, -6.0, 26.0, 'B', true);
  }

  // -----------------------------------------------------------------------
  // Update function — called with scroll parameter t ∈ [0, 1]
  // -----------------------------------------------------------------------
  const _up = new THREE.Vector3(0, 1, 0);

  // Sky-lane S-curve constants
  const SKY_SWAY_AMP  = 3.0;  // metres lateral
  const SKY_SWAY_FREQ = 0.8;  // cycles per unit-t
  const SKY_Y_AMP     = 4.0;  // metres vertical
  const SKY_Y_FREQ    = 0.6;  // cycles per unit-t
  const TAU = Math.PI * 2;

  function update(t: number): void {
    for (const slot of slots) {
      // Modular u — loops continuously as t increases
      const u = ((slot.u0 + t * slot.laneSpeed) % 1 + 1) % 1;
      const frame = roadFrame(u);

      const wobble = laneWobble(t, slot.wobbleSeed);
      const lateral = slot.laneOffset + wobble;

      if (slot.kind === 'ground') {
        // World position: road surface + lateral offset
        slot.asset.group.position
          .copy(frame.pos)
          .addScaledVector(frame.binormal, lateral);

        // Orientation: car forward = tangent (or negated for oncoming)
        // Use pre-allocated _negTangent to avoid per-frame clone()
        let faceTangent: THREE.Vector3;
        if (slot.laneSpeed >= 0) {
          faceTangent = frame.tangent;
        } else {
          _negTangent.copy(frame.tangent).negate();
          faceTangent = _negTangent;
        }
        orientFromTangent(slot.asset.group, faceTangent, frame.normal);

        // Wheel spin speed
        slot.asset.group.userData.speed = slot.wheelSpeed;
        slot.asset.update(t);

      } else {
        // Hover: wrapper handles world position + orientation;
        // asset.group handles bob/sway/thruster internally via update(t).

        // Compute lateral: base + S-curve sway for sky-lane vehicles
        let skyLateral = lateral;
        let skyY = slot.skyY;

        if (slot.isSkyLane) {
          // Gentle S-curve weave along binormal
          const sway = Math.sin(t * TAU * SKY_SWAY_FREQ + slot.phaseOffset) * SKY_SWAY_AMP;
          skyLateral = lateral + sway;
          // Gentle y oscillation within the y 22–34 range
          skyY = slot.skyY + Math.sin(t * TAU * SKY_Y_FREQ + slot.phaseY) * SKY_Y_AMP;
        }

        _hoverWorldPos
          .copy(frame.pos)
          .addScaledVector(frame.binormal, skyLateral);
        _hoverWorldPos.y += skyY;

        slot.wrapper.position.copy(_hoverWorldPos);

        // Use pre-allocated _negTangent to avoid per-frame clone()
        let faceTangent: THREE.Vector3;
        if (slot.laneSpeed >= 0) {
          faceTangent = frame.tangent;
        } else {
          _negTangent.copy(frame.tangent).negate();
          faceTangent = _negTangent;
        }
        orientFromTangent(slot.wrapper, faceTangent, _up);

        // Call hover's own update — it modifies asset.group.position.y (bob) and
        // asset.group.rotation.x/z (sway) relative to the wrapper. This is correct:
        // bob is in the wrapper's local Y, sway tilts the craft relative to the wrapper.
        slot.asset.update(t);
      }
    }
  }

  // Place all vehicles at t = 0 immediately so the initial bounding box is correct.
  update(0);

  return { group, update };
}
