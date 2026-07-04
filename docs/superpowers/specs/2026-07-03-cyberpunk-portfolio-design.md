# Cyberpunk Scroll Portfolio — Design Spec

**Date:** 2026-07-03
**Site:** evanly.me → Vercel project `cybersite` (https://cybersite-dyo5-three.vercel.app/), repo `evanly-gh/cybersite`, framework preset "Other"
**Owner:** Evan Li (evanly@uw.edu)

## 1. Summary

A single-page portfolio built as a continuous cinematic ride: a black-suited biker on a
Tron-style neon motorcycle rides through an endless cyberpunk city at night. One pinned
Three.js canvas, one master GSAP ScrollTrigger timeline scrubbed by scroll, drives the
camera, the biker, traffic, and every section reveal. Portfolio content (About, Projects,
Research) is displayed **in-world** on billboards, building banners, and holographic
screens. After the hero finale (biker rides an ocean bridge into a massive rising moon),
the canvas releases into DOM resume sections (Education, Skills, Experience &
Achievements, Contact) styled as a cyberpunk HUD.

Approach: **A — one world, one master timeline** (approved). No scene swaps; sections
are labeled ranges on one timeline. All 3D assets are generated procedurally in code
(Three.js primitives, merged + instanced geometry) — no external model files — so assets
can be iterated in code and later replaced with voxel versions.

## 2. Stack & deployment

- **Build:** Vite (vanilla JS or TS — TS preferred), `vite build` → `dist/`
- **3D:** Three.js (WebGL2), `EffectComposer` post-processing
- **Animation:** GSAP + ScrollTrigger (pinned canvas, scrubbed master timeline)
- **Fonts:** self-hosted via Fontsource npm packages (no external font CDN at runtime)
- **Deploy:** Vercel static (`framework: "Other"`, build command `npm run build`,
  output dir `dist`), auto-deploy on push to `main` of `evanly-gh/cybersite`
- **No backend.** Contact section uses `mailto:` and outbound links only.

## 3. Design language

### 3.1 Palette
| Token | Hex | Use |
|---|---|---|
| `--void` | `#07080F` | sky, page base |
| `--shadow-blue` | `#101426` | building bodies, shadow |
| `--tron-cyan` | `#00F0FF` | the biker: bike lights, trail, hero UI accents |
| `--signal-magenta` | `#FF2BD6` | city neon, ads, competing glow |
| `--sodium-amber` | `#FFB347` | streetlights, warm restaurant/bar interiors |
| `--holo-teal` | `#B7F5E9` | holo screens, ghosted UI text |
| `--moonlight` | `#F5F0E6` | finale moon, closing type |

Rule: cyan belongs to the biker/protagonist and site chrome; the city at large skews
magenta/amber so the biker always pops.

### 3.2 Typography
- **Display:** Unbounded — section titles, intro/outro wordmark, used sparingly
- **Body/HUD:** Rajdhani — paragraphs, billboard copy, DOM sections
- **Utility mono:** Share Tech Mono — labels, coordinates, data readouts, eyebrows

All hero text is rendered to high-resolution `CanvasTexture`s so it exists in-world
(billboards/holos), never as DOM overlay inside the hero.

### 3.3 Signature motif: sandevistan time-stutter
RGB-split afterimages (Edgerunners sandevistan reference) carried through the whole site:
- Biker trail: chain of ghosted biker/bike snapshots fading cyan→magenta→violet with
  chromatic offset, spacing proportional to speed; present throughout the ride.
- Finale: trail amplified to a full-spectrum echo chain (rainbow gradient across ghosts).
- Cursor trail (site-wide, DOM overlay canvas): miniature sandevistan — dashed segments
  with RGB-split echoes that lag and fade.
- Section titles glitch in with 2–3 RGB-split offset frames.

## 4. World design

### 4.1 Layout & route
Fixed authored city, deterministic (scroll scrubs both directions identically). Biker
follows one continuous Catmull-Rom spline:

```
[INTRO PLAZA] ─straight─> [ABOUT STREET] ─> [SHIBUYA CROSSING]
    ─(90° right drift)─> [RAMP STREET / PROJECTS BOULEVARD]
    ─(on-ramp)─> [RESEARCH SKYWAY]  (elevated highway)
    ─> [OCEAN BRIDGE] ─> horizon + rising moon
```

The bike's lateral path has organic non-uniform weave: layered incommensurate sine
noise + hand-placed offset keyframes; lean into turns; suspension bob. Never a straight
line, never a uniform tempo.

### 4.2 Endless-city illusion — 3 detail rings
- **Ring 0** (≤60 m of route): full-detail authored blocks; storefronts, restaurants
  with seated patrons, billboards, powerlines, street props.
- **Ring 1** (60–250 m): instanced medium/tall buildings, emissive window textures,
  rooftop clutter (instanced).
- **Ring 2** (250 m–horizon): instanced silhouette towers with animated window-glow
  shader; exponential fog (`FogExp2`, void-blue) melts them into the sky.
- Ocean side (finale) is the only edge of the world where the city visibly ends.

### 4.3 Metro line
Elevated track on pylons looping through Rings 0–1; the train **hangs beneath the
track** (Cyberpunk Edgerunners style), lit windows, passes through frame at 2–3
choreographed timeline moments (once behind the About displays, once crossing above
the Shibuya intersection, once distant in the finale).

## 5. Asset catalog

Every asset family gets a mandatory **3-iteration detail loop** during implementation:
build → render screenshot → ask "what detail is missing vs. reference?" → add → repeat
×3 minimum. Reference imagery: Cyberpunk 2077/Edgerunners stills, Blade Runner streets,
Jesse Zhou ramen-shop detail density, GTA Tron-bike ("Shotaro") for the bike.

### 5.1 Buildings
- **Tall ×2:** (a) stepped megatower, antenna crown, blinking aircraft beacons;
  (b) slab tower with a vertical neon spine and holo-band.
- **Special tall ×1:** corporate monolith (Arasaka-style), glowing sigil near the crown,
  placed as a landmark visible from About street.
- **Medium ×3:** (a) terraced apartment block — AC units, balconies, hanging laundry;
  (b) office block with wraparound holo ticker; (c) parking structure with visible car
  silhouettes on decks.
- **Short ×4:** (a) storefront row, ≥4 varied sign/awning themes; (b) fancy restaurant —
  outdoor seating, string lights, seated patrons, waiter; (c) ramen shop — noren
  curtains, steam from kitchen vent, counter seating, patrons; (d) bar — neon marquee,
  stools, patrons, spill of amber light onto sidewalk.
- **Skinny towers ×2:** (a) lattice radio mast, guy wires, blinking beacons;
  (b) monument/statue with holographic halo ring.
- **Rooftop clutter set:** satellite dishes, vent units with spinning fans, glass
  observatory, water tower, billboard mounts, rooftop tables/chairs, pipes, antennas.
  ≥80 % of Ring 0–1 buildings get non-flat tops.
- **Footprints:** varied — 1×1, 1×2, 2×3, L-shaped; skyline must read as mixed
  rectangular slabs, not uniform squares.

### 5.2 Billboards (vibe carriers — the city is full of them)
**5 formats:** large landscape (16:9), portrait/thin (9:21), small square card (1:1),
**ultra-wide strip banner (~8:1** — spans a building face or hangs across the street),
**small vertical card (2:3)**.
**3 mounts:** freestanding stand, building-side hang (flat or perpendicular flag-mount),
rooftop frame.
**Content:** procedurally drawn canvas ads — futuristic fake brands with scanline +
flicker shader; several easter eggs from Evan's work: *MAM Industries*, *Q4_K_M Energy*,
*pgvector ramen*, *Sandevistan tune-ups*, plus generic neon kanji/katakana signage.
Billboard light visibly floods nearby geometry (emissive + faked area glow planes).

### 5.3 Vehicles
- **Ground cars ×6** — detail scales with price tier:
  - Cheap ×2: boxy hatchback; dented kei van — low detail, dim halogen lights.
  - Average ×2: sedan; crossover — mid detail, white/red light strips.
  - Luxury ×2: Lamborghini-wedge with underglow + animated neon accent lines; long GT
    coupe with full-width light-bar tail.
- **Hover cars ×2:** glowing thruster rings, no wheels, animated bob; fly lane paths
  between building heights, plus occasional street-level hover lane.
- Traffic moves with/against the biker but much slower relative to the scroll, so the
  biker visibly overtakes.
- All vehicles: headlights/taillights project light pools onto the road ahead/behind.

### 5.4 Biker (protagonist)
Black biker suit, helmet with cyan visor stripe, subtle suit seam lights. Bike =
Tron-style: enclosed **circular hoop wheels with emissive neon rim rings**, low wedge
body with cyan light channels, headlight cone projected on the asphalt. Animations:
lean-into-turn, weave, suspension bob, drift pose (rear slide + counter-steer), backflip
tuck.

### 5.5 Misc
Construction cranes ×2 (one with slowly swinging load), gas station, powerline poles
with sagging catenary wires, traffic lights, steam vents, ~40 stylized people (walk,
stand, sit — restaurants/bar seating must be visibly occupied), dogs (walking with
owners / idling), street trash props, road markings incl. Shibuya diagonal crosswalk.

## 6. Lighting & post-processing

- Base: near-black ambient + moonlight directional (cool, low intensity).
- Streetlights: sodium-amber pools (fake light cones + emissive heads; real point
  lights only near the camera path, budgeted).
- Neon/billboards: emissive materials driving **UnrealBloomPass** (threshold tuned so
  only emissives bloom); billboard glow fills adjacent walls via glow planes.
- Vehicle lights: accurate placement; light pools on asphalt in front of headlights.
- Wet-street feel: high-gloss road material with screen-space-ish fake reflection
  (mirrored emissive smear texture, not full SSR — perf).
- Post chain: render → UnrealBloom → subtle chromatic aberration + vignette. Finale
  ramps bloom strength & moon exposure.

## 7. Scroll choreography (hero ≈ 1450vh pinned)

Master timeline segments (1 scroll ≈ 100vh):

| # | Segment | Scrolls | Camera & action |
|---|---|---|---|
| 0 | **Intro** | 1.5 | Clean title screen: wordmark "EVAN LI", sub "CS + ECON @ UW — ML / EDGE INFERENCE", "scroll to ride" hint. Camera high above neon grid; dives down, threads between towers, locks into chase cam behind biker already in motion. |
| 1 | **About** | 2.5 | Camera decelerates to a fixed point on the RIGHT side of the street, perpendicular to it, framing the LEFT street wall. About content on building banners/holos. Biker streaks across bottom of frame (small), with traffic. Metro passes behind. |
| 2 | **Drift transition** | 1.5 | Camera re-attaches to chase cam; approach Shibuya-style crossing (diagonal crosswalk, mega-screens, crowd on corners). Biker executes smooth 90° right drift: skid marks decal, tire-smoke particles, camera swings wide outside the turn, then settles. |
| 3 | **Projects** | 3.5 | Low, ground-hugging cam behind bike; ramp 1 ahead. Biker accelerates, launches, **backflips**. Camera pans to LEFT side of street, perpendicular, facing right street wall: holo/billboard layout displays the 2 main projects with a deliberate arc-shaped negative space matching the flight trajectory — biker sails through the gap. Lands; short run; ramp 2; second flip past the 3 smaller project cards (same negative-space treatment). |
| 4 | **Research** | 2.5 | Camera leads from ahead of the bike (biker locked center-frame) on the elevated skyway. Two large research holo-panels float past in the sky, one per side, large and readable; paced slowly. |
| 5 | **Finale** | 2 | Biker speeds onto ocean bridge; massive moon rising dead ahead; sandevistan trail amplifies to full spectrum; city glitters behind. Closing wordmark + "keep scrolling ↓" leading into DOM sections. |

Camera implementation: authored keyframe poses (position, lookAt, FOV, roll) per
segment, eased spline interpolation, scrubbed by the master timeline. Biker progress
along the route spline is also keyframed so speed can surge (ramps, finale) and ease
(About flyby loop).

`prefers-reduced-motion`: replace scrub choreography with static per-section vignettes
(camera fixed per section, biker idle) and normal page scrolling; disable cursor trail.

## 8. Section content (in-world displays)

All images are placeholder textures rendered with their required upload dimensions
labeled on them. One editable config: `src/content/resume.ts` holds every string and
image path.

### 8.1 About (building banners, left street wall)
- Mega-banner: "EVAN LI" + title line.
- Paragraph panel (holo): CS + Economics @ UW, Interdisciplinary Honors, GPA 3.9;
  focus on ML systems — model compression, on-device inference, test-time training.
- Face photo: portrait holo-board — **800×1000 (4:5)**.
- Misc images ×2: **800×600 (4:3)** each, adjacent smaller billboards.

### 8.2 Projects (right street wall + flight-arc negative space)
- Main ×2 (large building holos, **1280×720 16:9** images):
  1. **TTT-E2E** — PyTorch, HF Transformers · dual-branch MAML-style test-time
     training; emotion classification 45%→63% on ELSA; 4-method eval harness.
  2. **RememberMe** — PyTorch, ResNet-50, FastAPI · team lead; +35% avg F1 over CLIP
     zero-shot across 25+ CelebA attributes; 6-model pipeline, 120+ attributes,
     pgvector semantic search; 5s→2s latency under 2 GB RAM.
- Small ×3 (card billboards, **800×600** images):
  3. **Mandarin Learning App** — RN + Supabase Edge + Gemini 2.0, JWT-gated LLM proxy.
  4. **Bellevue College Hackathon** — 2nd place, 2024.
  5. **DubHacks 2025** — Growth Track competitor.

### 8.3 Research (sky holo-panels, **1280×720** images, medium descriptions)
  1. **Mobile Intelligence Lab, UW** — microLLM research under the MAM project; model
     compression + on-device inference for mobile/edge (PI: Wen Cheng).
  2. **LLM Hardware Benchmarking** — advised by Prof. Ranjay Krishna; encoder/PP/TG
     phase isolation, cold/warm/3-median protocol; GGUF Q4_K_M ≈ 50% memory reduction
     at minimal perplexity cost.

## 9. Post-hero DOM sections

Cyberpunk HUD/terminal styling on `--void` background with faint city-glow gradient;
scroll-triggered glitch-in reveals; cursor trail persists.

1. **Education** — UW card: B.S. CS + B.S. Economics, Interdisciplinary Honors,
   expected June 2027, GPA 3.9, coursework readout in mono.
2. **Skills** — interactive chip grid grouped: Languages / ML Frameworks / Techniques /
   Infrastructure / AI Dev Tools (from resume). Hover: neon pulse + related-group
   highlight.
3. **Experience & Achievements** — vertical timeline: Mobile Intelligence Lab,
   Panera Bread (2023, 2025), Ross (2023); achievements: Bellevue Hackathon 2nd,
   DubHacks 2025, Honors Program, Dean's List (Au 2025, Wi 2026).
4. **Contact** — neon-sign links: evanly@uw.edu (mailto), linkedin.com/in/evanhly,
   github.com/evanly-gh; framed as a "transmission" panel.

Quality floor: responsive to mobile (hero: reduced density tier + DPR cap; DOM sections
single-column), visible keyboard focus styles, semantic headings, reduced-motion path.

## 10. Architecture

```
src/
  main.ts                 boot, loader, quality tier select
  core/                   renderer, composer (bloom/CA/vignette), loop, resize, quality
  world/                  cityLayout (block map + route spline), rings, streets,
                          farField, metro
  assets/
    buildings/            one module per building type + rooftopClutter + billboards
    vehicles/             carCheap*, carAvg*, carLux*, hover*, bike (biker+bike)
    characters/           person (pose variants), dog
    props/                crane, gasStation, powerlines, trafficLight, steamVent
  fx/                     sandevistanTrail, cursorTrail, tireSmoke, skidMarks,
                          headlightPools, adFlicker
  choreography/           cameraRig (keyframe poses + interpolation), bikePath,
                          master (assembles segments), segments/{intro,about,drift,
                          projects,research,finale}.ts
  content/                resume.ts (ALL editable copy + image paths + dims),
                          adGenerator (canvas ad textures), textPanels (CanvasTexture)
  ui/                     loader screen, scroll hint, postHero DOM, contact
  utils/                  rng (seeded), geometry merge helpers, canvasText
```

Performance budget: <300 draw calls via instancing + static merges; DPR ≤ 1.75;
auto quality tiering (drop Ring 2 density, bloom resolution, particle counts when frame
time slips); code-generated assets keep payload tiny (target < 1 MB JS gzipped, fonts
aside).

## 11. Implementation process requirements

- Long, granular task list; subagents used for parallelizable asset families
  (buildings / vehicles / characters / props / billboards-ads) since modules are
  independent; choreography segments built sequentially on the shared camera rig.
- Every asset family: 3+ detail iterations with screenshot review vs. references.
- Choreography verification: rendered screenshots at ≥10 scroll positions per segment.
- Final pass: full-scroll critique every ~10%, fix list, second pass.
- Verification tooling: headless screenshot harness (puppeteer or playwright) rendering
  the site at chosen scroll offsets.

## 12. Out of scope (this build)

- Voxel (Teardown-style) asset versions — user will do later; procedural code assets
  must remain modular to allow drop-in replacement.
- Real photography/imagery — placeholders with labeled dimensions.
- Backend/forms, analytics, CMS.
