# Task 10 Report: Medium buildings ×3

**Worktree branch:** `worktree-agent-aec594d282eda0570` (based off `build/cyberpunk-hero` @ f35904a — note: the worktree checkout initially pointed at an unrelated orphan branch with no project files; it was reset to `build/cyberpunk-hero` before starting work)

**Commit:** `cf44a5d` — `feat(assets): apartment, holo-ticker office, parking structure`

## Files
- `src/assets/buildings/medium.ts` (new) — `buildApartment`, `buildOfficeHolo`, `buildParking`
- `src/viewer/entries/buildingsMedium.ts` (new) — registers `apartment`, `officeHolo`, `parking`, `mediumTrio`
- `tests/buildingsMedium.test.ts` (new) — contract/draw-call/determinism tests mirroring `buildingsTall.test.ts`

## What was built
- **Apartment** (22×14, 12 floors): street-face balcony grid (slab+railing, rng laundry/plant/storage/empty), stairwell tower w/ amber glow, roof water tower + dish farm + clothesline, AC units under ~60% of windows, 2 ground shopfronts w/ square ads.
- **Office holo tower** (26×18, 14 floors): cooler curtain-wall facade, 4-face wraparound additive holo-ticker band (`userData.ticker` tagged mesh, UV-scrolled in the viewer's `updateAmbient`), recessed amber-lit lobby, roof glass observatory (transparent, teal edge trim) + vent cluster.
- **Parking structure** (34×22, 7 decks): open decks w/ columns + parapets, 2-5 rng car silhouettes/deck w/ amber tail lights, helical ramp (spiral tread stack around a drum), rooftop lamp poles, big magenta neon "P" sign, blinking rooftop beacon.

## 3-round iteration log
- **Round 1**: apartment side drainage pipe run + parapet pigeon spikes; office zigzag fire escape; parking ticket booth + boom barrier arm + per-deck amber wall-wash lighting (fixed the open decks reading as a solid black box).
- **Round 2**: apartment sagging roof service cable between water tower and dish mast; office rooftop window-washer davit crane; parking rooftop chain-link fence around the perimeter.
- **Round 3**: apartment backlit entrance address plaque; office caged maintenance ladder to the roof; parking security camera at the booth with a blinking status LED (shares the beacon blink pass).

Each round: shot all 3 buildings + `mediumTrio` at 4 angles, read the PNGs, compared against "what's missing vs a Cyberpunk 2077 mid-block," and added ≥2 details (5, 3, and 3 respectively).

## Verification
- `npx tsc --noEmit` clean.
- `npx vitest run`: 8 files / 75 tests passed (includes the new 17-test `buildingsMedium.test.ts`: userData contract, ≤6 draw calls/building, ground-anchored bounds, determinism, beacon/ticker tagging).
- `npm run build` succeeds.
- Dev server + `tools/shoot.mjs` screenshots confirmed all 3 buildings + `mediumTrio` render without errors across 3 iteration rounds; dev server killed before finishing.

## Concerns
- Fire escape / cable / crane / fence details are geometrically present and verified via draw-call/bounds tests, but at this render distance and "bodies near-black" house rule they mostly read as subtle interruptions in the window-texture pattern or roofline silhouette bumps rather than crisp readable shapes — consistent with how `tall.ts`'s own pipe-run and railing details read in its screenshots, but worth a look in the full city assembly with real streetlights/context.
- Draw-call budget is tight but within spec: apartment/office use exactly 6; parking uses 5 (room to spare).
