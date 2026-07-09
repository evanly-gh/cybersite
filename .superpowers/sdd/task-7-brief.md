### Task 7: Streets, intersection, skyway, bridge

**Files:**
- Create: `src/world/streets.ts`

**Interfaces:**
- Produces: `buildStreets(rng: Rng): THREE.Group` and `STREET_WIDTH = 14` (2 lanes each way), `SIDEWALK_W = 3`. Consumes `WAYPOINTS`, `roadFrame`.

- [ ] **Step 1: Build road surfaces** — About street: box 560×0.2×14 along X at y −0.1; Projects boulevard: 14 wide along −Z from z −30 to −420; ramps: two wedge meshes (ExtrudeGeometry triangle profile, 8 m long, 2.6 m tall lip, full road width) at `ramp1Base`/`ramp2Base` plus matching down-slope landing wedges at the Land waypoints; skyway: elevated deck (10 wide, guard rails 1.1 m, support pylons every 30 m from ground) following route y; bridge: 12 wide deck, 2 suspension towers (40 m, holo-teal beacon tips), catenary cables (TubeGeometry along sagging CatmullRom), cyan edge light strips (emissive boxes) both sides full length. Road material: `MeshStandardMaterial` near-black `#0a0c14`, roughness 0.35, metalness 0.75 (wet look).
- [ ] **Step 2: Markings + crossing** — lane dashes and edge lines as a repeating `CanvasTexture` on thin overlay planes (avoid z-fight: y +0.02, `polygonOffset`). Shibuya intersection: 40×40 m plaza slab; canvas-texture decal with the diagonal + orthogonal zebra crossing pattern (white 60% alpha, worn edges via rng speckle erase); 4 corner sidewalk bulbs.
- [ ] **Step 3: Sidewalks + curbs** — 3 m sidewalks both sides of both streets (merged boxes, `#14182a`, 0.15 m curb) with expansion-line texture.
- [ ] **Step 4: Verify** — register `streets` in viewer (whole group, shot from high angles + one low angle at the ramp); check: ramps read as jumpable wedges, crossing pattern reads as Shibuya, bridge cables sag naturally. 3-iteration loop applies (e.g., add manhole discs, storm drains at curbs, worn asphalt patches via vertex-color darkening, cat-eye reflector dots down lane centers).
- [ ] **Step 5: Commit** — `feat: streets, shibuya crossing, ramps, skyway, ocean bridge`

