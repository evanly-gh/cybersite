### Task 13: Billboards — 5 formats × 3 mounts

**Files:** Create `src/assets/billboards/billboards.ts`

**Interfaces:** `buildBillboard(rng: Rng, o: { format: AdFormat; mount: 'stand'|'wall'|'roof'; widthM?: number; texture?: THREE.Texture }): { group: THREE.Group; setTexture(t: THREE.Texture): void; updateAmbient(sec: number): void }`. Default `widthM` per format: landscape 12, portrait 4.5 (h≈10.5), square 5, strip 24 (h 3), vcard 3.6 (h 5.4). If `texture` omitted, uses `makeAd(format, rng)`. Section-content displays reuse this by passing their own texture — this module is the single screen/frame implementation for the whole site.

- [ ] **Step 1: Screen assembly** — emissive front plane (the ad), thin dark frame box, back panel with rng greeble (ribs, junction box, cable drop), 2–4 maintenance lights on frame top (tiny amber), corner mount brackets. Glow system: additive halo plane 15% larger behind screen at 12% opacity (fakes area-light fill) + a downward gradient "light spill" plane when mount is `stand`/`roof`.
- [ ] **Step 2: Mounts** — `stand`: one or two steel posts + cross brace + base plates + service ladder; `wall`: standoff brackets (flush) OR perpendicular flag-mount arm for portrait/vcard (rng picks); `roof`: A-frame truss + catwalk + 2 spotlight arms aimed at screen (emissive cone gizmos).
- [ ] **Step 3: Flicker** — `updateAmbient`: 8% of billboards (rng at build) get neon-flicker (emissiveIntensity keyed to hash noise bursts); strip format gets slow UV scroll option (`userData.scroll = true` 50% of strips).
- [ ] **Step 4: Iterate ×3** on `billboardGallery` viewer asset (grid of all 15 format×mount combos). Candidates: rust streaks under frames, cable conduits down posts, pigeon row on top edge, one dead-pixel band on an unlucky screen.
- [ ] **Step 5: Commit** — `feat(assets): billboard system, 5 formats × 3 mounts with glow + flicker`

