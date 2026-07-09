### Task 5: Content — resume data, placeholders, ad generator

**Files:**
- Create: `src/content/resume.ts`, `src/content/placeholders.ts`, `src/content/adGenerator.ts`

**Interfaces:**
- Produces:
  - `RESUME` const (single editable source of truth) with shape:
    `{ name, tagline, about: { paragraph, faceImage: ImageSlot, misc: ImageSlot[2] }, projectsMain: Project[2], projectsSmall: Project[3], research: Project[2], education, skills: Record<string, string[]>, experience: TimelineEntry[], achievements: string[], contact: { email, linkedin, github } }` where `interface ImageSlot { src: string | null; w: number; h: number; label: string }` and `interface Project { title: string; stack: string; blurb: string; image: ImageSlot }`.
  - `makePlaceholder(slot: ImageSlot): THREE.CanvasTexture` — shadow-blue panel, dashed holo-teal border, crosshair diagonals, mono text `${label} — upload ${w}×${h}`.
  - `type AdFormat = 'landscape'|'portrait'|'square'|'strip'|'vcard'`; `AD_SIZES: Record<AdFormat,[number,number]> = { landscape:[1024,576], portrait:[512,1194], square:[512,512], strip:[2048,256], vcard:[512,768] }`; `makeAd(format: AdFormat, rng: Rng): THREE.CanvasTexture`.

- [ ] **Step 1: Write `resume.ts`** with the REAL content from spec §8 (About paragraph: UW CS+Econ Interdisciplinary Honors, GPA 3.9, ML systems / model compression / on-device inference / test-time training focus; TTT-E2E + RememberMe as mains with stack+blurb from spec; Mandarin App / Bellevue Hackathon 2nd / DubHacks as smalls; two research entries; education/skills/experience/achievements/contact verbatim from spec §8–9). Image dims: face 800×1000, misc 800×600 ×2, project mains 1280×720, smalls 800×600, research 1280×720. All `src: null` initially.
- [ ] **Step 2: Write `placeholders.ts`** per interface.
- [ ] **Step 3: Write `adGenerator.ts`** — 10+ fake brands: `MAM INDUSTRIES` (hex-grid logo), `Q4_K_M ENERGY` (lightning can), `PGVECTOR RAMEN` (noodle-bowl arrow glyph), `SANDEVISTAN TUNE-UPS` (afterimage chevrons), plus generic: `髙電 HI-VOLT`, `NIGHT LOOP TRANSIT`, `ORBITAL EATS`, `KANJI HOTEL 旅`, `SYNTH BAR`, `EDGE CREDIT`. Each ad: 2-color gradient bg from {magenta, amber, teal} (rng-picked, never tron-cyan per palette rule), big glyph drawn with canvas paths, brand name in Unbounded or Rajdhani, slogan line in mono, scanlines + 2 px border. Portrait/strip formats get vertical/horizontal layout variants.
- [ ] **Step 4: Verify** — register viewer asset `adWall` (a 6×2 grid of planes, one per format+brand sample, emissive map = ads) and `placeholderWall` (all ImageSlots). Shoot both; check legibility, palette compliance, no clipped text.
- [ ] **Step 5: Commit** — `feat: resume content config, placeholder + ad texture generators`

---

# Phase 1 — World skeleton

