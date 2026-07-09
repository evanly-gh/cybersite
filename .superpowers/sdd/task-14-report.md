# Task 14 Report — Ground cars (cheap ×2, average ×2)

**Branch:** `build/cyberpunk-hero` (worked in cwd checkout)
**Commit:** `ebe7a61` feat(assets): cheap + average tier cars with light anchors

## Files
- `src/assets/vehicles/cars.ts` — `buildHatchback`, `buildKeiVan`, `buildSedan`, `buildCrossover` → `{ group, update(t) }`; shared `makeWheel(r)`, `makeLightBar(w,color,intensity)`.
- `src/viewer/entries/cars.ts` — registers `hatchback`, `keiVan`, `sedan`, `crossover`, `carLineup`.
- `tests/cars.test.ts` — 24 tests (interface, head/tail anchors, 4-wheel InstancedMesh, update(t) spin obeys userData.speed, per-tier draw-call budget, determinism, on-ground + +X orientation).

## Design
- Stacked beveled-box silhouettes merged into ONE body mesh with one material group per material (bike.ts coalescing pattern). 4 wheels = one spinning InstancedMesh (1 draw call), axle along Z, spun by `update(t)` = `t · userData.speed`.
- Draw-call budgets met: hatchback 3, keiVan 4, sedan 5, crossover 5.
- Palette from theme COLORS only; tron-cyan reserved for the biker. Cheap = plain neutral/beige tints + dim amber halogen (glass shares the faint glow as a dash smear); average = richer paint, dark-chrome trim, moonlight-white LED heads, red LED tail bar (signalMagenta→red).
- `userData.headAnchor` / `userData.tailAnchor` Object3D at the lamps for Task 24 light pools.

## 3 detail iterations (shot carLineup + each car ×4 angles, read PNGs)
- **R1:** tier read confirmed at a glance; cheap glass over-glowed and clipped past the cabin sides.
- **R2:** dimmed cheap glow (0.35→0.16) + inset window bands; added front grille slats (all) + antennas (whip on cheap, shark-fin on average).
- **R3:** fixed kei-van door-groove glow→matte; added mudflaps (all), rear reflectors on average; verified rear (a6) — average shows red LED bar + lit plate, cheap shows only dim amber squares.

Distinct details present: grilles, antennas, mudflaps, one dent (hatchback), mismatched primer panel + roof-rack crate + mud (kei van), door seams, wipers, exhaust pipe, lit license plate, chrome beltline, instrument-cluster glow through windshield, red tail bar + reflectors (average).

## Verification
- `tsc --noEmit` clean; full suite `vitest run` → 136 passed (11 files), incl. 24 new car tests.
- Dev server on :5214 for shoots, killed before reporting.

## Concerns
- Draw-call ceiling forced the license "plate" to reuse the white-LED material (a lit rectangle, no canvas glyph texture) rather than a CanvasTexture, to stay within the ≤5 budget. Legible as a plate at traffic distance; a canvas atlas trick could add glyphs later without a new draw call.
- Wheels use a single material per car (geometry differs: cheap hubcap vs average 6-spoke alloy); at night the steel/alloy distinction is carried mostly by the body, not the rim tint.
