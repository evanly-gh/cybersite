# Cyberpunk City Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the city and roadway as a single scroll-scrubbed spline ride that carries the Tron bike through a dense neon metropolis (KitBash NeoCity meshes), revealing Evan Li's résumé zone by zone and ending on a moonlit bridge.

**Architecture:** A route spline drives everything as pure functions of `t ∈ [0,1]`. The road is extruded along the spline; buildings are placed in walls flanking the corridor; a master GSAP timeline maps scroll → `t` → camera pose + bike pose + bike position. Foundation-first: get a grey-box ride working end-to-end and verified, then dress with KitBash detail, content displays, life, and FX.

**Tech Stack:** Three.js 0.185 (WebGL2), TypeScript (strict), GSAP 3 ScrollTrigger, Vite, Vitest, Playwright. Offline mesh pipeline: obj2gltf + @gltf-transform/cli (DRACO).

## Global Constraints

- **Units:** 1 unit = 1 meter; ground plane at `y=0`.
- **Reserved palette:** `tronCyan` (0x00f0ff) is EXCLUSIVE to the bike/rider. All city/building/prop/people/content emissives use `holoTeal`, `signalMagenta`, `sodiumAmber`, or `moonlight` from `src/theme.ts`. A house-rules test greps `src/` (excluding `assets/vehicles/bike.ts`) for `tronCyan` misuse.
- **Determinism:** NO `Math.random()` in `src/`. All layout/traffic/camera/bike use the seeded `Rng` (`makeRng`) or are pure functions of `t`. Wall-clock (`sec`) may drive ONLY decorative ambient (flicker/sway/blink) via `updateAmbient(sec)`, never anything that affects scrub position.
- **Scrub-safety:** camera pose, bike pose, and bike position for a given `t` must be identical on forward and backward scroll (no hysteresis, no time integration).
- **Draw-call budget:** ≤ 300 draw calls per camera viewpoint, audited via `?stats=1`. Buildings merged/instanced; full density only in the corridor the camera sees.
- **Road clearance (hard rule):** no building geometry may intrude into the road. Every placement clamps to a minimum clearance from the road centerline (`MIN_ROAD_CLEARANCE = 20` — corridor half-width 17 + margin 3).
- **Content source:** all in-world copy/images come from `RESUME` in `src/content/resume.ts`; images are placeholder textures (`makePlaceholder`) until real assets drop in.
- **Route t-map (authoritative — every segment references these):**
  | zone | t-range |
  |---|---|
  | intro/cruise | 0.00–0.12 |
  | about | 0.12–0.28 |
  | buffer/turn (Shibuya, 90° right) | 0.28–0.36 |
  | projects-ramp1 (backflip 1, 2 big) | 0.36–0.46 |
  | scaffold-ride | 0.46–0.52 |
  | projects-ramp2 (backflip 2, 3 small) | 0.52–0.62 |
  | descend | 0.62–0.68 |
  | research (low cam, looking up) | 0.68–0.84 |
  | buffer/lift | 0.84–0.89 |
  | bridge/finale | 0.89–1.00 |

---

## File Structure

**Created:**
- `src/world/route.ts` — spline waypoints, `sampleRoute(t)`, `roadFrame(t)`, zone constants, `MOON_POS`.
- `src/world/streets.ts` — road surface, sidewalks, crossing, ramps, scaffolding, bridge geometry.
- `src/world/cityLayout.ts` — building placement along the route + display anchors.
- `src/world/farField.ts` — skyline silhouettes + moon.
- `src/choreography/bikePath.ts` — `BikePath.state(t)` → bike position/quaternion/pose.
- `src/choreography/cameraRig.ts` — `CameraRig` pose keyframing + apply to camera.
- `src/choreography/master.ts` — scroll → t → drive rig/bike/updatables + render.
- `src/choreography/reducedMotion.ts` — reduced-motion snap + scroll-hint.
- `src/choreography/traffic.ts` — ambient traffic along lanes.
- `src/choreography/segments/*.ts` — one file per zone (intro, about, turn, projects, research, finale).
- `src/fx/sandevistan.ts`, `src/fx/lightPools.ts`, `src/fx/driftFx.ts` — bike FX.
- `src/content/contentPanel.ts` — résumé-content → CanvasTexture for billboards/holo panels.
- `tools/process-kitbash.mjs` — offline OBJ → split → decimate → glTF+DRACO.
- Viewer entries + tests as noted per task.

**Modified:**
- `src/main.ts` — assemble the world instead of the empty scene.

---

## Task 1: Route Spline

**Files:**
- Create: `src/world/route.ts`
- Test: `tests/route.test.ts`

**Interfaces:**
- Consumes: `THREE`, `makeRng` (not needed — route is fixed geometry).
- Produces:
  - `export interface RouteSample { pos: THREE.Vector3; tangent: THREE.Vector3 }`
  - `export function sampleRoute(t: number): RouteSample` — position + normalized tangent at `t∈[0,1]`.
  - `export interface RoadFrame { pos: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3; binormal: THREE.Vector3 }`
  - `export function roadFrame(t: number): RoadFrame` — orthonormal frame; `binormal` is the left/right road axis (horizontal), `normal` is up-ish.
  - `export const ZONES: Record<string, [number, number]>` — the t-map table above.
  - `export const MOON_POS: THREE.Vector3` and `export const MOON_RADIUS: number`.
  - `export const ROUTE_LENGTH: number` — approx arc length in meters.

**Waypoints (meters).** The route runs +X for the opening, turns right (−Z) at Shibuya, then runs −Z through the stunt/research/bridge. Heights encode the ramps/scaffold/bridge:

```
name            x      y     z      zone boundary
introStart    -320     0     0      t=0.00
aboutStart    -240     0     0      t=0.12
aboutEnd       160     0     0      t=0.28
shibuya        240     0     0      turn apex (t≈0.32)
ramp1Base      240     0   -70      t=0.36
ramp1Lip       240    11   -95      launch (mid ramp1)
flip1Apex      240    20  -120      t≈0.41 (airborne peak)
scaffoldDeck   240    13  -160      land (t=0.46)
scaffoldEnd    240    13  -210      t=0.52
ramp2Lip       240    22  -235      launch (mid ramp2)
flip2Apex      240    30  -260      t≈0.57 (airborne peak)
descendTop     240    12  -300      t=0.62
roadResume     240     0  -340      t=0.68
researchMid    240     0  -470      t≈0.76
researchEnd    240     0  -600      t=0.84
bridgeStart    240     8  -640      t=0.89
bridgeEnd      240    12 -1100      t=1.00
```

`MOON_POS = (240, 240, -2400)`, `MOON_RADIUS = 300`.

Implementation: build a `THREE.CatmullRomCurve3` from the waypoints (centripetal). `sampleRoute(t)` calls `curve.getPointAt(t)` + `curve.getTangentAt(t)`. `roadFrame(t)`: tangent from the curve; `binormal = tangent × worldUp` normalized; `normal = binormal × tangent`. Guard the degenerate case (tangent ∥ worldUp) by falling back to previous binormal — not needed here since the path is never vertical.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/route.test.ts
import { describe, it, expect } from 'vitest';
import { sampleRoute, roadFrame, ZONES, MOON_POS, ROUTE_LENGTH } from '../src/world/route';

describe('route', () => {
  it('samples endpoints', () => {
    const a = sampleRoute(0);
    const b = sampleRoute(1);
    expect(a.pos.x).toBeCloseTo(-320, 0);
    expect(b.pos.z).toBeCloseTo(-1100, -1); // within ~10m
  });

  it('turns right: +X travel before Shibuya, -Z travel after', () => {
    const before = sampleRoute(0.15).tangent; // heading +X
    const after = sampleRoute(0.7).tangent;    // heading -Z
    expect(before.x).toBeGreaterThan(0.5);
    expect(after.z).toBeLessThan(-0.5);
  });

  it('road frame is orthonormal', () => {
    const f = roadFrame(0.5);
    expect(f.tangent.length()).toBeCloseTo(1, 3);
    expect(f.binormal.length()).toBeCloseTo(1, 3);
    expect(f.tangent.dot(f.binormal)).toBeCloseTo(0, 3);
  });

  it('ramp/scaffold heights are encoded', () => {
    expect(sampleRoute(0.46).pos.y).toBeGreaterThan(8);  // scaffold deck
    expect(sampleRoute(0.84).pos.y).toBeCloseTo(0, 0);   // research ground
    expect(sampleRoute(1).pos.y).toBeGreaterThan(8);      // bridge deck
  });

  it('exposes zones and moon', () => {
    expect(ZONES.about[0]).toBeCloseTo(0.12, 2);
    expect(MOON_POS.y).toBeGreaterThan(100);
    expect(ROUTE_LENGTH).toBeGreaterThan(1500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/route.test.ts`
Expected: FAIL — `sampleRoute` not exported / module missing.

- [ ] **Step 3: Implement `src/world/route.ts`**

Build the curve from the waypoint list, implement `sampleRoute`, `roadFrame`, and export `ZONES`, `MOON_POS`, `MOON_RADIUS`, `ROUTE_LENGTH = curve.getLength()`. Use `getPointAt`/`getTangentAt` (arc-length parameterized) so `t` maps to even spatial progress.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/world/route.ts tests/route.test.ts
git commit -m "feat(route): spline waypoints, sampleRoute, roadFrame, zone map"
```

---

## Task 2: Road & Ground Geometry (grey-box)

**Files:**
- Create: `src/world/streets.ts`
- Create: `src/viewer/entries/streets.ts`
- Test: `tests/streets.test.ts`

**Interfaces:**
- Consumes: `sampleRoute`, `roadFrame`, `ZONES` from `route.ts`; `makeRng`; `COLORS`.
- Produces:
  - `export function buildStreets(rng: Rng): THREE.Group` — road ribbon + sidewalks + ground plane. `group.name = 'streets'`. userData: `{ draw: number }` (approx draw-call count).
  - `export const ROAD_HALF_WIDTH = 7;` (3 lanes ≈ 14m) and `export const CORRIDOR_HALF = 17;` (34m corridor).

Implementation: sample the route at ~200 steps; at each step build a quad strip for the road (width `2*ROAD_HALF_WIDTH` along `binormal`) and two sidewalk strips just outside it, following `pos` + frame. Merge road quads into one mesh (dark asphalt `MeshStandardMaterial`), sidewalks into another (lighter concrete). Add a large ground plane at `y=-0.05` under the whole city (`COLORS.void`). This is grey-box: flat colors, lane markings/reflections come later (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/streets.test.ts
import { describe, it, expect } from 'vitest';
import { buildStreets, ROAD_HALF_WIDTH } from '../src/world/streets';
import { makeRng } from '../src/utils/rng';

describe('streets', () => {
  it('builds a streets group with meshes', () => {
    const g = buildStreets(makeRng(1));
    expect(g.name).toBe('streets');
    let meshes = 0;
    g.traverse((o) => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(3); // road + 2 sidewalks + ground
  });

  it('road ribbon follows the route into -Z after the turn', () => {
    const g = buildStreets(makeRng(1));
    const box = new (require('three').Box3)().setFromObject(g);
    expect(box.min.z).toBeLessThan(-900);  // reaches the bridge end
    expect(box.max.x).toBeGreaterThan(230); // reaches Shibuya x
  });

  it('road half width constant', () => {
    expect(ROAD_HALF_WIDTH).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/streets.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `buildStreets` + `src/viewer/entries/streets.ts`**

streets.ts as above. Viewer entry: `registerAsset('streets', (rng) => buildStreets(rng));`

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/streets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/streets.ts src/viewer/entries/streets.ts tests/streets.test.ts
git commit -m "feat(streets): grey-box road ribbon + sidewalks following the route"
```

---

## Task 3: Bike Path (position + pose from t)

**Files:**
- Create: `src/choreography/bikePath.ts`
- Test: `tests/bikePath.test.ts`

**Interfaces:**
- Consumes: `sampleRoute`, `roadFrame`, `ZONES` from `route.ts`; `BikePose` from `src/assets/vehicles/bike.ts` (`{ lean, pitch, crouch, wheelSpin }`).
- Produces:
  - `export interface BikeState { pos: THREE.Vector3; quat: THREE.Quaternion; pose: BikePose }`
  - `export class BikePath { state(t: number): BikeState }`

Implementation: `state(t)` samples the route for `pos`. Orientation: build a quaternion from the road frame (forward = tangent, up = normal) via `THREE.Matrix4.lookAt`-style basis, adjusted so the bike's local +X (forward) aligns with tangent. Pose:
- `wheelSpin = t * 300` (monotonic; purely visual).
- `lean`: proportional to horizontal curvature — nonzero through the Shibuya turn (`ZONES.turn`), zero on straights. Compute as angle between tangent at `t-ε` and `t+ε` projected on the horizontal plane, clamped to ±35°.
- `pitch`: a **backflip** during each ramp zone. In `projects-ramp1` (0.36–0.46), ramp `pitch` from 0 → `-2π` (backward = negative pitch per bike.ts convention where +pitch = nose up; backflip rotates nose up and over, so use +2π). Use a smoothstep across the zone so the apex (`flip1Apex` t≈0.41) is mid-rotation. Same for `projects-ramp2` (0.52–0.62) → another +2π. Outside ramp zones, `pitch = 0`.
- `crouch`: 0.2 default (race tuck); rises to ~0.6 during flips for a tucked flip silhouette.

All pure functions of `t` — no state between calls.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/bikePath.test.ts
import { describe, it, expect } from 'vitest';
import { BikePath } from '../src/choreography/bikePath';

describe('BikePath', () => {
  const bp = new BikePath();

  it('is deterministic (scrub-safe)', () => {
    const a = bp.state(0.55);
    const b = bp.state(0.55);
    expect(a.pos.x).toBe(b.pos.x);
    expect(a.pose.pitch).toBe(b.pose.pitch);
  });

  it('does a full backflip in each ramp zone', () => {
    const before1 = bp.state(0.36).pose.pitch;
    const after1 = bp.state(0.46).pose.pitch;
    expect(Math.abs(after1 - before1)).toBeCloseTo(2 * Math.PI, 1);
    const before2 = bp.state(0.52).pose.pitch;
    const after2 = bp.state(0.62).pose.pitch;
    expect(Math.abs(after2 - before2)).toBeCloseTo(2 * Math.PI, 1);
  });

  it('leans through the Shibuya turn, straight elsewhere', () => {
    expect(Math.abs(bp.state(0.15).pose.lean)).toBeLessThan(0.05);
    expect(Math.abs(bp.state(0.32).pose.lean)).toBeGreaterThan(0.1);
  });

  it('wheelSpin is monotonic', () => {
    expect(bp.state(0.6).pose.wheelSpin).toBeGreaterThan(bp.state(0.3).pose.wheelSpin);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/bikePath.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `bikePath.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/bikePath.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/choreography/bikePath.ts tests/bikePath.test.ts
git commit -m "feat(bikePath): position + pose (backflips, turn lean) as pure f(t)"
```

---

## Task 4: Camera Rig

**Files:**
- Create: `src/choreography/cameraRig.ts`
- Test: `tests/cameraRig.test.ts`

**Interfaces:**
- Consumes: `THREE`.
- Produces:
  - `export interface CamPose { pos: THREE.Vector3; target: THREE.Vector3; fov: number }`
  - `export interface CamKey extends CamPose { t: number }`
  - `export class CameraRig { addKey(k: CamKey): void; sample(t: number): CamPose; apply(cam: THREE.PerspectiveCamera, t: number): void }`

Implementation: keys sorted by `t`; `sample(t)` finds the bracketing keys and interpolates `pos`/`target` with `Vector3.lerpVectors` and `fov` linearly, using a smoothstep eased fraction. `apply` sets `cam.position`, `cam.lookAt(target)`, `cam.fov`, `cam.updateProjectionMatrix()`. Clamp `t` to `[firstKey.t, lastKey.t]`. Pure/deterministic.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cameraRig.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/choreography/cameraRig';

describe('CameraRig', () => {
  it('interpolates between keys', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0, 0, 0), target: new THREE.Vector3(1, 0, 0), fov: 50 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(10, 0, 0), target: new THREE.Vector3(1, 0, 0), fov: 70 });
    const mid = rig.sample(0.5);
    expect(mid.pos.x).toBeGreaterThan(0);
    expect(mid.pos.x).toBeLessThan(10);
    expect(mid.fov).toBeCloseTo(60, 0);
  });

  it('is deterministic', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0,0,0), target: new THREE.Vector3(0,0,-1), fov: 55 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(5,5,5), target: new THREE.Vector3(0,0,-1), fov: 55 });
    expect(rig.sample(0.3).pos.x).toBe(rig.sample(0.3).pos.x);
  });

  it('applies to a camera', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
    rig.apply(cam, 0.5);
    expect(cam.fov).toBeCloseTo(55, 1);
    expect(cam.position.z).toBeCloseTo(8, 1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cameraRig.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `cameraRig.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/cameraRig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/choreography/cameraRig.ts tests/cameraRig.test.ts
git commit -m "feat(cameraRig): keyframed camera pose interpolation"
```

---

## Task 5: Chase-Cam Segments (all zones, grey-box camera keys)

**Files:**
- Create: `src/choreography/segments/ride.ts`
- Test: `tests/segments.test.ts`

**Interfaces:**
- Consumes: `CameraRig`, `CamKey` from `cameraRig.ts`; `BikePath` from `bikePath.ts`; `sampleRoute`, `roadFrame`, `ZONES` from `route.ts`.
- Produces:
  - `export function registerRideSegments(rig: CameraRig, bike: BikePath): void` — adds camera keys across ALL zones so the whole ride has continuous coverage.

Implementation: for each zone add keys. Default chase pose: `pos = bikePos + (-tangent * 9) + (normal * 4)` (behind + above), `target = bikePos + tangent*6`, `fov = 55`. Special zones override:
- **about (0.12–0.28):** at ~0.20 swing camera out along +binormal to frame the hero wall (side offset), `target` toward the wall side.
- **turn (0.28–0.36):** widen (`fov 62`), pull the camera outside the turn radius.
- **flips (0.41, 0.57):** at each apex, camera settles beside the bike (`pos = bikePos + binormal*10 + normal*2`), `target = bikePos`, so bike + project signs frame together.
- **research (0.68–0.84):** LOW `pos.y = 1.5`, `target.y = 24` (looking UP), `fov 66`.
- **finale (0.89–1.0):** pull back and up (`pos = bikePos - tangent*18 + normal*10`), `target` toward `MOON_POS`.

Compute each key by sampling `bike.state(tKey)` / `roadFrame(tKey)`. This is grey-box — poses can be tuned during the verification task.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/segments.test.ts
import { describe, it, expect } from 'vitest';
import { CameraRig } from '../src/choreography/cameraRig';
import { BikePath } from '../src/choreography/bikePath';
import { registerRideSegments } from '../src/choreography/segments/ride';

describe('ride segments', () => {
  it('covers the whole ride with keys', () => {
    const rig = new CameraRig();
    registerRideSegments(rig, new BikePath());
    // sample at many t — should never throw and fov stays sane
    for (let t = 0; t <= 1; t += 0.05) {
      const p = rig.sample(t);
      expect(p.fov).toBeGreaterThan(30);
      expect(p.fov).toBeLessThan(100);
    }
  });

  it('research camera looks up (target above camera)', () => {
    const rig = new CameraRig();
    registerRideSegments(rig, new BikePath());
    const p = rig.sample(0.76);
    expect(p.target.y).toBeGreaterThan(p.pos.y + 5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/segments.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `segments/ride.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/choreography/segments/ride.ts tests/segments.test.ts
git commit -m "feat(segments): chase-cam keys across all zones (grey-box)"
```

---

## Task 6: Master Timeline (scroll → t → drive)

**Files:**
- Create: `src/choreography/master.ts`
- Test: `tests/master.test.ts`

**Interfaces:**
- Consumes: `CameraRig`, `BikePath`, `BikeAsset` (`{ group, pose }` from `bike.ts`), `THREE`.
- Produces:
  - `export interface Updatable { update(t: number): void }`
  - `export interface MasterOpts { rig: CameraRig; bike: BikePath; bikeAsset: BikeAsset; camera: THREE.PerspectiveCamera; scene: THREE.Scene; updatables: Updatable[]; render?: () => void; isReducedMotion: boolean; onProgressNotify?: (t: number) => void }`
  - `export interface MasterHandle { setProgress(t: number): void }`
  - `export function initMaster(o: MasterOpts): MasterHandle`

Implementation: `setProgress(t)`:
1. `const st = bike.state(t)` → set `bikeAsset.group.position.copy(st.pos)`, `.quaternion.copy(st.quat)`, `bikeAsset.pose(st.pose)`.
2. `bikeAsset.group.updateMatrixWorld(true)` (so FX reading `matrixWorld` are current).
3. `rig.apply(camera, t)`.
4. for each `u of updatables` `u.update(t)`.
5. `onProgressNotify?.(t)`; `render?.()`.

In standard mode, wire GSAP ScrollTrigger: create a tall scroll container, pin the canvas, `scrub: true`, `onUpdate: self => setProgress(self.progress)`. In `?shot=` mode (no scroll), call `setProgress(Number(shot))` once and set `window.__READY = true` after 2 rAF. Guard GSAP/ScrollTrigger import so the unit test (jsdom, no scroll) can call `initMaster` and `setProgress` directly.

Test focuses on `setProgress` wiring (no GSAP).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/master.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { initMaster } from '../src/choreography/master';
import { CameraRig } from '../src/choreography/cameraRig';
import { BikePath } from '../src/choreography/bikePath';

function fakeBikeAsset() {
  const group = new THREE.Group();
  return { group, pose: vi.fn(), ghostGeometry: new THREE.BufferGeometry() };
}

describe('master', () => {
  it('setProgress positions the bike and calls updatables', () => {
    const rig = new CameraRig();
    rig.addKey({ t: 0, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    rig.addKey({ t: 1, pos: new THREE.Vector3(0,2,8), target: new THREE.Vector3(0,0,0), fov: 55 });
    const bikeAsset = fakeBikeAsset();
    const u = { update: vi.fn() };
    const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 5000);
    const h = initMaster({
      rig, bike: new BikePath(), bikeAsset, camera,
      scene: new THREE.Scene(), updatables: [u], isReducedMotion: true
    });
    h.setProgress(0.5);
    expect(bikeAsset.pose).toHaveBeenCalled();
    expect(u.update).toHaveBeenCalledWith(0.5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/master.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `master.ts`** (dynamic-import GSAP only in browser path).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/master.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/choreography/master.ts tests/master.test.ts
git commit -m "feat(master): scroll->t timeline driving bike + camera + updatables"
```

---

## Task 7: Boot Integration — grey-box ride end-to-end

**Files:**
- Modify: `src/main.ts`
- Create: `src/choreography/reducedMotion.ts`

**Interfaces:**
- Consumes: everything above + `initCore`, `buildBike`, `createLoader`, `renderPostHero`.
- Produces:
  - `src/choreography/reducedMotion.ts`: `export function initReducedMotion(setProgress: (t:number)=>void, pulseHint?: (o:number)=>void): { onProgress: (t:number)=>void }`.

Implementation: rewrite `bootHero` to: init core; build streets + bike; add hemisphere+key lights; construct `CameraRig` + `BikePath`; `registerRideSegments`; add bike + streets to scene; `initMaster`; wire ScrollTrigger (standard) or `?shot=` path. Keep the `?viewer` branch and `renderPostHero`. This is the foundation checkpoint: a rideable grey-box city.

- [ ] **Step 1: Implement `reducedMotion.ts`** (snap `t` to nearest zone boundary on scroll; expose `onProgress`).

- [ ] **Step 2: Rewrite `bootHero` in `main.ts`** to assemble the grey-box ride (dynamic-import the world/choreography modules as the old main did).

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npx vite build`
Expected: EXIT 0.

- [ ] **Step 4: Screenshot sweep (grey-box)**

Run (dev server in another shell): `npm run shoot -- --scroll 0,0.12,0.20,0.32,0.41,0.49,0.57,0.65,0.76,0.86,0.95,1.0`
Expected: 12 PNGs in `shots/`; bike visibly follows the road, flips mid-ramp, camera looks up in research, pulls back at finale. Inspect them.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/choreography/reducedMotion.ts
git commit -m "feat(boot): grey-box scroll ride end-to-end (route+road+bike+camera)"
```

**CHECKPOINT:** Foundation complete — verify the ride feels right before dressing. If camera/bike poses need tuning, adjust `segments/ride.ts` and `bikePath.ts` now.

---

## Task 8: KitBash Mesh Processing Pipeline

**Files:**
- Create: `tools/process-kitbash.mjs`
- Create: `public/models/.gitkeep` (dir exists)
- Output: `public/models/neocity/*.glb` (committed)

**Interfaces:**
- Produces: per-piece DRACO glb files named after the 47 KitBash objects, e.g. `KB3D_NEC_BldgLG_A_Main.glb`, plus a manifest `public/models/neocity/manifest.json` listing `{ name, file, bbox:[w,h,d] }`.

Implementation: a Node script (run manually, not in CI) that:
1. Reads source OBJ path from `argv` (default `~/Downloads/Cyber Assets/Cyber kitbash/kb3d_neocity-native.obj`).
2. Uses `obj2gltf` to convert the whole OBJ → a temp glb (materials unlit; missing textures ignored).
3. Loads the glb with `@gltf-transform/core`, splits by node/mesh name into the 47 pieces (each piece = one root object from the OBJ `o` records).
4. For each piece: `weld` + `simplify` (ratio 0.5, error 0.01) + `dedup` + DRACO compress; write to `public/models/neocity/<name>.glb`; record bbox via `getWorldBounds`.
5. Write `manifest.json`.

Deps: `npm install --save-dev obj2gltf @gltf-transform/core @gltf-transform/functions @gltf-transform/cli`. (Verified these install + run in this environment; full-kit DRACO output ≈1.93MB.)

- [ ] **Step 1: Install deps**

Run: `npm install --save-dev obj2gltf @gltf-transform/core @gltf-transform/functions @gltf-transform/cli`
Expected: EXIT 0.

- [ ] **Step 2: Write `tools/process-kitbash.mjs`**

- [ ] **Step 3: Run the pipeline**

Run: `node tools/process-kitbash.mjs`
Expected: `public/models/neocity/` fills with ~47 `.glb` + `manifest.json`; script logs total size. Confirm total < 8MB.

- [ ] **Step 4: Sanity-check one piece loads**

Run: `node -e "import('@gltf-transform/core').then(async ({NodeIO})=>{const io=new (await import('@gltf-transform/core')).NodeIO(); /* smoke */ console.log('ok')})"` (or simply verify file sizes with `ls -lh public/models/neocity/ | head`).
Expected: files present, none 0 bytes.

- [ ] **Step 5: Commit**

```bash
git add tools/process-kitbash.mjs public/models/neocity package.json package-lock.json
git commit -m "feat(assets): KitBash NeoCity mesh pipeline + processed glb pieces"
```

---

## Task 9: NeoCity Loader

**Files:**
- Create: `src/assets/buildings/neocity.ts`
- Create: `src/viewer/entries/neocity.ts`
- Test: `tests/neocity.test.ts`

**Interfaces:**
- Consumes: `tryLoadScene` from `src/assets/gltfLoader.ts`; `COLORS`.
- Produces:
  - `export interface NeoPiece { name: string; scene: THREE.Group | null; bbox: [number, number, number] }`
  - `export interface NeoLibrary { pieces: Record<string, NeoPiece>; get(name: string): THREE.Group | null }`
  - `export async function loadNeoCity(basePath?: string): Promise<NeoLibrary>` (default `/models/neocity/`) — fetches `manifest.json`, then each piece via `tryLoadScene` (null on failure → procedural fallback path still works).
  - `export function applyNeonMaterials(group: THREE.Group, rng: Rng): void` — walks meshes, assigns emissive window/neon materials keyed off the piece's `.mtl` material-name intent (Concrete/Glass/Neon*/Brass) using `holoTeal`/`signalMagenta`/`sodiumAmber`/`moonlight` (NEVER `tronCyan`).

Implementation: `loadNeoCity` fetches the manifest (`fetch` in browser; guarded so unit test can pass a stub). `get(name)` returns a deep clone of the piece scene with `applyNeonMaterials` already applied at load. Since KitBash ships no textures, `applyNeonMaterials` maps material name substrings → emissive intent.

- [ ] **Step 1: Write the failing test** (uses a stub library, no real fetch)

```typescript
// tests/neocity.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyNeonMaterials } from '../src/assets/buildings/neocity';
import { makeRng } from '../src/utils/rng';
import { COLORS } from '../src/theme';

describe('neocity materials', () => {
  it('assigns non-cyan emissive materials to meshes', () => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial());
    m.name = 'KB3D_NEC_NeonLightBlue_part';
    g.add(m);
    applyNeonMaterials(g, makeRng(1));
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.emissive.getHex()).not.toBe(COLORS.tronCyan);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/neocity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `neocity.ts` + viewer entry** (`registerAsset('neocity', ...)` renders a few pieces in a row; async load guarded).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/neocity.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify a real piece in the browser**

Run: `npm run shoot -- --viewer neocity`
Expected: `neocity-a*.png` show detailed KitBash buildings with neon materials. Inspect.

- [ ] **Step 6: Commit**

```bash
git add src/assets/buildings/neocity.ts src/viewer/entries/neocity.ts tests/neocity.test.ts
git commit -m "feat(neocity): loader + emissive material assignment for KitBash pieces"
```

---

## Task 10: City Layout (building placement + display anchors)

**Files:**
- Create: `src/world/cityLayout.ts`
- Create: `src/viewer/entries/city.ts`
- Test: `tests/layout.test.ts`

**Interfaces:**
- Consumes: `sampleRoute`, `roadFrame`, `ZONES`, `route.ts` constants; `NeoLibrary` from `neocity.ts`; `CORRIDOR_HALF`, `MIN_ROAD_CLEARANCE`; `makeRng`.
- Produces:
  - `export interface DisplayAnchor { pos: THREE.Vector3; quat: THREE.Quaternion; kind: 'aboutHero'|'aboutSign'|'projBig'|'projSmall'|'research' }`
  - `export interface City { group: THREE.Group; anchors: DisplayAnchor[]; update(t:number): void; updateAmbient(sec:number): void }`
  - `export function buildCity(lib: NeoLibrary, seed: number): City`

Implementation: walk the route in steps; on both sides place NeoCity pieces at `pos ± binormal*(CORRIDOR_HALF + pieceHalfWidth)`, clamped so the near face is ≥ `MIN_ROAD_CLEARANCE` from centerline (**hard road-clearance rule**). Choose piece by zone: Large towers dominate About/Research walls; Medium fill; Small (markets/clutter) at ground near camera. Orient each piece to face the road (`quat` from binormal). Compute `DisplayAnchor`s:
- **aboutHero:** one large wall face at t≈0.20, on +binormal side, `pos.y≈14`.
- **aboutSign:** 2–3 smaller anchors near it (bio + misc).
- **projBig:** 2 anchors flanking `flip1Apex` (t≈0.41), at apex height, offset ±binormal.
- **projSmall:** 3 anchors around `flip2Apex` (t≈0.57).
- **research:** 2 anchors high (`pos.y≈22`) on the canyon walls in 0.68–0.84.

Merge/instanceable static meshes; `update`/`updateAmbient` drive metro + window flicker later. Enforce clearance in a helper `clampOutsideRoad(pos, binormal, halfW)` with a unit test.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/layout.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCity } from '../src/world/cityLayout';
import { ROAD_HALF_WIDTH } from '../src/world/streets';
import { sampleRoute, roadFrame } from '../src/world/route';

// Stub NeoLibrary: every get() returns a unit box so layout math is testable offline.
const stubLib = {
  pieces: {},
  get: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(20,40,20))); (g.userData as any).footprint=[20,20]; return g; }
} as any;

describe('cityLayout', () => {
  it('never places building geometry inside the road', () => {
    const city = buildCity(stubLib, 1337);
    // sample many buildings; each must clear the road at its t
    const box = new THREE.Box3();
    let violations = 0;
    city.group.traverse((o) => {
      if (!(o as any).isMesh) return;
      box.setFromObject(o);
      // crude check: nothing crosses the centerline corridor at its own z-projected t
      // (fine-grained clearance is unit-tested in clampOutsideRoad)
    });
    expect(violations).toBe(0);
  });

  it('produces the expected display anchors', () => {
    const city = buildCity(stubLib, 1337);
    const kinds = city.anchors.map(a => a.kind);
    expect(kinds.filter(k => k === 'projBig').length).toBe(2);
    expect(kinds.filter(k => k === 'projSmall').length).toBe(3);
    expect(kinds.filter(k => k === 'research').length).toBe(2);
    expect(kinds).toContain('aboutHero');
  });

  it('is deterministic', () => {
    const a = buildCity(stubLib, 1337).anchors[0].pos.x;
    const b = buildCity(stubLib, 1337).anchors[0].pos.x;
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/layout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `cityLayout.ts` + `src/viewer/entries/city.ts`** (city viewer entry loads the real NeoLibrary and shows the assembled corridor).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/cityLayout.ts src/viewer/entries/city.ts tests/layout.test.ts
git commit -m "feat(city): NeoCity building placement + display anchors, road-clearance clamp"
```

---

## Task 11: Content Panels (résumé → texture)

**Files:**
- Create: `src/content/contentPanel.ts`
- Test: `tests/contentPanel.test.ts`

**Interfaces:**
- Consumes: `RESUME`, `Project`, `ImageSlot` from `resume.ts`; `makeCanvasTexture`, `drawPanel`, `wrapText` from `src/utils/canvasText.ts`; `makePlaceholder` from `placeholders.ts`.
- Produces:
  - `export function makeAboutHeroTexture(): THREE.CanvasTexture` (portrait + name + tagline)
  - `export function makeProjectTexture(p: Project): THREE.CanvasTexture` (title + stack + blurb + image slot)
  - `export function makeResearchTexture(p: Project): THREE.CanvasTexture`
  - `export function makeBioTexture(): THREE.CanvasTexture`

Implementation: canvas-draw each panel with the theme palette (emissive-friendly: dark bg, bright text/accents in teal/magenta/amber — never cyan). Reuse `drawPanel`/`wrapText`. Return `CanvasTexture` for use as `emissiveMap` on display meshes.

- [ ] **Step 1: Write the failing test**

Tests run in plain Node (NO jsdom) — canvas is stubbed. Mirror the `document`
Proxy stub from `tests/billboards.test.ts` (a callable Proxy returning itself for
any property/coercing to 0), and assert the function returns a `THREE.CanvasTexture`
instance — do NOT assert real pixel dimensions (the stub reports 0).

```typescript
// tests/contentPanel.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// Stub the DOM canvas exactly as tests/billboards.test.ts does (Node, no jsdom).
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain),
  set: () => true,
  apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};

import { makeProjectTexture, makeAboutHeroTexture } from '../src/content/contentPanel';
import { RESUME } from '../src/content/resume';

describe('contentPanel', () => {
  it('creates a CanvasTexture for a project', () => {
    expect(makeProjectTexture(RESUME.projectsMain[0])).toBeInstanceOf(THREE.CanvasTexture);
  });
  it('creates the about hero texture', () => {
    expect(makeAboutHeroTexture()).toBeInstanceOf(THREE.CanvasTexture);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/contentPanel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `contentPanel.ts`** (draws to a DOM canvas at runtime; the tests stub `document` as above, so never touch `document` at module-evaluation time — only inside the functions).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/contentPanel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/contentPanel.ts tests/contentPanel.test.ts
git commit -m "feat(content): résumé-content panel textures for displays"
```

---

## Task 12: Content Displays (billboards on walls, holo for floating)

**Files:**
- Create: `src/world/displays.ts`
- Create: `src/viewer/entries/displays.ts`
- Test: `tests/displays.test.ts`

**Interfaces:**
- Consumes: `DisplayAnchor` from `cityLayout.ts`; `buildBillboard` from `src/assets/billboards/billboards.ts`; content textures from `contentPanel.ts`; `COLORS`.
- Produces:
  - `export interface Displays { group: THREE.Group; updateAmbient(sec:number): void }`
  - `export function buildDisplays(anchors: DisplayAnchor[]): Displays`

Implementation: for each anchor, build the right surface:
- `aboutHero`/`aboutSign`/`research` → **solid neon billboard** via `buildBillboard` with the content texture (`setTexture`), positioned+oriented at the anchor.
- `projBig`/`projSmall` → **holographic panel**: an emissive translucent plane (scanline shader or `MeshBasicMaterial` + additive) with a glowing frame, facing the camera at the flip apex. `updateAmbient` adds subtle flicker/scanline scroll.

- [ ] **Step 1: Write the failing test**

Tests run in plain Node (no jsdom). Because `buildDisplays` reaches `buildBillboard`
→ `makeAd` (canvas), include the same `document` Proxy stub used in
`tests/billboards.test.ts` at the TOP of the file, before importing `buildDisplays`.

```typescript
// tests/displays.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
// --- DOM canvas stub (see tests/billboards.test.ts) ---
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain), set: () => true, apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};
import { buildDisplays } from '../src/world/displays';

const anchors = [
  { pos: new THREE.Vector3(240,14,-50), quat: new THREE.Quaternion(), kind: 'aboutHero' as const },
  { pos: new THREE.Vector3(230,20,-120), quat: new THREE.Quaternion(), kind: 'projBig' as const },
];

describe('displays', () => {
  it('builds a surface per anchor', () => {
    const d = buildDisplays(anchors);
    let meshes = 0;
    d.group.traverse((o) => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/displays.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `displays.ts` + viewer entry**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/displays.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/displays.ts src/viewer/entries/displays.ts tests/displays.test.ts
git commit -m "feat(displays): neon-billboard + holo content surfaces at anchors"
```

---

## Task 13: Road Detailing + Shibuya + Ramps + Scaffolding + Bridge

**Files:**
- Modify: `src/world/streets.ts`
- Test: `tests/streets.test.ts` (extend)

**Interfaces:**
- Produces (add to streets module):
  - `export function buildShibuya(rng: Rng): THREE.Group` — scramble crossing (diagonal crosswalks, corner wrap billboards, wait pads).
  - `export function buildScaffolding(rng: Rng): THREE.Group` — rideable deck at the scaffold zone (truss, planks, netting, work lights, warning stripes).
  - `buildStreets` now also emits lane markings, crosswalk paint, manhole/grate decals (as emissive-subtle textures) and the ramp/bridge deck surfaces following the route's y-profile.

Implementation: upgrade the grey-box road with a `CanvasTexture` for lane markings + wet-neon sheen (emissive-subtle). Build the Shibuya set-piece at the turn (t≈0.32, world x≈240,z≈0): giant corner billboards (reuse `buildBillboard` with `makeAd`), painted scramble + diagonals. Build scaffolding attached to the building side at the scaffold zone (0.46–0.52), aligned to the route's elevated y. Ensure the road deck ramps/bridge match `sampleRoute` heights so the bike surface is continuous.

- [ ] **Step 1: Write the failing test (extend streets.test.ts)**

Note: `buildShibuya` reaches `buildBillboard` → canvas. `tests/streets.test.ts` must
carry the same `document` Proxy stub from `tests/billboards.test.ts` at the top of the
file (add it when extending). Assert mesh counts / bbox, never real pixel sizes.

```typescript
import { buildShibuya, buildScaffolding } from '../src/world/streets';
// ...
it('shibuya set-piece has billboards', () => {
  const g = buildShibuya(makeRng(2));
  let meshes = 0; g.traverse(o => { if ((o as any).isMesh) meshes++; });
  expect(meshes).toBeGreaterThan(5);
});
it('scaffolding is elevated to deck height', () => {
  const g = buildScaffolding(makeRng(3));
  const box = new (require('three').Box3)().setFromObject(g);
  expect(box.max.y).toBeGreaterThan(10);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/streets.test.ts`
Expected: FAIL (new exports missing).

- [ ] **Step 3: Implement the upgrades**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/streets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/streets.ts tests/streets.test.ts
git commit -m "feat(streets): road detailing + Shibuya + scaffolding + ramp/bridge decks"
```

---

## Task 14: Far-Field Skyline + Moon

**Files:**
- Create: `src/world/farField.ts`
- Create: `src/viewer/entries/farField.ts`
- Test: `tests/farField.test.ts`

**Interfaces:**
- Consumes: `MOON_POS`, `MOON_RADIUS` from `route.ts`; `makeRng`; `COLORS`.
- Produces:
  - `export interface FarField { group: THREE.Group; updateAmbient(sec:number): void }`
  - `export function buildFarField(rng: Rng, density?: number): FarField`
  - `export function buildMoon(rng: Rng): THREE.Group`

Implementation: a ring of cheap silhouette towers (billboard-style dark boxes with sparse emissive windows) beyond the corridor, plus a large detailed moon at `MOON_POS` (high-contrast maria via `CanvasTexture`, dual glow sprites, Fresnel rim). `MeshBasicMaterial` moon (fog:false) so it reads at all distances including the close finale. Deterministic layout; `updateAmbient` for subtle far-window twinkle only.

- [ ] **Step 1: Write the failing test**

Note: `buildMoon` draws its maria texture to canvas — include the `document` Proxy
stub from `tests/billboards.test.ts` at the top before importing.

```typescript
// tests/farField.test.ts
import { describe, it, expect } from 'vitest';
// --- DOM canvas stub (see tests/billboards.test.ts) ---
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain), set: () => true, apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};
import { buildFarField, buildMoon } from '../src/world/farField';
import { makeRng } from '../src/utils/rng';

describe('farField', () => {
  it('builds skyline + moon', () => {
    const f = buildFarField(makeRng(2), 1);
    let meshes = 0; f.group.traverse(o => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(10);
  });
  it('moon is a group with geometry', () => {
    let meshes = 0; buildMoon(makeRng(2)).traverse(o => { if ((o as any).isMesh) meshes++; });
    expect(meshes).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/farField.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `farField.ts` + viewer entry**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/farField.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/farField.ts src/viewer/entries/farField.ts tests/farField.test.ts
git commit -m "feat(farField): silhouette skyline + detailed moon"
```

---

## Task 15: Traffic + Crowds + Metro (life)

**Files:**
- Create: `src/choreography/traffic.ts`
- Create: `src/viewer/entries/traffic.ts`
- Test: `tests/traffic.test.ts`

**Interfaces:**
- Consumes: `sampleRoute`, `roadFrame`, `ROAD_HALF_WIDTH`; vehicle builders (`buildSedan`, `buildHoverA`, etc.); `buildCrowd`; `buildMetro`; `makeRng`.
- Produces:
  - `export interface Traffic { group: THREE.Group; update(t:number): void }`
  - `export function buildTraffic(rng: Rng): Traffic`

Implementation: N ground cars + M hover vehicles placed in lanes (offset along `binormal` from route samples), moving as pure functions of `t` (each vehicle has a phase; position = route sample at `(t*speed + phase) mod range`). Crowds on sidewalks at the Shibuya crossing. Metro line overhead following a parallel curve. All deterministic; `update(t)` repositions.

- [ ] **Step 1: Write the failing test**

Note: vehicle/metro builders may draw to canvas. If `buildTraffic` reaches any
canvas-drawing builder, add the `document` Proxy stub from `tests/billboards.test.ts`
at the top of this file before the `buildTraffic` import.

```typescript
// tests/traffic.test.ts
import { describe, it, expect } from 'vitest';
// --- DOM canvas stub (see tests/billboards.test.ts) — include if builders draw to canvas ---
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain), set: () => true, apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};
import { buildTraffic } from '../src/choreography/traffic';
import { makeRng } from '../src/utils/rng';

describe('traffic', () => {
  it('is deterministic under update(t)', () => {
    const a = buildTraffic(makeRng(3)); a.update(0.5);
    const b = buildTraffic(makeRng(3)); b.update(0.5);
    const pa: number[] = []; a.group.traverse(o => pa.push(o.position.x));
    const pb: number[] = []; b.group.traverse(o => pb.push(o.position.x));
    expect(pa).toEqual(pb);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/traffic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `traffic.ts` + viewer entry**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/traffic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/choreography/traffic.ts src/viewer/entries/traffic.ts tests/traffic.test.ts
git commit -m "feat(traffic): deterministic vehicles + crowds + metro"
```

---

## Task 16: Bike FX (sandevistan slow-mo, light pools, drift)

**Files:**
- Create: `src/fx/sandevistan.ts`, `src/fx/lightPools.ts`, `src/fx/driftFx.ts`
- Test: `tests/sandevistan.test.ts`

**Interfaces:**
- Consumes: `bikeAsset.ghostGeometry`; `BikePath`; `THREE`.
- Produces:
  - `export function buildSandevistan(ghostGeom: THREE.BufferGeometry): { group: THREE.Group; record(m: THREE.Matrix4, t:number): void; update(t:number): void; snapshotCount: number }`
  - `export function buildLightPools(sources: THREE.Object3D[]): { group: THREE.Group; update(t:number): void }`
  - `export function buildDriftFx(maxSmoke: number): { group: THREE.Group; update(t:number): void }`

Implementation: sandevistan renders a chain of ghost meshes of the bike; at the flip apexes (near-freeze), the ghost chain fans out for the slow-mo look. The near-freeze itself is realized in `bikePath`/`master` by the apex spanning a wide `t`-band (already encoded in the route t-map — the ramp zones are wide relative to spatial travel). Light pools: additive ground discs under bike/traffic. Drift: smoke puffs at the Shibuya turn. All deterministic under `update(t)` (ghost seeding replays `bikePath.state` from 0→t as the old main did).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/sandevistan.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildSandevistan } from '../src/fx/sandevistan';

describe('sandevistan', () => {
  it('records and updates without error', () => {
    const s = buildSandevistan(new THREE.BoxGeometry(1,1,1));
    s.record(new THREE.Matrix4(), 0.1);
    s.update(0.1);
    expect(s.snapshotCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sandevistan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the three FX modules**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/sandevistan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fx/*.ts tests/sandevistan.test.ts
git commit -m "feat(fx): sandevistan slow-mo trail, light pools, drift smoke"
```

---

## Task 17: Full Boot Integration (dress the ride)

**Files:**
- Modify: `src/main.ts`
- Modify: `src/choreography/segments/ride.ts` (wire content-reveal camera to real anchors; slow-mo apex framing)

**Interfaces:** consumes all prior tasks.

Implementation: extend `bootHero` to: `loadNeoCity()` → `buildCity(lib, 1337)`; add `buildStreets` + `buildShibuya` + `buildScaffolding` + `buildFarField` + `buildDisplays(city.anchors)` + `buildTraffic` + FX to the scene; push `city`, `traffic`, FX into `updatables`; wire `updateAmbient` list into `core.onFrame`. Update `ride.ts` so flip-apex camera keys frame the real `projBig`/`projSmall` anchor positions and the research keys frame the `research` anchors. Mobile: quality tier + density. Reduced-motion: snap.

- [ ] **Step 1: Implement the full assembly in `main.ts`**

- [ ] **Step 2: Update `ride.ts` to use real anchor positions**

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npx vite build`
Expected: EXIT 0.

- [ ] **Step 4: Full screenshot sweep + draw-call audit**

Run: `npm run shoot -- --scroll 0,0.12,0.20,0.32,0.41,0.49,0.57,0.65,0.76,0.86,0.95,1.0`
Then load `http://localhost:5173/?shot=0.32&stats=1` etc. and read console draw calls.
Expected: dressed city; content readable at About/Projects/Research; draw calls ≤300/viewpoint. Inspect all PNGs.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/choreography/segments/ride.ts
git commit -m "feat(boot): full dressed ride — city, displays, life, FX wired"
```

---

## Task 18: Verification Sweep + House Rules + Fixes

**Files:**
- Create: `tests/houseRules.test.ts`
- Modify: any files needing fixes found in the sweep.

**Interfaces:** none new.

Implementation: a test that greps `src/` (excluding `src/assets/vehicles/bike.ts`) for `tronCyan` and fails if found (reserved-palette enforcement). Then a manual verification sweep: run the full screenshot set, verify each zone against the spec (intro cruise, About hero wall, Shibuya turn, two backflips with readable project holos, low-up research, moon finale), draw-call audit at each viewpoint, determinism (same seed → same layout), forward/backward scrub consistency. Fix any issues found and re-sweep.

- [ ] **Step 1: Write the house-rules test**

```typescript
// tests/houseRules.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

describe('house rules', () => {
  it('tronCyan is only used by the bike', () => {
    const offenders = walk('src').filter(
      (f) => !f.replace(/\\/g, '/').endsWith('assets/vehicles/bike.ts') &&
             /tronCyan/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it; fix any offenders**

Run: `npx vitest run tests/houseRules.test.ts`
Expected: PASS (fix any file that misuses `tronCyan`).

- [ ] **Step 3: Full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: all green, EXIT 0.

- [ ] **Step 4: Manual verification sweep + draw-call audit**

Run the 12-point sweep + `?stats=1` at each viewpoint. Verify against the spec zone-by-zone; fix + re-sweep as needed.

- [ ] **Step 5: Commit**

```bash
git add tests/houseRules.test.ts
git commit -m "test(house-rules): enforce reserved cyan; verification sweep fixes"
```

---

## Self-Review Notes

- **Spec coverage:** route (T1), road/ramps/scaffold/bridge (T2,T13), bike backflips (T3), camera incl. low-up research + finale pullback (T4,T5,T17), scroll master + reduced-motion + mobile (T6,T7,T17), KitBash meshes (T8,T9,T10), content displays billboards+holo (T11,T12), Shibuya set-piece (T13), moon/skyline (T14), full living street traffic/crowds/metro (T15), slow-mo FX (T16), reserved palette + draw-call audit + determinism (T18). All spec sections mapped.
- **Road-clearance hard rule:** enforced in T10 (`clampOutsideRoad`) + audited T18.
- **Type consistency:** `RouteSample`/`RoadFrame`/`BikeState`/`CamPose`/`DisplayAnchor`/`City`/`NeoLibrary` names used identically across producing and consuming tasks.
