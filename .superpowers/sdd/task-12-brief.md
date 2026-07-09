### Task 12: Skinny towers + rooftop clutter kit

**Files:** Create `src/assets/buildings/skinny.ts`, `src/assets/buildings/rooftop.ts`

**Interfaces:** `buildRadioMast(rng): THREE.Group` (~50 m), `buildMonument(rng): THREE.Group` (~22 m). `decorateRoof(roof: { y: number; w: number; d: number }, rng: Rng, opts?: { billboard?: boolean }): THREE.Group` — returns a clutter group positioned in roof-local space; used by cityLayout for EVERY Ring 0/1 building (≥80% non-flat rule lives here).

- [ ] **Step 1: Radio mast** — tapering lattice (3 legs, cross-bracing via thin cylinders — merge!), 3 dish clusters at heights, guy wires to ground anchors, double red beacons + top strobe, small equipment shed at base.
- [ ] **Step 2: Monument** — stone plinth + abstract angular figure (stacked rotated boxes reading as a stylized striding figure), up-lights (4 amber cones), holographic halo ring torus (teal, additive) hovering over the head, plaque with mono canvas text.
- [ ] **Step 3: Clutter kit** — library of small builders: satellite dish (parametric size/heading), vent unit w/ spinning fan disc (`userData.fans`), pipe run, water tower, glass observatory, rooftop table+chairs, antenna whip, skylight box, parapet rail, billboard frame. `decorateRoof` packs 3–7 items by rng within footprint with margin, avoiding overlap via simple grid slots; honors `opts.billboard` by reserving the center slot.
- [ ] **Step 4: Iterate ×3** on a `roofDemo` viewer asset (3 different-size roofs decorated) + both towers.
- [ ] **Step 5: Commit** — `feat(assets): radio mast, monument, rooftop clutter kit`

