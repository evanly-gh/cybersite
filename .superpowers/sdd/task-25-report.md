# Task 25 Report — Camera rig, bike path, master scroll timeline, intro dive

## Status

COMPLETE

## Commits (base..head)

Base: `c3ec4a0`
Head: `8864430`

Commit: `feat(choreography): camera rig, bike path, master scroll timeline, intro dive`

## Files Created

- `src/choreography/bikePath.ts` — BikePath class
- `src/choreography/cameraRig.ts` — CameraRig class
- `src/choreography/master.ts` — initMaster with ScrollTrigger + ?shot= mode
- `src/choreography/segments/intro.ts` — intro segment (camera+bike keys + in-world title)
- `src/ui/loader.ts` — loading overlay
- `tests/bikePath.test.ts` — TDD bikePath tests (6 tests)

## Files Modified

- `src/main.ts` — replaced buildSanityScene with full world boot
- `index.html` — title update; #hero kept as-is (CSS drives height)
- `src/styles.css` — #hero 1450vh, canvas fixed-fill, loader CSS with glitch keyframes

## Test Summary

251 tests pass, 19 test files (all green). 6 new bikePath tests added via TDD.

## Shoot Verification

Shots at t=0, t=0.05, t=0.10 captured and rendered correctly:

- **t=0**: High overhead aerial view (camera at 120, 190, -60) showing full
  cyberpunk city grid — buildings with colored windows, street network visible,
  farField background present. City, traffic, lighting all rendering.

- **t=0.05**: Swoop frame mid-dive between tall buildings. About Street canyon
  visible with billboards, street lamps, building facades. Camera descending
  smoothly between the "two talls" authored in the key.

- **t=0.10**: Street-level chase camera (y=2m) along About Street. Road
  markings and building canyon visible. Camera settles behind bike position.
  Bright billboard/storefront glow visible at street level (expected — intro
  street has sodium-amber signage).

No NaN/black frames. No building clips visible at the authored key positions.
Bike group renders (not visible at t=0 due to overhead angle; at t=0.10 the
camera is ahead of the bike position since chase is near-behind not exact).

## Concerns / Known Issues

1. **Intro title not visible in shots**: The in-world CanvasTexture panel at
   introOverhead anchor (x=-280, y=15, z=0) is not in frame at t=0 (overhead
   camera looks down from x=120) and fades out by t=0.05. The billboard module
   approach works; visual check requires a dedicated camera angle looking at the
   anchor. Deferred to segment-task review.

2. **Bike not visible in shots**: The bike group renders at ROUTE_U.introStart
   (x=-300) at t=0 which is off to the side at the overhead angle. At t=0.10
   it's near x=-260 but the chase camera at (-272, 2, -6) is looking ahead of
   the bike. Bike draw calls are present in the scene graph.

3. **Large storefront glow at t=0.10**: The sodium-amber billboard glow on the
   About Street wall dominates the right side of the t=0.10 frame. This is
   correct city lighting behavior at street level; no geometry error.

4. **Camera key t=0.04 "swoop between two talls"**: The authored key (20, 40,
   -18) puts the camera at x=20 which is city center, not the intro street
   (x=-300 to -260). This produces a valid architectural swoop but not strictly
   "between the intro-street buildings." Later tasks can retune keys when all
   segment content is in place.

5. **ScrollTrigger on #hero**: #hero height is set in CSS to 1450vh. The
   ScrollTrigger pin should work — verified structurally. Full scroll behavior
   requires a real browser session (not shot mode).

6. **Sandevistan Pattern A**: record() called once per frame after bike
   positioning in master's setProgress, per the Task 22 lesson. In ?shot= mode
   each setProgress call fires once, so the trail accumulates correctly on
   forward-only test passes.

---

## Fix Session Report — 2026-07-09

### Fix 1 (CRITICAL): BikeState.quat aliasing — `src/choreography/bikePath.ts`

**Problem:** `_airState()` did `_tmpAxisAngle.setFromAxisAngle(...); const quat = _tmpAxisAngle.multiply(baseQuat)`. The `multiply` mutates and returns `_tmpAxisAngle` itself, so `BikeState.quat` was a direct alias of the module-level temp. Any subsequent `state()` call would silently overwrite it, corrupting callers (tasks 26–30) holding a prior `BikeState`.

**Fix:** Changed to `_tmpAxisAngle.clone().multiply(baseQuat)` so the returned `quat` is always an independent object.

**Ground/air state pos check:** Ground-state `pos` uses `.clone()` — already fresh. Air-state `pos` uses `new THREE.Vector3(...)` — already fresh. Ground-state `quat` uses `new THREE.Quaternion()` — already fresh. Only the air-state `quat` was aliased.

**Also removed:** Unused module-level `_tmpQuat` declaration (dead code).

**Also added:** Public `uAt(t: number): number` method on `BikePath` exposing the internal piecewise-linear u(t) for testability.

### Fix 2 (IMPORTANT): Intro title legible at t=0 — `src/choreography/segments/intro.ts`

**Problem:** The intro title panel was 30×12 world units at street level (y=15). From the t=0 overhead camera at `(120, 190, -60)` looking at `(-260, 0, 0)` (~440 units away, FOV 48), the panel was only ~123 pixels wide and nearly edge-on — unreadable.

**Fix:**
1. Increased panel size to **200×80 world units** (maintains 2.4:1 canvas aspect ratio), filling ~51% of horizontal FOV at 440u distance.
2. Offset mesh in anchor-local space to `(20, 45, 0)` — world position `(-260, 60, 0)`, centering it near the camera's look-at point but elevated.
3. Oriented using `Quaternion.setFromUnitVectors(+Z, directionToCamera)` from mesh world pos `(-260, 60, 0)` toward camera `(120, 190, -60)`.

**Screenshot t=0:** "EVAN LI" wordmark clearly readable in large white bold text, "FULL-STACK · SYSTEMS · RESEARCH" tagline in cyan, "SCROLL TO RIDE ▼" CTA visible below. Panel occupies central ~40% of the frame surrounded by the neon-lit cyberpunk city from above. Panel correctly tilted to face the overhead camera.

**Screenshot t=0.05:** Title completely absent — camera has dived to street level between buildings. No intro panel visible (opacity=0, mesh.visible=false at t≥0.05 per existing fade logic). Street-level city view with neon billboards.

### Fix 3 (CRITICAL): Overlap-throw tests + shared-boundary verification

**`tests/bikePath.test.ts`** (4 new tests added):
- `addSpeedKeys throws when a second batch t-range overlaps an existing batch (interior)` — intro [0,0.10] then [0.05,0.28] → throws `/overlapping t range/i`
- `addSpeedKeys does NOT throw when second batch starts at exact boundary t` — [0,0.10] then [0.10,0.28] → no throw
- `addSpeedKeys: non-overlapping sequential batches assemble correctly` — verifies `uAt()` values at boundaries
- `airborne BikeState.quat is an independent object` — snapshot test proving Fix 1 works

**`tests/cameraRig.test.ts`** (new file, 5 tests):
- Interior overlap throws, shared boundary doesn't throw, sequential [0,0.10]+[0.10,0.28] doesn't throw, evaluate produces finite values, multi-batch interior overlap throws

**Shared-boundary:** The existing guard `if (newMin < existingMax - 1e-9)` already permits boundary sharing. No code change needed. Verified tasks 26–30 handoff (t=0.10) will not throw.

### Fix 4 (MINOR): Monotonicity test + dead code

Both monotonicity tests rewritten to use `bp.uAt(t)` directly with explicit assertions (`u >= prevU - 1e-12`) instead of the no-op `void state; void prevU` loop body. Dead `_tmpQuat` declaration removed.

### Test Results

```
npx vitest run --no-file-parallelism --pool=forks
Test Files  20 passed (20)
Tests       260 passed (260)
Duration    ~10s
```

### Build

```
npm run build
✓ built in 389ms  (chunk size warning is pre-existing, not an error)
```
