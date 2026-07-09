### Task 9: Tall buildings ×2 + special monolith

**Files:** Create `src/assets/buildings/tall.ts`, `src/assets/buildings/special.ts`

**Interfaces:** `buildTallStepped(rng: Rng, floors?: number): THREE.Group` (default 34 floors), `buildTallSlab(rng, floors?)` (default 40), `buildMonolith(rng): THREE.Group` (fixed design, ~52 floors). Each group's origin at ground center; `group.userData.roofY` set for clutter placement; `userData.footprint = [w, d]`.

- [ ] **Step 1: `buildTallStepped`** — 3 stacked boxes stepping in (e.g. 26×26 → 20×20 → 14×14 m), setbacks get railing rims; antenna crown: 8 m mast + 3 cross-braces + double blinking red beacon (emissive sphere, `updateAmbient` handled by cityLayout blink pass — here just tag `userData.beacons: Mesh[]`); vertical edge trim strips (thin emissive magenta boxes) on two faces; window texture per tier.
- [ ] **Step 2: `buildTallSlab`** — slab 40×16 m footprint; full-height vertical neon spine (1.5 m wide emissive strip, magenta) up one narrow face ending in a rooftop sign frame; horizontal holo ticker band at floor 30 (strip-format ad texture from `makeAd('strip', rng)`); mechanical penthouse + dish cluster on roof.
- [ ] **Step 3: `buildMonolith`** — tapered obsidian tower (4-segment box taper 46×46 → 30×30), material near-black metalness 0.9, sparse dim windows (20% lit, cool); glowing corporate sigla near crown: canvas-texture emissive plane (invent an angular hex-triangle "MAM" sigil, holo-teal) on two faces; base: 12 m atrium with amber light spill and 6 entry pylons; crown: 3 aviation beacons + halo ring (thin torus, emissive teal, slow ambient rotation tagged `userData.halo`).
- [ ] **Step 4: Iterate ×3** with `npm run shoot -- --viewer tallStepped` etc. Candidate details: rooftop water tanks, window AC boxes scattered on lower floors, roof-edge drainage rails, dirt streak vertex tint under sills, cell antennas on setbacks, red beacon glow sprites.
- [ ] **Step 5: Commit** — `feat(assets): tall stepped + slab towers, corporate monolith` (iteration log in body).

