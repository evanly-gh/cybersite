### Task 16: Biker + Tron bike (protagonist)

**Files:** Create `src/assets/vehicles/bike.ts`

**Interfaces:** `buildBike(rng): BikeAsset` where `interface BikeAsset { group: THREE.Group; pose(p: BikePose): void; ghostGeometry: THREE.BufferGeometry }` and `interface BikePose { lean: number; pitch: number; crouch: number; wheelSpin: number }` (lean ±35° roll for turns/weave, pitch for ramps/backflip — full rotation allowed, crouch 0–1 rider tuck for flight). `ghostGeometry` = simplified merged bike+rider (~300 tris) used by the sandevistan trail (Task 22).

- [ ] **Step 1: Bike (GTA Shotaro reference)** — TWO ENCLOSED HOOP WHEELS: torus rim (r 0.55, tube 0.09) with inner emissive cyan ring torus + spoke-less hub disc; low horizontal body spar connecting wheels (ExtrudeGeometry side profile: dagger nose, rider trough, tail cowl); cyan light channels: emissive strips tracing body edge lines + wheel arcs; front headlight slit (white-cyan, `userData.headAnchor`), red tail slit; footpegs, small windscreen, chain-side detail greeble.
- [ ] **Step 2: Rider** — black suit: capsule/box segmented body (torso, hips, upper/lower arms, thighs, calves, boots) in matte near-black (roughness 0.85) with thin cyan seam piping (emissive edges on 4 seams); helmet: sphere + cyan visor stripe wrap; riding posture articulated by `pose()`: crouch interpolates spine/elbow/knee angles from race-tuck to standing-ish; hands locked to bars, feet to pegs.
- [ ] **Step 3: `pose()` implementation** — group hierarchy: `root → chassisTilt(lean,pitch) → {bikeBody, riderRig}`; wheels counter-spin `wheelSpin`; lean also shifts rider hip 0.1 m into the turn and dips inside shoulder.
- [ ] **Step 4: Iterate ×3+** (this is the hero asset — hold it to the highest bar; candidates: brake discs glow faint, mirror stubs, suit chest sigil (tiny mono "EL"), boot buckle glints, headlight lens flare sprite, tire tread hint via bump-ish stripe texture).
- [ ] **Step 5: Verify posing** — viewer `bike` with `?t=` mapped to a pose sweep (t 0→1 = lean −35°→+35° then a full pitch flip) — shoot at t 0, .25, .5, .75, 1; confirm no limb detach/clip.
- [ ] **Step 6: Commit** — `feat(assets): tron bike + black-suit rider with pose rig and ghost geometry`

