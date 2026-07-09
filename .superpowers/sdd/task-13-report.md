# Task 13 Report: Billboards — 5 formats × 3 mounts

**Status:** COMPLETE
**Worktree branch:** `worktree-agent-ab6eec4db13046d89`
**Commit:** `fdf834a` — `feat(assets): billboard system, 5 formats x 3 mounts with glow + flicker`
**Files:** `src/assets/billboards/billboards.ts` (new), `src/viewer/entries/billboards.ts` (new), `tests/billboards.test.ts` (new). No shared files touched.

> Note: the worktree branch was mis-created pointing at the initial empty commit; I reset it
> onto `build/cyberpunk-hero` (8d0bb83) before starting, so the commit applies cleanly there.

## Interface (as specified, binding)

`buildBillboard(rng, { format, mount, widthM?, texture? }) → { group, setTexture(t), updateAmbient(sec) }`

- Default widths: landscape 12, portrait 4.5 (h≈10.5), square 5, strip 24 (h 3), vcard 3.6 (h 5.4); height always follows AD_SIZES aspect; `widthM` override honored.
- `texture` omitted → `makeAd(format, rng)`. `setTexture` swaps the screen's emissiveMap (and applies RepeatWrapping when the build scrolls) — ready for section-content screens.
- 8% of builds (rng at build time) neon-flicker in `updateAmbient` via deterministic hash-noise bursts keyed to `sec` (screen emissiveIntensity + glow opacity together); 50% of strips get slow UV scroll, flagged `group.userData.scroll = true`.

## Draw-call budget: ≤4 per billboard (test-enforced)

1. **screen** — emissive ad plane
2. **structure** — ONE vertex-colored merged mesh: frame box, corner brackets, back-panel ribs/junction box/cable drop, posts + cross/X bracing + base plates + anchor bolts + service ladder + conduits (stand), standoff brackets or flag arms + tie rod (wall), A-frame truss + catwalk + railing + feet (roof), plus rust streaks, hazard bands, pigeons, dead-pixel band — steel/concrete/rust tints coexist via vertex colors
3. **glow** — ONE additive mesh (vertex-alpha RGBA): halo plane 15% larger behind the frame + downward light-spill sheet (stand/roof only)
4. **accents** — ONE unlit vertex-colored mesh: 2–4 amber maintenance lights, neon frame trim, roof spotlight cones + magenta beacon

## Mounts

- **stand** — 1–2 steel posts (2 forced for w≥8), cross brace + X diagonals (or T-spreader + struts for single pole), base plates w/ anchor bolts, service ladder (rails + rungs), cable conduit with couplers, amber hazard bands; strip gets gantry clearance ~5 m.
- **wall** — flush standoff brackets + wall plates, OR (portrait/vcard, rng 50%) perpendicular flag-arm: two horizontal arms + wall plate + diagonal tie, screen DoubleSide.
- **roof** — A-frame truss (vertical + diagonal legs, chords, concrete feet), catwalk with post/top/mid railing, 2 spotlight arms with emissive cone gizmos aimed at the screen, magenta aircraft beacon.

## 3-iteration detail loop (PNGs read every round; shots in worktree `shots/r1..r3`)

- **R1 (base + brief candidates: rust streaks, conduits, pigeons, dead-pixel band):** screens/halos/maintenance dots read well; verdict — frames and mounts vanish into pure black, spill invisible, gallery framing too distant.
- **R2:** neon trim tube around the frame (accent switched to unlit vertex-colored so trim/lights/cones share one draw call), steels lightened, amber hazard bands on post bases, spill 0.10→0.16. Verdict — frames finally read as signage; but trim over-bloomed into "fairy lights", spill a hard-edged slab, and glow color could mismatch the ad (magenta spill under a teal screen).
- **R3:** glow/trim color now **sampled from the ad texture's own canvas** (getImageData, rng-family fallback for non-canvas textures/tests), trim thinned 0.06→0.04 @ 1.55×, spill 0.13 with strong side falloff, roof beacon added. Verified roof catwalk/spotlights and the perpendicular flag mount via dedicated `billboardRoof` / `billboardWallFlag` viewer assets; dead-pixel band clearly visible striking through an unlucky ORBITAL EATS screen.

## Verification

- `npm run build` green (tsc --noEmit + vite build), `npm test` green — **36/36** (13 new billboard tests: budget ≤4 draw calls for all 15 combos, per-format default widths + aspect, widthM override, determinism per seed, setTexture swap, provided-texture path, ~50% strip scroll + offset advance + RepeatWrapping, ~8% flicker + actual intensity modulation, glow subtlety invariants — additive/no-depth-write/low vertex alpha, wall-has-no-spill).
- Viewer: `billboardGallery` (all 15 combos, wall slabs + roof pedestals as viewer-only props, updateAmbient passed through so `?sec=` drives flicker/scroll), plus `billboardCloseup`, `billboardRoof`, `billboardWallFlag`.
- Dev server on 5213 killed after shooting.

## House-rule compliance

- Randomness only via passed `Rng`; all rng draws happen at build time, never in `updateAmbient`.
- Colors: theme COLORS + lerps between theme tokens (same precedent as streets.ts); emissive/glow strictly magenta/amber/teal families — **no tron-cyan anywhere**.
- Emissive discipline: halo peak 12% opacity, spill 13%, additive, no depth write; screens are the only bright surfaces.

## Concerns / notes for downstream

- `deriveGlowColor` reads the texture's backing canvas; for cross-origin or non-canvas textures it silently falls back to an rng family pick (magenta/amber/teal) — fine for all current in-repo textures.
- The kanji glyphs in ads render as tofu boxes in the headless-browser shots (Unbounded has no CJK) — pre-existing adGenerator/Task-5 territory, not billboard geometry.
- Gallery auto-framing is distant because the strip row makes the grid ~70 m wide; use `?cam=` or the three closeup assets for detail review.
