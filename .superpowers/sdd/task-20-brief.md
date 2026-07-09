### Task 20: City layout — populate the world

**Files:**
- Create: `src/world/cityLayout.ts`, `tests/layout.test.ts`
- Modify: `src/main.ts` (assemble world group)

**Interfaces:**
- Consumes: every builder from Tasks 7–19.
- Produces: `buildCity(seed: number): City` where
  `interface City { group: THREE.Group; update(t: number): void; updateAmbient(sec: number): void; anchors: DisplayAnchors }` and
  `interface DisplayAnchors { aboutWall: THREE.Object3D[]; projectsWall: THREE.Object3D[]; researchSky: THREE.Object3D[]; introOverhead: THREE.Object3D }` — empty positioned/oriented nodes where segment tasks (26–30) mount content displays. `update` fans out to metro/crowd/flicker children; `updateAmbient` to fans/beacons/flicker.

- [ ] **Step 1: Zoning map** — define block rectangles flanking both streets as data (array of `{ rect: [x,z,w,d]; zone: 'aboutWall'|'aboutBack'|'shibuya'|'projectsWall'|'projectsBack'|'boulevard'|'skywayFlank' }`). Rules: About street LEFT wall (−Z side, faces the About camera) = medium buildings + storefront rows with clean facades for banners; About RIGHT = mixed short/medium behind camera; Shibuya corners = office w/ mega landscape billboards + storefront rows + crowd; Projects boulevard RIGHT wall (−X… the wall the projects camera faces, +X side per route) = talls + mediums with big flat faces; monolith landmark at `(140, 0, -60)` visible down both streets; venues (restaurant, ramen, bar) clustered near About midpoint + one ramen repeat near gas station on the boulevard; gas station at `(215, 0, -240)`; cranes at `(300, 0, -140)` and `(170, 0, -520)`; radio mast + monument placed per zone map.
- [ ] **Step 2: Fill pass (seeded)** — iterate blocks: pick building builder by zone weights, respect footprints (userData), `decorateRoof` on ≥80% (billboard on ~25% of roofs), place billboards: ~120 total (wall-mounts on every blank facade > 12 m wide, stands at sidewalk corners, strip banners across street at 2 points + on 3 building faces), powerline runs down both sidewalks, street lamps every 22 m alternating sides, traffic lights at Shibuya, steam vents ×6, vending machines, hydrants, trash.
- [ ] **Step 3: Populate life** — fill ALL venue seat anchors with `buildPerson(rng,'sit')` (100% occupancy at restaurant terrace + ramen counter + bar stools per spec); ~20 walkers along sidewalks, Shibuya `buildCrowd` ×4 corners (n≈14 each), 4 dog+owner pairs, 3 phone-standers under billboards.
- [ ] **Step 4: Tests** — `layout.test.ts` (run with a stub THREE via happy-dom or plain — layout module must keep pure data functions separate from mesh creation to be testable): no two building rects overlap; every venue seat anchor consumed; billboard count ≥ 100; ≥80% of placed buildings flagged non-flat-roof.
- [ ] **Step 5: Assemble in `main.ts`** — `buildCity(1337)` + streets + farField into scene; static free camera at Shibuya for now. Shoot from 6 authored debug viewpoints (`?cam=` from Task 8): About wall, Shibuya, boulevard low angle, skyway, bridge, overhead. **Iterate ×3 at the CITY level**: compare against Cyberpunk 2077/Edgerunners street stills — typical round-1 gaps: not enough signage density, streets too wide/empty, no vertical cable clutter, lighting pools too uniform. Fix by density/placement tuning.
- [ ] **Step 6: Draw-call audit** — log `renderer.info.render.calls` at each debug viewpoint; must be < 260 (leave headroom for bike/fx). If over: merge more statics per block, convert lamp/billboard repeats to InstancedMesh.
- [ ] **Step 7: Commit** — `feat(world): zoned city layout, life population, draw-call budget pass`

