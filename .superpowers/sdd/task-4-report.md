# Task 4 Report: Core renderer + post-processing + quality tiers

## Implemented

- **`src/core/core.ts`** (new): `initCore(canvas): Core` exactly per the interface in the
  brief (`renderer`, `scene`, `camera`, `render()`, `onFrame()`, `start()`, `setQuality()`,
  `quality`).
  - Renderer: `antialias: true`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure
    = 1.1`, `setPixelRatio(min(devicePixelRatio, 1.75))`.
  - Scene: `background = COLORS.void`, `fog = FogExp2(COLORS.void, 0.0016)`.
  - Camera: `PerspectiveCamera(55, aspect, 0.1, 4000)`.
  - Composer chain: `RenderPass` → `UnrealBloomPass(strength 0.9, radius 0.6, threshold
    0.75)` → inline `ShaderPass` (chromatic aberration + vignette) → `OutputPass`.
  - CA/vignette fragment shader: samples R/G/B at `vUv ± normalize(uv-0.5) * 0.0015 * dist`
    (radial offset scaled by distance from center so it's ~0 at screen center and grows
    toward the edges), then multiplies by `mix(1.0, smoothstep(0.95, 0.55, dist), 0.35)` —
    a vignette that only darkens the outer 35%-strength band between radius 0.55 and 0.95.
  - Quality tiers: tier 2 leaves `UnrealBloomPass` at its natural (composer-driven) internal
    resolution, which is exactly half the effective (DPR-scaled) framebuffer size — this
    *is* the "resolution ½" the brief specifies as the base spec, since `UnrealBloomPass`
    always internally halves whatever width/height it's given via `setSize()`. Tier 1
    re-invokes `bloomPass.setSize()` with half the effective size so the internal halving
    lands on ¼ resolution, and clamps DPR to ≤1.25. Tier 0 sets `bloomPass.enabled = false`
    and DPR to a flat 1. This required reading `UnrealBloomPass.js`/`EffectComposer.js`
    source directly — the constructor's `resolution` parameter is only used for the
    *initial* mip chain sizing; every subsequent `setSize()` call (which `EffectComposer`
    invokes on every pass on `addPass()` and on resize) ignores it and just halves whatever
    it's given. Documented this in a code comment since it's non-obvious from the public API.
  - Auto-drop: 60-frame rolling average of `requestAnimationFrame` deltas; if avg > 22 ms and
    at least 5 (sim) seconds have elapsed since the last auto-drop, decrements quality by one
    tier (floor 0).
  - Resize handler updates camera aspect, renderer size, composer size/pixel ratio, and
    (tier 1 only) re-applies the halved bloom target size.

- **`src/main.ts`**: replaced the temporary 2D-context clear with `initCore` + a temporary
  sanity scene (`buildSanityScene`): a 5×4 grid of 20 emissive-magenta boxes
  (`MeshStandardMaterial`, `emissiveIntensity: 3`), hemisphere + directional light, and a
  slow circular camera orbit driven via `core.onFrame`. Calls `core.start()` for the live
  page, then a synchronous `core.render()` + `window.__READY = true` so
  `npm run shoot -- --scroll 0` gets a populated first frame without waiting on rAF timing.
  (Full `?shot=`-driven scroll scene mapping is out of scope — deferred to Task 25 per the
  brief; the harness's `?shot=0` navigation is satisfied because `boot()`'s non-viewer path
  doesn't discriminate on the shot value yet.)

- **`src/viewer/viewer.ts`**: swapped the plain `WebGLRenderer` + manually-built scene for
  `initCore(canvas)`, reusing `core.scene`/`core.camera` for the grid helper, lights, and
  asset framing logic (unchanged). Dropped the viewer's own resize listener (core installs
  its own). Kept the try/catch diagnostic-on-throw behavior and the `window.__READY`
  contract; calls `core.render()` once for the static per-angle screenshot instead of
  `core.start()`, per the brief's note that the viewer does its own static framing.

## Verification

- `npm run build` — clean (`tsc --noEmit && vite build`), no errors.
- `npm test` — 6/6 passing (unchanged rng suite).
- `npm run shoot -- --viewer testCube` (dev server on :5173, killed after): produced
  `testCube-a0..a3.png`. **What I saw**: a strong soft teal/cyan bloom halo radiating from
  the cube in all four angles; the cube's own faces are blown to near-white in the center
  (the cyan emissive + lit MeshStandardMaterial output crosses the ACES/exposure-adjusted
  luminance well past the 0.75 bloom threshold), with the halo fading smoothly to the dark
  void background at the frame edges. This confirms the bloom pass is live and strong.
  (One transient repro note below under Concerns — not a core.ts bug.)
- `npm run shoot -- --scroll 0`: produced `scroll-0.png`. **What I saw**: the 5×4 grid of
  magenta boxes on the void background, each box surrounded by a soft magenta glow that
  blends into a single larger bloom cloud across the whole grid; visible red/blue channel
  separation (chromatic aberration) fringing the box edges; and visibly darker corners
  versus the lit center (vignette). I initially shipped this with `emissiveIntensity: 1.4`,
  which stayed under the 0.75 post-tonemap luminance threshold and produced crisp,
  non-blooming boxes (bloom is threshold-gated, so a dim emissive can legitimately produce
  no glow) — bumped to `3` so the sanity scene visibly demonstrates bloom as the brief
  expects for verification purposes.

## Files changed

- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/core/core.ts` (new)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/main.ts`
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/viewer/viewer.ts`

Commit: `2d5584a feat: core renderer with bloom/CA/vignette + quality tiers`

## Self-review

- Interface match: `Core` fields/methods match the brief's signature verbatim, including
  the `quality` field being live-readable (implemented as a getter in the returned object
  literal — TypeScript's structural typing accepts this against the plain `quality: 0|1|2`
  interface property, confirmed by a clean `tsc --noEmit`).
  values were plugged in verbatim (strength 0.9, radius 0.6, threshold 0.75, offset 0.0015,
  smoothstep 0.55→0.95, 35% vignette strength, exposure 1.1, fog density 0.0016, DPR caps
  1.75/1.25/1, camera fov/near/far 55/0.1/4000, auto-drop threshold 22ms/5s/floor-0).
- One real design decision I made beyond the brief's literal text: since `UnrealBloomPass`'s
  `resolution` constructor argument is effectively inert after the first `setSize()` call
  (an EffectComposer/three.js internal detail, not obvious without reading source), I
  implemented the ½/¼ resolution tiers by controlling the `setSize()` calls directly rather
  than relying on the constructor argument, which would have silently done nothing. Verified
  by reading `UnrealBloomPass.js` and `EffectComposer.js` from `node_modules` (three 0.185.1).
- Did not add MSAA/FXAA/SMAA. The brief only specified `antialias: true` on the renderer;
  under `EffectComposer` that flag has no effect on the composited output since
  `EffectComposer`'s internal render targets aren't multisampled by default. This matches
  the brief's literal spec but is worth knowing if edges look aliased later — not something
  I fixed since it wasn't requested and would deviate from "exactly as above."
- Left `main.ts`'s sanity scene and `viewer.ts`'s `testCube` asset marked as temporary (both
  already carried "TEMP" comments before this task); did not touch the TEMP testCube
  registration in `main.ts` itself.

## Concerns

- **Screenshot-harness flakiness, not a core.ts bug**: on one run, `npm run shoot -- --viewer
  testCube`'s `angle=0` screenshot came back solid blank white (18x smaller file size than
  the other three angles) while angles 1–3 showed correct bloom. Re-running the exact same
  batch reproduced all four angles correctly, and a standalone single-URL fetch of
  `?viewer=testCube&angle=0` also rendered correctly. This looks like a Playwright
  navigation/timing race in `tools/shoot.mjs` (reusing one `page` across sequential
  `page.goto()` calls) rather than anything in the renderer — flagging in case it recurs for
  later tasks that rely on the same harness.
- The sanity-scene bloom/exposure combination is intentionally punchy (faces clip toward
  white) to make bloom obviously visible for this task's verification; production emissive
  intensities for real scene content in later tasks should probably be tuned lower/staged so
  bloom reads as an accent rather than a full clip.
