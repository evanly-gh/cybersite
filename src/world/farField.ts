import * as THREE from 'three';
import { COLORS } from '../theme';
import type { Rng } from '../utils/rng';
import { makeCanvasTexture } from '../utils/canvasText';
import { MOON_POS, MOON_RADIUS } from './route';
import { FOG_DENSITY } from '../core/core';

/**
 * Task 8: the far-field backdrop — Ring 2 skyline, sky dome, rising moon, and ocean.
 * This is what makes the city read as endless beyond the streets Task 7 built, and it's
 * the layer the finale's bridge run rides straight into (the moon sits dead ahead down
 * the ocean-sector wedge). Everything here is authored in absolute world coordinates
 * (matching route.ts / WAYPOINTS) rather than relative to a local origin — there is no
 * "small prop" to center a turntable camera on.
 */

// ---------------------------------------------------------------------------------
// Tunables (verbatim from the task brief)
// ---------------------------------------------------------------------------------

export const CITY_CENTER = new THREE.Vector3(0, 0, -200);
export const SKYLINE_INNER_R = 250;
export const SKYLINE_OUTER_R = 1600;
export const SKYLINE_COUNT = 1100;
export const BEACON_COUNT = 20;
export const STAR_COUNT = 400;
export const SKY_RADIUS = 3200;
export const OCEAN_Z = -830; // ocean sector starts here (world z), matches the wedge exclusion
export const WEDGE_HALF_DEG = 35; // 70 deg wedge, centered on -Z from CITY_CENTER

// Round-2 iteration: a second, sparser, dimmer skyline ring further out (~1800m) so the
// city doesn't have a hard, visibly-circular edge at 1600m — it just keeps fading into
// the fog like a real endless skyline would.
export const FAR_SKYLINE_INNER_R = 1650;
export const FAR_SKYLINE_OUTER_R = 2000;
export const FAR_SKYLINE_COUNT = 450;
const FAR_SKYLINE_DIM = 0.45;

const WINDOW_PITCH = 3.4; // meters per window cell, both axes

// ---------------------------------------------------------------------------------
// Skyline instance data
// ---------------------------------------------------------------------------------

interface BuildingData {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotY: number;
  seed: number;
}

/** True if (x,z) falls in the 70deg -Z wedge AND is beyond the ocean's start line — the
 * region reserved for open water / sightline to the moon. Land nearer than OCEAN_Z in
 * that same compass direction (waterfront blocks) is still buildable. */
function inOceanWedge(x: number, z: number): boolean {
  if (z >= OCEAN_Z) return false;
  const dx = x - CITY_CENTER.x;
  const dz = z - CITY_CENTER.z;
  const angle = Math.atan2(dx, -dz); // 0 == due -Z from city center
  return Math.abs(angle) < THREE.MathUtils.degToRad(WEDGE_HALF_DEG);
}

/** Area-uniform point in the [innerR, outerR] annulus around CITY_CENTER. */
function sampleAnnulusPoint(rng: Rng, innerR: number, outerR: number): { x: number; z: number } {
  const rMin2 = innerR * innerR;
  const rMax2 = outerR * outerR;
  const r = Math.sqrt(rng.range(rMin2, rMax2));
  const theta = rng.range(0, Math.PI * 2);
  return {
    x: CITY_CENTER.x + r * Math.sin(theta),
    z: CITY_CENTER.z - r * Math.cos(theta)
  };
}

/**
 * Generates `count` building placements via rejection sampling (redraw whenever a
 * candidate lands in the ocean wedge — that's ~19% of the annulus's area, so this
 * converges in a small multiple of `count` draws). Heights are lognormal-ish
 * (12 + rng()^2 * 170), footprints 14-60m with 30% elongated up to 1:3, and a
 * 90-degree-snapped yaw with +/-6deg jitter so the skyline reads as gridded blocks,
 * not scattered debris. `innerR`/`outerR` let a second, farther/dimmer ring (Round-2
 * iteration: depth cue beyond the primary 250-1600m skyline) reuse the same generator.
 */
function generateBuildings(rng: Rng, count: number, innerR = SKYLINE_INNER_R, outerR = SKYLINE_OUTER_R): BuildingData[] {
  const buildings: BuildingData[] = [];
  let guard = 0;
  const guardLimit = count * 20;

  while (buildings.length < count && guard < guardLimit) {
    guard++;
    const { x, z } = sampleAnnulusPoint(rng, innerR, outerR);
    if (inOceanWedge(x, z)) continue;

    const height = 12 + rng() * rng() * 170;

    let width: number;
    let depth: number;
    if (rng.chance(0.3)) {
      const short = rng.range(14, 30);
      const aspect = rng.range(1.5, 3);
      const long = Math.min(60, short * aspect);
      if (rng.chance(0.5)) {
        width = long;
        depth = short;
      } else {
        width = short;
        depth = long;
      }
    } else {
      width = rng.range(14, 60);
      depth = THREE.MathUtils.clamp(width * rng.range(0.85, 1.15), 14, 60);
    }

    const snap = rng.int(0, 3) * (Math.PI / 2);
    const jitter = THREE.MathUtils.degToRad(rng.range(-6, 6));

    buildings.push({ x, z, width, depth, height, rotY: snap + jitter, seed: rng() });
  }

  return buildings;
}

// ---------------------------------------------------------------------------------
// Skyline shader material
// ---------------------------------------------------------------------------------

const SKYLINE_VERTEX = /* glsl */ `
  attribute vec3 aSize;
  attribute float aSeed;

  varying vec3 vLocalNormal;
  varying vec2 vUvW;
  varying vec3 vSize;
  varying float vSeed;
  varying float vFogDepth;

  void main() {
    vLocalNormal = normal;
    vUvW = uv;
    vSize = aSize;
    vSeed = aSeed;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SKYLINE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uAmber;
  uniform vec3 uTeal;
  uniform vec3 uMagenta;
  uniform vec3 uBody;
  uniform float uDim;

  varying vec3 vLocalNormal;
  varying vec2 vUvW;
  varying vec3 vSize;
  varying float vSeed;
  varying float vFogDepth;

  // Deterministic hash: cell coords + per-instance seed (drawn from the app's seeded
  // Rng in JS) -> pseudo-random float. No extra entropy source, so identical Rng seeds
  // always produce identical window patterns.
  float hash(vec2 p, float seed) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seed * 7.13);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec3 n = abs(vLocalNormal);
    float isSide = step(n.y, 0.5);

    // Box faces facing +-X span (depth, height); faces facing +-Z span (width, height).
    float useX = step(n.z, n.x);
    float faceWidth = mix(vSize.x, vSize.z, useX);
    float faceHeight = vSize.y;

    float cols = max(1.0, floor(faceWidth / ${WINDOW_PITCH.toFixed(1)}));
    float rows = max(1.0, floor(faceHeight / ${WINDOW_PITCH.toFixed(1)}));

    vec2 grid = vUvW * vec2(cols, rows);
    vec2 cell = floor(grid);
    vec2 cellUv = fract(grid);

    float hLit = hash(cell, vSeed);
    float hColor = hash(cell + vec2(17.0, 5.0), vSeed);
    float hFlicker = hash(cell + vec2(91.0, 41.0), vSeed);
    float hPeak = hash(cell + vec2(53.0, 29.0), vSeed);

    float lit = step(hLit, 0.55);

    vec3 winColor = mix(uAmber, uTeal, step(0.4, hColor));
    winColor = mix(winColor, uMagenta, step(0.75, hColor));

    // Calibration: night-mood windows are punctuation, not wallpaper. Most lit windows
    // sit at a low, clearly-colored glow (won't cross the bloom threshold); only ~5%
    // of windows pop to a bloom-eligible peak — that's what should read as bright dots
    // scattered across an otherwise dark facade.
    float peak = step(0.95, hPeak);
    float level = mix(0.32, 1.6, peak);

    float flickerMask = step(0.98, hFlicker);
    float flickerWave = sin(uTime * (2.5 + hFlicker * 7.0) + hFlicker * 41.0) * 0.5 + 0.5;
    float brightness = lit * level * mix(1.0, mix(0.1, 1.0, flickerWave), flickerMask);

    float margin = 0.16;
    float windowMask = step(margin, cellUv.x) * step(margin, cellUv.y) *
                        step(cellUv.x, 1.0 - margin) * step(cellUv.y, 1.0 - margin);

    float winVisible = lit * windowMask * isSide;
    vec3 winEmissive = winColor * brightness * uDim;

    vec3 body = uBody * (0.65 + 0.35 * cellUv.y);
    vec3 result = mix(body, winEmissive, winVisible);

    // Manual FogExp2 replica (core.ts owns scene.fog; a from-scratch ShaderMaterial can't
    // pull in the fog_fragment chunk, so match its math here) with lit windows punching
    // through more than the dark body — real-world night skylines read as scattered
    // glints against haze, not silhouettes. uDim (< 1 for the Round-2 far/dim second
    // layer at ~1800m) also weakens the punch-through so that layer reads as a fainter,
    // more fog-buried silhouette behind the primary skyline.
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    float effectiveFog = fogFactor * (1.0 - winVisible * 0.85 * uDim);
    result = mix(result, uFogColor, clamp(effectiveFog, 0.0, 1.0));

    gl_FragColor = vec4(result, 1.0);
  }
`;

function buildSkylineMaterial(dim: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(COLORS.void) },
      uFogDensity: { value: FOG_DENSITY },
      uAmber: { value: new THREE.Color(COLORS.sodiumAmber) },
      uTeal: { value: new THREE.Color(COLORS.holoTeal) },
      uMagenta: { value: new THREE.Color(COLORS.signalMagenta) },
      uBody: { value: new THREE.Color(COLORS.towerBody) },
      uDim: { value: dim }
    },
    vertexShader: SKYLINE_VERTEX,
    fragmentShader: SKYLINE_FRAGMENT,
    fog: false
  });
}

function buildSkylineMesh(
  buildings: BuildingData[],
  dim = 1
): { mesh: THREE.InstancedMesh; tallestIdx: number[] } {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = buildSkylineMaterial(dim);

  const mesh = new THREE.InstancedMesh(geometry, material, buildings.length);
  mesh.name = dim >= 1 ? 'skyline' : 'skylineFar';
  // Instance placements span the full annulus while the underlying geometry is a unit
  // box at the origin — the mesh's own (tiny) bounding sphere would get every instance
  // frustum-culled at once. Disable culling for this mesh entirely.
  mesh.frustumCulled = false;

  const aSize = new Float32Array(buildings.length * 3);
  const aSeed = new Float32Array(buildings.length);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();

  buildings.forEach((b, i) => {
    scale.set(b.width, b.height, b.depth);
    euler.set(0, b.rotY, 0);
    q.setFromEuler(euler);
    pos.set(b.x, b.height / 2, b.z);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(i, m);

    aSize[i * 3 + 0] = b.width;
    aSize[i * 3 + 1] = b.height;
    aSize[i * 3 + 2] = b.depth;
    aSeed[i] = b.seed;
  });

  mesh.instanceMatrix.needsUpdate = true;
  geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));

  const tallestIdx = buildings
    .map((b, i) => ({ i, h: b.height }))
    .sort((a, b) => b.h - a.h)
    .slice(0, BEACON_COUNT)
    .map((e) => e.i);

  return { mesh, tallestIdx };
}

// ---------------------------------------------------------------------------------
// Rooftop beacons (aircraft warning lights) on the 20 tallest towers
// ---------------------------------------------------------------------------------

interface Beacon {
  sprite: THREE.Sprite;
  phase: number;
}

function makeRadialGlowTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(128, 128, (ctx) => {
    // Calibration fix: steeper falloff than the original (0.35 stop at 0.18 opacity)
    // so glow sources (moon halo, rooftop beacons) read as a tight bright core with a
    // quick taper instead of a broad soft wash that bloom then smears even further.
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.1, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

function buildBeacons(
  buildings: BuildingData[],
  tallestIdx: number[],
  rng: Rng,
  glowTex: THREE.Texture
): { group: THREE.Group; beacons: Beacon[] } {
  const group = new THREE.Group();
  group.name = 'beacons';
  const beacons: Beacon[] = [];

  for (const i of tallestIdx) {
    const b = buildings[i];
    const mat = new THREE.SpriteMaterial({
      map: glowTex,
      color: COLORS.sodiumAmber,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(b.x, b.height + 3, b.z);
    sprite.scale.set(11, 11, 1);
    group.add(sprite);
    beacons.push({ sprite, phase: rng.range(0, Math.PI * 2) });
  }

  return { group, beacons };
}

// ---------------------------------------------------------------------------------
// Sky dome + stars
// ---------------------------------------------------------------------------------

function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uVoid: { value: new THREE.Color(COLORS.void) },
      uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
      // Calibration fix: an amber haze here read as warm daylight fog, violating the
      // night-mood brief ("kill the amber horizon glow"). A real light-polluted night
      // sky stains blue-violet, not amber, once you're this far from the source — swap
      // hue and cut the amplitude so it's a subtle tint, not a wash.
      uHaze: { value: new THREE.Color(COLORS.nightHaze) }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uVoid;
      uniform vec3 uHorizon;
      uniform vec3 uHaze;
      varying vec3 vDir;
      void main() {
        float t = clamp(abs(vDir.y) / 0.5, 0.0, 1.0);
        vec3 color = mix(uHorizon, uVoid, t);

        // Tight exponential band around the horizon (vDir.y == 0), biased to sit mostly
        // at/above the skyline rather than washing the whole lower sky. Kept subtle —
        // this is a faint light-pollution tint, not a glow.
        float haze = exp(-abs(vDir.y) * 14.0) * 0.10;
        color += uHaze * haze;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  return mesh;
}

function buildStars(rng: Rng, count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const minY = Math.sin(THREE.MathUtils.degToRad(15));
  const r = SKY_RADIUS * 0.98;

  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let tries = 0;
    do {
      const u = rng.range(-1, 1);
      const theta = rng.range(0, Math.PI * 2);
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      x = s * Math.cos(theta);
      y = u;
      z = s * Math.sin(theta);
      tries++;
    } while (y < minY && tries < 50);
    y = Math.max(y, minY);

    positions[i * 3 + 0] = x * r;
    positions[i * 3 + 1] = y * r;
    positions[i * 3 + 2] = z * r;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 3.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'stars';
  points.frustumCulled = false;
  return points;
}

// ---------------------------------------------------------------------------------
// Moon
// ---------------------------------------------------------------------------------

/**
 * Paints a realistic full-moon surface onto a 1024×1024 canvas.
 * Hand-authored maria placement approximates a real full moon view:
 *   - Oceanus Procellarum (left), Mare Imbrium (upper-left),
 *   - Mare Serenitatis (upper-center), Mare Tranquillitatis (center-right),
 *   - Mare Crisium (right edge).
 * Large and small craters use the seeded rng for repeatable placement.
 */
function makeMoonColorTexture(rng: Rng): THREE.CanvasTexture {
  const SIZE = 1024;
  return makeCanvasTexture(SIZE, SIZE, (ctx) => {
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    // --- Highland base ---
    ctx.fillStyle = '#f5f0e6';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // --- Maria (dark seas) — hand-authored positions ---
    // Each entry: [centerX, centerY, radiusX, radiusY, opacity]
    const maria: [number, number, number, number, number][] = [
      // Oceanus Procellarum — large, left side
      [310, 500, 210, 240, 0.22],
      // Mare Imbrium — upper-left
      [390, 330, 155, 140, 0.20],
      // Mare Serenitatis — upper-center-right
      [580, 360, 100, 95, 0.18],
      // Mare Tranquillitatis — center-right
      [610, 490, 110, 90, 0.19],
      // Mare Crisium — far right, smallish
      [760, 370, 58, 50, 0.16],
      // Mare Nubium — lower-left
      [430, 640, 90, 70, 0.15],
    ];

    for (const [mx, my, rx, ry, alpha] of maria) {
      const grd = ctx.createRadialGradient(mx, my, 0, mx, my, Math.max(rx, ry));
      grd.addColorStop(0, `rgba(60,55,45,${alpha})`);
      grd.addColorStop(0.65, `rgba(55,50,40,${(alpha * 0.6).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(60,55,45,0)');
      ctx.save();
      ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      ctx.beginPath();
      ctx.arc(
        mx / (rx / Math.max(rx, ry)),
        my / (ry / Math.max(rx, ry)),
        Math.max(rx, ry) * 1.1,
        0, Math.PI * 2
      );
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.restore();
    }

    // --- Large craters (15) with rim highlights and ejecta rays for biggest ---
    const largeCraters: [number, number, number][] = [];
    for (let i = 0; i < 15; i++) {
      const r = rng.range(20, 60);
      const px = rng.range(r + 20, SIZE - r - 20);
      const py = rng.range(r + 20, SIZE - r - 20);
      largeCraters.push([px, py, r]);

      // Dark interior fill
      const alpha = rng.range(0.08, 0.15);
      const grd = ctx.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, `rgba(40,35,30,${alpha})`);
      grd.addColorStop(0.8, `rgba(35,30,25,${(alpha * 0.6).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(40,35,30,0)');
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Bright rim highlight on upper-left edge
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, r * 0.98, Math.PI * 1.0, Math.PI * 1.8);
      ctx.strokeStyle = `rgba(240,235,220,${rng.range(0.18, 0.32).toFixed(3)})`;
      ctx.lineWidth = rng.range(1.5, 3.5);
      ctx.stroke();
      ctx.restore();
    }

    // Ejecta rays on the 4 largest craters (Tycho-style)
    const biggest = largeCraters.slice().sort((a, b) => b[2] - a[2]).slice(0, 4);
    for (const [px, py, r] of biggest) {
      const rayCount = Math.floor(rng.range(8, 16));
      for (let j = 0; j < rayCount; j++) {
        const angle = rng.range(0, Math.PI * 2);
        const len = r * rng.range(2.0, 3.2);
        ctx.save();
        ctx.globalAlpha = rng.range(0.04, 0.08);
        ctx.strokeStyle = 'rgba(255,250,235,1)';
        ctx.lineWidth = rng.range(0.8, 2.2);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(angle) * len, py + Math.sin(angle) * len);
        ctx.stroke();
        ctx.restore();
      }
    }

    // --- Small craters (70) ---
    for (let i = 0; i < 70; i++) {
      const r = rng.range(3, 12);
      const px = rng.range(r + 5, SIZE - r - 5);
      const py = rng.range(r + 5, SIZE - r - 5);
      const alpha = rng.range(0.05, 0.14);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(50,45,35,${alpha})`;
      ctx.fill();
      // Bright pixel on upper-left rim
      ctx.beginPath();
      ctx.arc(px - r * 0.35, py - r * 0.35, Math.max(1, r * 0.15), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,252,240,${rng.range(0.25, 0.5).toFixed(3)})`;
      ctx.fill();
    }

    // --- Limb darkening overlay ---
    // Radial gradient centered on canvas: transparent at center → dark at edges
    const moonDiscR = SIZE * 0.49; // clip moon to disc radius
    const limbGrd = ctx.createRadialGradient(cx, cy, moonDiscR * 0.55, cx, cy, moonDiscR);
    limbGrd.addColorStop(0, 'rgba(15,12,8,0)');
    limbGrd.addColorStop(1, 'rgba(15,12,8,0.25)');
    ctx.beginPath();
    ctx.arc(cx, cy, moonDiscR, 0, Math.PI * 2);
    ctx.fillStyle = limbGrd;
    ctx.fill();

    // Clip to disc (black outside sphere boundary, avoids square seams)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(cx, cy, moonDiscR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill();
    ctx.restore();
  });
}

/**
 * Grayscale bump/heightfield map (512×512):
 * brighter = higher, darker = lower/depression.
 * Maria dips are slightly darker; crater rims are lighter; floors darker.
 */
function makeMoonBumpTexture(rng: Rng): THREE.CanvasTexture {
  const SIZE = 512;
  return makeCanvasTexture(SIZE, SIZE, (ctx) => {
    // Neutral mid-grey highland base
    ctx.fillStyle = '#888880';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const scale = SIZE / 1024; // coordinate scale from color texture space

    // Maria depressions (darker = lower elevation)
    const maria: [number, number, number, number][] = [
      [310 * scale, 500 * scale, 210 * scale, 220 * scale],
      [390 * scale, 330 * scale, 155 * scale, 130 * scale],
      [580 * scale, 360 * scale, 100 * scale, 88 * scale],
      [610 * scale, 490 * scale, 110 * scale, 82 * scale],
      [760 * scale, 370 * scale, 58 * scale, 46 * scale],
      [430 * scale, 640 * scale, 90 * scale, 64 * scale],
    ];
    for (const [mx, my, rx, ry] of maria) {
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, Math.max(rx, ry));
      g.addColorStop(0, 'rgba(90,88,80,0.5)');
      g.addColorStop(0.7, 'rgba(110,108,100,0.3)');
      g.addColorStop(1, 'rgba(136,136,128,0)');
      ctx.save();
      ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      ctx.beginPath();
      ctx.arc(mx / (rx / Math.max(rx, ry)), my / (ry / Math.max(rx, ry)), Math.max(rx, ry) * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }

    // Large crater depressions + bright rims
    for (let i = 0; i < 15; i++) {
      const r = rng.range(10, 30) * scale;
      const px = rng.range(r + 10, SIZE - r - 10);
      const py = rng.range(r + 10, SIZE - r - 10);
      // Dark floor
      ctx.beginPath();
      ctx.arc(px, py, r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,58,55,0.55)';
      ctx.fill();
      // Bright rim ring
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200,200,190,0.45)';
      ctx.lineWidth = r * 0.28;
      ctx.stroke();
    }

    // Small crater dots
    for (let i = 0; i < 70; i++) {
      const r = rng.range(1.5, 6) * scale;
      const px = rng.range(r + 2, SIZE - r - 2);
      const py = rng.range(r + 2, SIZE - r - 2);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,78,72,0.35)';
      ctx.fill();
    }
  });
}

function buildMoon(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'moon';

  // --- High-resolution surface texture (1024px) ---
  const moonTexture = makeMoonColorTexture(rng);

  // --- Bump map (512px) for surface relief ---
  // Fork the rng state by using a fresh stream of calls — both texture functions draw
  // from the same seeded rng sequentially, producing deterministic results each run.
  const bumpTexture = makeMoonBumpTexture(rng);

  // --- Main sphere with MeshStandardMaterial ---
  // emissiveIntensity 0.45 gives visible self-luminosity (readable at t=0.19 distant view)
  // without blowing out bloom at the close finale shot (t=0.85, ~900m away).
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 48, 32),
    new THREE.MeshStandardMaterial({
      map: moonTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.8,
      roughness: 0.92,
      metalness: 0.0,
      emissive: new THREE.Color(COLORS.moonlight),
      emissiveIntensity: 0.45,
      fog: false,
    })
  );
  sphere.position.copy(MOON_POS);
  sphere.frustumCulled = false;
  group.add(sphere);

  // --- Fresnel rim effect: slightly larger back-face sphere with additive blend ---
  // Creates a subtle bright halo around the moon's silhouette edge.
  const rimSphere = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS * 1.008, 48, 32),
    new THREE.MeshBasicMaterial({
      color: COLORS.moonlight,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  );
  rimSphere.position.copy(MOON_POS);
  rimSphere.frustumCulled = false;
  group.add(rimSphere);

  // --- Dual-layer glow sprites ---
  const glowTex = makeRadialGlowTexture();

  // Inner glow: tight halo just beyond the disc
  const innerGlowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: COLORS.moonlight,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const innerGlow = new THREE.Sprite(innerGlowMat);
  innerGlow.position.copy(MOON_POS);
  const innerGlowDiameter = MOON_RADIUS * 1.15 * 2;
  innerGlow.scale.set(innerGlowDiameter, innerGlowDiameter, 1);
  group.add(innerGlow);

  // Outer glow: wide, very dim atmospheric scatter
  const outerGlowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: COLORS.moonlight,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const outerGlow = new THREE.Sprite(outerGlowMat);
  outerGlow.position.copy(MOON_POS);
  const outerGlowDiameter = MOON_RADIUS * 1.7 * 2;
  outerGlow.scale.set(outerGlowDiameter, outerGlowDiameter, 1);
  group.add(outerGlow);

  return group;
}

// ---------------------------------------------------------------------------------
// Ocean + moon-glitter streak
// ---------------------------------------------------------------------------------

const OCEAN_WIDTH = 4000;
const OCEAN_DEPTH = 2400;
const OCEAN_Y = -0.5;

function buildOcean(): THREE.Mesh {
  const centerZ = OCEAN_Z - OCEAN_DEPTH / 2;
  const geo = new THREE.PlaneGeometry(OCEAN_WIDTH, OCEAN_DEPTH, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const oceanColor = new THREE.Color(COLORS.void).lerp(new THREE.Color(COLORS.shadowBlue), 0.1);
  const mat = new THREE.MeshPhysicalMaterial({
    color: oceanColor,
    roughness: 0.08,
    metalness: 0,
    // Calibration fix: even at 0.2, specularIntensity let the viewer harness's bright
    // directional key light turn this huge plane into a wide, blown-out mirror sheen —
    // full-surface shine instead of a narrow moon-glitter streak. The night-mood brief
    // wants the ocean itself near-black, with the *only* highlight being the dedicated
    // glitter-streak mesh drawn on top. Killing specularIntensity removes the
    // dielectric Fresnel highlight entirely (still leaves roughness at the brief's
    // mandated 0.08, just with nothing to specularly reflect) while the ambient/hemi
    // light still gives it a faint diffuse presence rather than pure flat black.
    specularIntensity: 0,
    specularColor: oceanColor
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, OCEAN_Y, centerZ);
  mesh.name = 'ocean';
  return mesh;
}

const GLITTER_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLITTER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 p = vec2(vUv.x * 6.0, vUv.y * 44.0 - uTime * 1.6);
    float streak = noise(p) * noise(p * 2.3 + 11.0);
    // Calibration fix: steeper center-weighted falloff (was 1.6) so the streak reads as
    // a narrow bright thread down its own centerline rather than a solid glowing band
    // edge-to-edge across its already-generous near width.
    float edge = pow(1.0 - abs(vUv.x * 2.0 - 1.0), 4.0);
    float alpha = streak * edge;
    gl_FragColor = vec4(uColor, alpha * 0.8);
  }
`;

/** Triangular glitter strip: wide near the bridge, tapering toward the moon on the horizon. */
function buildGlitter(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const xCenter = MOON_POS.x;
  const zNear = OCEAN_Z - 30;
  const zFar = MOON_POS.z;
  // Calibration fix: at the brief's bridge-eye cam (6m above the water, only ~40m from
  // this mesh's near edge) the original 90m near-width was *wider than the camera's
  // entire frustum* at that distance — it wasn't reading as a streak at all, it was
  // filling the whole screen width and reading as a full-surface sheen. Narrowed so it
  // stays a clearly-bounded bright thread even from a low, close-up vantage.
  const widthNear = 22;
  const widthFar = 6;
  const y = OCEAN_Y + 0.02;

  const positions = new Float32Array([
    xCenter - widthNear / 2, y, zNear,
    xCenter + widthNear / 2, y, zNear,
    xCenter + widthFar / 2, y, zFar,
    xCenter - widthFar / 2, y, zFar
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = [0, 1, 2, 0, 2, 3];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(COLORS.moonlight) }
    },
    vertexShader: GLITTER_VERTEX,
    fragmentShader: GLITTER_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'moonGlitter';
  return { mesh, material };
}

// ---------------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------------

const BEACON_PERIOD_SEC = 2.4;
const BEACON_DUTY = 0.18;

export function buildFarField(rng: Rng, density = 1): { group: THREE.Group; updateAmbient: (sec: number) => void } {
  const group = new THREE.Group();
  group.name = 'farField';

  const sky = buildSky();
  group.add(sky);

  const stars = buildStars(rng, STAR_COUNT);
  group.add(stars);

  const buildings = generateBuildings(rng, SKYLINE_COUNT);
  const { mesh: skylineMesh, tallestIdx } = buildSkylineMesh(buildings);
  group.add(skylineMesh);

  // Round-2 iteration: dimmer, sparser second ring at ~1650-2000m so the primary
  // skyline's 1600m cutoff doesn't read as a hard, suspiciously circular city edge.
  // On mobile (density < 1), halve the far Ring 2 instance count to save GPU.
  const farCount = Math.floor(FAR_SKYLINE_COUNT * density);
  const farBuildings = generateBuildings(rng, farCount, FAR_SKYLINE_INNER_R, FAR_SKYLINE_OUTER_R);
  const { mesh: farSkylineMesh } = buildSkylineMesh(farBuildings, FAR_SKYLINE_DIM);
  group.add(farSkylineMesh);

  const glowTex = makeRadialGlowTexture();
  const { group: beaconGroup, beacons } = buildBeacons(buildings, tallestIdx, rng, glowTex);
  group.add(beaconGroup);

  const moon = buildMoon(rng);
  group.add(moon);

  const ocean = buildOcean();
  group.add(ocean);

  const { mesh: glitterMesh, material: glitterMat } = buildGlitter();
  group.add(glitterMesh);

  const skylineMat = skylineMesh.material as THREE.ShaderMaterial;
  const farSkylineMat = farSkylineMesh.material as THREE.ShaderMaterial;

  function updateAmbient(sec: number): void {
    skylineMat.uniforms.uTime.value = sec;
    farSkylineMat.uniforms.uTime.value = sec;
    glitterMat.uniforms.uTime.value = sec;

    for (const beacon of beacons) {
      const cyclePos = ((sec + beacon.phase) % BEACON_PERIOD_SEC) / BEACON_PERIOD_SEC;
      let pulse = 0;
      if (cyclePos < BEACON_DUTY) {
        const rise = THREE.MathUtils.smoothstep(cyclePos, 0, BEACON_DUTY * 0.35);
        const fall = 1 - THREE.MathUtils.smoothstep(cyclePos, BEACON_DUTY * 0.65, BEACON_DUTY);
        pulse = rise * fall;
      }
      (beacon.sprite.material as THREE.SpriteMaterial).opacity = 0.08 + 0.92 * pulse;
    }
  }
  updateAmbient(0);

  return { group, updateAmbient };
}
