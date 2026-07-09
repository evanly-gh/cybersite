### Task 14: Ground cars — cheap ×2, average ×2

**Files:** Create `src/assets/vehicles/cars.ts` (luxury added Task 15 in same file)

**Interfaces:** `buildHatchback(rng)`, `buildKeiVan(rng)`, `buildSedan(rng)`, `buildCrossover(rng)` → each `{ group: THREE.Group; update(t: number): void }` (update = wheel spin driven by traffic system via `userData.speed`). Shared internal helpers `makeWheel(r)`, `makeLightBar(w, color, intensity)`. All cars: origin at ground center, +X forward, `userData.headAnchor` & `userData.tailAnchor` (Object3D) for Task 24 light pools; body via beveled box silhouettes (2–3 stacked boxes for cabin/hood), window band (dark glossy inset), bumpers, side mirrors.

- [ ] **Step 1: Cheap tier** — LOW detail on purpose: hatchback = 2-box body, plain gray/beige rng, dim yellowish round headlights (low emissive), no trim, one dent (scaled vertex nudge or offset panel box), steel wheels; kei van = tall single box + flat face, sliding-door groove line, roof rack with strapped crate, mismatched panel color, dim lights.
- [ ] **Step 2: Average tier** — MID detail: sedan = 3-box, chrome-ish trim strip, white strip headlights + red bar tail (moderate emissive), door seams (thin dark lines via texture), alloy wheels (cylinder + 5 spoke boxes); crossover = taller wagon body, roof rails, plastic cladding (darker lower band), fog lamps.
- [ ] **Step 3: Iterate ×3** per tier (candidates: license plates (canvas), wipers, exhaust pipe, interior dash glow through windshield, mud tint on kei van).
- [ ] **Step 4: Commit** — `feat(assets): cheap + average tier cars with light anchors`

