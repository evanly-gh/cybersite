# Task 2 Report: Screenshot harness + asset viewer

## Status: DONE

## Environment note
`node`/`npm` are not on PATH by default in this shell; they live at
`/mmfs1/home/evanly/.local/node-v22.14.0-linux-x64/bin`. Every command in this
task was run with that dir prepended to `PATH`. Playwright's chromium browsers
were already installed under `~/.cache/ms-playwright` (chromium-1228).

## Step 5 gate check (done first)
Launched `chromium.launch()` directly via a throwaway node script before writing
any other code, per the brief's instruction to stop if this fails. It launched
cleanly and rendered a `data:text/html` page. Not blocked — proceeded with
implementation.

## What was implemented

- **`src/viewer/registry.ts`** — `registerAsset`/`getAsset`/`listAssets` over a
  `Map`, `AssetEntry` union type, interim `type Rng = () => number` with the
  `// replaced by utils/rng in Task 3` comment, exactly per the brief's Step 1
  code block.

- **`src/viewer/viewer.ts`** — `runViewer()`:
  - Parses `viewer`, `angle` (0-3), `t` (0..1) from `location.search`.
  - Builds a plain `THREE.WebGLRenderer` scene (no bloom composer yet — noted
    in a doc comment that it arrives with `core/core.ts` in Task 4).
  - Scene: `COLORS.void` background, 40×40 `GridHelper` (holoTeal / shadowBlue),
    `HemisphereLight` + key `DirectionalLight`.
  - Looks up the asset via `getAsset(name)`, calls `make(rng)` with a small
    local `mulberry32` seeded PRNG (same interim-`Rng` pattern as registry;
    Task 3 will replace both). Handles both `AssetEntry` shapes (bare
    `Object3D` vs `{ group, update, updateAmbient }`).
  - Centers the asset over the origin and drops it so its bounding-box min-Y
    sits on the grid (y=0).
  - Calls `update(t)` / `updateAmbient(t)` before framing, since an asset's
    animation could change its silhouette/bounds.
  - Frames the camera using the asset's bounding-sphere radius: azimuth =
    `angle * 45°`, elevation = `20°`, distance derived from radius and the
    camera's vertical FOV so the asset is comfortably in frame regardless of
    size.
  - Shows an on-screen diagnostic message (and still sets `__READY`) if
    `?viewer=` is missing or the name isn't registered, so the harness never
    hangs — it fails loud in the screenshot instead of timing out silently.
  - Sets `window.__READY = true` after the first `renderer.render()` call.

- **`tools/shoot.mjs`** — copied verbatim from the brief's Step 3 code block
  (CLI arg parsing, `--viewer`/`--angles`/`--scroll`/`--out`/`--url`, waits on
  `window.__READY === true`, screenshots to `shots/`).

- **`src/main.ts`** — wrapped the existing boot logic in a `boot()` function
  with an early return: if `location.search` has `viewer=`, it registers a
  temporary `testCube` asset (2m `BoxGeometry`, emissive-cyan
  `MeshStandardMaterial` using `COLORS.tronCyan`) inline, marked
  `// TEMP: verification asset for Task 2 — delete this block when Phase 2
  starts`, then calls `runViewer()` and returns. Otherwise it falls through to
  the original Task-1 2D-canvas paint + `console.log('boot ok')`, unchanged in
  behavior.

- **`src/env.d.ts`** — added a global `Window.__READY?: boolean` ambient
  declaration (plain top-level `interface Window` augmentation, not wrapped in
  `declare global` — this file has no import/export so it's already a global
  script; wrapping it in `declare global` produced a TS2339 error, presumably
  because the ambient-module declarations already above it change how the
  file's scope is resolved. The unwrapped form works and type-checks cleanly).

- **`.gitignore`** — added `shots/`.

## Verification evidence

1. **Chromium launch gate**: passed (see above) before any other work.
2. **`npm run build`** (`tsc --noEmit && vite build`): passes clean, no
   type errors, produces `dist/` output.
3. **Dev server + shoot**: started `vite --port 5173 --strictPort` in the
   background, confirmed `curl -o /dev/null -w '%{http_code}' localhost:5173`
   returns `200`, then ran:
   ```
   npm run shoot -- --viewer testCube
   ```
   Output:
   ```
   saved testCube-a0.png
   saved testCube-a1.png
   saved testCube-a2.png
   saved testCube-a3.png
   ```
   `ls -la shots/`:
   ```
   testCube-a0.png   9071 bytes
   testCube-a1.png  23223 bytes
   testCube-a2.png   9024 bytes
   testCube-a3.png  23579 bytes
   ```
   a0/a2 are smaller because those angles (azimuth 0°/180°) are dead-on face
   views with large flat-color regions (compress better); a1/a3 (45°/135°) are
   three-quarter corner views. This is expected PNG-compression behavior, not
   a rendering defect — confirmed visually below.
4. **Visual check (Read tool on PNGs)**: opened `shots/testCube-a1.png` — shows
   a cyan cube, angled three-quarter view, sitting on a faint grid against a
   near-black void background, exactly as specified. Also opened
   `shots/testCube-a0.png` — shows the same cube dead-on (azimuth 0°) with
   the grid rendered as a horizon line (correct perspective behavior for a
   front-on view of an axis-aligned box). Both confirm correct rendering.
5. **Console-error check**: used a small Playwright script to load
   `?viewer=testCube&angle=1&t=0.5`, wait on `__READY`, and collect
   `console`/`pageerror` events — zero errors. Also reloaded `/` (non-viewer
   path) and confirmed `boot ok` still logs with no errors, i.e. the
   Task-1 behavior is preserved for the default path.
6. Dev server killed after verification (`pkill -f "vite --port 5173"`,
   confirmed via `curl` that port 5173 no longer answers).

## Files changed
- `.gitignore` (modified)
- `src/env.d.ts` (modified)
- `src/main.ts` (modified)
- `src/viewer/registry.ts` (new)
- `src/viewer/viewer.ts` (new)
- `tools/shoot.mjs` (new)

## Commit
`c9ca26f feat: playwright screenshot harness + asset viewer` on
`build/cyberpunk-hero`.

## Self-review
- `tools/shoot.mjs` is copied verbatim per the brief even though its CLI-arg
  parser has a latent quirk: `.filter(Boolean)` doesn't actually drop the `[]`
  entries produced for non-`--` argv tokens, because an empty array is truthy
  in JS. In practice this is harmless for the commands documented in the
  brief (`--viewer <name>`, `--scroll a,b,c`, `--angles N`, `--out`, `--url`)
  since every token here is either a `--flag` or immediately consumed as that
  flag's value — there are no bare positional args. Left as-is since the task
  said to use the brief's code verbatim; flagging it here in case a later task
  adds positional args to the CLI.
- Camera-framing math (bounding-sphere-based distance) is a reasonable default
  but not specified in the brief beyond "45° steps, elevation 20°" — future
  assets with very elongated bounding boxes may need tighter framing; this is
  fine to revisit per-asset in later tasks since `registerAsset` callbacks
  fully control asset geometry.
- `testCube` registration lives in `main.ts` (not a separate file) since the
  brief frames it as temporary verification scaffolding to delete at Phase 2;
  keeping it inline next to the `viewer=` branch makes it easy to spot and
  delete in one place later.
- No automated tests were added (none requested by the brief for this task).

## Concerns
None blocking. The one non-blocking note is the shoot.mjs arg-parser quirk
described above, kept verbatim as instructed.

## Review fixes (post-review, second commit)

Reviewer flagged two Important issues; both fixed in
`fix(viewer): error diagnostics keep harness alive, updateAmbient gets seconds`.

1. **Asset errors no longer hang the harness** — asset construction, centering,
   `update(t)`/`updateAmbient(sec)`, and camera framing in
   `src/viewer/viewer.ts` are now wrapped in try/catch. On throw the error is
   logged via `console.error`, the existing `showMessage` diagnostic is shown
   with the error message, and execution falls through to the final
   `renderer.render()` + `window.__READY = true`, so the harness screenshots
   the diagnostic instead of timing out 30s per angle.

2. **`updateAmbient` gets seconds, not scroll progress** — added a
   `?sec=<number>` query param (default `2`); `updateAmbient(sec)` now receives
   that fixed value instead of `t`. Deliberately not wall-clock so screenshots
   stay deterministic. `tools/shoot.mjs` unchanged (verbatim per brief); a
   later task can pass `--sec` through if needed — until then the default `2`
   applies.

### Fix verification evidence
- `npx tsc --noEmit` and `npm run build`: pass clean.
- Happy path: re-ran `npm run shoot -- --viewer testCube` — 4 PNGs saved,
  visually re-confirmed `testCube-a1.png` (cyan cube, 3/4 angle, grid)
  unchanged from before.
- Error path: temporarily registered a `throwing` asset in `main.ts` whose
  factory throws `new Error('intentional test failure')`, ran
  `npm run shoot -- --viewer throwing --angles 2`:
  - Both screenshots saved; total wall time 1.06s for 2 angles (vs the
    previous behavior of a 30s waitForFunction timeout per angle).
  - Visually read `throwing-a0.png`: shows the diagnostic banner
    `viewer: asset "throwing" threw: intentional test failure` over the
    void+grid scene.
  - Removed the temporary `throwing` asset and its PNGs before committing;
    `git status` confirms only `src/viewer/viewer.ts` changed in the fix
    commit.
- Dev server killed after verification (curl to :5173 confirms it is down).
