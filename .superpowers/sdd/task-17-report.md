# Task 17: People + dogs — report

**Worktree branch:** `worktree-agent-ad59915dee2f4df20`
**Commit:** `9352b70` — feat(assets): stylized people (walk/stand/sit), dogs, cheap crowd

Note: this worktree's branch had been left pointing at an unrelated init
commit at task start (not the project history). It was reset to
`build/cyberpunk-hero` (8153916, the tip other Task 17-dependency worktrees
were on) before any work began, so the new commit sits directly on top of the
expected Task 11/16 history.

## Files
- `src/assets/characters/person.ts` — `buildPerson`, `buildCrowd`
- `src/assets/characters/dog.ts` — `buildDog`
- `src/assets/characters/rig.ts` — shared rig helpers (mirrors the bike/rider
  merge-and-skin technique from `src/assets/vehicles/bike.ts`)
- `src/viewer/entries/characters.ts` — `personWalk`, `personStand`,
  `personSit`, `dogWalk`, `crowd`, `streetCast` (+ a debug-only `dogSit`,
  not in the required list but useful for review)
- `tests/characters.test.ts` — 23 new tests

## What was built
- **Person**: single SkinnedMesh, 11 rigid-bound bones, 2 material groups
  (matte body + an "accent" material that's always the dark visor band and,
  20% of builds, also lights up one of stripe/umbrella/holo-phone-glow in
  magenta/amber/teal — never tron-cyan). `walk` is a baked mid-stride pose
  with continuous sub-4cm bob + arm-swing in `updateAmbient`. `sit` keeps the
  hips bone at the group's local origin (0,0,0) so it seats correctly when
  Task 20 parents it onto a Task 11 seat anchor (0.45m hip height); thighs
  rotate forward, calves drop straight down so feet land at local y ≈ -0.45,
  matching the anchor's floor offset. `stand` adds idle sway plus an
  independent 30% "looking at phone" idle (arm raised, glow quad pulses).
- **Dog**: box body/head/legs + wagging tail, 2 size classes (rng-picked),
  1-2 draw calls (fur + optional 25%-chance glowing collar).
- **Crowd**: one low-poly figure (capsule + head) driven through a single
  `THREE.InstancedMesh`, so `buildCrowd(rng, n, area)` costs ~1 draw call
  regardless of n (tested at n=10 and n=40 — draw-call count is identical).
  Per-instance color variety + a continuous per-instance sway phase in
  `updateAmbient`.

## Verification
- `npx tsc --noEmit` clean.
- `npx vitest run`: **135/135 passing** (23 new in `tests/characters.test.ts`):
  pose validity + ≤2 draw calls for `buildPerson`/`buildDog`; sit-pose
  pelvis-at-group-origin and feet-reach-floor (~-0.45) checks; crowd
  draw-call count independent of n; determinism for all three builders under
  a fixed seed; finite world matrices under `updateAmbient` across a range
  of seconds; sub-4cm walk-bob amplitude measurement; source-scan checks (no
  `Math.random`, no `tronCyan`, accent colors limited to
  `signalMagenta`/`sodiumAmber`/`holoTeal`).
- Manual: `npm run dev -- --port 5217 --strictPort`, `npm run shoot` against
  `personWalk`, `personStand`, `personSit`, `dogWalk`, `crowd`, `streetCast`,
  `dogSit` (4 angles each), read back every PNG.

## 3-round detail-iteration log
- **Round 1** (first pass — added bags/backpacks, hood-up variant, a bent
  trailing-knee heel detail, a held umbrella, and holo-phone glow):
  - Figures read as people at a glance, but the muted-tone palette mixed too
    far toward `COLORS.void`; several tones rendered as pure black on the
    black backdrop (barely visible in `streetCast`/`crowd`).
  - The dog's fur palette had the same problem and the dog was essentially
    invisible from every angle.
  - The umbrella accent was bound to the swinging forearm bone, sitting
    flush against the head — it read as a rice hat sitting on the person,
    not an umbrella held above them.
  - `streetCast`'s lineup was spread across ~12m, so the viewer's
    auto-framing camera zoomed out until every figure was a few dark pixels.
- **Round 2** (fixes — a full look/render/adjust pass, not new features):
  rebuilt the muted-tone palettes to mix theme colors toward each other
  (e.g. `shadowBlue`→`moonlight`) instead of toward `void`; gave every
  material a small self-emissive lift (0.12) for legibility against the
  night backdrop; moved the umbrella to a fixed spine-relative offset well
  clear of the head; compacted `streetCast` into a ~7x5m footprint so the
  camera frames it usefully. Re-shooting the still-dark dog surfaced a real
  bug: leg geometry was authored as bone-local `(0, -legLen/2, 0)` offsets
  while every other dog part (body/head/tail) uses absolute from-hips
  coordinates — the convention `mergeParts`'s skinning requires — so all
  four legs baked to the world origin regardless of which leg bone they were
  bound to, and the dog rendered as an unrecognizable box on a single
  crossed pair of "legs." Fixed by giving each leg (and the tail) its own
  absolute X/Z matching its bone's bind position.
- **Round 3** (2 new details): more pronounced trailing-leg knee bend in the
  walk bake (reads as a heel lift, per the brief's candidate list); a
  25%-chance glowing neon collar on the dog (second material group, stays
  within the ≤2 draw-call budget).

## Concerns / notes for downstream tasks
- Task 20 (seat/stand parenting): the sit pose's contract is "hips bone at
  group-local origin, feet reach ~y=-0.45" — verified by test and visually.
- `personSit`/`streetCast` viewer entries include stub bench/seat props at
  y=0.45 purely for isolated preview; Task 20 should parent the real
  `buildPerson(..., 'sit').group` directly onto each venue's
  `userData.seats[i]` anchor (no extra y-offset needed since the anchor
  itself already sits at 0.45m and the person's local origin is the pelvis).
- `dogSit` viewer entry is extra (not in the required registration list) —
  harmless, left in for future review convenience.
