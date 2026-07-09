# Task 6 Report: Route spline + segment map

## Implemented

- `src/world/route.ts`
  - `WAYPOINTS`: the 14 named `THREE.Vector3`s verbatim from the brief (introStart → bridgeEnd).
  - `ROUTE`: `THREE.CatmullRomCurve3` through `Object.values(WAYPOINTS)` in ride order, `curveType: 'centripetal'`, open (not closed).
  - `ROUTE_U`: computed once at module load by sampling `ROUTE.getPointAt(i/4096)` for `i in [0,4096]` and, per waypoint, taking the `i` whose sample is nearest (squared distance) to the waypoint's authored position, `u = i/4096`.
  - `MOON_POS = (240, 260, -2600)`, `MOON_RADIUS = 320`.
  - `roadFrame(u)`: clamps `u` to `[0,1]`, returns `{ pos, tangent, normal, binormal }` where `binormal = normalize(tangent × worldUp)` (falls back to `tangent × (1,0,0)` if tangent is ~parallel to up, to avoid a zero-length cross product), and `normal = normalize(binormal × tangent)`.
- `tests/route.test.ts` — 5 tests per the brief's Step 1 criteria (length, shibuyaCenter proximity, skywayEnd y, binormal unit-length/perpendicularity across 20 sampled u) plus one sanity test on WAYPOINTS/MOON constants.
- `src/main.ts` — registers `routeDebug` (see below), imports `ROUTE`/`WAYPOINTS` from `./world/route` and `makeCanvasTexture` from `./utils/canvasText`.

## TDD: RED then GREEN (real output)

RED (route.ts did not exist yet):
```
 FAIL  tests/route.test.ts [ tests/route.test.ts ]
Error: Cannot find module '../src/world/route' imported from .../tests/route.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN (after implementing route.ts):
```
 RUN  v4.1.9 /mmfs1/gscratch/intelligentsystems/evanly/cybersite
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Full suite after adding the routeDebug viewer code (`npm test`):
```
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

Sanity-checked the exact numbers offline (`node` script using the same waypoints/three version):
- `ROUTE.getLength()` = **1948.05 m** (in `[1650, 1950]`, but only ~2m of headroom under the upper bound — flagging as a concern below).
- `ROUTE.getPointAt(ROUTE_U.shibuyaCenter)` = `(239.976, 0, 0.0237)`, distance **0.034 m** from `(240,0,0)` (well within 8m).
- `ROUTE.getPointAt(ROUTE_U.skywayEnd).y` = **27.996**, within 1m of 28.

`npm run build` (`tsc --noEmit && vite build`): clean, no errors.

## routeDebug viewer asset

Registered in `src/main.ts` (same pattern as `testCube`/`adWall`): a `THREE.Group` containing
- a `TubeGeometry` built directly along the real `ROUTE` (512 tubular segments, 12 radial segments, open), emissive cyan (`COLORS.tronCyan`), and
- one magenta emissive marker sphere + one canvas-sprite text label (via `makeCanvasTexture`, `Share Tech Mono`) per `WAYPOINTS` entry.

**Important deviation from the brief's literal "radius 0.5":** at true scale (waypoints span ~540m in X, ~1400m in Z), the viewer's generic auto-framing camera lands ~2600 units back from the bounding-sphere center. `core/core.ts`'s `FogExp2` (density 0.0016) is tuned for the ~10–20-unit sanity props elsewhere in `main.ts`; at that camera distance the fog factor is effectively `exp(-13)` — i.e. the whole scene renders solid black. First screenshot attempt confirmed this (all 4 angles pure black, no console errors, `window.__READY` true, empty error-message div).

Per the brief's own guidance ("if framing is too tight/far to judge, adjust the debug asset, e.g. scale — not the route"), I added a `DISPLAY_SCALE = 0.15` applied to the whole `routeDebug` group, and pre-divided the tube radius (1.2), marker radius (3.5), and label size/offset by `DISPLAY_SCALE` before building the geometry, so the *positions* shrink (bringing the camera back into the fog-transparent range) while the *rendered* tube/marker/label sizes stay the same as if built at `DISPLAY_SCALE = 1`. `ROUTE` itself (the actual exported curve used by tests and future tasks) is completely untouched — only the debug-viz group's local geometry differs from the literal "radius 0.5."

## What I saw in the PNGs (`shots/routeDebug-a{0..3}.png`)

- **a0** (front-ish): the long flat +X leg (introStart→shibuyaCenter) is horizontal in the lower-left, pink markers cluster at aboutStart, then a right turn into a diagonal leg rising up-and-right through the ramp/skyway waypoints to bridgeEnd at the top. Labels (`aboutStart`, `shibuyaCenter`, `skywayTop`, `skywayEnd`, `bridgeEnd`, etc.) are legibly rendered near their markers, some overlapping where waypoints are close together (the ramp1/ramp2 cluster).
- **a1** (45°): from this azimuth the two legs of the L appear to converge into a "V" due to perspective foreshortening — this is a viewing-angle artifact, not an actual route problem (confirmed by a0/a2/a3 all showing the same L unambiguously).
- **a2** (90°, near side-on): cleanest read — a clear right-angle L: flat leg from introStart to shibuyaCenter, then a corner, then a long leg that stays essentially level through ramp1Base/Land/ramp2Base/Land/skywayStart before angling upward through skywayTop/skywayEnd and continuing up to bridgeEnd.
- **a3** (135°): route reads as one continuous rising diagonal line (both legs nearly collinear from this angle) with markers/labels visible along its length, bridgeEnd clearly at the far end.

**Ramp "bumps" — none, by design of the given coordinates.** All of `ramp1Base/ramp1Land/ramp2Base/ramp2Land` (and `skywayStart`) are `y=0` per the brief's exact waypoints — there is no vertical elevation change until `skywayStart(0) → skywayTop(28)`. So visually the route is flat from `shibuyaCenter` all the way to `skywayStart`, then climbs. This matches what the screenshots show (flat until the climb) and matches the literal coordinates given — I did not alter waypoint values to manufacture bumps. The task-instruction phrase "two ramp bumps on the −Z leg" appears to be a naming-based expectation rather than something encoded in these exact coordinates; flagging this explicitly since it's the one place the visual doesn't match the orchestrator's prose description, even though it matches the brief's coordinates exactly.

The skyway climb and long bridge run are clearly visible in a2/a3.

## Files changed
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/world/route.ts` (new)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/tests/route.test.ts` (new)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/main.ts` (modified: routeDebug registration + `buildRouteDebug`)

## Self-review

- `ROUTE_U` nearest-sample approach matches the brief exactly (4096 samples, nearest point).
- `roadFrame`'s binormal formula matches the brief's spec literally (`tangent × up`, re-orthogonalized), with a defensive fallback for the degenerate case where tangent is parallel to world-up (doesn't occur anywhere on this route, but guards against future waypoint edits producing a vertical tangent).
- Route length (1948.05m) is within spec but has very little margin (~2m) below the 1950 upper bound. It's a fixed deterministic value (no randomness), so it won't flake between runs, but any future waypoint tweak that adds even a little curve overshoot could push it over. Worth knowing for whoever edits waypoints later.
- The `DISPLAY_SCALE` hack in `buildRouteDebug` is a bit unusual (dividing radii by scale before multiplying group scale back down) — documented with an explicit comment in `main.ts` explaining why, since it deviates from the brief's literal "radius 0.5" for the *debug visualization only* (not `ROUTE` itself, which is unaffected and is what all later tasks import).
- Did not modify `core/core.ts`'s fog or the viewer's generic auto-framing logic — kept the fix scoped to the debug asset as instructed.
- `npm test` (11/11) and `npm run build` both clean at time of commit.

## Concerns for downstream tasks
- Route length has thin margin under the 1950m cap (see above).
- Fog/auto-framing in `viewer.ts`/`core.ts` is tuned for small (~10-20 unit) props; any future large-scale (city-block-sized) viewer asset will hit the same all-black-fog issue and need a similar display-scale workaround, or a fix to the viewer's fog/framing for large objects.
