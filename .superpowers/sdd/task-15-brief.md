### Task 15: Luxury cars ×2 + hover cars ×2

**Files:** Modify `src/assets/vehicles/cars.ts`; Create `src/assets/vehicles/hover.ts`

**Interfaces:** `buildLamboWedge(rng)`, `buildGTCoupe(rng)` (same contract as Task 14). `buildHoverA(rng)`, `buildHoverB(rng)` → `{ group; update(t) }` with `userData.bobSeed` (traffic system feeds t; update does thruster pulse + slight attitude sway — deterministic in t).

- [ ] **Step 1: Lambo wedge** — HIGH detail: low single-wedge silhouette via ExtrudeGeometry side profile (sharp nose, high tail), scissor-door seam lines, huge rear diffuser + spoiler, hex mesh intake texture, thin full-width magenta light blade front AND rear, **underglow** (additive plane under chassis, rng magenta/teal), animated neon accent line along flank (UV-scroll emissive strip), Y-spoke wheels w/ cyan rim ring (dimmer than bike's — bike owns cyan; use teal), twin exhaust glow.
- [ ] **Step 2: GT coupe** — long-hood 2-door, chrome beltline, full-width amber light bar tail, pop-up-style front lights, deep gloss paint (clearcoat-ish: metalness 0.6 roughness 0.15), wire-look wheels.
- [ ] **Step 3: Hover cars** — A: sleek teardrop cab + 4 corner thruster rings (torus + additive inner disc, teal glow) + landing skids, belly glow, nav strobes wingtips; B: boxy sky-taxi + 2 large rear ring turbines + front lift vanes, roof "TAXI 空" holo sign (vcard ad), magenta trim glow. Both: no wheels; `update(t)` bobs ±0.4 m at incommensurate frequencies seeded by `bobSeed`, thruster ring emissive pulses.
- [ ] **Step 4: Iterate ×3** (candidates: brake calipers, carbon splitter, heat-haze quad behind hover thrusters (additive noise sprite), interior HUD glow, badge glyphs).
- [ ] **Step 5: Commit** — `feat(assets): luxury cars with underglow + hover vehicles`

