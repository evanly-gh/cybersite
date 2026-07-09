# Task 16 — Biker + Tron bike (protagonist) — Report

**Worktree branch:** `worktree-agent-a85799e7328fe44b3`
**Commit:** `0cf15f137ae983db790a8d7bfe925c1244f084b7`
**Status:** Complete. `npm run build` + `npm test` (33 tests, 5 files) green.

## Files
- `src/assets/vehicles/bike.ts` — the asset.
- `src/viewer/entries/bike.ts` — registers viewer asset `bike`, maps `?t=` to the pose sweep.
- `tests/bike.test.ts` — 8 tests.

## Binding interface (exact, as dispatched)
    export function buildBike(rng: Rng): BikeAsset
    export interface BikeAsset { group: THREE.Group; pose(p: BikePose): void; ghostGeometry: THREE.BufferGeometry }
    export interface BikePose  { lean: number; pitch: number; crouch: number; wheelSpin: number }

- Hierarchy: root(group) -> chassisTilt(lean roll about +X) -> pitchPivot(pitch about +Z, pivot at bike centre y=0.66) -> { bikeBody, riderRig }.
- pose(): lean +/-35 deg roll (also shifts rider hips 0.1 m into the turn + dips the inside shoulder 9 deg); pitch full rotation (backflips) about the bike centre so bike+rider rotate rigidly together; crouch 0->1 interpolates spine pitch 64->36 deg and re-solves elbows/knees; wheelSpin rotates the two hub discs only (hoop rims + face arcs stay static).
- userData.headAnchor Object3D sits at the headlight (1.15, 0.7, 0) for light pools.
- ghostGeometry: merged low-poly bike+rider silhouette, neutral tuck, ~260 tris (test asserts <=400), non-indexed, single group — ready for the sandevistan trail (Task 22).

## Rider rig — the hard part
Rider is a SINGLE THREE.SkinnedMesh with 11 rigid-bound bones (hips, spine, head, upper/fore arm x2, thigh/calf x2). Arms and legs are posed by an analytic two-bone IK solver that aims each chain at fixed grip / peg world targets every pose() call, with reach clamped so the end-effector always lands exactly on target. This guarantees hands never leave the bars and feet never leave the pegs through the whole lean/pitch/crouch envelope — verified by a test that sweeps 11 pose combinations and asserts each hand/foot within 3 cm of its grip/peg anchor.

## Draw-call budget: 8 (<= 8 OK)
Merged static bike mesh with 4 material groups (dark metal / cyan glow / white-cyan headlight / red tail) + 2 spinning hub discs (shared metal mat) + rider SkinnedMesh with 2 groups (matte suit / cyan piping). Test sums material groups across all meshes and asserts <= 8.

## Palette (INVERTED rule honoured)
Cyan (COLORS.tronCyan) is exclusive to this asset: rim rings, edge channels, hub eyes, seams, visor. Suit is matte near-black (0x14161f, roughness 0.85). Tail/brake red is derived from COLORS.signalMagenta pushed toward red (no red token exists). Emissive intensities were tuned low so the asset reads as a sculpted form under UnrealBloom rather than a white blob.

## Detail iteration loop (GTA "Shotaro" reference; screenshots read each round)
- Round 0 (initial build): hoop wheels (rim torus + inner cyan ring + face arcs), ExtrudeGeometry dagger side profile, cyan edge channels, headlight slit + lens-flare quads, red tail slit + brake rings, footpegs, windscreen, chain-side greeble, mirror stubs, helmet + cyan visor stripe wrap, 4-seam piping, chest "EL" sigil, boot buckles.
- Round 1: emissives were blowing out to a featureless white glow under bloom — dialled all emissive intensities down (~2.4->1.0 glow, 3.2->1.5 head) and lightened the metal so the dagger sculpt and rider read. Confirmed sleek low-long silhouette, wheels dominant.
- Round 2: fork struts body->hub axle (removed the "floating hoop" read), underbelly ground-glow strip (Tron floor wash), nose chevron accents, rider knee pads with a cyan cap.
- Round 3: twin cyan tail fins on the cowl, cyan hub-centre "eye" dots (Tron wheel look), rider shoulder pauldron accents + forearm gauntlet cuff rings.

## Pose verification (REQUIRED — done)
Shot at t = 0, .25, .5, .75, 1 from a side view (silhouette) and a 3/4 front cam (rider + lean, since lean is roll about the forward axis and is invisible in a pure side view), plus a rider close-up. Findings:
- No limb detachment or clip-through at any pose (side or 3/4).
- Lean reads dynamic: bike tilts into camera and rider hips visibly shift into the turn.
- Full pitch flip (t 0.5->1): rider stays rigidly welded to the bike through the rotation.
- Close-up confirms helmet visor wrap, shoulder accents, "EL" chest sigil, cuff rings, seam piping, hands on bars, boots on pegs.

## Concerns / notes for integration
- The asset is intentionally very dark against the bare viewer void (matte near-black body, cyan glow only). It is designed to be lit by the city + its own headlight/underglow light pools in-scene; do not judge brightness from the isolated turntable.
- headAnchor is provided but no actual light/pool is attached here (that is the fx/headlightPools task) — it is a positioned Object3D only.
- Red tail/brake colour is synthesised from signalMagenta since the palette has no red token; if a red token is later added, swap it in buildBike.
- Author-set bounding box/sphere on the rider mesh (bind pose dangles below ground) so the viewer's Box3.setFromObject framing does not mis-rest the asset.
