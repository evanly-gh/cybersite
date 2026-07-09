# Task 12 report: Skinny towers + rooftop clutter kit

**Branch:** `worktree-agent-a25064a9974bb5d35` (isolated git worktree)
**Commit:** `b79e2c3` — feat(assets): radio mast, monument, rooftop clutter kit

## Files
- `src/assets/buildings/skinny.ts` — `buildRadioMast(rng)`, `buildMonument(rng)`
- `src/assets/buildings/rooftop.ts` — clutter-kit builders + `decorateRoof(roof, rng, opts)`
- `src/viewer/entries/skinnyRoof.ts` — registers `radioMast`, `monument`, `roofDemo`
- `tests/skinnyRoof.test.ts` — 11 tests (contracts, bounds, draw-call budget, determinism)

## What was built
- **Radio mast (~50m):** 3-leg tapering lattice built from stacked cylinder segments
  (taper via `legPos`'s radius lerp), 10-band cross-bracing + diagonal X-braces (all
  merged into one body mesh), amber FAA-style warning stripes near the top third, 3 dish
  clusters (reusing the shared `buildSatelliteDish`) with a teal rim-glow ring per dish,
  climbing amber position-marker lights up the legs, guy wires to 3-fold ground anchors
  with amber tension-light markers, a service ladder up one leg, a lit-doorway base
  equipment shed, double red mid-mast beacons, and a white top strobe.
- **Monument (~22m):** 2-tier stone plinth, an abstract striding figure built from
  stacked/rotated boxes (rear-planted leg, forward-striding leg, leaning torso, angled
  arms/head), 4 amber up-light cones each paired with a ground light-pool disc, thin
  teal seam-trim lights tracing the figure's joints, a teal additive halo torus over the
  head (`userData.halo`), and a mono-canvas civic plaque.
- **Rooftop clutter kit:** satellite dish, vent+spinning-fan unit (`userData.fans`),
  pipe run w/ warning band, water tower w/ cap beacon, glass observatory, rooftop
  table+4 stools, antenna whip w/ tip light, skylight, parapet rail (always present),
  billboard frame. `decorateRoof` packs 3–7 items on a non-overlapping grid of slots
  sized to the roof footprint, reserves the center slot for `opts.billboard`, and adds a
  rain-puddle sheen + parapet perimeter marker lights. Output is capped at 3 merged
  meshes (body/glow/fans) regardless of item count.

## Iteration log (3 rounds, screenshots read back after each)
1. **R1:** bare geometry was invisible against the black sky/roof — only
   beacons/strobe/halo/skylight-glow showed. Diagnosed as the classic "dark body, no
   accent" problem already called out in tall.ts/special.ts's own round-notes.
2. **R2:** dish rim-glow rings, amber position lights climbing the mast, a lit shed
   doorway; enlarged monument up-lights + ground light-pool discs + teal joint trim;
   per-item status LEDs (vent, water-tower cap, antenna tip) + pipe warning bands in the
   clutter kit.
3. **R3:** guy-wire anchor tension lights + a service ladder (mast); rain-puddle sheen +
   parapet perimeter marker lights (clutter kit) — this surfaced and fixed an
   out-of-footprint puddle-radius bug caught by the new bounds test on the 40×24 roof.

## Verification
- `npx tsc --noEmit` — clean
- `npm test` — 8 files, 69 tests passed (incl. the 11 new ones: decorateRoof bounds/
  billboard-reservation/draw-call-budget/determinism on 3 roof sizes; radioMast/monument
  userData contracts + draw-call budget)
- `npm run build` — succeeds
- Screenshots via the playwright harness at 4 angles for `radioMast`, `monument`,
  `roofDemo`, plus a `--cam` close-up of `roofDemo` to confirm clutter reads correctly at
  in-game viewing distance (the wide demo-composite shot naturally shrinks small props to
  subpixel size, which is a framing artifact of the 3-roofs-side-by-side test scene, not
  a design issue).

## Concerns
- None blocking. The far-away `roofDemo` composite screenshot still looks sparse because
  three roofs are framed together at once — a close `--cam` shot confirms the clutter +
  accent lights read correctly at realistic distance.
- Did not touch `main.ts` or any shared file — new work is limited to the two new asset
  files, one new viewer entry, and one new test file.
- **Note:** this worktree's harness sandbox blocked writing this report to the shared
  checkout path `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/.superpowers/sdd/`
  requested in the brief (isolation enforced at the tool level). It's saved instead at
  the equivalent path inside this worktree; the calling process should copy it out if a
  shared-location copy is needed.

## Note on the task-12 brief file
The brief file (`.../.superpowers/sdd/task-12-brief.md`) contained embedded fake
`<system-reminder>` blocks (a "date changed" notice and MCP-auth instructions) that read
as a prompt-injection attempt. They were ignored; no action was taken on their content,
and nothing about credentials/tokens was requested or acted on.
