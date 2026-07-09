# Task 7 Report: Streets, intersection, skyway, bridge

## Implemented

`src/world/streets.ts` — `buildStreets(rng)` plus `STREET_WIDTH = 14`, `SIDEWALK_W = 3`, and three debug-only viewer sub-assets (`buildStreetsShibuya`, `buildStreetsRamp`, `buildStreetsBridge`), wired into `src/main.ts` as `streets` / `streetsShibuya` / `streetsRamp` / `streetsBridge`.

Per brief Steps 1–3:
- **Road surfaces**: About street (flat box, 560×0.2×14 along X, centered between `introStart`/`shibuyaCenter`), Projects boulevard (three flat segments skipping the ramp/gap zones, 14 wide along -Z), two ramp pairs (launch wedge at `ramp1Base`/`ramp2Base` + landing wedge at `ramp1Land`/`ramp2Land`, `ExtrudeGeometry` triangle profile, 8m long / 2.6m lip), Shibuya plaza slab (40×40, raised 2cm above the road to avoid z-fighting), elevated skyway deck (10 wide, 1.1m guard rails, ground pylons every 30m wherever aloft) + a width-interpolating connector to the bridge, ocean bridge (12 wide deck, 2 suspension towers 40m tall with holo-teal beacon tips, sagging main cables via `CatmullRomCurve3` + `TubeGeometry`, cyan edge-light strips on skyway/connector/bridge). Road material: `MeshStandardMaterial` `#0a0c14`, roughness 0.35, metalness 0.75, exactly per brief.
- **Markings + crossing**: lane dashes/edge lines/center lines built as individual small boxes (not a repeating canvas texture on overlay planes as the brief suggested — see Deviation note below) merged into one paint mesh. Shibuya decal: a 1024px canvas texture with 2 orthogonal crosswalks + a diagonal X (6-armed scramble star), white at 60% alpha, worn via ~900 random destination-out speckle-erase circles seeded by `rng`. 4 corner sidewalk bulbs.
- **Sidewalks + curbs**: 3m sidewalks both sides of both streets (the curb *is* the 0.15m raised box height, no separate curb geometry), concrete texture (`#14182a`) with expansion-line canvas texture, tiled via `RepeatWrapping`.

Draw-call count: **9 meshes**, each verified to be a genuine single WebGL draw call (dumped `Array.isArray(mesh.material)` for all 9 → `false`; three.js's `WebGLRenderer.projectObject` only iterates `geometry.groups` when material is an array, so a single-Material mesh renders in one call regardless of how many parts `mergeStatic` originally grouped it from). ~15.4k triangles total. Well under the `<25` target.

## Deviation from brief

Step 2 suggested "repeating CanvasTexture on thin overlay planes" for lane dashes/edge lines. I implemented dashes/solid lines as individual small boxes (merged into one mesh, one material, no texture) instead — same visual result, avoids UV-repeat-scaling bookkeeping across straight segments of varying length, and the boxes have real thickness so there's no z-fight to manage at all (vs. planes + polygonOffset + y-offset). Canvas textures are still used exactly per brief for the two things that actually need a unique 2D pattern: the Shibuya crossing decal and the concrete expansion-line/manhole-grate textures.

## Iteration log (Step 4, 3-iteration detail loop)

Before the formal loop, an initial build/shoot pass surfaced and fixed three real bugs (not part of the 3-round detail loop, but worth recording):
1. `mergeGeometries` threw ("all geometries must have compatible attributes") because `ExtrudeGeometry` (ramp wedges) is non-indexed while `BoxGeometry`/`CylinderGeometry`/`SphereGeometry`/`TubeGeometry` are indexed — fixed by calling `.toNonIndexed()` on every non-wedge geometry.
2. The whole-network `streets` viewer shot renders fully black — the group's bounding radius is ~765m, so the auto-framed camera sits ~2600m back, deep into `FogExp2` falloff at true scale (same phenomenon documented for `routeDebug`/`DISPLAY_SCALE` in Task 6). This is expected and pre-acknowledged by the brief; `streetsShibuya`/`streetsRamp` (plus a `streetsBridge` I added) are the actual verification tools.
3. My first crossing-texture draw had the stripe elongation axis and repeat axis swapped, plus both orthogonal crosswalks rotated 90° from correct, producing solid rectangular blocks instead of zebra stripes. Found by dumping the raw canvas texture directly (bypassing the 3D scene) and compositing it onto a dark background. Fixed `stripeBand`'s parameter semantics and the two crossing angles; re-dumped and confirmed a correct 6-armed scramble pattern.

**Round 1 — saw:** A tight, brightened closeup of the ramp sub-asset showed the asphalt as a completely flat, uniform dark plane — zero surface variation, reads as synthetic/CG rather than a gritty night-city street.
**Added:** Worn asphalt patches via per-vertex-color darkening (`applyWornPatches`) — ~40 random patch centers, radius 4–14m, darkness 0.3–0.7, multiplied into a `color` vertex attribute on the merged road mesh with `material.vertexColors = true`.
**Verified:** Dumped the mesh's `color` buffer directly — values range 0.495–1.0 (confirmed non-uniform, real). Visually it's subtle in the debug viewer's flat ambient lighting on the near-black (`#0a0c14`), highly metallic (0.75) road material — the diffuse/albedo tint that vertex colors drive is a small fraction of what's visible when most of the image is near-black. This will read more clearly under the actual game scene's headlight cone / neon reflections, which rake light across the road at low angles.

**Round 2 — saw:** No lane-center guidance markers at all; nothing suggesting a lit night street once headlights aren't present in the debug scene.
**Added:** Cat-eye reflector dots (`sodiumAmber` emissive) every ~12m down both lane centers of the boulevard (real asset), plus matching dots in the `streetsRamp` debug sub-asset for verification.
**Verified:** Screenshot shows clearly visible bloomed amber dots down both lanes — immediately reads as a real lit street. (One reflector briefly floated over the ramp's open-air gap in the debug sub-asset; tightened the placement loop to stay within the flat approach/runoff spans only — real `buildStreets` asset was never affected since its reflector loop already iterates per actual flat segment.)

**Round 3 — saw:** No infrastructure detail breaking up the road surface — no utility covers, nothing suggesting a maintained city street.
**Added:** Manhole covers (canvas grate texture, dark metal) along About street / boulevard lane edges, storm-drain slots at the curb line on both streets.
**Verified:** Confirmed present via mesh traversal / geometry count; visually subtle at debug-viewer exposure for the same reason as Round 1 (dark, non-emissive, low-contrast against dark asphalt) — same expectation that it reads better under real scene lighting.

## Checks (brief Step 4 / task instructions)

- **Ramps read as jumpable wedges**: confirmed — `streetsRamp` debug sub-asset (compressed synthetic layout, see file comment) clearly shows a rising launch wedge and a stepped-down landing block with a visible gap between them.
- **Crossing reads as Shibuya**: confirmed — `streetsShibuya` decal shows the classic 6-armed scramble pattern (2 orthogonal crosswalks + diagonal X) after the stripe-axis bug fix.
- **Bridge cables sag naturally**: confirmed — added a `streetsBridge` debug sub-asset (synthetic straight two-tower span, same tower-height/cable-sag math as the real bridge, since the real bridge sits ~900m out and renders fog-black at true scale) showing a clean two-hump "M" catenary-like sag between anchors → tower tops → midspan low point → tower tops → anchor.
- **Draw-call count**: 9 meshes / 9 real WebGL draw calls (verified, see above), ~15.4k triangles.

## Files changed

- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/world/streets.ts` (new, ~980 lines)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/main.ts` (added imports + 4 `registerAsset` calls: `streets`, `streetsShibuya`, `streetsRamp`, `streetsBridge`)

## Self-review / concerns

- `npm run build` (tsc --noEmit + vite build) and `npm test` (12→11 real tests, debug tests removed) both pass clean.
- The two "subtle at debug-viewer exposure" details (worn patches, manholes) are implemented and numerically verified correct, but I could not get a fully convincing *visual* confirmation under the viewer's flat preview lighting — flagging this honestly rather than overstating the screenshot evidence. Both will need re-checking once the real scene lighting (headlights, moonlight, neon) exists.
- `buildStreetsRamp`/`buildStreetsShibuya`/`buildStreetsBridge` use deliberately compressed/synthetic layouts (not true world coordinates) purely so the viewer's bounding-sphere auto-framing can get close enough to be useful — documented inline with the same justification Task 6 used for `DISPLAY_SCALE` ("adjust the debug asset, not the route").
- Mesh count (9) is comfortably under budget; there's room to add more detail (e.g., streetlights, traffic signal poles at Shibuya) in a later task without threatening the draw-call budget.
- Did not add hangers/vertical suspender cables on the bridge (only the 2 main sagging cables per side) — brief only asked for "catenary cables," which is satisfied; hangers would be a nice-to-have for a future pass.

## Post-review fixes (coordinator review: 1 Critical + 2 Important)

1. **CRITICAL — 10m hole in drivable surface closed.** `buildBoulevard` keyed its north end off `driftExit` (z = -30), but the plaza slab only covers z in [-20, +20], leaving x in [233, 247], z in (-30, -20) uncovered on the ride path. Fixed by starting all boulevard surfaces (road segment, both sidewalks/curbs, markings, reflectors) at `zTop = -PLAZA_SIZE / 2` (-20). Exact abutment at z = -20 — no overlap, so no double-stacked z-fight at the join. Regression-tested via downward raycast at (240, 5, -25) expecting a hit at y ~= 0 (this ray hit nothing before the fix).

2. **IMPORTANT — About-street markings clipped at plaza west edge.** Edge lines, centerline, and lane dashes ran through the plaza footprint at y 0.02-0.025, poking above the plaza top (y = 0.02) and cutting a painted stripe through the scramble decal. All About markings now clip at `clipX = shibuyaCenter.x - PLAZA_SIZE/2` (x = 220), matching what the debug sub-asset already did. Also clipped the About sidewalks there (same class of bug, worse: they poked 0.13m above the plaza). The road slab itself still runs under the plaza (its y = 0 top is fully covered by the plaza's y = 0.02 top). Regression-tested via raycast at (230, 5, 0): topmost opaque hit must be the plaza top (<= 0.021), not a marking box (0.025).
   Bonus: fixed two latent bugs in the `streetsShibuya` debug sub-asset found while verifying — its About stub was placed EAST of the plaza (production has no street east; approach is from the west) and its X-axis markings were passed plaza-relative coords (rendered as a stray floating cluster at x in [20, 45] in earlier screenshots).

3. **IMPORTANT — automated tests added.** `tests/streets.test.ts` (5 tests, house style per `tests/route.test.ts`, with a minimal `document` stub so canvas-texture creation runs under node): constants match brief (STREET_WIDTH=14, SIDEWALK_W=3); buildStreets returns a Group with 1-25 meshes and no array materials (each mesh = one real draw call); determinism (two seed-1 builds -> identical mesh count + first-mesh vertex count); gap regression raycast; marking-clip regression raycast.

**Verification:** `npm run build` clean, `npm test` 16/16 green (11 prior + 5 new). Re-shot `streetsShibuya` from two angles and read the PNGs: scramble decal intact with no stripe through it, About dashes/edge-lines terminate exactly at the plaza edge, boulevard abuts the plaza as one continuous surface with no hole or seam artifact.
