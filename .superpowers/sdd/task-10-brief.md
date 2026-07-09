### Task 10: Medium buildings ×3

**Files:** Create `src/assets/buildings/medium.ts`

**Interfaces:** `buildApartment(rng): THREE.Group` (~12 floors, 22×14), `buildOfficeHolo(rng)` (~14 floors, 26×18), `buildParking(rng)` (~7 decks, 34×22 — elongated). Same `userData` contract as Task 9.

- [ ] **Step 1: Apartment** — balcony grid on street face (per-balcony: slab + railing, rng contents: laundry line w/ 2–4 cloth quads, plant, storage boxes, 30% empty); stairwell tower with red EXIT glow; roof: water tower + dish farm + clothesline; AC units under 60% of windows; ground floor: two small shopfronts with square-format ads.
- [ ] **Step 2: Office** — curtain-wall window texture (tighter grid, cooler light); wraparound holo ticker band (strip ad, additive, double-sided, slight outward offset + `userData.ticker` for UV scroll); recessed lobby with amber interior; roof: glass observatory box (transparent material, teal edge light) + vent cluster.
- [ ] **Step 3: Parking** — open decks: floor slabs + columns, low parapet per deck; 2–5 simple car silhouettes per deck (dark boxes + dim tail lights) placed by rng; helical ramp cylinder at one end; rooftop deck with lamp poles; big `P` neon sign (magenta) on tower.
- [ ] **Step 4: Iterate ×3** (candidates: pipe runs down apartment side, rooftop pigeon spikes/wires, office fire-escape, parking ticket booth + barrier arms, oil stains decal on decks).
- [ ] **Step 5: Commit** — `feat(assets): apartment, holo-ticker office, parking structure`

