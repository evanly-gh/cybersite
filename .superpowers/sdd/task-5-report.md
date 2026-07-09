# Task 5 Report — Content: resume data, placeholders, ad generator

## Implemented

- **`src/content/resume.ts`** — `RESUME` const matching the brief's exact shape
  (`ImageSlot`, `Project`, `TimelineEntry`, `Resume` interfaces exported). Copy pulled
  from spec §8–9:
  - About: UW CS + Economics, Interdisciplinary Honors, GPA 3.9, expected June 2027,
    ML systems / model compression / on-device inference / test-time training focus.
  - `projectsMain`: TTT-E2E (PyTorch, HF Transformers; 45%→63% ELSA; 4-method eval
    harness) and RememberMe (PyTorch, ResNet-50, FastAPI; +35% avg F1 over CLIP
    zero-shot across 25+ CelebA attributes; 6-model pipeline, 120+ attributes,
    pgvector; 5s→2s latency under 2GB RAM).
  - `projectsSmall`: Mandarin Learning App (RN + Supabase Edge + Gemini 2.0, JWT-gated
    proxy), Bellevue College Hackathon (2nd, 2024), DubHacks 2025 (Growth Track).
  - `research`: Mobile Intelligence Lab / MAM project (advised by Wen Cheng),
    LLM Hardware Benchmarking (advised by Prof. Ranjay Krishna; GGUF Q4_K_M ≈50%
    memory reduction).
  - `education`/`skills`/`experience`/`achievements`/`contact` per spec §9 (Panera
    Bread 2023/2025, Ross 2023, Dean's List Au 2025/Wi 2026, evanly@uw.edu /
    linkedin.com/in/evanhly / github.com/evanly-gh). Skill chip contents and
    coursework/experience descriptions beyond the named categories aren't literally
    given in the spec, so I filled them in consistent with the stacks/facts already
    established elsewhere in the doc (PyTorch, HF Transformers, ResNet-50, FastAPI,
    pgvector, CLIP, GGUF/llama.cpp, etc.) — flagging this as an assumption in case the
    real resume differs on exact chip wording.
  - Image dims set exactly per brief: face 800×1000, misc 800×600 ×2, project mains
    1280×720, smalls 800×600, research 1280×720. All `src: null`.

- **`src/content/placeholders.ts`** — `makePlaceholder(slot)`: shadow-blue background
  with a radial vignette, faint holo-teal crosshair diagonals, dashed holo-teal border,
  and a centered Share-Tech-Mono label `${label} — upload ${w}×${h}`. Font size shrinks
  to fit; if it still doesn't fit at the floor size, splits into two lines (label /
  dims) rather than clipping or overflowing the canvas.

- **`src/content/adGenerator.ts`** — `AdFormat`, `AD_SIZES` exactly as specified.
  `makeAd(format, rng)`: rng-picks 1 of 10 brands (`MAM INDUSTRIES` hex-grid,
  `Q4_K_M ENERGY` lightning can, `PGVECTOR RAMEN` noodle-bowl+arrow, `SANDEVISTAN
  TUNE-UPS` afterimage chevrons, plus 髙電 HI-VOLT, NIGHT LOOP TRANSIT, ORBITAL EATS,
  KANJI HOTEL 旅, SYNTH BAR, EDGE CREDIT), each with its own canvas-path glyph function.
  rng-picks a color family (magenta/amber/teal — teal maps to `COLORS.holoTeal`, never
  `COLORS.tronCyan`) and draws a 2-color gradient background, brand name (Unbounded
  bold) + slogan (Share Tech Mono), 2px border, and scanlines. `landscape`/`strip` use
  a horizontal glyph-left layout; `portrait`/`square`/`vcard` use a vertical stacked
  layout — satisfying "portrait/strip get vertical/horizontal variants."

- **Viewer assets** registered in `src/main.ts`: `adWall` (12-cell, 6×2 grid, formats
  cycled `landscape,portrait,square,strip,vcard,...`, one `makeAd` texture per cell,
  emissive-only material) and `placeholderWall` (10 cells — all of `RESUME`'s
  ImageSlots, one `makePlaceholder` texture per cell). Added a `buildWall()` helper
  that fits each cell's native aspect ratio into a uniform grid slot so extreme aspect
  variance (e.g. 512×1194 portrait vs. 2048×256 strip) doesn't distort the grid pitch.

## Iteration log (3 rounds, as required)

1. **First render** (`scale`-based grid, `map` + `emissiveMap` material,
   `emissiveIntensity: 1.4`, background gradient lightened toward white): teal-family
   ads were completely blown out to solid white/gray blobs — no glyph, no text
   legible at all. Root cause: `COLORS.holoTeal` (0xb7f5e9) is already near-white;
   lightening it further for the gradient's bright stop, then lighting it a second
   time via a lit `map`, then adding `emissiveMap * 1.4` on top, pushed every teal
   pixel well past the bloom threshold (0.75) into pure white. Magenta/amber ads
   were fine (not blown) but the wall was framed small (portrait cells' extreme
   height inflated the auto-framing bounding sphere).
2. **Second round**: rewrote `drawBackground()` to mix each family's base color
   *toward* `COLORS.shadowBlue`/`COLORS.void` (dark theme colors) instead of
   lightening toward white — this caps luminance regardless of how bright the source
   hue is. Same fix applied to `accent` (glyph/slogan color, mixed 18% toward white
   instead of shaded up). Removed the lit `map` from wall materials (now
   `color: 0x000000` + `emissiveMap` only, `emissiveIntensity: 1.1`) so brightness is
   controlled purely by the texture. Switched `buildWall()` from raw-scale columns/rows
   to a uniform `cellW`×`cellH` fit-box (3×3 units, 0.5 gap) so mixed aspect ratios
   don't distort framing.
3. **Third round (verification)**: re-shot both. Cropped/zoomed with PIL to inspect at
   pixel level (see below) — all readable, no clipping, no cyan. No further changes
   needed.

## What I saw in the PNGs

- **`adWall-a0.png`** (after fixes): 12 planes in a 6×2 grid, each showing a distinct
  brand — e.g. `ORBITAL EATS` (orbit ring + fork tines, magenta bg), `EDGE CREDIT`
  (chip glyph, magenta bg), `PGVECTOR RAMEN` ×2 (bowl + steam lines + diagonal arrow,
  magenta bg — same brand picked twice by rng across 12 draws, expected), `HI-VOLT`
  ×2 (lightning bolt, one amber one teal-family bg), `SANDEVISTAN TUNE-UPS` (chevron
  glyph, teal-family bg), a `Q4_K_M ENERGY`-style amber can. Zoomed 10x crop of the
  PGVECTOR RAMEN cell confirms brand name, slogan ("nearest neighbor noodles."), and
  glyph all sit fully inside the 2px border with no clipping. Sampled background
  pixels from teal-family cells: RGB ≈ (197,205,198)/(212,201,208) — muted gray-teal,
  nowhere near `tronCyan` (0,240,255). No pure cyan anywhere in the image.
- **`placeholderWall-a0.png`**: 10 planes in a 5×2 grid, one per `RESUME` ImageSlot.
  Labels read clearly at zoom: "FACE PORTRAIT — upload 800×1000", "ABOUT MISC 1 —
  upload 800×600", "TTT-E2E — upload 1280×720", "REMEMBERME — upload 1280×720", etc.
  Dashed holo-teal border and faint crosshair diagonals visible on every panel;
  dimension labels present and unclipped on all 10 slots (face portrait at 4:5 is
  visibly taller/narrower than the 4:3/16:9 slots, confirming aspect ratios are
  respected).

## Files changed

- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/content/resume.ts` (new)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/content/placeholders.ts` (new)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/content/adGenerator.ts` (new)
- `/mmfs1/gscratch/intelligentsystems/evanly/cybersite/src/main.ts` (added `buildWall()`
  helper + `adWall`/`placeholderWall` registrations, imports for the three new
  content modules)

Commit: `66088e4` — `feat: resume content config, placeholder + ad texture generators`

## Self-review

- Interfaces match the brief's binding shape exactly: `RESUME`, `makePlaceholder`,
  `AdFormat`, `AD_SIZES`, `makeAd(format, rng)` — later tasks importing these should
  not need any changes.
- All randomness goes through the injected `Rng` (`rng.pick`), no `Math.random()`.
- Palette rule enforced: ad gradients only ever read `COLORS.signalMagenta`,
  `COLORS.sodiumAmber`, `COLORS.holoTeal`; `COLORS.tronCyan` is never referenced in
  `adGenerator.ts`.
- `npm run build` (tsc --noEmit + vite build) is clean, `npm test` is green (6/6,
  unchanged rng tests — no new test file was added since the brief's Step 4 verification
  is the screenshot-based visual check, not unit tests).
- One judgment call worth flagging: the spec names skill *categories*
  (Languages/ML Frameworks/Techniques/Infrastructure/AI Dev Tools) and course/timeline
  *topics* but doesn't spell out literal chip text or coursework list — I filled those
  in to be consistent with facts already in the spec. Worth a real-resume diff pass
  before this ships publicly.
- `education`, `skills`, `experience` shapes aren't pinned down word-for-word by the
  brief's interface line (only `RESUME`'s top-level keys are specified) — I designed
  reasonable nested shapes (`education: {school, degrees, honors, graduation, gpa,
  coursework}`, `experience: TimelineEntry[]` with `role/org/period/detail`). If a
  later task (post-hero DOM sections) expects different field names, it'll need a
  quick alignment pass — I didn't find any other task brief in this repo that already
  consumes `RESUME` to cross-check against.
- `buildWall()`/`WallCell` live in `main.ts` as a viewer-only verification helper per
  the brief ("register viewer asset..."); they're not exported for reuse since no
  other task references them, but if a later choreography task wants an in-world
  "billboard wall" concept, this logic may be worth promoting into a shared module
  instead of duplicating.

## Concerns

- None blocking. The skills/education/experience literal content (see self-review)
  is the one area a human should sanity-check against the real resume before this
  goes live, since the design spec itself doesn't spell out that copy verbatim.

## Post-review fix (coordinator resume diff)

Coordinator diffed `resume.ts` against the real resume; applied their verbatim
corrections in `src/content/resume.ts`:

1. `education.coursework` → `['Deep Learning', 'Data Structures & Parallelism',
   'HW/SW Interface', 'Statistical Methods']` (previous six entries were invented).
2. `skills` → replaced all five groups with the exact source lists (Languages now
   includes JavaScript/Java/C-C++; ML Frameworks adds OpenCV/MediaPipe/CLIP/SegFormer;
   Techniques now Fine-tuning / Meta-learning (MAML/TTT) / RAG / Zero-shot
   classification / GGUF quantization / Evals design / Vector search; Infrastructure
   adds AWS/Git/HuggingFace Spaces; AI Dev Tools = Cursor / Claude Code / GitHub
   Copilot).
3. `experience`: Mobile Intelligence Lab period corrected to 'Spring 2026 – Present';
   Panera Bread → role 'Associate', period 'Jun–Dec 2023 · Jun–Aug 2025', detail
   'Issaquah, WA'; Ross → org 'Ross Dress For Less', role 'Retail Associate', period
   'Jun–Sep 2023', detail 'Issaquah, WA'.
4. Mandarin app blurb → 'Mobile Mandarin tutor: JWT-gated Deno Edge proxy to
   Gemini 2.0 returns structured JSON for inline grammar corrections.'

`npm run build` clean after the change. `placeholderWall` re-shoot skipped: it renders
only ImageSlot labels/dimensions, none of which changed.

Commit: `fix(content): correct resume facts to source values`
