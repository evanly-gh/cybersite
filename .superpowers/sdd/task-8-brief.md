### Task 8: Far field — Ring 2 skyline, sky, moon, ocean

**Files:**
- Create: `src/world/farField.ts`

**Interfaces:**
- Produces: `buildFarField(rng: Rng): { group: THREE.Group; updateAmbient(sec: number): void }`. Consumes `MOON_POS/MOON_RADIUS`.

- [ ] **Step 1: Skyline** — `InstancedMesh` (1 box geom, ~1100 instances): annulus r 250–1600 m around city center `(0,0,-200)`, EXCLUDING the ocean sector (a 70° wedge centered on −Z beyond z −830 stays empty). Heights: lognormal-ish `12 + rng()²·170`; footprints 14–60 m with 30% elongated (aspect up to 1:3); slight y-rotation snap to 90°±6°. Material: custom `ShaderMaterial` — body near-black; procedural window grid in fragment shader (grid from world-scaled UV; per-instance random via `instanceId` hash; ~55% windows lit amber/teal/magenta mix; brightness flickers ~2% of windows on `uTime`). 20 tallest instances get emissive rooftop beacon sprites.
- [ ] **Step 2: Sky + moon + ocean** — sky: inverted sphere r 3200, gradient shader void→`#0b0e1e` horizon band, 400 star points (Points, size-attenuated, only above 15° elevation); moon: sphere r `MOON_RADIUS` at `MOON_POS`, `MeshBasicMaterial` moonlight color + additive glow sprite ×2.2 radius + faint crater speckle texture (canvas); ocean: plane 4000×2400 at y −0.5 for z < −830, dark `#05070e`, roughness 0.08, plus a moon-glitter streak: additive plane strip from bridge toward moon with animated noise shader (`updateAmbient` scrolls it).
- [ ] **Step 3: Verify** — viewer `farField` from bridge-eye view (place camera at `(240, 6, -900)` looking at moon — add optional `?cam=` override to viewer for this) and from About street view; iterate ×3 (e.g., add aircraft warning lights blinking on tallest towers, a second dimmer skyline layer at 1800 m for depth, horizon haze band).
- [ ] **Step 4: Commit** — `feat: far-field skyline, sky, rising moon, ocean with moon glitter`

---

# Phase 2 — Asset families

**These 11 tasks are parallelizable via subagents** (independent modules, shared deps are Tasks 1–5 only). Every task follows the Global Constraints asset workflow: viewer registration + ≥3 documented detail iterations with screenshots. Detail iteration suggestions are listed per task, but the implementer must LOOK at their screenshots and choose what the asset actually lacks. All materials from `theme.ts` palette; emissive surfaces get `emissiveIntensity` 1.5–3 so bloom picks them up. All buildings: reuse a shared window strategy — emissive window planes or canvas window textures with per-window rng lit/unlit (~50–70% lit, warm/cool mix).

