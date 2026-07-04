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

function buildMoon(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'moon';

  const moonHex = '#' + COLORS.moonlight.toString(16).padStart(6, '0');
  const craterTex = makeCanvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = moonHex;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 46; i++) {
      const cr = rng.range(4, 20);
      const cx = rng.range(0, 256);
      const cy = rng.range(0, 256);
      const shade = rng.range(0.06, 0.22);
      ctx.fillStyle = `rgba(25,22,30,${shade})`;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 48, 32),
    new THREE.MeshBasicMaterial({ map: craterTex, color: 0xffffff, fog: false })
  );
  sphere.position.copy(MOON_POS);
  sphere.frustumCulled = false;
  group.add(sphere);

  // Calibration fix: the moon itself is allowed to stay a bright "money shot," but its
  // additive glow sprite was wide/strong enough that UnrealBloomPass (screen-space,
  // owned by core.ts — not tunable here) smeared it across the entire lower frame,
  // washing the ocean into a grey sheet instead of leaving it dark around a narrow
  // glitter streak. Shrinking + dimming the glow source starves that bloom bleed at
  // the source without touching bloom itself or the moon's own core brightness.
  const glowTex = makeRadialGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: COLORS.moonlight,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  });
  const glow = new THREE.Sprite(glowMat);
  glow.position.copy(MOON_POS);
  const glowDiameter = MOON_RADIUS * 1.35 * 2;
  glow.scale.set(glowDiameter, glowDiameter, 1);
  group.add(glow);

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

export function buildFarField(rng: Rng): { group: THREE.Group; updateAmbient: (sec: number) => void } {
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
  const farBuildings = generateBuildings(rng, FAR_SKYLINE_COUNT, FAR_SKYLINE_INNER_R, FAR_SKYLINE_OUTER_R);
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
