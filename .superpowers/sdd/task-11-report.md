# Task 11 Report: Short buildings ×4 (street-life set)

**Worktree branch:** `worktree-agent-a78a6791f42a5b390`
**Commit:** `2815a14` — feat(assets): storefront row, restaurant, ramen shop, bar with seat anchors
(worktree root: `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/.claude/worktrees/agent-a78a6791f42a5b390`)

Note: this worktree's branch was initially detached from the project history (only the
`README.md` init commit) rather than based on `build/cyberpunk-hero`. Fast-forwarded it
(`git merge --ff-only build/cyberpunk-hero`) before starting, since it was a strict
ancestor — no rebasing/history rewrite needed.

## Files
- `src/assets/buildings/short.ts` (new) — `buildStorefrontRow`, `buildFancyRestaurant`,
  `buildRamenShop`, `buildBar`.
- `src/viewer/entries/buildingsShort.ts` (new) — registers `storefrontRow`,
  `fancyRestaurant`, `ramenShop`, `bar`, and a `shortStrip` composite.
- `tests/short.test.ts` (new) — userData contract, draw-call budgets, seat-anchor
  counts/positions, steamAnchor, and flicker tagging.

`medium.ts` did not exist yet at start time (parallel task), so nothing was reused from
it; all facade/window/merge machinery is reused from `tall.ts` (`boxPart`, `mergeOne`,
`addTierFacades`, `makeWindowTexture/Mat`, `makeGlowMat`, `makeBodyMat`, `FLOOR_H`) the
same way `special.ts` does.

## What was built
- **Storefront row** (default 4 shops, 8m frontage, 2 floors): rng-sampled themes
  {electronics, pawn, noodle, clothing, pharmacy, arcade} via Fisher-Yates shuffle, each
  with a distinct awning color (vertex-colored boxes, one draw call for all), a
  sign-atlas texture (one canvas cell per shop, one draw call), a glass-glow atlas
  (mullion cross + baked grime drips, tinted per shop's theme accent), 2nd-floor
  windows (reusing `addTierFacades`), one shop with a balcony, sandwich boards (own
  atlas + UV remap, `remapUVsToCell`), hanging cables between shops, curb trash bags,
  wall pipes/junction boxes, and a shared roof (parapet, scattered vent boxes, a whip
  antenna + satellite dish, and `userData.billboardAnchors`). ~6 draw calls.
- **Fancy restaurant**: 2-floor warm facade, 6 arched windows (alpha-punched canvas
  texture), terrace with hedge planters + path lights, host stand, 5 round tables × 2
  chairs (10 `userData.seats` anchors, candle glow per table), a 4-pole string-light
  rig with perimeter + diagonal catenary garlands, a vcard-format glowing menu holo,
  and a thin moonlight-neon "ORBITAL EATS" sign. 8 draw calls (at the venue cap).
- **Ramen shop**: single story + attic, a small noren curtain (3 swaying cloth strips)
  over the entrance end of the open counter, 6 stools (`userData.seats`) facing the
  counter, kitchen glow + a 5-lantern row, a roof steam vent (`userData.steamAnchor`
  for Task 24's fx), a magenta+amber bowl/chopsticks flag sign mounted perpendicular to
  the facade ("PGVECTOR RAMEN"), mono menu strips, a glowing vending machine, and a
  utility cable/junction box. ~7 draw calls.
- **Bar**: dark facade, huge "SYNTH BAR" magenta marquee (`userData.flicker`), a
  porthole window with silhouettes, a bottle-wall glow window (rng colored-dot
  texture), an amber sidewalk light-spill pool, 4 outdoor stools + 1 standing table (5
  `userData.seats`), rooftop AC + beer-crate stack with small indicator lights, and a
  sagging utility cable. ~6 draw calls.

All colors come only from `theme.ts` `COLORS` (no tron-cyan); interiors skew warm
amber, matching the "warm pools of light" house rule.

## Verification
- `npx tsc --noEmit` — clean.
- `npm run build` — clean (vite build succeeds).
- `npx vitest run` — **81/81 tests pass** (8 files), including the new
  `tests/short.test.ts` (23 tests): userData contract (roofY/footprint), draw-call
  budgets (storefront ≤6, venues ≤8), seat-anchor counts exactly matching spec
  (restaurant 10, ramen 6, bar 5), every anchor is a bare `Object3D` (not a `Mesh`) at
  0 < y < 1.0 and actually parented in the group, `billboardAnchors`/`steamAnchor`/
  `flicker` tagging, determinism for a fixed seed, and custom shop-count support.
- Dev server (`--port 5211`) + Playwright screenshot harness: shot each of the 4
  viewers + `shortStrip` at 4 angles, plus several manual `?cam=` close-ups, across 3
  iteration rounds (PNGs read and inspected each round). No console errors; harness's
  `window.__READY` gate never hung.
- Dev server was killed before finishing.

## Iteration log (3 rounds, screenshot-driven)
- **Round 1** (bug fixes + 2 new details): the ramen noren curtain in v0 spanned the
  entire 7.6m counter opaquely, hiding the stools/kitchen behind it — shrunk to a
  realistic ~2.1m curtain over the entrance only. The bar's sidewalk spill was a flat
  opaque `w*0.9 x 3.5` plane that blew out to a solid rectangle under bloom — replaced
  with a soft radial-gradient, additive-blended pool texture. Added: a glass-glow atlas
  (mullion cross + grime drips, themed per shop) for the storefront row's interior
  glow, and hanging utility cables + wall-mounted junction boxes on the ramen shop and
  bar.
- **Round 2** (bug fix + 2 new details): the "SYNTH BAR"/"ORBITAL EATS" neon text used
  a heavy `ctx.shadowBlur` on the "Unbounded" display font, which rendered as an
  illegible striped smear rather than letterforms (canvas shadow-blur + a large custom
  variable-font glyph is not reliable) — removed the canvas-side glow entirely and let
  the engine's real bloom pass carry the glow; both signs are now crisply legible.
  Added: small amber indicator lights on the bar's rooftop AC unit + crate stack, and
  terrace path-lights along the restaurant's hedge planters.
- **Round 3** (2 new details): candle glow on every restaurant table, awning drip
  icicles on the storefront row, and a rooftop whip antenna + satellite dish on the
  storefront row for skyline silhouette variety (spec: ≥80% of Ring 0-1 buildings need
  non-flat tops).

## Concerns
- The residual faint horizontal banding visible on very bright emissive text in
  screenshots is an `UnrealBloomPass` characteristic from the shared `core/core.ts`
  post-processing chain (untouched, per house rules) — it shows on any sufficiently
  bright thin emissive feature, not specific to this task's textures.
- `medium.ts` (parallel task) didn't exist at authoring time; if it lands with
  different shared helpers worth reusing, short.ts wasn't updated to depend on it (not
  required by the brief).
