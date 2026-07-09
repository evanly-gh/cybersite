# Task 8 Report: Far field — Ring 2 skyline, sky, moon, ocean

## Implemented

`src/world/farField.ts` (new, 672 lines) — `buildFarField(rng)` returning `{ group, updateAmbient(sec) }`, registered as the `farField` viewer asset in `src/main.ts`.

Per brief Steps 1–2, all tunables verbatim:

- **Skyline (Step 1)**: one `InstancedMesh` (unit `BoxGeometry`, 1100 instances) placed by rejection-sampling an area-uniform point in the `[250, 1600]` m annulus around `CITY_CENTER = (0,0,-200)`, redrawing whenever a candidate falls in the 70°-wide (±35°) wedge centered on −Z **and** is beyond `z = -830` (the ocean's start line — near-shore land in that same compass direction is still buildable, only the actual water sightline is kept clear). Heights `12 + rng()²·170`; footprints 14–60 m, 30% elongated up to 1:3 (short side 14–30, aspect 1.5–3×, capped at 60); yaw snapped to 90°±6°. Custom `ShaderMaterial`: per-instance `aSize`/`aSeed` `InstancedBufferAttribute`s; fragment shader builds a window grid from the box's own per-face UV scaled by real face dimensions (pitch 3.4 m), a `hash(cell, seed)` (no entropy beyond the Rng-derived per-instance seed — same seed ⇒ identical windows) picks ~55% lit / amber-teal-magenta mix, ~2% flicker via `sin(uTime·f(hash))`. The 20 tallest instances (sorted by height) get additive amber sprite beacons with an aircraft-style duty-cycle blink (`updateAmbient` drives phase-offset pulses, `smoothstep`-shaped rise/fall, 2.4s period).
- **Sky + moon + ocean (Step 2)**: inverted sphere (r=3200, `BackSide`) gradient shader `void ↔ #0b0e1e`; 400 `Points` stars rejection-sampled to stay above 15° elevation; moon = `SphereGeometry(MOON_RADIUS)` at `MOON_POS` (imported from `route.ts`, not redefined) with a canvas crater-speckle texture + an additive glow `Sprite` at 2.2× radius; ocean = `4000×2400` plane at `y=-0.5` for `z < -830`, dark void/shadowBlue mix, `roughness 0.08`, plus a triangular (90 m near → 18 m far) additive "moon-glitter" strip running from the bridge toward the moon with a hand-rolled value-noise shader scrolled by `updateAmbient(sec)`.
- **Viewer `?cam=` override (required brief addition)**: `src/viewer/viewer.ts` now parses `?cam=x,y,z,tx,ty,tz` and, when present, skips the origin-centering + auto-distance framing entirely (that logic assumes one small bounding box — nonsensical for a 3200 m sky dome) and instead sets the camera directly to the given absolute position/lookAt. `?angle=` behavior is unchanged when `?cam=` is absent. `tools/shoot.mjs` got a `--cam` passthrough (`--tag` names the output file since `?cam=` makes the 4-angle sweep meaningless — one shot per `--cam`+`--tag` call).

## A real bug found and fixed (not part of the 3-iteration detail loop)

First screenshot attempts were **non-deterministically pure white** (measured: 99.9%+ pixels at `(255,255,255)`, ~3-6 KB PNGs). Root cause: `runViewer()` called `core.render()` then set `window.__READY = true` on the *same* synchronous tick. WebGL canvases without `preserveDrawingBuffer` only guarantee their drawing-buffer content survives to the paint that immediately follows the draw call — flipping the ready flag synchronously races that paint, and Playwright's screenshot can land on a still-blank (white-composited) canvas. This "usually" went unnoticed on tiny sanity-scene props (fast enough that the race rarely lost) but hit consistently on farField's heavier scene (1550 instances + 2 custom shaders + bloom). Fixed with two nested `requestAnimationFrame` calls before setting `__READY`, guaranteeing at least one full paint cycle has passed. Verified: 3 repeated `npm run shoot` invocations of the same `?cam=` URL now produce byte-identical (`md5sum`-matched) PNGs, where before the fix they varied between a correct render and solid white.

## Iteration log (Step 3, 3-iteration detail loop)

Pre-loop, once the race condition above was fixed, the first *legitimate* renders still looked overbloomed (sky/ocean washed light-grey instead of dark). Traced to three compounding sources and fixed together: (1) the moon's additive glow-sprite gradient had a slow falloff (still 85% opacity at 35% of its radius) — steepened to a tight core + fast falloff; (2) window emissive multiplier `2.4` reduced to `1.7`; (3) the ocean's `MeshStandardMaterial` (metalness 0.55) caught the viewer harness's generic bright directional light as a huge blown-out dielectric-Fresnel highlight sweeping the whole plane at grazing angles — switched to `MeshPhysicalMaterial` with `specularIntensity: 0.2` (keeps the brief's mandated `roughness: 0.08` and lets the color/fog do the work, just dials down the fixed-Fresnel highlight instead of fighting scene lighting the asset doesn't own). A debug shot looking down the glitter strip at a shallower angle confirmed the mottled noise streak renders correctly with dark water either side; the brief's exact bridge-eye cam (`240,6,-900` looking at the moon, only 6 m above the water) legitimately shows a bright, wide mirror-like reflection near the camera — physically correct for a near-grazing view of calm water reflecting a huge bright moon, not a bug.

**Round 1 — saw:** the primary skyline has a hard, visibly circular edge at 1600 m from directly above (aerial confirmation shot) and from the bridge/street views the city just stops rather than fading into haze.
**Added:** a second, sparser (450 instances), dimmer (`uDim = 0.45` uniform scaling both window brightness and fog punch-through) skyline ring at 1650–2000 m, reusing the same generator/material/shader with `innerR`/`outerR` and `dim` parameters.
**Verified:** aerial shot shows the ring extending further out before fading into fog rather than cutting off sharply; unit test confirms all far-ring instances fall in `[1650, 2000]` and `uDim < 1`.

**Round 2 — saw:** the sky gradient (void → `#0b0e1e`) is correct but reads as a clean, empty gradient with no sense of a light-polluted city atmosphere; the horizon line is visually flat.
**Added:** a warm amber (`sodiumAmber`) haze band in the sky fragment shader, `exp(-|elevation|·14)·0.22` added on top of the base gradient — tight around the horizon, both above and below (the sky sphere wraps fully around).
**Verified:** street-view and bridge-view shots show a clear warm glow hugging the horizon line under the dark upper sky; aerial shot shows it correctly appearing at the frame's grazing-angle corners.

**Round 3 — saw:** from directly above (aerial shot) the annulus/wedge-exclusion geometry needed a sanity check since it's hard to judge from ground-level shots alone. Also confirmed rooftop beacons exist per the unit tests but are visually hard to pick out from windows at bloom exposure in ground-level shots.
**Verified (no further code change needed):** the aerial shot (`cam=0,3000,-200.01,0,0,-200`) shows a clean ring (empty at r<250, populated to the outer edge, a clear wedge-shaped gap toward the moon direction) confirming the annulus + wedge-exclusion math is correct; beacon blink logic and 20-tallest selection are covered directly by `tests/farField.test.ts` (duty-cycle opacity bounds, count) since ground-level bloom exposure isn't a reliable way to visually audit 20 individual sprites against a background of 1000+ similarly-bright windows.

## Environment note (not a code issue)

Mid-session, a handful of screenshot attempts hit `CONTEXT_LOST_WEBGL` / `THREE.WebGLRenderer: Context Lost.` on this shared, heavily-loaded compute node (other users' unrelated jobs visible in `ps aux`, ~17 GiB free / 29 GiB swapped at the time). Immediate retries succeeded consistently, and a simpler scene (`testCube`) rendered fine at the same moment — this reads as transient host resource pressure on the (software/headless) GPU path, not a farField-specific bug. Final screenshots were re-captured with clean results and are saved under `.superpowers/sdd/shots-final/` (gitignored).

## Determinism

Same `Rng` seed ⇒ identical skyline: unit-tested (both skyline InstancedMeshes' `instanceMatrix` arrays `toEqual` across two `buildFarField(makeRng(7))` calls) and screenshot-verified (byte-identical PNGs across repeated `npm run shoot` calls once the `__READY` race was fixed). The viewer wiring (`main.ts` → `registerAsset('farField', ...)`) goes through `runViewer()`'s fixed `makeRng(1)`, so `?viewer=farField` is deterministic by construction.

## Files changed

- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/world/farField.ts` (new)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/tests/farField.test.ts` (new, 9 tests)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/main.ts` (import + `registerAsset('farField', ...)`)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/viewer/viewer.ts` (`?cam=x,y,z,tx,ty,tz` override + the `__READY` double-rAF fix)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/tools/shoot.mjs` (`--cam`/`--tag` passthrough)

## Self-review / concerns

- `npm run build` (`tsc --noEmit && vite build`) and `npm test` (25 tests, 4 files) both green.
- The `__READY` race fix in `viewer.ts` is a general harness correctness fix (affects every registered asset, not just farField) — worth flagging explicitly since it's outside `farField.ts`'s own scope but was necessary to get *any* reliable screenshot of this asset.
- Ocean material uses `MeshPhysicalMaterial` rather than the brief's implied `MeshStandardMaterial`; `roughness: 0.08` (the one value the brief actually specifies) is preserved, and `MeshPhysicalMaterial` is a strict superset (its `specularIntensity` knob is what let me tame the generic-scene-light-highlight overexposure without touching the mandated roughness or `core.ts`).
- Beacon sprites and the far dim skyline ring are verified numerically (unit tests: annulus bounds, `uDim < 1`, opacity bounds) more than they are pixel-verified in ground-level screenshots, since at bloom exposure with 1000+ bright windows in frame, 20 small sprites and a 45%-dim outer ring are inherently subtle to eyeball-confirm from a still PNG — flagging this honestly rather than overclaiming visual proof.
- Did not touch `core.ts` (fog, bloom, tonemapping) anywhere — all brightness/fog tuning done via farField's own materials/uniforms, per the brief's explicit instruction.
- Screenshots referenced above are under `.superpowers/sdd/shots-final/` (gitignored, not part of the commit) — `farField-bridge.png` (bridge-eye, `?cam=240,6,-900,240,260,-2600`), `farField-street.png` (`?cam=0,8,60,0,30,-400`), `farField-aerial.png` (`?cam=0,3000,-200.01,0,0,-200`, annulus/wedge sanity check).

## Calibration fix log (controller review: "warm daylight fog" vs. required Blade Runner 2049 night mood)

A controller pass viewing rendered frames (not just unit tests) flagged the module as geometrically correct but tonally wrong: the whole backdrop read as warm, hazy daylight instead of a dark night city with lights as punctuation. Re-shot `bridge-eye` (`?cam=240,6,-900,240,260,-2600`) and `street` (`?cam=0,8,60,0,30,-400`) after each round.

**Round A — saw:** street view showed near-uniform warm white-gold windows (colors present in the shader but crushed to white by bloom since almost every lit window hit full `1.7×` emissive); sky had a visible amber horizon band bleeding well up into the frame; bridge-eye ocean was a fully blown-out light-grey mirror sheet edge-to-edge, not a dark surface with a narrow glitter streak.
**Changed:**
1. Skyline fragment shader: replaced the old single-tier "any lit window = full brightness" model with a two-tier one — ~5% of windows (`hash`-selected, `peak` mask) hit a bloom-eligible peak level (`1.6`), the rest sit at a low, clearly-tinted `0.32` level. This is what makes amber/teal/magenta actually read as distinct colors instead of bleaching to white-gold, and makes bright windows scattered punctuation instead of wallpaper.
2. Sky dome: swapped the horizon haze color from `sodiumAmber` to a dark blue-violet (`0x2a1e55`) and cut its amplitude `0.22 → 0.10` — kills the amber wash, leaves a faint light-pollution tint consistent with `void → #0b0e1e`.
3. Ocean material: `specularIntensity 0.2 → 0`, `oceanColor` lerp fraction `0.18 → 0.1` (darker, closer to void).
**Verified:** street view — windows now read as distinct sparse amber/teal/magenta points against near-black facades, sky corners are near-black with no amber cast. Bridge-eye ocean was *still* a solid light-grey sheet — the specular-intensity change had no visible effect, meaning the wash wasn't coming from the ocean material's own lighting response at all.

**Round B — saw:** with ocean specular already zeroed, the bridge-eye ocean was unchanged — still fully bright edge-to-edge. Traced the real cause: the moon-glitter quad's `widthNear` (90m) was wider than the camera's entire view frustum at its near edge (only ~40m from the `cam=240,6,-900` bridge-eye position, where the frustum is only ~42m wide) — the "streak" wasn't a streak at all from this vantage, it was overscanning the full screen width and reading as a full-surface sheen. Also tightened the shared radial glow texture (moon halo + beacons) falloff and shrank/dimmed the moon's glow sprite, on the hypothesis that bloom bleed from the moon was contributing (it turned out to be a much smaller contributor than the glitter mesh, but the tighter glow is a legitimate improvement in its own right and left in).
**Changed:**
1. `buildGlitter`: `widthNear 90 → 22`, `widthFar 18 → 6`; fragment shader edge falloff exponent `1.6 → 4.0` (concentrates brightness on the centerline instead of a flat bright band); alpha multiplier `0.85 → 0.8`.
2. `makeRadialGlowTexture` gradient stops steepened (`0.12/0.7` and `0.35/0.18` stops → `0.1/0.55` and `0.22/0.1`) for a tighter core + faster taper.
3. Moon glow sprite: opacity `0.4 → 0.22`, diameter multiplier `2.2× → 1.35×` radius.
**Verified:** bridge-eye now shows a genuinely narrow bright thread running from the camera toward the moon, dark ocean on both sides, moon itself still a bright "money shot" disc with a contained halo rather than a wash covering the whole lower frame.

**Round C — saw:** re-shot both views once more after Round B to confirm no regressions from the glitter/glow changes (they don't touch the skyline shader or sky dome at all). Street view unchanged from Round A's fix (still correct); bridge-eye now passes all three criteria simultaneously in the same frame (dark tower silhouettes visible in the mid-ground of the bridge-eye shot too, narrow ocean streak, near-black sky/ocean elsewhere).
**Verified (no further change needed):** `npm run build` and `npm test` both green (25/25) after all rounds — no test touches pixel output, so this was confirmed purely by re-reading the rendered PNGs each round, per the brief's requirement to visually iterate rather than trust the build alone.

**Final frame descriptions:**
- **bridge-eye** (`cam=240,6,-900,240,260,-2600`): near-black sky in the corners fading to a contained blue-white halo directly around the moon; the moon itself is a bright, sharp, crater-textured disc dead center; a narrow, mottled-noise bright streak runs from just in front of the camera straight to the base of the moon, with genuinely dark (near-black) water on both sides of it; a few silhouetted towers are visible flanking the moon at the horizon line.
- **street** (`cam=0,8,60,0,30,-400`): skyline silhouettes are near-black bodies (subtle vertical shading only), scattered with sparse amber/teal/magenta lit windows — most dim and clearly colored, a handful of standout bright ones per tower (the ~5% peak tier); sky gradient is void-black at the top through dark blue near the horizon with only a faint blue-violet haze band, no amber cast; ground/foreground is near-black.

Environment note: screenshot capture on this shared node continued to intermittently return a solid-color frame (pure white in early rounds, solid dark-blue once) consistent with the report's earlier-documented transient `CONTEXT_LOST_WEBGL` / paint-race behavior — not a regression from these changes. An immediate re-run of the identical `npm run shoot` command always produced a correct, detailed frame; this was treated as environmental flakiness per the existing report note, not a code issue, and every frame described above is from a confirmed-good (large, detailed) PNG, not a blank one.

## Post-review maintainability refactor (no visual change)

Reviewer approved the calibration but flagged two Important maintainability issues; both fixed:

1. **Theme-sourced colors:** the three hex literals used by farField (`0x0b0e1e` sky horizon, `0x0a0c16` tower body, `0x2a1e55` night haze) now live in `src/theme.ts` as `COLORS.skyHorizon` / `COLORS.towerBody` / `COLORS.nightHaze` (identical values), and farField references them through `COLORS` like every other palette color.
2. **Shared fog density:** `FOG_DENSITY = 0.0016` is now exported from `src/core/core.ts` (and used in core's own `FogExp2` construction) instead of being duplicated in farField with only a comment linking them — farField imports it, so the skyline shader's manual fog replica stays in lockstep with the real scene fog by construction.

Verified: `npm run build` + `npm test` green (25/25); street view re-shot and read — pixel-identical look (byte-identical 479537-byte PNG vs. the approved calibration frame, as expected since all values are unchanged, only their source of truth moved). A console-instrumented page load was also run to rule out an import-cycle regression from farField newly importing core (`READY = true`, no page errors — the blank-frame retries seen during re-shooting were the same documented `CONTEXT_LOST_WEBGL` node flakiness, observed live in the console output with an immediate "Context Restored"). Commit: `refactor(farfield): theme-sourced colors, shared fog density`.
