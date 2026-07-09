### Task 19: Metro — track + hanging train

**Files:** Create `src/assets/metro/metro.ts`

**Interfaces:** `buildMetro(rng): { group: THREE.Group; update(t: number): void }`. Internally defines `METRO_PATH: CatmullRomCurve3` — a closed loop threading Ring 0/1: passes BEHIND the About street's left wall (visible over rooftops from the About camera), crosses ABOVE the Shibuya intersection diagonally at y 16, runs down the Projects boulevard's far side, distant pass near the bridge approach. `update(t)` places the train at `pathU = (t * 3.2) % 1` — tuned in Step 3 so the train is in-frame near t≈0.17 (About), t≈0.33 (drift), t≈0.86 (finale, distant).

- [ ] **Step 1: Track** — elevated box-girder following METRO_PATH at y 14–18 (TubeGeometry backbone + repeated cross-section frames via InstancedMesh along path), T-pylons every 35 m to ground, teal edge running-light strip, hazard stripes on pylon bases.
- [ ] **Step 2: Train (Edgerunners style — hangs UNDER the girder)** — bogie arms grip the girder top; 4 articulated cars suspended beneath: rounded-box cars, big lit window band (canvas texture with passenger silhouettes!), destination board (mono canvas "NIGHT LOOP ▸ KABUKI"), underside skid glow (teal), headlight; cars follow path with per-car u-offset so the consist bends through curves; gentle sway (±1.5°) as deterministic f(t).
- [ ] **Step 3: Tune passes** — temporary debug page logging train u at section boundaries; adjust the 3.2 multiplier/path so the three choreographed passes land (exact t values may shift after Task 25 exists — leave `METRO_SPEED` exported const with a TUNE comment).
- [ ] **Step 4: Iterate ×3** (candidates: girder cable trays, pylon graffiti decal, roof pantograph-analog sparks OFF (too noisy) but small strobe ON, car-gap gangway bellows).
- [ ] **Step 5: Commit** — `feat(assets): suspended metro loop with hanging train`

---

# Phase 3 — City assembly

