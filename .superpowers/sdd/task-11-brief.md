### Task 11: Short buildings ×4 (street-life set)

**Files:** Create `src/assets/buildings/short.ts`

**Interfaces:** `buildStorefrontRow(rng, shops?: number): THREE.Group` (default 4 shops, each 8 m frontage, 2 floors), `buildFancyRestaurant(rng)`, `buildRamenShop(rng)`, `buildBar(rng)`. Each exports `userData.seats: THREE.Object3D[]` — empty seat anchor nodes where Task 17 people get planted, and `userData.roofY`, `userData.footprint`.

- [ ] **Step 1: Storefront row** — per shop rng theme from {electronics (wall of small glowing screens), pawn shop (barred window, 質 sign), noodle stand, clothing (mannequin quads), pharmacy (green cross neon), arcade (flashing marquee)}; each: distinct awning (colored box or angled canvas), sign (square or vcard ad or custom canvas sign), interior glow plane, door, 2nd-floor windows + one balcony; shared roof: parapet + vent boxes + one rooftop billboard mount point tagged `userData.billboardAnchors`.
- [ ] **Step 2: Fancy restaurant** — 2 floors, warm amber interior, tall arched windows (canvas texture); outdoor terrace: low hedge planters, 5 round tables + 2 chairs each (seat anchors), string lights (catenary of small emissive spheres between 4 poles), host stand, glowing menu holo-board (vcard format); name sign "ORBITAL EATS" in elegant thin neon (moonlight color).
- [ ] **Step 3: Ramen shop** — single story + attic; noren curtain strips over door (3 cloth quads, slight rng sway offsets baked); counter open to street with 6 stools (seat anchors); kitchen glow + hanging lantern row (emissive amber spheres); steam vent on roof tagged `userData.steamAnchor` (fx in Task 24 attaches); big bowl-with-chopsticks neon sign (magenta+amber) perpendicular flag-mount; menu strips beside door (mono canvas textures); "PGVECTOR RAMEN" branding.
- [ ] **Step 4: Bar** — dark facade, huge "SYNTH BAR" neon marquee (magenta, flicker-tagged `userData.flicker`), porthole window with silhouettes, 4 outdoor stools + standing table (seat anchors), amber light spill plane on sidewalk, bottle-wall glow through window (rng colored dots texture), rooftop AC + beer-crate stack by side door.
- [ ] **Step 5: Iterate ×3** (candidates: sandwich boards, hanging cables between shops, trash bags at curb, vending machine (glowing, classic cyberpunk) beside ramen shop, wall pipes + junction boxes, drips/grime tint).
- [ ] **Step 6: Commit** — `feat(assets): storefront row, restaurant, ramen shop, bar with seat anchors`

