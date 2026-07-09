### Task 18: Street props — cranes, gas station, powerlines, signals, misc

**Files:** Create `src/assets/props/crane.ts`, `src/assets/props/gasStation.ts`, `src/assets/props/powerlines.ts`, `src/assets/props/streetProps.ts`

**Interfaces:** `buildCrane(rng, swinging?: boolean): { group; updateAmbient(sec) }`; `buildGasStation(rng): THREE.Group`; `buildPowerRun(rng, from: V3, to: V3, poles: number): THREE.Group` (sagging catenary wires between poles + service drops); `streetProps.ts` exports `buildTrafficLight(rng)`, `buildStreetLamp(rng)` (sodium-amber head + fake light cone (additive gradient cone mesh) + sidewalk pool decal), `buildSteamVent(rng)` (grate + anchor for fx), `buildVendingMachine(rng)`, `buildHydrant(rng)`, `buildTrashHeap(rng)`.

- [ ] **Step 1: Cranes** — lattice mast (merged), jib + counter-jib, counterweight blocks, operator cab (lit window), hook block on cables with dangling I-beam load; `swinging` variant pendulums the load ±4° in `updateAmbient`; red beacons at jib tips; base cross footing on a gravel pad with 2 material stacks.
- [ ] **Step 2: Gas station** — canopy on 4 columns (underside light panel — bright! classic night-photo look), 4 pump units (screen = square ad, hose + nozzle), price sign tower (mono canvas: fake credits/liter), kiosk with window glow, air pump corner, oil stain decals.
- [ ] **Step 3: Powerlines** — poles: cylinder + crossarms + insulator studs + junction box + one rng {shoe-pair silhouette, bird row, tangled cable clump}; wires: TubeGeometry catenaries (3 per span) + drop lines to buildings.
- [ ] **Step 4: Street props set** per interface (traffic light: 3-lamp head both directions + pedestrian box with walking-man glyph canvas).
- [ ] **Step 5: Iterate ×3** on viewer `propYard` (all props arranged). Candidates: crane warning stripes, station bollards, lamp flicker on one unlucky lamp, puddle decal under hydrant.
- [ ] **Step 6: Commit** — `feat(assets): cranes, gas station, powerlines, street prop kit`

