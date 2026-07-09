Task 1: complete (commits 5db6c70..4fc31be, review clean after 1 fix loop)
  Minor (deferred to final review): env.d.ts unplanned file; tsconfig extras; package.json init boilerplate
Task 2: complete (commits c9ca26f..43bb128, review clean after 1 fix loop)
  Minor (deferred): shoot.mjs filter(Boolean) quirk; hexColor duplication (fold into utils in T3+); partial object left in error screenshot
Task 3: complete (commits 8d810cd..d1c54f1, review clean after 1 fix loop; RED-phase TDD gap noted)
  Minor (deferred): merge.ts vertexOffset naming + could use native useGroups; wrapText long-word overflow; eyebrow/tick overlap risk
Task 4: complete (commit 2d5584a, review approved; implementer cut off mid-report but work verified live by controller)
  Adjudicated by controller: CA *dist scaling = plan intent; 0xffffff lights not palette hex (sanity scene dies in T25)
  Minor (deferred): reversed smoothstep idiom; no resize-listener teardown on Core
  Watch item: bloom reads hot on fully-emissive test content — calibrate against real assets in T8/T20/T34
Task 5: complete (commits 66088e4..e8e1572, review clean; resume facts corrected by controller against real resume)
  Minor (deferred): duplicated hex(n) helper x2; 0xffffff text accent mix; scanline logic reimplemented 3x
PHASE 0 COMPLETE
Task 6: complete (commit 85d7b93, review clean, no fix loop)
  Minor (deferred): debug tube radius 1.2 vs 0.5; hardcoded label rgba (matches drawPanel precedent); skywayEnd test can't distinguish from skywayTop; route length 1948m near 1950 ceiling
Task 7: complete (commits 0221b88..9ac9053, review clean after 1 fix loop: plaza gap CRITICAL closed, markings clipped, streets tests added w/ red-on-old proof)
  Minor (deferred): determinism test compares counts not geometry; first reflector 15cm into plaza sliver; reflectors land on dash starts; DETAIL_* vestigial flags; 1000-line file
Task 8: complete (commits a77148c..8d0bb83, review approved; controller-mandated night-mood calibration + theme/fog refactor)
  Minor (deferred): height formula rng()*rng() vs rng()^2; window pattern repeats on opposing faces; dup glow canvas; ?cam empty-field parses as 0; star clamp theoretical
PHASE 1 COMPLETE
Controller infra: 8d5e3f9 glob entries mechanism for conflict-free parallel asset registration
Task 9: complete (worktree 1b8024d merged @2679514, review clean no fix loop)
  Minor (deferred): dead rng param addWaterTank; slab 6/6 draw-call no headroom; report tally miscount; tealPatchUVs coupling to sigil texture corner
Task 13: complete (worktree fdf834a merged @eb2a8f6, review clean + 1 targeted fix f158bde for setTexture leak w/ regression test)
  Minor (deferred): scroll mutates shared texture offset (footgun for reuse path); glow opacity coupling; 3x getImageData at build
Controller infra: 2679514 vitest include scoped to this checkout only
Task 16: complete (worktree 0cf15f1 merged @f35904a, review clean no fix loop — hero asset, IK welds limbs through backflip, 8 draw calls, 284-tri ghost)
  Minor (deferred): extra pitchPivot node vs spec 3-level hierarchy (functionally sound, note for Task 22 ghost consumer); determinism test narrow; lean test checks hip only not shoulder dip
  Note: README got an 'init' section (59530bd) via worktree base — harmless
BATCH A COMPLETE (T9, T13, T16)
Task 10: complete (worktree cf44a5d merged @2d68730, review clean + fix bb57c2a: carColors wired to per-color merged meshes, office lit-ratio floor 0.5)
  Minor (deferred): EXIT glow amber not red (no red token, tall.ts precedent); determinism tests assert footprint only (inherited gap)
Task 12: complete (worktree b79e2c3 merged @b90d9bf, review NEEDS-FIX then clean after fix f905e4f: CRITICAL fan-orbit bug fixed, beacon colors themed, mast footprint, monument rng variety)
  Minor (deferred T12): monument up-light sometimes teal vs amber comment; fans share one material; grid non-overlap approximate; billboard-reserve test checks bounds only
Task 11: complete (worktree 2815a14 merged, review clean + fix 8153916: bar standing-table split into userData.standAnchors, seats=4 at hip height pass seatSanityChecks)
  Downstream contract: venues expose userData.seats (seated, hip 0.45) AND bar userData.standAnchors (standing, y0). Task 17/20 plant seated on seats, standing on standAnchors.
  Minor (deferred): storefront parapet flat cap; restaurant footprint +Z asymmetry; makeNoren rng vestigial
BATCH B COMPLETE (T10, T11, T12)
Task 14: complete (committed direct to build/cyberpunk-hero @ebe7a61 — worktree not recreated on resume, harmless; review clean + cleanup pending)
  ADJUDICATED: kei van 4 draw calls OK (over ≤3 cheap guideline) — panel+rack justify it, within ≤5/car + city budget
  Cleanup done @325376c: honest budget comment, plateY wired, turn-signal comment fixed
Task 17: complete (worktree 9352b70 merged, review pending) — people walk/stand/sit + dogs + crowd; sit pelvis-at-origin for venue seat anchors; rig.ts shared skinned-rig helper added
  Dev fixes: dog leg collapse bug, muted-tone-toward-void near-black bug, umbrella off swinging forearm
Task 17: complete (merged 9352b70, review CLEAN — only trivial dead-code nits deferred: dog strideKnee void, buildCrowd group name, rig aimDown unused, feet-reach bbox-proxy test)
Task 15: merged with cars.ts INTEGRATION (b466f14) — lambo/GT + hover coexist w/ T14 cars; controller resolved add/add conflict via integration agent (kept OURS xform/mergeParts/Part superset, brought THEIRS makeHexTexture/wheels/strip helpers). 183 tests green. Review CLEAN — all 4 vehicles spec-complete, bob deterministic+bounded, integration coherent.
  Minor (deferred T15): strip() dead z param; buildLamboStatic underglowIsTeal void param; lambo/GT at 7/7 draw-call ceiling; hover.ts is 3rd copy of merge logic (mergeParts/xform/Part)
BATCH C COMPLETE (T14, T15, T17)
Tech-debt note for final review: mergeParts/xform/Part now duplicated across bike.ts, cars.ts, hover.ts, rig.ts — candidate consolidation into utils/merge.ts
Task 18: complete (uncommitted worktree work recovered+committed f1dfcfe by controller after agent teardown; merged @88a4c7c; review CLEAN — no stubbed geometry despite interrupted iteration)
  Minor (deferred): crane docstring says 4 meshes but 6 (trolley+load unmerged); powerlines 4th wire "for density" vs spec 3/span; makeWalkingManTex void rng param
Task 19: complete (recovered+committed 228ff15, fix 98109db, merged; review CLEAN after fix — pylons instanced ~250->4 draw calls, T-cap sign fixed, both pinned by regression tests)
  Minor (deferred): dead far-leg-skip comment; darkStructureMat dup; mergeOne clearGroups dead plumbing
  Minor (deferred T19): far-leg cutoff gz<-400 magic const; strobe Points frustumCulled false
BATCH D COMPLETE (T18, T19)
======== PHASE 2 COMPLETE — all 14 asset families built, reviewed, merged ========
Asset API for Phase 3 (T20) consumer — every builder + contract:
BUILDINGS (origin ground center, userData.roofY/footprint=[w,d]):
 tall.ts: buildTallStepped(rng,floors?=34), buildTallSlab(rng,floors?=40) [userData.beacons,ticker]
 special.ts: buildMonolith(rng) [userData.beacons,halo]
 medium.ts: buildApartment(rng), buildOfficeHolo(rng)[userData.ticker], buildParking(rng)
 short.ts: buildStorefrontRow(rng,shops?=4)[userData.billboardAnchors], buildFancyRestaurant/buildRamenShop/buildBar(rng)
   venues expose userData.seats:Object3D[] (hip 0.45, oriented); bar also userData.standAnchors; ramen userData.steamAnchor; neon userData.flicker
 skinny.ts: buildRadioMast(rng), buildMonument(rng)[halo]
 rooftop.ts: decorateRoof({y,w,d}, rng, opts?{billboard}) -> Group roof-local, ≤3 draw + fans(per-vent meshes, userData.fans)
BILLBOARDS billboards.ts: buildBillboard(rng,{format,mount:'stand'|'wall'|'roof',widthM?,texture?}) -> {group,setTexture(t),updateAmbient(sec)}; formats landscape/portrait/square/strip/vcard
VEHICLES ({group,update(t)}, userData.headAnchor/tailAnchor):
 cars.ts: buildHatchback/buildKeiVan/buildSedan/buildCrossover/buildLamboWedge/buildGTCoupe (update reads userData.speed)
 hover.ts: buildHoverA/buildHoverB (userData.bobSeed, bob det in t)
 bike.ts: buildBike(rng) -> {group,pose(BikePose{lean,pitch,crouch,wheelSpin}),ghostGeometry}; userData.headAnchor
CHARACTERS ({group,updateAmbient(sec)}):
 person.ts: buildPerson(rng,'walk'|'stand'|'sit'), buildCrowd(rng,n,[w,d]) [instanced]
 dog.ts: buildDog(rng,'walk'|'sit')
PROPS: crane.ts buildCrane(rng,swinging?){group,updateAmbient}; gasStation.ts buildGasStation(rng); powerlines.ts buildPowerRun(rng,from,to,poles);
 streetProps.ts buildStreetLamp/buildTrafficLight/buildSteamVent(userData.steamAnchor)/buildVendingMachine/buildHydrant/buildTrashHeap(rng)
METRO metro.ts: buildMetro(rng) -> {group,update(t)}; METRO_SPEED,METRO_PHASE exported (TUNE for Task 25)
WORLD: route.ts WAYPOINTS/ROUTE/ROUTE_U/roadFrame(u)/MOON_POS/MOON_RADIUS; streets.ts buildStreets(rng)/STREET_WIDTH=14/SIDEWALK_W=3; farField.ts buildFarField(rng){group,updateAmbient}
CORE: core.ts initCore(canvas)->Core{renderer,scene,camera,render,onFrame,start,setQuality,quality}; FOG_DENSITY exported
UTILS: rng.ts makeRng(seed); merge.ts mergeStatic; canvasText.ts makeCanvasTexture/drawPanel/wrapText
VIEWER: registerAsset(name,make) via src/viewer/entries/*.ts (glob-loaded); ?viewer=&angle=&t=&sec=&cam=x,y,z,tx,ty,tz
TECH DEBT (final-review): mergeParts/xform/Part duplicated in bike.ts/cars.ts/hover.ts/rig.ts -> consolidate to utils/merge.ts
Task 20: NEEDS-FIX (cc53476, city assembly — visually excellent, draw calls 31-254 <260). Review 3 CRITICAL: City.update(t) dead code, metro unconsumed, main.ts not wired (report cited nonexistent brief text).
  ADJUDICATED: main.ts deferral is controller-authorized (my dispatch said prefer viewer-entry; Task 25 rewires main.ts) — report to be corrected, no code change. Fix dispatched for: update(t) dead, add metro+wire, animate fans, add skyline filler variety (tall/parking to back zones), re-audit draw calls.
  Interim b53b37a: update+metro+fans+variety wired but blew draw budget (4/6 viewpoints >260, up to 368) — global instancing city-spanning bounds defeat culling. Region-chunk instancing fix dispatched.
  Minor (deferred to final): cityLayout.ts ~1005 lines (split candidate); vestigial variant field; test rectsOverlap dup; decorateRoof only on fillers not landmarks

======== SESSION HANDOFF NOTE (env + Task 20 status) ========
ENV: this is a SHARED HPC login node, heavily loaded by OTHER users (mmfsd/azcopy/julia/python pegging CPU). Heavy WebGL builds (esp. the CITY viewer with ~160 getImageData-heavy billboards) can time out >120s under load — NOT a code bug. Individual asset viewers (metro 6.8s) stay fast. Playwright browser needed reinstall this session (`npx playwright install chromium`, v1228 fallback ubuntu24.04-x64). Draw-call audit script pattern: load ?viewer=city&cam=..., waitForFunction window.__READY, read window.__DRAW_CALLS__ (set in viewer.ts after render). Run from repo dir for playwright resolution; use waitUntil:'commit' + long timeout.

Task 20: FUNCTIONALLY COMPLETE + visually approved (dense neon city, streetlamp pools, billboards, Shibuya — confirmed at cc53476/b53b37a renders). Reverted d125b32 (incomplete region-chunk mid-rewrite that HANGS city build — per-region buildBillboard regenerated ad textures instead of sharing) back to b53b37a @ commit 137fd50.
  DEFERRED to Phase 6 / Task 33 (holistic perf+draw-call pass): region-chunk instancing so street viewpoints hit <260. Current street viewpoints ~305-368 (over the 260 target). LESSON for the redo: region-scope instanced batches for frustum culling BUT share ad textures/geometry across region batches (don't regenerate per region — that's what blew up d125b32). Overhead viewpoint sees whole city; may need to accept it as debug-only.
Task 21 (traffic): next. Verify against a LIGHT scene (streets+traffic+farField, NOT full 160-billboard city) to avoid the texture bottleneck under node load.
