### Task 17: People + dogs

**Files:** Create `src/assets/characters/person.ts`, `src/assets/characters/dog.ts`

**Interfaces:** `buildPerson(rng, pose: 'walk'|'stand'|'sit'): { group; updateAmbient(sec) }` — stylized ~1.7 m; `buildDog(rng, pose: 'walk'|'sit'): { group; updateAmbient(sec) }`; plus `buildCrowd(rng, n: number, area: [w,d]): { group; updateAmbient(sec) }` (instanced-ish cheap crowd for Shibuya corners: merged low-detail standing/walking figures with slight per-instance sway).

- [ ] **Step 1: Person** — segmented capsule figure (no face detail; visor-band suggestion), rng outfit palette (muted street tones + 20% get one neon accent: umbrella edge, jacket stripe, holo phone glow in hand); `walk`: baked stride pose + `updateAmbient` bob/arm swing (sub-4 cm amplitudes); `sit`: hips at 0.45 m matching Task 11 seat anchors; `stand`: idle sway + 30% looking-at-phone (glow quad under face).
- [ ] **Step 2: Dog** — box body + head + legs + tail wag in `updateAmbient`; `walk` pairs beside an owner; 2 sizes.
- [ ] **Step 3: Iterate ×3** on viewer `streetCast` (a lineup: 3 walkers, 2 standers, 3 sitters on a bench prop, 2 dogs). Candidates: bags/backpacks, hood up variant, heel lift in stride, umbrella prop (it's a neon city — one glowing-rim umbrella).
- [ ] **Step 4: Commit** — `feat(assets): stylized people (walk/stand/sit), dogs, cheap crowd`

