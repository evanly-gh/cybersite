# Cyberpunk City Rebuild — Design Spec

**Date:** 2026-07-15
**Branch:** build/cyberpunk-hero
**Status:** Approved design, ready for implementation plan

## Summary

Rebuild the city and roadway of the scroll-scrubbed cyberpunk portfolio ride from
scratch. The previous city construction (route, streets, layout, far-field,
choreography, biker FX) was deleted; only the visual **assets** remain (bike/rider,
buildings, billboards, characters, vehicles, props, metro, GLTF loader). This spec
defines the new ride: a single scroll-driven spline that carries a Tron-style bike
through a dense neon metropolis, revealing Evan Li's résumé content zone by zone, and
ending on a moonlit bridge.

Buildings use the **real KitBash3D "NeoCity" meshes** (verified feasible: 185MB OBJ →
obj2gltf → gltf-transform simplify + DRACO → ~1.93MB for the full kit), loaded through
the existing DRACO-wired hybrid loader with procedural fallback.

## Content Source

All in-world copy and image slots come from `src/content/resume.ts` (`RESUME`), which
already contains: About (bio paragraph + face portrait + 2 misc images), 2 large
Projects (TTT-E2E, RememberMe), 3 small Projects (Mandarin App, Bellevue Hackathon,
DubHacks 2025), 2 Research entries (Mobile Intelligence Lab, LLM HW Benchmarking), plus
post-hero DOM sections (Education, Skills, Experience, Contact). Images are placeholder
slots (`src: null`) until real assets are dropped in.

## Route (Backbone)

A single continuous spline, scroll-scrubbed `t ∈ [0,1]`. Units are meters; `y=0` is
ground. The route has **one 90° right turn** at a Shibuya-style crossing; everything
after the turn runs along the perpendicular axis. Buffer beats sit between every zone so
transitions ease rather than snap.

```
ZONE            t-range     path                         content              camera
──────────────────────────────────────────────────────────────────────────────────────
intro/cruise    0.00–0.12   straight, pure driving       — (none)             establish behind, cruise
about           0.12–0.28   straight boulevard           About hero wall+signs chase, swing to wall
buffer/turn     0.28–0.36   90° RIGHT @ Shibuya          (crossing set-piece) drift arc
projects-ramp1  0.36–0.46   ramp up off street           Projects: 2 BIG      slow-mo apex hold
scaffold-ride   0.46–0.52   land on bldg scaffolding     (buffer)             recover behind
projects-ramp2  0.52–0.62   ramp off scaffold            Projects: 3 SMALL    slow-mo apex hold
descend         0.62–0.68   ramp back down to road       (buffer)             settle to ground
research        0.68–0.84   straight ground strip        Research: 2          LOW, looking UP
buffer/lift     0.84–0.89   road rises onto bridge       —                    lift
bridge/finale   0.89–1.00   bridge away from city        moon payoff          pull back wide
```

Stunt line (physical): **Ramp1 → backflip 1 → land on scaffolding → ride → Ramp2 →
backflip 2 → descend to road → research strip → bridge.**

## World Geometry

### Roadway ("full living street")
- 3-lane road surface (~14m wide) with lane markings, crosswalks at the crossing,
  manhole/grate detail, wet-asphalt neon reflections (road picks up sign glow above it).
- Flanking sidewalks (~3m) with tall curbs; streetlamps at intervals with light pools.
- The road **is** the spline: extruded along the route, so it turns at Shibuya and ramps
  up/down through the stunt and bridge.

### Corridor
- **Width ~34m** between the building walls (moderate canyon — room for lanes +
  sidewalks + setback, buildings frame without crowding the camera).
- Continuous building **walls** on both sides, set back past the sidewalk. **Hard rule:
  buildings never intrude on the road** (regression from the previous build — enforce a
  minimum road-clearance clamp on all placement).
- Placement uses KitBash NeoCity pieces: Large towers (stepped + podium + antenna
  clusters) for skyline, Medium mid-rises (banners, bases) filling walls, Small
  buildings (street markets, alley clutter, neon signs) at ground level near the camera.
- **Far-field depth:** simpler skyline (silhouettes + a few big background towers) so the
  city reads vast without full render cost past the corridor.

### Shibuya crossing — iconic set-piece
- Full scramble crossing: painted diagonal crosswalks, wall of giant wrap-around
  billboards on the corner buildings, dense crowds, signals. Anchors the right turn as a
  memorable landmark.

### Stunt structures
- **Ramp1:** road kicks up into a street launch ramp; bike goes airborne for backflip 1.
- **Scaffolding:** construction scaffolding attached to a building side — a rideable
  elevated deck (steel truss, planks, safety netting, work lights, warning stripes;
  modeled on KitBash rooftop/greeble + prop pieces). Bike lands and rides along it.
- **Ramp2:** ramp on/off the scaffolding launches backflip 2.
- **Descend:** ramp/road curves back down to the street, settling to ground level.

### Bridge / finale
- Road rises onto a bridge leading away from the city toward a large detailed moon on
  the horizon. No content — pure payoff.

### Life (deterministic, scrub-safe)
- Ambient traffic (cars + hover vehicles) in road lanes; pedestrians/crowds on
  sidewalks; metro line overhead. Positions are pure functions of `t` or wall-clock
  (ambient only), never `Math.random` at runtime.

## Content Display Surfaces

Treatment: **billboards for walls, holographic for floating** (mixed).

- **About (0.12–0.28) — one hero wall + supporting signs:** a single large building face
  with portrait + "Evan Li" + tagline (solid neon billboard); nearby smaller signs carry
  the bio paragraph and 2 misc images. Camera reads hero-first, then details.
- **Projects (0.36–0.62) — slow-mo apex, holographic, stationary & unobstructed:**
  - Flip 1 apex: 2 big projects (TTT-E2E, RememberMe) as large floating holo signs
    flanking the arc — title, stack, blurb, screenshot slot each.
  - Flip 2 apex: 3 small projects (Mandarin, Bellevue, DubHacks) as a cluster of smaller
    holo signs.
  - Signs integrated into the scene (mounted on scaffold beams / floating between
    buildings) but kept clear and facing the camera at apex.
- **Research (0.68–0.84) — low camera looking up:** 2 entries (Mobile Intelligence Lab,
  LLM HW Benchmarking) on large solid billboards mounted **high** on canyon-wall
  buildings; low upward camera makes them monumental.
- **Finale:** no content.

## Camera & Choreography

- **Default:** chase cam behind + slightly above the bike, looking ahead. Bike stays hero.
- **Content reveals:** camera swings out to frame the About hero wall / Research panels,
  then eases back behind.
- **Turn:** camera arcs through the right turn, drifting wide to show the crossing.
- **Flips:** both are **backflips** (rig `pitch` rotates backward). At each apex, time
  dilates to a **dramatic near-freeze** — because the ride is scroll-scrubbed, the apex
  spans a wide `t`-band so a chunk of scrolling barely advances the bike while the signs
  sit readable, then motion resumes. Ghost trail (sandevistan) fans out at apex.
- **Research:** camera drops LOW and angles UP at the towering signs.
- **Finale:** camera pulls back and up to a wide silhouette as the bike rides toward the
  moon; city glows behind.

Architecture: a master GSAP timeline where `t` drives camera pose, bike pose, and bike
position — all pure functions of `t` (scrub-safe, deterministic). Ambient life animates
on wall-clock so it moves even when scroll is still.

## Playback & Reach

- **Scroll-scrubbed:** scroll position drives `t` (top = 0, bridge = 1). Scroll down =
  forward, up = reverse. Pinned canvas.
- **Mobile + reduced-motion (full support):** quality tiers (lower DPR/density on
  phones), touch scroll, and a `prefers-reduced-motion` fallback that snaps to sections
  instead of scrubbing.

## Technical Architecture

### Asset pipeline (KitBash NeoCity)
- Offline step: KitBash NeoCity OBJ → split into the 47 named pieces → decimate →
  glTF + DRACO → `public/models/`. Exact handling (repeatable script vs. one-time
  process) is **deferred to implementation** — pick the cleanest approach then, flag if
  blocked. Verified feasible in this environment (obj2gltf + @gltf-transform/cli;
  full-kit output ~1.93MB DRACO).
- Load through existing hybrid loader (`src/assets/gltfLoader.ts` +
  `src/assets/buildings/gltfBuildings.ts`); **procedural fallback** if a file is missing.
- KitBash ships **no textures** — author emissive window/neon materials in-code, matching
  the site's emissive art style. Material colors are "named intent" from the .mtl
  (Concrete, GlassTinted, Neon LightBlue/Red/Yellow, Brass).

### Palette (reserved)
- **tron-cyan is exclusive to the bike/rider.** City/buildings/people/props use
  holoTeal / signalMagenta / sodiumAmber / moonlight (`src/theme.ts`). House-rules tests
  grep source for `tronCyan` misuse.

### Modules (rebuilt)
- `src/world/route.ts` — the spline + waypoints + `roadFrame(t)` orientation.
- `src/world/streets.ts` — road, sidewalks, crossing, ramps, scaffolding, bridge.
- `src/world/cityLayout.ts` — building placement along the route + display anchors.
- `src/world/farField.ts` — skyline silhouettes + moon.
- `src/choreography/` — master timeline, camera rig, bike path, per-zone segments,
  traffic.
- `src/fx/` — sandevistan (slow-mo/ghost trail), light pools, drift FX.
- `src/main.ts` — boot wiring (currently boots an empty scene; rewire to assemble the
  new world).

### Performance
- Buildings placed as instanced/merged meshes along the route; full density only in the
  camera corridor, cheap far-field beyond.
- Draw-call budget tracked **per viewpoint from the start** (previous build fought this
  as a retrofit). Global (not per-zone) instancing where bounding spheres would span the
  turn.

### Verification
- `?viewer=<asset>` for each new asset/structure.
- `npm run shoot` screenshot sweep at key `t`-values across all zones.
- `?stats=1` draw-call audit at each viewpoint.
- Deterministic seed test (same seed → same layout) + forward/backward scrub consistency.

## Build Sequence

**Foundation first, then verify, then dress.** Build route + road + basic (grey-box)
building placement + camera/bike ride working end-to-end first; verify the whole ride
feels right; then layer in KitBash detail, content displays, life (traffic/crowds/metro),
and FX. This de-risks the choreography before heavy asset work.

## Non-Goals

- No new résumé content (use `RESUME` as-is; real images drop in later).
- No redesign of the post-hero DOM sections (Education/Skills/Experience/Contact render
  as-is via `renderPostHero`).
- Not shipping the KitBash 4K PBR textures (not included; emissive materials authored in
  code).

## Key Risks

1. **Draw-call / perf budget** with real KitBash meshes — mitigate via decimation, merge,
   instancing, corridor-only density, per-viewpoint audit.
2. **Buildings intruding on the road** — enforce a hard minimum road-clearance clamp
   (previous regression).
3. **Frustum culling across the 90° turn** — use global instancing where bounding spheres
   span the bend.
4. **Scroll-scrubbed slow-mo readability** — the near-freeze apex must reserve enough
   `t`-band that content is comfortably readable at natural scroll speed.
5. **Mesh-processing tooling** — verified working now; if a re-tune is needed later,
   re-running the pipeline must stay reproducible.
