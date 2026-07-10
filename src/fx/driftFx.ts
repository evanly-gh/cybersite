/**
 * Task 24 — Drift FX: scrub-safe skid marks + tire smoke + venue steam
 *
 * ## buildDriftFx(): { group; update(t) }
 * Skid marks are pre-authored ribbon geometry hugging the drift curve (a line
 * from shibuyaCenter toward driftExit offset by ±0.35 m wheel track, sampled
 * from the ROUTE spline). Reveal is driven by a `uReveal` shader uniform so
 * marks appear progressively as t sweeps through the window and persist after.
 * All positions are pure f(t) — scrub-safe.
 *
 * Tire smoke: 40 sprites per window. Each sprite has a fixed spawn position
 * (u along the drift line) and a deterministic life curve. position / opacity /
 * scale = pure f(t). No accumulation. Additive blending, billboarded.
 *
 * ## buildSteam(anchors): { group; updateAmbient(sec) }
 * 6 additive soft-circle sprites per anchor, rising in a looped wall-clock
 * animation. updateAmbient(sec) is ambient — NOT scrub-driven.
 *
 * ## NOTE on bikePath
 * bikePath (Task 25) does not exist yet. The drift skid geometry is derived
 * from the ROUTE spline itself, sampling the segment between shibuyaCenter
 * and driftExit and offsetting by ±WHEEL_TRACK. Task 28 will retune the exact
 * windows and geometry once bikePath is available. The DRIFT_WINDOW,
 * LANDING_WINDOWS and WHEEL_TRACK constants below are the tuneable knobs.
 */

import * as THREE from 'three';
import { ROUTE, ROUTE_U, roadFrame } from '../world/route';
import { COLORS } from '../theme';
import { makeRng } from '../utils/rng';

// ---------------------------------------------------------------------------
// Tuneable constants (Task 28 retuning knobs)
// ---------------------------------------------------------------------------

/** Drift window in scroll t. */
export const DRIFT_WINDOW = { tStart: 0.30, tEnd: 0.345 } as const;

/** Ramp-landing smoke windows.
 * Task 28 retune: start at the t1 of each air window (exact touchdown moment)
 * and extend for a short skid duration afterward.
 * Air window 1 t1 = 0.475 → landing starts here.
 * Air window 2 t1 = 0.565 → landing starts here.
 */
export const LANDING_WINDOWS = [
  { tStart: 0.475, tEnd: 0.490 },
  { tStart: 0.565, tEnd: 0.578 }
] as const;

/** Half-track width: skid lines are ±WHEEL_TRACK from the route center. */
export const WHEEL_TRACK = 0.35;

/** Number of tire-smoke sprites per window. */
export const SMOKE_COUNT = 40;

/** Number of ribbon segments for the skid arc geometry. */
export const SKID_SEGMENTS = 32;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp + remap t from [lo, hi] → [0, 1]. */
function remap(t: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
}

/**
 * Soft radial gradient texture (white center → transparent edge).
 * Used for smoke / steam sprites.
 */
function softCircleTex(color: string, innerAlpha = 1): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, color.replace(')', `, ${innerAlpha})`).replace('rgb', 'rgba'));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(canvas);
}

/** Build a single additive sprite material. */
function additiveSpritemat(tex: THREE.Texture, opacity = 1): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity
  });
}

// ---------------------------------------------------------------------------
// Skid mark geometry helpers
// ---------------------------------------------------------------------------

/**
 * Sample the ROUTE spline between two u-parameters and build a flat ribbon
 * (PlaneGeometry analogue as a custom BufferGeometry) offset laterally by
 * `sideOffset` meters from the road center.
 *
 * The ribbon has `segments` quads along its length and is `width` meters wide.
 * UVs go 0→1 along the length (used by the uReveal shader).
 */
function buildSkidRibbon(
  uStart: number,
  uEnd: number,
  sideOffset: number,
  width: number,
  segments: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const frac = i / segments;
    const u = uStart + frac * (uEnd - uStart);
    const frame = roadFrame(u);
    const center = frame.pos;
    const bi = frame.binormal; // road-lateral direction

    // Two vertices per ring: inner and outer
    const inner = center.clone().addScaledVector(bi, sideOffset - width / 2);
    const outer = center.clone().addScaledVector(bi, sideOffset + width / 2);

    // Small Y lift so marks don't z-fight the road
    inner.y += 0.01;
    outer.y += 0.01;

    positions.push(inner.x, inner.y, inner.z);
    positions.push(outer.x, outer.y, outer.z);

    uvs.push(frac, 0);
    uvs.push(frac, 1);
  }

  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Custom uReveal shader material for the skid ribbon.
 * uReveal ∈ [0, 1] clips the ribbon from the start (uv.x < uReveal shows).
 */
function buildSkidMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uReveal: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uReveal;
      varying vec2 vUv;
      void main() {
        // Marks reveal from 0→uReveal along the ribbon length
        if (vUv.x > uReveal) discard;
        // Fade toward the leading edge for a soft draw-on look
        float fade = smoothstep(uReveal - 0.08, uReveal, vUv.x);
        // Fade at the trailing end slightly too
        float trailFade = smoothstep(0.0, 0.03, vUv.x);
        float alpha = (1.0 - fade) * trailFade * 0.85;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

// ---------------------------------------------------------------------------
// buildDriftFx
// ---------------------------------------------------------------------------

export interface DriftFx {
  group: THREE.Group;
  update(t: number): void;
}

/**
 * Builds scrub-safe drift FX: tire skid marks + tire smoke for the drift
 * window and both ramp landings.
 *
 * All state driven by `t` is a pure function of t — no accumulation.
 */
export function buildDriftFx(): DriftFx {
  const group = new THREE.Group();
  group.name = 'driftFx';

  const rng = makeRng(0x24_d01f);

  // ---- Route u-parameters for the drift segment -------------------------
  const uShibuya = ROUTE_U.shibuyaCenter;
  const uDriftExit = ROUTE_U.driftExit;

  // ---- Skid ribbons (drift window) --------------------------------------
  // Two tracks (left/right of center), dark rubber color
  const rubberColor = 0x1a1008; // very dark brownish-black

  const leftMat = buildSkidMaterial(rubberColor);
  const rightMat = buildSkidMaterial(rubberColor);

  const leftRibbon = new THREE.Mesh(
    buildSkidRibbon(uShibuya, uDriftExit, -WHEEL_TRACK, 0.12, SKID_SEGMENTS),
    leftMat
  );
  leftRibbon.name = 'skidLeft';
  const rightRibbon = new THREE.Mesh(
    buildSkidRibbon(uShibuya, uDriftExit, WHEEL_TRACK, 0.12, SKID_SEGMENTS),
    rightMat
  );
  rightRibbon.name = 'skidRight';
  group.add(leftRibbon, rightRibbon);

  // ---- Landing skid marks -----------------------------------------------
  // Short straight ribbons at ramp1Land and ramp2Land
  const landingMaterials: THREE.ShaderMaterial[] = [];
  for (const [wpStart, wpEnd] of [
    ['ramp1Land', 'ramp2Base'] as const,
    ['ramp2Land', 'skywayStart'] as const
  ]) {
    const uA = ROUTE_U[wpStart];
    const uB = uA + Math.min(0.003, (ROUTE_U[wpEnd] - uA) * 0.15);
    for (const side of [-WHEEL_TRACK, WHEEL_TRACK]) {
      const mat = buildSkidMaterial(rubberColor);
      const mesh = new THREE.Mesh(buildSkidRibbon(uA, uB, side, 0.1, 6), mat);
      mesh.name = `skidLanding_${wpStart}_${side > 0 ? 'R' : 'L'}`;
      group.add(mesh);
      landingMaterials.push(mat);
    }
  }

  // ---- Smoke sprites (drift + landing windows) --------------------------
  // Soft-gray additive for drift smoke; slight cyan rim tint on drift sprites
  const smokeTex = softCircleTex('rgb(180,180,200)');
  const smokeCyanTex = softCircleTex('rgb(100,220,240)');

  interface SmokeParticle {
    sprite: THREE.Sprite;
    /** Progress fraction along the window (0→1) at which this particle spawns. */
    spawnFrac: number;
    /** World position at spawn (computed from route). */
    spawnPos: THREE.Vector3;
    /** Lateral kick direction (outward from the route, ±). */
    kick: THREE.Vector3;
    /** Small vertical rise speed (deterministic). */
    riseRate: number;
    /** Lifetime fraction (duration as fraction of window width). */
    lifeDur: number;
    /** Base scale (deterministic). */
    baseScale: number;
    /** Is this particle a "rim tint" (cyan accent, drift only)? */
    isCyan: boolean;
  }

  const driftParticles: SmokeParticle[] = [];
  const landingParticles: SmokeParticle[][] = [[], []];

  /** Build a set of SMOKE_COUNT particles for a given route u-range. */
  function buildParticles(uA: number, uB: number, target: SmokeParticle[], cyanTint: boolean): void {
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const frac = rng.range(0, 1);
      const u = uA + frac * (uB - uA);
      const frame = roadFrame(u);
      const spawnPos = frame.pos.clone();
      spawnPos.y += 0.1; // above ground

      // Kick outward from the inside of the turn (route binormal)
      const kickDir = frame.binormal.clone().multiplyScalar(rng.range(-2.5, 2.5));
      kickDir.y = rng.range(0.3, 1.2); // always rises

      const isCyan = cyanTint && rng.chance(0.35);
      const mat = additiveSpritemat(isCyan ? smokeCyanTex : smokeTex);
      const sprite = new THREE.Sprite(mat);
      sprite.name = 'smoke';

      target.push({
        sprite,
        spawnFrac: frac,
        spawnPos,
        kick: kickDir,
        riseRate: rng.range(0.8, 2.2),
        lifeDur: rng.range(0.18, 0.55),
        baseScale: rng.range(0.5, 1.6),
        isCyan
      });
      group.add(sprite);
    }
  }

  // Drift window particles (spawn u between shibuyaCenter and driftExit)
  buildParticles(uShibuya, uDriftExit, driftParticles, true);

  // Landing window particles
  const uRamp1Land = ROUTE_U.ramp1Land;
  const uRamp1LandEnd = uRamp1Land + (ROUTE_U.ramp2Base - uRamp1Land) * 0.08;
  buildParticles(uRamp1Land, uRamp1LandEnd, landingParticles[0], false);

  const uRamp2Land = ROUTE_U.ramp2Land;
  const uRamp2LandEnd = uRamp2Land + (ROUTE_U.skywayStart - uRamp2Land) * 0.08;
  buildParticles(uRamp2Land, uRamp2LandEnd, landingParticles[1], false);

  // ---- update(t): pure f(t) -------------------------------------------

  /**
   * Update a set of smoke particles for a given window.
   * windowProgress ∈ [0, 1] across the window; 0 = not started, >0 = active.
   */
  function updateParticles(particles: SmokeParticle[], windowProgress: number): void {
    for (const p of particles) {
      // The particle becomes visible once the window has swept past its spawnFrac
      const localT = windowProgress - p.spawnFrac; // time since this particle spawned

      if (localT < 0 || windowProgress <= 0) {
        p.sprite.visible = false;
        continue;
      }

      // Normalise by the particle's lifetime
      const age = localT / p.lifeDur;
      if (age > 1) {
        // Particle has expired: keep hidden
        p.sprite.visible = false;
        continue;
      }

      p.sprite.visible = true;

      // Position: start at spawnPos, drift along kick direction
      const travel = age * p.lifeDur * 6; // meters traveled
      const pos = p.spawnPos.clone().addScaledVector(p.kick.clone().normalize(), travel);
      pos.y += age * p.riseRate;
      p.sprite.position.copy(pos);

      // Opacity: ramp in at 0→0.1, fade out at 0.7→1
      const opacity = Math.min(age / 0.1, 1) * (1 - Math.max(0, (age - 0.7) / 0.3));
      // Cyan rim tint gets lower opacity
      (p.sprite.material as THREE.SpriteMaterial).opacity = (p.isCyan ? 0.35 : 0.6) * opacity;

      // Scale: expand with age
      const scale = p.baseScale * (0.4 + age * 1.6);
      p.sprite.scale.setScalar(scale);
    }
  }

  function update(t: number): void {
    // --- Drift window skid marks ---
    const driftProg = remap(t, DRIFT_WINDOW.tStart, DRIFT_WINDOW.tEnd);
    // After the window the marks stay fully revealed (persist)
    const reveal = t >= DRIFT_WINDOW.tEnd ? 1 : driftProg;
    leftMat.uniforms.uReveal.value = reveal;
    rightMat.uniforms.uReveal.value = reveal;

    // --- Landing skid marks ---
    const landingReveal0 = t >= LANDING_WINDOWS[0].tEnd
      ? 1
      : remap(t, LANDING_WINDOWS[0].tStart, LANDING_WINDOWS[0].tEnd);
    const landingReveal1 = t >= LANDING_WINDOWS[1].tEnd
      ? 1
      : remap(t, LANDING_WINDOWS[1].tStart, LANDING_WINDOWS[1].tEnd);

    // 4 landing ribbons: first pair for window 0, second pair for window 1
    for (let i = 0; i < landingMaterials.length; i++) {
      landingMaterials[i].uniforms.uReveal.value = i < 2 ? landingReveal0 : landingReveal1;
    }

    // --- Drift smoke ---
    const driftWinProg = remap(t, DRIFT_WINDOW.tStart, DRIFT_WINDOW.tEnd);
    updateParticles(driftParticles, driftWinProg);

    // --- Landing smoke ---
    const landWinProg0 = remap(t, LANDING_WINDOWS[0].tStart, LANDING_WINDOWS[0].tEnd);
    const landWinProg1 = remap(t, LANDING_WINDOWS[1].tStart, LANDING_WINDOWS[1].tEnd);
    updateParticles(landingParticles[0], landWinProg0);
    updateParticles(landingParticles[1], landWinProg1);
  }

  return { group, update };
}

// ---------------------------------------------------------------------------
// buildSteam
// ---------------------------------------------------------------------------

export interface SteamFx {
  group: THREE.Group;
  updateAmbient(sec: number): void;
}

/**
 * Steam columns for steam vents + ramen shops.
 * Each anchor gets STEAM_SPRITES_PER_ANCHOR additive soft-circle sprites that
 * loop continuously. updateAmbient(sec) is wall-clock (not scrub-driven).
 */
export function buildSteam(anchors: THREE.Object3D[]): SteamFx {
  const STEAM_SPRITES_PER_ANCHOR = 6;

  const group = new THREE.Group();
  group.name = 'steamFx';

  const rng = makeRng(0x24_5737);

  // Shared steam texture (very soft white)
  const steamTex = softCircleTex('rgb(220,230,240)', 0.9);

  interface SteamSprite {
    sprite: THREE.Sprite;
    /** Phase offset so sprites don't all start at the same position. */
    phaseOffset: number;
    /** Loop period in seconds. */
    period: number;
    /** Max scale when fully grown. */
    maxScale: number;
    /** Horizontal drift (deterministic). */
    drift: THREE.Vector3;
    /** Anchor this sprite belongs to. */
    anchor: THREE.Object3D;
    /** Max rise height above anchor. */
    riseHeight: number;
  }

  const sprites: SteamSprite[] = [];
  const tmpPos = new THREE.Vector3();

  for (const anchor of anchors) {
    for (let i = 0; i < STEAM_SPRITES_PER_ANCHOR; i++) {
      const mat = additiveSpritemat(steamTex, 0);
      const sprite = new THREE.Sprite(mat);
      sprite.name = 'steam';

      const phaseOffset = (i / STEAM_SPRITES_PER_ANCHOR) + rng.range(-0.1, 0.1);
      const period = rng.range(2.5, 4.5);
      const maxScale = rng.range(0.6, 1.4);
      const riseHeight = rng.range(2.0, 4.5);
      const driftX = rng.range(-0.3, 0.3);
      const driftZ = rng.range(-0.3, 0.3);

      sprites.push({
        sprite,
        phaseOffset,
        period,
        maxScale,
        drift: new THREE.Vector3(driftX, 0, driftZ),
        anchor,
        riseHeight
      });
      group.add(sprite);
    }
  }

  function updateAmbient(sec: number): void {
    for (const s of sprites) {
      // Get anchor world position
      s.anchor.getWorldPosition(tmpPos);

      // Loop phase ∈ [0, 1) across the period
      const phase = ((sec / s.period) + s.phaseOffset) % 1;

      // Opacity: ramp up 0→0.2, hold, fade 0.6→1
      const opacity = phase < 0.2
        ? phase / 0.2
        : phase > 0.6
          ? 1 - (phase - 0.6) / 0.4
          : 1;

      // Rise: linear with phase
      const y = phase * s.riseHeight;

      // Horizontal drift: small sinusoidal wander
      const xDrift = s.drift.x * Math.sin(phase * Math.PI * 2);
      const zDrift = s.drift.z * Math.cos(phase * Math.PI * 2);

      s.sprite.position.set(tmpPos.x + xDrift, tmpPos.y + y, tmpPos.z + zDrift);
      (s.sprite.material as THREE.SpriteMaterial).opacity = opacity * 0.55;

      // Scale: grow as it rises
      const scale = s.maxScale * (0.3 + phase * 0.7);
      s.sprite.scale.setScalar(scale);
    }
  }

  return { group, updateAmbient };
}
