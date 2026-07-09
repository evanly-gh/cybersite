# Task 9 Report: Tall buildings ×2 + special monolith

**Branch:** `worktree-agent-ad30160b0f5becfb3` (worktree at `.claude/worktrees/agent-ad30160b0f5becfb3`)
**Commit:** `1b8024d` — `feat(assets): tall stepped + slab towers, corporate monolith`
**Note:** the worktree branch had forked from `main` before the project scaffold landed; I rebased it onto `build/cyberpunk-hero` (clean, no conflicts) before starting. `npm run build` + `npm test` green (38 tests, incl. 14 new).

## Implemented

### Files
- `src/assets/buildings/tall.ts` — `buildTallStepped(rng, floors=34)`, `buildTallSlab(rng, floors=40)` + the shared facade system (exported for special.ts; task 9 owns both files, no shared file touched)
- `src/assets/buildings/special.ts` — `buildMonolith(rng)` (52 floors, fixed design)
- `src/viewer/entries/buildingsTall.ts` — registers `tallStepped`, `tallSlab`, `monolith`, `tallTrio`; wraps each with a preview-only `updateAmbient` (beacon blink + halo precession) so stills show them lit — the real city assembly owns those animations via the userData tags
- `tests/buildingsTall.test.ts` — contract tests: `roofY`/`footprint`/`beacons` userData, origin at ground center, halo tagged + parented, floors param, seed determinism, and **≤ 6 draw calls per building** (counts material-array groups, so the budget is enforced, not aspirational)

### Shared facade system (the core trick)
One repeating 8×16-cell canvas window texture per building (theme colors only: amber/teal/moonlight + rare magenta tenant, ~50–70% lit for city fill, per-cell dim levels with only ~6–7% full-brightness bloom peaks, half-drawn blinds, dirt streaks under sills). Facade planes get UVs scaled so a cell is always 3.0×3.2 m and offset by whole cells per face — every facade differs but all share ONE material → all windows on a building are a single draw call. Categories (body / windows / magenta neon / amber accents / ad ticker / sigil) each merge to one mesh via the `mergeOne` unwrap (same trick as streets.ts). Draw calls: stepped 5, slab 6, monolith 6 (beacons and halo included).

### Per brief
- **Stepped:** 3 tiers 26→20→14 m (rng-jittered), railed setbacks (rails + posts), 8 m mast + 3 cross-braces + double beacon (`userData.beacons`), vertical magenta edge trim on two faces, water tank w/ conical cap + legs, AC boxes, cell antennas on setbacks.
- **Slab:** 40×16 m, full-height 1.5 m magenta spine up the +X narrow face ending in a rooftop sign frame (posts + neon-outline rectangle + beacons), `makeAd('strip', rng)` holo ticker band at floor 30 on both long faces, mechanical penthouse + 3-dish cluster.
- **Monolith:** 4-segment obsidian taper 46→41→35.5→30, metalness 0.9, 20% lit dim cool windows, invented angular hex-triangle **MAM Industries** sigil (hexagon + alternate-vertex triangle + compressed-core glyph + letterform, holo-teal, shadowBlur glow) on +Z/+X crown faces, 12 m amber atrium (glowing lobby walls + ground light-spill aprons) behind 6 entry pylons with the tower overhanging, 3 aviation beacons + tilted teal halo torus (`userData.halo`, baked horizontal in a tilted holder so `rotation.y` animation precesses visibly).

## Iteration log (SAW → ADDED, per asset)

### Round 1 (initial shoot, 4 angles each)
- **stepped SAW:** dark mast invisible → double beacon floated disconnected; setback roofs pure black voids (tank/AC unreadable); lobby band too thin. Window punctuation + trim otherwise right.
- **slab SAW:** ticker a dim unreadable smear; neon sign rectangle floating unsupported (posts invisible); penthouse + dishes vanish against sky.
- **monolith SAW:** shaft a featureless black void — no windows at all; 4-segment taper unreadable; full-face amber lobby walls the brightest thing in frame (house-rule violation); sigil/halo/atrium composition good.

### Round 2 (adds)
- **stepped ADDED:** amber marker strips up two mast faces (ties beacons to crown); dim amber strips along setback railings + mechanical lamp on the water-tank cap; wider lobby band.
- **slab ADDED:** ticker enlarged 32×4→36×4.5 and intensity 1.4→2.0; horizontal circuit-tick stubs off the spine every ~8 floors; amber warning strips on penthouse roof edges + lamp strip atop the sign frame.
- **monolith ADDED:** teal seam-light strips tracing every setback collar — UV-pinned to a teal tick baked into the sigil texture so they ride the sigil material (**zero extra draw calls**); window dimLo/Hi 0.15/0.38→0.32/0.6 and intensity 1.6→2.0; atrium 1.5→1.1.

### Round 3 (verify + adds)
- **monolith SAW: windows STILL a void → real bug found:** facade planes sized `w-0.6` with a 0.16 gap sit at `w/2-0.14` — *buried inside the body box* (the other towers used a proud offset). Fixed to 0.36 → windows finally render; taper + seams now read perfectly.
- **stepped ADDED:** dark drainage/service pipes proud of the facades cutting black vertical interruptions through the lit window grid (the thing megatower references have that flat textures don't); tiny amber safety lamps at crown roof corners.
- **slab ADDED:** guard railing around the roof perimeter; 4 drainage pipes breaking the long facades.
- **monolith ADDED:** entry canopy + two teal wayfinding strips flanking the lobby (sigil-patch trick again); crown mechanical plant boxes (for the ride's high camera); seam plates widened (were rendering dashed under the collar lip); halo tube 0.16→0.22, intensity 2.0→2.4.

### Composite check (`tallTrio`, 4 angles)
Three clearly distinct silhouettes (ziggurat steps / thin slab with spine / massive tapering landmark); bodies read darker than windows everywhere; emissives are punctuation (trim lines, spine, ticker, sigil, halo, beacons), no facade blowout. Night-mood compliant.

## Self-review
- ≤6 draw calls enforced by test; all randomness through `Rng` (no `Math.random`); all colors from `COLORS`; tron-cyan never used; origin at ground center; `roofY`/`footprint`/`beacons`/`halo` userData set.
- The sigil-texture "teal patch" UV trick is slightly clever but documented at both ends (texture comment + `tealPatchUVs`); it buys teal seam/wayfinding lights without a 7th material.
- Screenshot evidence in worktree `shots/r1|r2|r3|final/` (untracked, not committed).

## Concerns / notes for integration
1. **Beacon color:** brief says "red" beacons, but the binding house rule limits colors to theme COLORS (no red exists). I followed Task 8's farField precedent: aviation beacons are `sodiumAmber`. If a true red is wanted, add a theme token.
2. **"Window texture per tier" (stepped):** implemented as one shared repeating texture with per-facade whole-cell UV offsets (visually distinct per tier, 1 draw call for all windows) rather than N textures/materials — that trade is what keeps the building ≤6 draw calls with headroom for detail.
3. **Viewer blink is preview-only:** builders set constant beacon `emissiveIntensity 3`; city assembly should drive the actual blink pass via `userData.beacons` and rotate `userData.halo.rotation.y` (holder is pre-tilted; y-rotation gives visible precession).
4. **Branch base:** worktree was rebased onto `build/cyberpunk-hero` (the branch with the project scaffold); merge my commit `1b8024d` onto that branch.
5. `tallTrio` spacing is 48/52 m (not exactly 40) because the slab is 40 m wide and the monolith 46 — 40 m centers would interpenetrate.
6. **Report location:** the harness blocks this agent from writing into the main checkout (worktree isolation), so the report lives at the worktree path below; please copy to `.superpowers/sdd/task-9-report.md` in the main checkout if needed.
