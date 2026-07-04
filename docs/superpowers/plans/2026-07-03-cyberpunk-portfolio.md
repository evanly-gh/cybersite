# Cyberpunk Scroll Portfolio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build evanly.me — a scroll-scrubbed cinematic Three.js ride through a neon cyberpunk city where a Tron-bike rider reveals About/Projects/Research on in-world billboards, ending in DOM resume sections.

**Architecture:** One pinned canvas + one master GSAP ScrollTrigger timeline (Approach A). A fixed, seeded, deterministic city; all assets procedural (Three.js primitives, merged/instanced). Camera = authored keyframe poses interpolated by timeline progress. Everything visual verified by a Playwright screenshot harness.

**Tech Stack:** Vite 6 + TypeScript (strict), Three.js (WebGL2, EffectComposer/UnrealBloom), GSAP 3 + ScrollTrigger, Fontsource (Unbounded, Rajdhani, Share Tech Mono), Vitest (unit), Playwright (screenshots), Vercel static deploy.

**Spec:** `docs/superpowers/specs/2026-07-03-cyberpunk-portfolio-design.md` — read it before any task.

## Global Constraints

- Palette (verbatim, define once as CSS vars AND `src/theme.ts` consts): `--void #07080F`, `--shadow-blue #101426`, `--tron-cyan #00F0FF`, `--signal-magenta #FF2BD6`, `--sodium-amber #FFB347`, `--holo-teal #B7F5E9`, `--moonlight #F5F0E6`. Cyan is reserved for the biker + site chrome; the city skews magenta/amber.
- Fonts self-hosted only: `@fontsource/unbounded` (display), `@fontsource/rajdhani` (body/HUD), `@fontsource/share-tech-mono` (mono). No runtime font/CDN requests.
- All hero text lives in-world via `CanvasTexture` — never DOM inside the hero.
- Determinism: every random choice goes through `makeRng(seed)` with a hardcoded seed. Scrubbing backward must replay identically. No `Math.random()` anywhere in `src/`.
- Performance: < 300 draw calls in the worst frame; DPR ≤ 1.75; JS bundle < 1 MB gzipped (fonts excluded); instancing/merging mandatory for repeated geometry.
- Hero scroll length: 1450vh pinned. Segment budget (fractions of master progress `t∈[0,1]`): intro `0–0.10`, about `0.10–0.28`, drift `0.28–0.38`, projects `0.38–0.62`, research `0.62–0.79`, finale `0.79–1.0`.
- **Asset workflow (applies to EVERY task in Phase 2):** register the asset in the viewer registry, then run ≥ 3 detail iterations: `npm run shoot -- --viewer <name>` → compare against spec §5 parts list + reference imagery → list ≥ 2 missing details → add them → re-shoot. Paste the iteration log (what was added each round) into the task's commit message body.
- Asset module contract: static assets export `build<Name>(rng: Rng): THREE.Group`; animated assets export `build<Name>(rng: Rng): { group: THREE.Group; update(t: number): void }` where `t` is master timeline progress (NOT wall-clock) so scrubbing stays deterministic. Ambient-only motion (fans, flicker) may additionally accept `clock` seconds via `updateAmbient(sec: number)`.
- Units: 1 unit = 1 m. Road lanes 3.5 m wide, sidewalks 3 m, building floors 3.2 m. Bike ≈ 2.2 m long.
- Commit after every task with a descriptive message; never batch tasks into one commit.
- Verification is visual: a task touching visuals is NOT done until its screenshots have been rendered and reviewed against the spec.

## File Map (created over the course of the plan)

```
index.html  vite.config.ts  tsconfig.json  vercel.json  package.json
tools/shoot.mjs                      Playwright screenshot harness
src/
  main.ts  theme.ts  styles.css
  core/core.ts                       renderer+scene+camera+composer+quality
  utils/rng.ts  utils/canvasText.ts  utils/merge.ts
  content/resume.ts  content/placeholders.ts  content/adGenerator.ts
  viewer/registry.ts  viewer/viewer.ts
  world/route.ts  world/streets.ts  world/farField.ts  world/cityLayout.ts
  assets/buildings/{tall.ts,special.ts,medium.ts,short.ts,skinny.ts,rooftop.ts}
  assets/billboards/billboards.ts
  assets/vehicles/{cars.ts,hover.ts,bike.ts}
  assets/characters/{person.ts,dog.ts}
  assets/props/{crane.ts,gasStation.ts,powerlines.ts,streetProps.ts}
  assets/metro/metro.ts
  fx/{sandevistan.ts,cursorTrail.ts,driftFx.ts,lightPools.ts}
  choreography/{cameraRig.ts,bikePath.ts,traffic.ts,master.ts}
  choreography/segments/{intro.ts,about.ts,drift.ts,projects.ts,research.ts,finale.ts}
  ui/{loader.ts,postHero.ts}
tests/{rng.test.ts,route.test.ts,layout.test.ts,bikePath.test.ts}
```

---

# Phase 0 — Foundation

### Task 1: Project scaffold + deploy config

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `vercel.json`, `.gitignore`, `src/main.ts`, `src/styles.css`, `src/theme.ts`

**Interfaces:**
- Produces: `src/theme.ts` exporting `export const COLORS = { void: 0x07080f, shadowBlue: 0x101426, tronCyan: 0x00f0ff, signalMagenta: 0xff2bd6, sodiumAmber: 0xffb347, holoTeal: 0xb7f5e9, moonlight: 0xf5f0e6 } as const;` — every later task imports colors from here, never hardcodes hex.

- [ ] **Step 1: Init npm project and install dependencies**

```bash
npm init -y
npm i three gsap @fontsource/unbounded @fontsource/rajdhani @fontsource/share-tech-mono
npm i -D vite typescript @types/three vitest playwright
npx playwright install chromium
```
Expected: clean install. If `playwright install` fails on the cluster (no network/glibc), note it and continue — Task 2 has a fallback check.

- [ ] **Step 2: Write configs**

`package.json` scripts:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "shoot": "node tools/shoot.mjs"
  }
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
export default defineConfig({ build: { target: 'es2022', sourcemap: false } });
```

`tsconfig.json`: `"strict": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "noEmit": true, "types": ["vite/client"]`, include `src`, `tests`.

`vercel.json`:
```json
{ "buildCommand": "npm run build", "outputDirectory": "dist", "framework": null }
```

- [ ] **Step 3: Write `index.html` + `src/styles.css` + `src/theme.ts` + stub `src/main.ts`**

`index.html`: `<canvas id="stage">` inside `<div id="hero">`, empty `<main id="post-hero">`, loads `/src/main.ts` as module. `styles.css`: CSS custom properties for the 7 palette colors (values from Global Constraints), `html { background: var(--void); }`, font-family stacks (`Rajdhani` body, `Unbounded` display via `.display`, `Share Tech Mono` via `.mono`), `#hero { height: 100vh; }`, canvas fixed-fill. `main.ts`: imports the three fontsource packages + styles, logs `boot ok`, paints the canvas solid `--void` via a temporary 2D context (removed in Task 4).

- [ ] **Step 4: Verify dev server and build**

Run: `npm run dev -- --port 5173 &` then `curl -s localhost:5173 | grep stage`; `npm run build`
Expected: HTML served containing `id="stage"`; build completes with `dist/` output.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite+ts project, theme tokens, vercel config"
```

### Task 2: Screenshot harness + asset viewer

**Files:**
- Create: `tools/shoot.mjs`, `src/viewer/registry.ts`, `src/viewer/viewer.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `registerAsset(name: string, make: (rng: Rng) => THREE.Object3D | { group: THREE.Object3D; update?: (t: number) => void; updateAmbient?: (sec: number) => void })` and `getAsset(name)` from `src/viewer/registry.ts`. CLI: `npm run shoot -- --viewer <name> [--angles 4]` and `npm run shoot -- --scroll 0,0.15,0.5,1 [--out shots/]`. Screenshots land in `shots/` (gitignored).

- [ ] **Step 1: Write `src/viewer/registry.ts`**

```ts
import type * as THREE from 'three';
import type { Rng } from '../utils/rng'; // created Task 3; declare interim `type Rng = () => number` and fix import in Task 3
export type AssetEntry = THREE.Object3D | { group: THREE.Object3D; update?: (t: number) => void; updateAmbient?: (sec: number) => void };
const registry = new Map<string, (rng: Rng) => AssetEntry>();
export function registerAsset(name: string, make: (rng: Rng) => AssetEntry): void { registry.set(name, make); }
export function getAsset(name: string) { return registry.get(name); }
export function listAssets(): string[] { return [...registry.keys()]; }
```

- [ ] **Step 2: Write `src/viewer/viewer.ts`**

Reads `?viewer=<name>&angle=<0-3>&t=<0..1>` from `location.search`; creates a minimal scene (void background, ground grid 40×40 m, hemisphere light + key directional, bloom composer from Task 4 once available — until then plain renderer), instantiates the asset centered, frames camera at 4 orbit angles (45° steps, elevation 20°), applies `update(t)` if present. Exposes `window.__READY = true` after first rendered frame (the harness waits on this).

- [ ] **Step 3: Write `tools/shoot.mjs`**

```js
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map((a,i,arr)=>a.startsWith('--')?[a.slice(2),arr[i+1]??'1']:[]).filter(Boolean));
const base = args.url ?? 'http://localhost:5173';
mkdirSync(args.out ?? 'shots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
async function snap(url, file) {
  await page.goto(url); await page.waitForFunction('window.__READY === true', { timeout: 30000 });
  await page.screenshot({ path: `${args.out ?? 'shots'}/${file}` }); console.log('saved', file);
}
if (args.viewer) {
  const n = Number(args.angles ?? 4);
  for (let a = 0; a < n; a++) await snap(`${base}/?viewer=${args.viewer}&angle=${a}&t=${args.t ?? 0.5}`, `${args.viewer}-a${a}.png`);
} else {
  for (const s of String(args.scroll ?? '0').split(',')) await snap(`${base}/?shot=${s}`, `scroll-${s}.png`);
}
await browser.close();
```
(`?shot=` handling is added to `main.ts` in Task 25 — it sets master progress directly and signals `__READY`.)

- [ ] **Step 4: Wire viewer into `main.ts`** — if `location.search` contains `viewer=`, import and run viewer instead of the site.

- [ ] **Step 5: Verify** — register a temporary `testCube` asset (2 m emissive-cyan `BoxGeometry`), run `npm run dev &` + `npm run shoot -- --viewer testCube`, confirm 4 PNGs in `shots/` show a cyan cube from 4 angles. Read one PNG with the Read tool to confirm. If Playwright cannot launch on this machine, STOP and surface the error — the whole plan's verification depends on this task.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: playwright screenshot harness + asset viewer"` (keep `testCube` until Phase 2 starts, then delete).

### Task 3: Utils — seeded RNG, canvas text, geometry merge

**Files:**
- Create: `src/utils/rng.ts`, `src/utils/canvasText.ts`, `src/utils/merge.ts`, `tests/rng.test.ts`
- Modify: `src/viewer/registry.ts` (real `Rng` import)

**Interfaces:**
- Produces:
  - `makeRng(seed: number): Rng` where `interface Rng { (): number; range(a: number, b: number): number; int(a: number, b: number): number; pick<T>(arr: readonly T[]): T; chance(p: number): boolean }` (mulberry32 core).
  - `makeCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture` (sets `colorSpace = SRGBColorSpace`, anisotropy 4).
  - `drawPanel(ctx, o: { w: number; h: number; eyebrow?: string; title?: string; body?: string; accent?: string; bg?: string; align?: 'left'|'center' })` — the ONE house style for text panels: bg `#101426ee`, 2 px accent border + corner ticks, eyebrow in Share Tech Mono uppercase letter-spaced, title in Unbounded, body in Rajdhani with word-wrap (implement `wrapText` helper), subtle scanlines every 4 px at 5% alpha.
  - `mergeStatic(parts: { geom: THREE.BufferGeometry; matrix: THREE.Matrix4; mat: number }[], mats: THREE.Material[]): THREE.Mesh` using `BufferGeometryUtils.mergeGeometries` with groups preserved per material index.

- [ ] **Step 1: Write failing tests** in `tests/rng.test.ts`: same seed ⇒ identical first 5 outputs; different seeds differ; `range(2,5)` stays in `[2,5)` over 1000 draws; `int(0,3)` hits all of 0..3; `pick` only returns members.
- [ ] **Step 2: Run** `npm test` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the three util files per the interfaces above (mulberry32: `let a=seed|0; return ()=>{a|=0;a=a+0x6D2B79F5|0;let x=Math.imul(a^a>>>15,1|a);x=x+Math.imul(x^x>>>7,61|x)^x;return((x^x>>>14)>>>0)/4294967296}` extended with the helper methods via `Object.assign`).
- [ ] **Step 4: Run** `npm test` — expect PASS. Also `npm run build` to type-check canvas/merge modules.
- [ ] **Step 5: Commit** — `feat: seeded rng, canvas panel text, geometry merge utils`

### Task 4: Core renderer + post-processing + quality tiers

**Files:**
- Create: `src/core/core.ts`
- Modify: `src/main.ts`, `src/viewer/viewer.ts` (use core for consistent look)

**Interfaces:**
- Produces: `initCore(canvas: HTMLCanvasElement): Core` with
  `interface Core { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; render(): void; onFrame(cb: (sec: number) => void): void; start(): void; setQuality(tier: 0 | 1 | 2): void; quality: 0 | 1 | 2 }`.
  Internals: `EffectComposer` = RenderPass → UnrealBloomPass(resolution ½, strength 0.9, radius 0.6, threshold 0.75) → ShaderPass(inline chromatic-aberration+vignette fragment shader: rgb offset 0.0015 radial, vignette smoothstep 0.55→0.95 at 35% strength) → OutputPass. `renderer`: `antialias: true`, `toneMapping: ACESFilmic`, exposure 1.1, `setPixelRatio(min(devicePixelRatio, 1.75))`. `scene.fog = new THREE.FogExp2(COLORS.void, 0.0016)`; `scene.background = new THREE.Color(COLORS.void)`. Quality tiers: 2 = full; 1 = bloom res ¼ + DPR ≤ 1.25; 0 = bloom off + DPR 1. Auto-drop: if rolling 60-frame avg > 22 ms, decrement tier (once per 5 s, floor 0). Resize handler updates camera/composer.

- [ ] **Step 1: Implement `core.ts`** exactly as above; camera defaults fov 55, near 0.1, far 4000.
- [ ] **Step 2: Wire into `main.ts`** (site path) and `viewer.ts` so viewer shots include bloom. Add a temporary sanity scene in main: 20 emissive-magenta boxes on a grid, slow orbit camera via `onFrame`.
- [ ] **Step 3: Verify** — `npm run shoot -- --viewer testCube` (bloom halo visible around cube) and a manual page screenshot; read PNGs, confirm glow + vignette. `npm run build` passes.
- [ ] **Step 4: Commit** — `feat: core renderer with bloom/CA/vignette + quality tiers`

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

### Task 6: Route spline + segment map

**Files:**
- Create: `src/world/route.ts`, `tests/route.test.ts`

**Interfaces:**
- Produces:
  - `WAYPOINTS` (named, exact):
    `introStart (-300, 0, 0)`, `aboutStart (-260, 0, 0)`, `aboutEnd (200, 0, 0)`, `shibuyaCenter (240, 0, 0)`, `driftExit (240, 0, -30)`, `ramp1Base (240, 0, -90)`, `ramp1Land (240, 0, -170)`, `ramp2Base (240, 0, -260)`, `ramp2Land (240, 0, -330)`, `skywayStart (240, 0, -420)`, `skywayTop (240, 28, -520)`, `skywayEnd (240, 28, -800)`, `bridgeStart (240, 14, -860)`, `bridgeEnd (240, 12, -1400)`. Bike travels +X along About street, turns right at Shibuya onto −Z.
  - `ROUTE: THREE.CatmullRomCurve3` through the waypoints (`curveType 'centripetal'`).
  - `ROUTE_U: Record<keyof typeof WAYPOINTS, number>` — the arc-length parameter `u∈[0,1]` of each waypoint (computed once via nearest-point sampling at 4096 samples).
  - `MOON_POS = new THREE.Vector3(240, 260, -2600)`, `MOON_RADIUS = 320`.
  - `roadFrame(u: number): { pos: V3; tangent: V3; normal: V3; binormal: V3 }` (Y-up-projected Frenet-like frame; binormal = tangent × up, re-orthogonalized — used by streets, traffic lanes, bike path).

- [ ] **Step 1: Failing tests** — total route length in `[1650, 1950]` m; `ROUTE.getPointAt(ROUTE_U.shibuyaCenter)` within 8 m of `(240,0,0)`; y at `ROUTE_U.skywayEnd` within 1 m of 28; `roadFrame(u).binormal` unit-length and ⟂ tangent for 20 sampled u.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Viewer check** — register `routeDebug` (TubeGeometry along ROUTE, radius 0.5, emissive cyan + waypoint marker spheres labeled via small canvas sprites); shoot 4 angles; confirm the L-shaped route with ramp bumps and skyway climb reads correctly.
- [ ] **Step 6: Commit** — `feat: authored city route spline with named waypoints`

### Task 7: Streets, intersection, skyway, bridge

**Files:**
- Create: `src/world/streets.ts`

**Interfaces:**
- Produces: `buildStreets(rng: Rng): THREE.Group` and `STREET_WIDTH = 14` (2 lanes each way), `SIDEWALK_W = 3`. Consumes `WAYPOINTS`, `roadFrame`.

- [ ] **Step 1: Build road surfaces** — About street: box 560×0.2×14 along X at y −0.1; Projects boulevard: 14 wide along −Z from z −30 to −420; ramps: two wedge meshes (ExtrudeGeometry triangle profile, 8 m long, 2.6 m tall lip, full road width) at `ramp1Base`/`ramp2Base` plus matching down-slope landing wedges at the Land waypoints; skyway: elevated deck (10 wide, guard rails 1.1 m, support pylons every 30 m from ground) following route y; bridge: 12 wide deck, 2 suspension towers (40 m, holo-teal beacon tips), catenary cables (TubeGeometry along sagging CatmullRom), cyan edge light strips (emissive boxes) both sides full length. Road material: `MeshStandardMaterial` near-black `#0a0c14`, roughness 0.35, metalness 0.75 (wet look).
- [ ] **Step 2: Markings + crossing** — lane dashes and edge lines as a repeating `CanvasTexture` on thin overlay planes (avoid z-fight: y +0.02, `polygonOffset`). Shibuya intersection: 40×40 m plaza slab; canvas-texture decal with the diagonal + orthogonal zebra crossing pattern (white 60% alpha, worn edges via rng speckle erase); 4 corner sidewalk bulbs.
- [ ] **Step 3: Sidewalks + curbs** — 3 m sidewalks both sides of both streets (merged boxes, `#14182a`, 0.15 m curb) with expansion-line texture.
- [ ] **Step 4: Verify** — register `streets` in viewer (whole group, shot from high angles + one low angle at the ramp); check: ramps read as jumpable wedges, crossing pattern reads as Shibuya, bridge cables sag naturally. 3-iteration loop applies (e.g., add manhole discs, storm drains at curbs, worn asphalt patches via vertex-color darkening, cat-eye reflector dots down lane centers).
- [ ] **Step 5: Commit** — `feat: streets, shibuya crossing, ramps, skyway, ocean bridge`

### Task 8: Far field — Ring 2 skyline, sky, moon, ocean

**Files:**
- Create: `src/world/farField.ts`

**Interfaces:**
- Produces: `buildFarField(rng: Rng): { group: THREE.Group; updateAmbient(sec: number): void }`. Consumes `MOON_POS/MOON_RADIUS`.

- [ ] **Step 1: Skyline** — `InstancedMesh` (1 box geom, ~1100 instances): annulus r 250–1600 m around city center `(0,0,-200)`, EXCLUDING the ocean sector (a 70° wedge centered on −Z beyond z −830 stays empty). Heights: lognormal-ish `12 + rng()²·170`; footprints 14–60 m with 30% elongated (aspect up to 1:3); slight y-rotation snap to 90°±6°. Material: custom `ShaderMaterial` — body near-black; procedural window grid in fragment shader (grid from world-scaled UV; per-instance random via `instanceId` hash; ~55% windows lit amber/teal/magenta mix; brightness flickers ~2% of windows on `uTime`). 20 tallest instances get emissive rooftop beacon sprites.
- [ ] **Step 2: Sky + moon + ocean** — sky: inverted sphere r 3200, gradient shader void→`#0b0e1e` horizon band, 400 star points (Points, size-attenuated, only above 15° elevation); moon: sphere r `MOON_RADIUS` at `MOON_POS`, `MeshBasicMaterial` moonlight color + additive glow sprite ×2.2 radius + faint crater speckle texture (canvas); ocean: plane 4000×2400 at y −0.5 for z < −830, dark `#05070e`, roughness 0.08, plus a moon-glitter streak: additive plane strip from bridge toward moon with animated noise shader (`updateAmbient` scrolls it).
- [ ] **Step 3: Verify** — viewer `farField` from bridge-eye view (place camera at `(240, 6, -900)` looking at moon — add optional `?cam=` override to viewer for this) and from About street view; iterate ×3 (e.g., add aircraft warning lights blinking on tallest towers, a second dimmer skyline layer at 1800 m for depth, horizon haze band).
- [ ] **Step 4: Commit** — `feat: far-field skyline, sky, rising moon, ocean with moon glitter`

---

# Phase 2 — Asset families

**These 11 tasks are parallelizable via subagents** (independent modules, shared deps are Tasks 1–5 only). Every task follows the Global Constraints asset workflow: viewer registration + ≥3 documented detail iterations with screenshots. Detail iteration suggestions are listed per task, but the implementer must LOOK at their screenshots and choose what the asset actually lacks. All materials from `theme.ts` palette; emissive surfaces get `emissiveIntensity` 1.5–3 so bloom picks them up. All buildings: reuse a shared window strategy — emissive window planes or canvas window textures with per-window rng lit/unlit (~50–70% lit, warm/cool mix).

### Task 9: Tall buildings ×2 + special monolith

**Files:** Create `src/assets/buildings/tall.ts`, `src/assets/buildings/special.ts`

**Interfaces:** `buildTallStepped(rng: Rng, floors?: number): THREE.Group` (default 34 floors), `buildTallSlab(rng, floors?)` (default 40), `buildMonolith(rng): THREE.Group` (fixed design, ~52 floors). Each group's origin at ground center; `group.userData.roofY` set for clutter placement; `userData.footprint = [w, d]`.

- [ ] **Step 1: `buildTallStepped`** — 3 stacked boxes stepping in (e.g. 26×26 → 20×20 → 14×14 m), setbacks get railing rims; antenna crown: 8 m mast + 3 cross-braces + double blinking red beacon (emissive sphere, `updateAmbient` handled by cityLayout blink pass — here just tag `userData.beacons: Mesh[]`); vertical edge trim strips (thin emissive magenta boxes) on two faces; window texture per tier.
- [ ] **Step 2: `buildTallSlab`** — slab 40×16 m footprint; full-height vertical neon spine (1.5 m wide emissive strip, magenta) up one narrow face ending in a rooftop sign frame; horizontal holo ticker band at floor 30 (strip-format ad texture from `makeAd('strip', rng)`); mechanical penthouse + dish cluster on roof.
- [ ] **Step 3: `buildMonolith`** — tapered obsidian tower (4-segment box taper 46×46 → 30×30), material near-black metalness 0.9, sparse dim windows (20% lit, cool); glowing corporate sigla near crown: canvas-texture emissive plane (invent an angular hex-triangle "MAM" sigil, holo-teal) on two faces; base: 12 m atrium with amber light spill and 6 entry pylons; crown: 3 aviation beacons + halo ring (thin torus, emissive teal, slow ambient rotation tagged `userData.halo`).
- [ ] **Step 4: Iterate ×3** with `npm run shoot -- --viewer tallStepped` etc. Candidate details: rooftop water tanks, window AC boxes scattered on lower floors, roof-edge drainage rails, dirt streak vertex tint under sills, cell antennas on setbacks, red beacon glow sprites.
- [ ] **Step 5: Commit** — `feat(assets): tall stepped + slab towers, corporate monolith` (iteration log in body).

### Task 10: Medium buildings ×3

**Files:** Create `src/assets/buildings/medium.ts`

**Interfaces:** `buildApartment(rng): THREE.Group` (~12 floors, 22×14), `buildOfficeHolo(rng)` (~14 floors, 26×18), `buildParking(rng)` (~7 decks, 34×22 — elongated). Same `userData` contract as Task 9.

- [ ] **Step 1: Apartment** — balcony grid on street face (per-balcony: slab + railing, rng contents: laundry line w/ 2–4 cloth quads, plant, storage boxes, 30% empty); stairwell tower with red EXIT glow; roof: water tower + dish farm + clothesline; AC units under 60% of windows; ground floor: two small shopfronts with square-format ads.
- [ ] **Step 2: Office** — curtain-wall window texture (tighter grid, cooler light); wraparound holo ticker band (strip ad, additive, double-sided, slight outward offset + `userData.ticker` for UV scroll); recessed lobby with amber interior; roof: glass observatory box (transparent material, teal edge light) + vent cluster.
- [ ] **Step 3: Parking** — open decks: floor slabs + columns, low parapet per deck; 2–5 simple car silhouettes per deck (dark boxes + dim tail lights) placed by rng; helical ramp cylinder at one end; rooftop deck with lamp poles; big `P` neon sign (magenta) on tower.
- [ ] **Step 4: Iterate ×3** (candidates: pipe runs down apartment side, rooftop pigeon spikes/wires, office fire-escape, parking ticket booth + barrier arms, oil stains decal on decks).
- [ ] **Step 5: Commit** — `feat(assets): apartment, holo-ticker office, parking structure`

### Task 11: Short buildings ×4 (street-life set)

**Files:** Create `src/assets/buildings/short.ts`

**Interfaces:** `buildStorefrontRow(rng, shops?: number): THREE.Group` (default 4 shops, each 8 m frontage, 2 floors), `buildFancyRestaurant(rng)`, `buildRamenShop(rng)`, `buildBar(rng)`. Each exports `userData.seats: THREE.Object3D[]` — empty seat anchor nodes where Task 17 people get planted, and `userData.roofY`, `userData.footprint`.

- [ ] **Step 1: Storefront row** — per shop rng theme from {electronics (wall of small glowing screens), pawn shop (barred window, 質 sign), noodle stand, clothing (mannequin quads), pharmacy (green cross neon), arcade (flashing marquee)}; each: distinct awning (colored box or angled canvas), sign (square or vcard ad or custom canvas sign), interior glow plane, door, 2nd-floor windows + one balcony; shared roof: parapet + vent boxes + one rooftop billboard mount point tagged `userData.billboardAnchors`.
- [ ] **Step 2: Fancy restaurant** — 2 floors, warm amber interior, tall arched windows (canvas texture); outdoor terrace: low hedge planters, 5 round tables + 2 chairs each (seat anchors), string lights (catenary of small emissive spheres between 4 poles), host stand, glowing menu holo-board (vcard format); name sign "ORBITAL EATS" in elegant thin neon (moonlight color).
- [ ] **Step 3: Ramen shop** — single story + attic; noren curtain strips over door (3 cloth quads, slight rng sway offsets baked); counter open to street with 6 stools (seat anchors); kitchen glow + hanging lantern row (emissive amber spheres); steam vent on roof tagged `userData.steamAnchor` (fx in Task 24 attaches); big bowl-with-chopsticks neon sign (magenta+amber) perpendicular flag-mount; menu strips beside door (mono canvas textures); "PGVECTOR RAMEN" branding.
- [ ] **Step 4: Bar** — dark facade, huge "SYNTH BAR" neon marquee (magenta, flicker-tagged `userData.flicker`), porthole window with silhouettes, 4 outdoor stools + standing table (seat anchors), amber light spill plane on sidewalk, bottle-wall glow through window (rng colored dots texture), rooftop AC + beer-crate stack by side door.
- [ ] **Step 5: Iterate ×3** (candidates: sandwich boards, hanging cables between shops, trash bags at curb, vending machine (glowing, classic cyberpunk) beside ramen shop, wall pipes + junction boxes, drips/grime tint).
- [ ] **Step 6: Commit** — `feat(assets): storefront row, restaurant, ramen shop, bar with seat anchors`

### Task 12: Skinny towers + rooftop clutter kit

**Files:** Create `src/assets/buildings/skinny.ts`, `src/assets/buildings/rooftop.ts`

**Interfaces:** `buildRadioMast(rng): THREE.Group` (~50 m), `buildMonument(rng): THREE.Group` (~22 m). `decorateRoof(roof: { y: number; w: number; d: number }, rng: Rng, opts?: { billboard?: boolean }): THREE.Group` — returns a clutter group positioned in roof-local space; used by cityLayout for EVERY Ring 0/1 building (≥80% non-flat rule lives here).

- [ ] **Step 1: Radio mast** — tapering lattice (3 legs, cross-bracing via thin cylinders — merge!), 3 dish clusters at heights, guy wires to ground anchors, double red beacons + top strobe, small equipment shed at base.
- [ ] **Step 2: Monument** — stone plinth + abstract angular figure (stacked rotated boxes reading as a stylized striding figure), up-lights (4 amber cones), holographic halo ring torus (teal, additive) hovering over the head, plaque with mono canvas text.
- [ ] **Step 3: Clutter kit** — library of small builders: satellite dish (parametric size/heading), vent unit w/ spinning fan disc (`userData.fans`), pipe run, water tower, glass observatory, rooftop table+chairs, antenna whip, skylight box, parapet rail, billboard frame. `decorateRoof` packs 3–7 items by rng within footprint with margin, avoiding overlap via simple grid slots; honors `opts.billboard` by reserving the center slot.
- [ ] **Step 4: Iterate ×3** on a `roofDemo` viewer asset (3 different-size roofs decorated) + both towers.
- [ ] **Step 5: Commit** — `feat(assets): radio mast, monument, rooftop clutter kit`

### Task 13: Billboards — 5 formats × 3 mounts

**Files:** Create `src/assets/billboards/billboards.ts`

**Interfaces:** `buildBillboard(rng: Rng, o: { format: AdFormat; mount: 'stand'|'wall'|'roof'; widthM?: number; texture?: THREE.Texture }): { group: THREE.Group; setTexture(t: THREE.Texture): void; updateAmbient(sec: number): void }`. Default `widthM` per format: landscape 12, portrait 4.5 (h≈10.5), square 5, strip 24 (h 3), vcard 3.6 (h 5.4). If `texture` omitted, uses `makeAd(format, rng)`. Section-content displays reuse this by passing their own texture — this module is the single screen/frame implementation for the whole site.

- [ ] **Step 1: Screen assembly** — emissive front plane (the ad), thin dark frame box, back panel with rng greeble (ribs, junction box, cable drop), 2–4 maintenance lights on frame top (tiny amber), corner mount brackets. Glow system: additive halo plane 15% larger behind screen at 12% opacity (fakes area-light fill) + a downward gradient "light spill" plane when mount is `stand`/`roof`.
- [ ] **Step 2: Mounts** — `stand`: one or two steel posts + cross brace + base plates + service ladder; `wall`: standoff brackets (flush) OR perpendicular flag-mount arm for portrait/vcard (rng picks); `roof`: A-frame truss + catwalk + 2 spotlight arms aimed at screen (emissive cone gizmos).
- [ ] **Step 3: Flicker** — `updateAmbient`: 8% of billboards (rng at build) get neon-flicker (emissiveIntensity keyed to hash noise bursts); strip format gets slow UV scroll option (`userData.scroll = true` 50% of strips).
- [ ] **Step 4: Iterate ×3** on `billboardGallery` viewer asset (grid of all 15 format×mount combos). Candidates: rust streaks under frames, cable conduits down posts, pigeon row on top edge, one dead-pixel band on an unlucky screen.
- [ ] **Step 5: Commit** — `feat(assets): billboard system, 5 formats × 3 mounts with glow + flicker`

### Task 14: Ground cars — cheap ×2, average ×2

**Files:** Create `src/assets/vehicles/cars.ts` (luxury added Task 15 in same file)

**Interfaces:** `buildHatchback(rng)`, `buildKeiVan(rng)`, `buildSedan(rng)`, `buildCrossover(rng)` → each `{ group: THREE.Group; update(t: number): void }` (update = wheel spin driven by traffic system via `userData.speed`). Shared internal helpers `makeWheel(r)`, `makeLightBar(w, color, intensity)`. All cars: origin at ground center, +X forward, `userData.headAnchor` & `userData.tailAnchor` (Object3D) for Task 24 light pools; body via beveled box silhouettes (2–3 stacked boxes for cabin/hood), window band (dark glossy inset), bumpers, side mirrors.

- [ ] **Step 1: Cheap tier** — LOW detail on purpose: hatchback = 2-box body, plain gray/beige rng, dim yellowish round headlights (low emissive), no trim, one dent (scaled vertex nudge or offset panel box), steel wheels; kei van = tall single box + flat face, sliding-door groove line, roof rack with strapped crate, mismatched panel color, dim lights.
- [ ] **Step 2: Average tier** — MID detail: sedan = 3-box, chrome-ish trim strip, white strip headlights + red bar tail (moderate emissive), door seams (thin dark lines via texture), alloy wheels (cylinder + 5 spoke boxes); crossover = taller wagon body, roof rails, plastic cladding (darker lower band), fog lamps.
- [ ] **Step 3: Iterate ×3** per tier (candidates: license plates (canvas), wipers, exhaust pipe, interior dash glow through windshield, mud tint on kei van).
- [ ] **Step 4: Commit** — `feat(assets): cheap + average tier cars with light anchors`

### Task 15: Luxury cars ×2 + hover cars ×2

**Files:** Modify `src/assets/vehicles/cars.ts`; Create `src/assets/vehicles/hover.ts`

**Interfaces:** `buildLamboWedge(rng)`, `buildGTCoupe(rng)` (same contract as Task 14). `buildHoverA(rng)`, `buildHoverB(rng)` → `{ group; update(t) }` with `userData.bobSeed` (traffic system feeds t; update does thruster pulse + slight attitude sway — deterministic in t).

- [ ] **Step 1: Lambo wedge** — HIGH detail: low single-wedge silhouette via ExtrudeGeometry side profile (sharp nose, high tail), scissor-door seam lines, huge rear diffuser + spoiler, hex mesh intake texture, thin full-width magenta light blade front AND rear, **underglow** (additive plane under chassis, rng magenta/teal), animated neon accent line along flank (UV-scroll emissive strip), Y-spoke wheels w/ cyan rim ring (dimmer than bike's — bike owns cyan; use teal), twin exhaust glow.
- [ ] **Step 2: GT coupe** — long-hood 2-door, chrome beltline, full-width amber light bar tail, pop-up-style front lights, deep gloss paint (clearcoat-ish: metalness 0.6 roughness 0.15), wire-look wheels.
- [ ] **Step 3: Hover cars** — A: sleek teardrop cab + 4 corner thruster rings (torus + additive inner disc, teal glow) + landing skids, belly glow, nav strobes wingtips; B: boxy sky-taxi + 2 large rear ring turbines + front lift vanes, roof "TAXI 空" holo sign (vcard ad), magenta trim glow. Both: no wheels; `update(t)` bobs ±0.4 m at incommensurate frequencies seeded by `bobSeed`, thruster ring emissive pulses.
- [ ] **Step 4: Iterate ×3** (candidates: brake calipers, carbon splitter, heat-haze quad behind hover thrusters (additive noise sprite), interior HUD glow, badge glyphs).
- [ ] **Step 5: Commit** — `feat(assets): luxury cars with underglow + hover vehicles`

### Task 16: Biker + Tron bike (protagonist)

**Files:** Create `src/assets/vehicles/bike.ts`

**Interfaces:** `buildBike(rng): BikeAsset` where `interface BikeAsset { group: THREE.Group; pose(p: BikePose): void; ghostGeometry: THREE.BufferGeometry }` and `interface BikePose { lean: number; pitch: number; crouch: number; wheelSpin: number }` (lean ±35° roll for turns/weave, pitch for ramps/backflip — full rotation allowed, crouch 0–1 rider tuck for flight). `ghostGeometry` = simplified merged bike+rider (~300 tris) used by the sandevistan trail (Task 22).

- [ ] **Step 1: Bike (GTA Shotaro reference)** — TWO ENCLOSED HOOP WHEELS: torus rim (r 0.55, tube 0.09) with inner emissive cyan ring torus + spoke-less hub disc; low horizontal body spar connecting wheels (ExtrudeGeometry side profile: dagger nose, rider trough, tail cowl); cyan light channels: emissive strips tracing body edge lines + wheel arcs; front headlight slit (white-cyan, `userData.headAnchor`), red tail slit; footpegs, small windscreen, chain-side detail greeble.
- [ ] **Step 2: Rider** — black suit: capsule/box segmented body (torso, hips, upper/lower arms, thighs, calves, boots) in matte near-black (roughness 0.85) with thin cyan seam piping (emissive edges on 4 seams); helmet: sphere + cyan visor stripe wrap; riding posture articulated by `pose()`: crouch interpolates spine/elbow/knee angles from race-tuck to standing-ish; hands locked to bars, feet to pegs.
- [ ] **Step 3: `pose()` implementation** — group hierarchy: `root → chassisTilt(lean,pitch) → {bikeBody, riderRig}`; wheels counter-spin `wheelSpin`; lean also shifts rider hip 0.1 m into the turn and dips inside shoulder.
- [ ] **Step 4: Iterate ×3+** (this is the hero asset — hold it to the highest bar; candidates: brake discs glow faint, mirror stubs, suit chest sigil (tiny mono "EL"), boot buckle glints, headlight lens flare sprite, tire tread hint via bump-ish stripe texture).
- [ ] **Step 5: Verify posing** — viewer `bike` with `?t=` mapped to a pose sweep (t 0→1 = lean −35°→+35° then a full pitch flip) — shoot at t 0, .25, .5, .75, 1; confirm no limb detach/clip.
- [ ] **Step 6: Commit** — `feat(assets): tron bike + black-suit rider with pose rig and ghost geometry`

### Task 17: People + dogs

**Files:** Create `src/assets/characters/person.ts`, `src/assets/characters/dog.ts`

**Interfaces:** `buildPerson(rng, pose: 'walk'|'stand'|'sit'): { group; updateAmbient(sec) }` — stylized ~1.7 m; `buildDog(rng, pose: 'walk'|'sit'): { group; updateAmbient(sec) }`; plus `buildCrowd(rng, n: number, area: [w,d]): { group; updateAmbient(sec) }` (instanced-ish cheap crowd for Shibuya corners: merged low-detail standing/walking figures with slight per-instance sway).

- [ ] **Step 1: Person** — segmented capsule figure (no face detail; visor-band suggestion), rng outfit palette (muted street tones + 20% get one neon accent: umbrella edge, jacket stripe, holo phone glow in hand); `walk`: baked stride pose + `updateAmbient` bob/arm swing (sub-4 cm amplitudes); `sit`: hips at 0.45 m matching Task 11 seat anchors; `stand`: idle sway + 30% looking-at-phone (glow quad under face).
- [ ] **Step 2: Dog** — box body + head + legs + tail wag in `updateAmbient`; `walk` pairs beside an owner; 2 sizes.
- [ ] **Step 3: Iterate ×3** on viewer `streetCast` (a lineup: 3 walkers, 2 standers, 3 sitters on a bench prop, 2 dogs). Candidates: bags/backpacks, hood up variant, heel lift in stride, umbrella prop (it's a neon city — one glowing-rim umbrella).
- [ ] **Step 4: Commit** — `feat(assets): stylized people (walk/stand/sit), dogs, cheap crowd`

### Task 18: Street props — cranes, gas station, powerlines, signals, misc

**Files:** Create `src/assets/props/crane.ts`, `src/assets/props/gasStation.ts`, `src/assets/props/powerlines.ts`, `src/assets/props/streetProps.ts`

**Interfaces:** `buildCrane(rng, swinging?: boolean): { group; updateAmbient(sec) }`; `buildGasStation(rng): THREE.Group`; `buildPowerRun(rng, from: V3, to: V3, poles: number): THREE.Group` (sagging catenary wires between poles + service drops); `streetProps.ts` exports `buildTrafficLight(rng)`, `buildStreetLamp(rng)` (sodium-amber head + fake light cone (additive gradient cone mesh) + sidewalk pool decal), `buildSteamVent(rng)` (grate + anchor for fx), `buildVendingMachine(rng)`, `buildHydrant(rng)`, `buildTrashHeap(rng)`.

- [ ] **Step 1: Cranes** — lattice mast (merged), jib + counter-jib, counterweight blocks, operator cab (lit window), hook block on cables with dangling I-beam load; `swinging` variant pendulums the load ±4° in `updateAmbient`; red beacons at jib tips; base cross footing on a gravel pad with 2 material stacks.
- [ ] **Step 2: Gas station** — canopy on 4 columns (underside light panel — bright! classic night-photo look), 4 pump units (screen = square ad, hose + nozzle), price sign tower (mono canvas: fake credits/liter), kiosk with window glow, air pump corner, oil stain decals.
- [ ] **Step 3: Powerlines** — poles: cylinder + crossarms + insulator studs + junction box + one rng {shoe-pair silhouette, bird row, tangled cable clump}; wires: TubeGeometry catenaries (3 per span) + drop lines to buildings.
- [ ] **Step 4: Street props set** per interface (traffic light: 3-lamp head both directions + pedestrian box with walking-man glyph canvas).
- [ ] **Step 5: Iterate ×3** on viewer `propYard` (all props arranged). Candidates: crane warning stripes, station bollards, lamp flicker on one unlucky lamp, puddle decal under hydrant.
- [ ] **Step 6: Commit** — `feat(assets): cranes, gas station, powerlines, street prop kit`

### Task 19: Metro — track + hanging train

**Files:** Create `src/assets/metro/metro.ts`

**Interfaces:** `buildMetro(rng): { group: THREE.Group; update(t: number): void }`. Internally defines `METRO_PATH: CatmullRomCurve3` — a closed loop threading Ring 0/1: passes BEHIND the About street's left wall (visible over rooftops from the About camera), crosses ABOVE the Shibuya intersection diagonally at y 16, runs down the Projects boulevard's far side, distant pass near the bridge approach. `update(t)` places the train at `pathU = (t * 3.2) % 1` — tuned in Step 3 so the train is in-frame near t≈0.17 (About), t≈0.33 (drift), t≈0.86 (finale, distant).

- [ ] **Step 1: Track** — elevated box-girder following METRO_PATH at y 14–18 (TubeGeometry backbone + repeated cross-section frames via InstancedMesh along path), T-pylons every 35 m to ground, teal edge running-light strip, hazard stripes on pylon bases.
- [ ] **Step 2: Train (Edgerunners style — hangs UNDER the girder)** — bogie arms grip the girder top; 4 articulated cars suspended beneath: rounded-box cars, big lit window band (canvas texture with passenger silhouettes!), destination board (mono canvas "NIGHT LOOP ▸ KABUKI"), underside skid glow (teal), headlight; cars follow path with per-car u-offset so the consist bends through curves; gentle sway (±1.5°) as deterministic f(t).
- [ ] **Step 3: Tune passes** — temporary debug page logging train u at section boundaries; adjust the 3.2 multiplier/path so the three choreographed passes land (exact t values may shift after Task 25 exists — leave `METRO_SPEED` exported const with a TUNE comment).
- [ ] **Step 4: Iterate ×3** (candidates: girder cable trays, pylon graffiti decal, roof pantograph-analog sparks OFF (too noisy) but small strobe ON, car-gap gangway bellows).
- [ ] **Step 5: Commit** — `feat(assets): suspended metro loop with hanging train`

---

# Phase 3 — City assembly

### Task 20: City layout — populate the world

**Files:**
- Create: `src/world/cityLayout.ts`, `tests/layout.test.ts`
- Modify: `src/main.ts` (assemble world group)

**Interfaces:**
- Consumes: every builder from Tasks 7–19.
- Produces: `buildCity(seed: number): City` where
  `interface City { group: THREE.Group; update(t: number): void; updateAmbient(sec: number): void; anchors: DisplayAnchors }` and
  `interface DisplayAnchors { aboutWall: THREE.Object3D[]; projectsWall: THREE.Object3D[]; researchSky: THREE.Object3D[]; introOverhead: THREE.Object3D }` — empty positioned/oriented nodes where segment tasks (26–30) mount content displays. `update` fans out to metro/crowd/flicker children; `updateAmbient` to fans/beacons/flicker.

- [ ] **Step 1: Zoning map** — define block rectangles flanking both streets as data (array of `{ rect: [x,z,w,d]; zone: 'aboutWall'|'aboutBack'|'shibuya'|'projectsWall'|'projectsBack'|'boulevard'|'skywayFlank' }`). Rules: About street LEFT wall (−Z side, faces the About camera) = medium buildings + storefront rows with clean facades for banners; About RIGHT = mixed short/medium behind camera; Shibuya corners = office w/ mega landscape billboards + storefront rows + crowd; Projects boulevard RIGHT wall (−X… the wall the projects camera faces, +X side per route) = talls + mediums with big flat faces; monolith landmark at `(140, 0, -60)` visible down both streets; venues (restaurant, ramen, bar) clustered near About midpoint + one ramen repeat near gas station on the boulevard; gas station at `(215, 0, -240)`; cranes at `(300, 0, -140)` and `(170, 0, -520)`; radio mast + monument placed per zone map.
- [ ] **Step 2: Fill pass (seeded)** — iterate blocks: pick building builder by zone weights, respect footprints (userData), `decorateRoof` on ≥80% (billboard on ~25% of roofs), place billboards: ~120 total (wall-mounts on every blank facade > 12 m wide, stands at sidewalk corners, strip banners across street at 2 points + on 3 building faces), powerline runs down both sidewalks, street lamps every 22 m alternating sides, traffic lights at Shibuya, steam vents ×6, vending machines, hydrants, trash.
- [ ] **Step 3: Populate life** — fill ALL venue seat anchors with `buildPerson(rng,'sit')` (100% occupancy at restaurant terrace + ramen counter + bar stools per spec); ~20 walkers along sidewalks, Shibuya `buildCrowd` ×4 corners (n≈14 each), 4 dog+owner pairs, 3 phone-standers under billboards.
- [ ] **Step 4: Tests** — `layout.test.ts` (run with a stub THREE via happy-dom or plain — layout module must keep pure data functions separate from mesh creation to be testable): no two building rects overlap; every venue seat anchor consumed; billboard count ≥ 100; ≥80% of placed buildings flagged non-flat-roof.
- [ ] **Step 5: Assemble in `main.ts`** — `buildCity(1337)` + streets + farField into scene; static free camera at Shibuya for now. Shoot from 6 authored debug viewpoints (`?cam=` from Task 8): About wall, Shibuya, boulevard low angle, skyway, bridge, overhead. **Iterate ×3 at the CITY level**: compare against Cyberpunk 2077/Edgerunners street stills — typical round-1 gaps: not enough signage density, streets too wide/empty, no vertical cable clutter, lighting pools too uniform. Fix by density/placement tuning.
- [ ] **Step 6: Draw-call audit** — log `renderer.info.render.calls` at each debug viewpoint; must be < 260 (leave headroom for bike/fx). If over: merge more statics per block, convert lamp/billboard repeats to InstancedMesh.
- [ ] **Step 7: Commit** — `feat(world): zoned city layout, life population, draw-call budget pass`

### Task 21: Traffic system

**Files:**
- Create: `src/choreography/traffic.ts`

**Interfaces:**
- Consumes: vehicle builders (Tasks 14–15), `roadFrame`, waypoints.
- Produces: `buildTraffic(rng): { group; update(t: number): void }`. Lane spec data: About street 2+2 lanes, boulevard 2+2, skyway 1+1, bridge 2+2 sparse; hover lanes: 2 sky paths (y 22–34, gentle S-curves above each street) + 1 street-level hover lane on the boulevard.
- Car mix per lane spawn table: cheap 40%, average 40%, luxury 20%.

- [ ] **Step 1: Lane engine** — each lane = offset curve of the street spline (`roadFrame` binormal × laneOffset); each vehicle: `u(t) = (u0 + t * laneSpeed) % 1` — deterministic, scrub-safe; same-direction lanes move at 0.25–0.4× the bike's average progress rate (biker visibly overtakes, per spec); oncoming lanes faster relative. ~26 ground cars + 5 hovers total (instancing NOT used — each is a built group; keep count modest for draw calls; reuse: max 2 unique builds per type, cloned).
- [ ] **Step 2: Vehicle behavior** — cars: wheel spin ∝ lane speed, slight lane wobble (per-car seeded sine, ±0.15 m), headlights on; hover cars: bob via their `update`, sky lanes weave between building gaps. No collision logic (lanes are exclusive slots with spaced u0) — verify no visual overlap by spacing u0 ≥ 0.06 apart per lane.
- [ ] **Step 3: Verify** — `?cam=` shots at 3 t values (0.15, 0.45, 0.9) — cars present on all streets, no interpenetration, tail-light streams read well at distance. Iterate: add 1–2 parked cars at curbs (static, cheap tier), one pulled-over taxi hover at Shibuya.
- [ ] **Step 4: Commit** — `feat(choreography): deterministic scrub-safe traffic on ground + sky lanes`

---

# Phase 4 — FX

### Task 22: Sandevistan trail

**Files:**
- Create: `src/fx/sandevistan.ts`

**Interfaces:**
- Consumes: `BikeAsset.ghostGeometry` (Task 16).
- Produces: `buildSandevistan(ghostGeom: THREE.BufferGeometry): { group; record(worldMatrix: THREE.Matrix4, t: number): void; setMode(m: 'ride'|'finale'): void; update(t: number): void }`.

- [ ] **Step 1: Ghost buffer** — `InstancedMesh(ghostGeom, mat, 24)`; snapshots recorded every 1.6 m of bike travel (distance-keyed ring buffer, so scrubbing back replays identically — recompute buffer from bikePath when t decreases); `ride` mode shows 12 ghosts, `finale` all 24.
- [ ] **Step 2: Material** — additive, depthWrite off, per-instance color + opacity: `ride` = gradient tron-cyan → signal-magenta → violet, opacity 0.55→0.05, slight per-ghost lateral offset ±0.05 m alternating (chromatic split feel); `finale` = full HSL rainbow sweep (like the Edgerunners rainbow trail reference), opacity 0.7→0.08, ghost scale 1.0→1.06 growing tailward, brighter emissive so bloom flares.
- [ ] **Step 3: RGB-split echo** — 2 extra instanced copies of only the FIRST 3 ghosts, tinted pure R / pure B, offset ±0.08 m screen-lateral — the signature time-stutter.
- [ ] **Step 4: Verify** — needs bikePath (Task 25); if built before it, verify in viewer with a scripted figure-8 matrix feed at 5 t values. Iterate ×3 (spacing, opacity falloff, whether ghosts should hold pose from their snapshot moment — they SHOULD: store full matrix incl. lean/flip pose by snapshotting posed matrices).
- [ ] **Step 5: Commit** — `feat(fx): sandevistan afterimage trail with ride/finale modes`

### Task 23: Cursor trail (DOM overlay, site-wide)

**Files:**
- Create: `src/fx/cursorTrail.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `initCursorTrail(): { destroy(): void }` — self-contained; fixed full-viewport `<canvas id="cursor-fx">` (pointer-events none, z-index above all).

- [ ] **Step 1:** rAF loop (wall-clock — this one is NOT scrubbed): pointer positions pushed to a trail array; render as segmented dashes along recent path (8–14 segments), each segment drawn 3× with offsets: cyan (lag 0), magenta (lag 2 frames, +2 px), white core — miniature sandevistan; segments decay over 450 ms with shrinking width 3→0 px; small chevron burst on click.
- [ ] **Step 2:** Disable when `prefers-reduced-motion`, on touch devices (`pointer: coarse`), and while tab hidden. Throttle to pointer-move deltas > 2 px.
- [ ] **Step 3: Verify** — Playwright script variant: move mouse in a circle via `page.mouse.move` steps, screenshot mid-motion; trail visible with RGB split.
- [ ] **Step 4: Commit** — `feat(fx): sandevistan cursor trail overlay`

### Task 24: Drift FX + light pools + venue steam

**Files:**
- Create: `src/fx/driftFx.ts`, `src/fx/lightPools.ts`

**Interfaces:**
- Produces:
  - `buildDriftFx(): { group; update(t: number): void }` — skid marks + tire smoke for the drift window and both ramp landings. Windows hardcoded from segment budget: drift `t∈[0.30,0.345]`, landings `t∈[0.475,0.49]` and `[0.565,0.578]` (retuned in Task 28).
  - `buildLightPools(vehicles: THREE.Object3D[]): { group; update(t) }` — for every `userData.headAnchor/tailAnchor`: gradient-textured ground quad ahead/behind (head: warm-white 8×5 m trapezoid, tail: red 3×2 m), plus the bike's stronger cyan cone + 10×6 m pool.
  - `buildSteam(anchors: THREE.Object3D[]): { group; updateAmbient(sec) }` — 6-sprite columns per vent/ramen anchor, additive soft circles, rise+expand loop.
- [ ] **Step 1: Skid marks** — pre-authored: two dark rubber arcs (curved ribbon geometry hugging the drift line, computed from bikePath's drift curve offset by wheel track 0.35 m) + short straight pairs at landings; reveal by t: `material.alphaMap` UV-clipped via shader uniform `uReveal` mapped to window progress (marks appear behind the bike, persist after).
- [ ] **Step 2: Tire smoke** — deterministic particle set: 40 sprites per window, each with fixed spawn (u along drift line) + life curve; position/opacity/scale = pure f(t) (no accumulation → scrub-safe); billboarded soft-gray additive-screen blend, drift ones kick outward from rear wheel with cyan rim tint.
- [ ] **Step 3: Light pools + steam** per interface.
- [ ] **Step 4: Verify** — viewer harness with scripted t sweep through the drift window (0.30→0.35 in 6 shots): marks draw progressively, smoke plumes at rear wheel, pools track vehicles. Iterate ×3.
- [ ] **Step 5: Commit** — `feat(fx): scrub-safe drift skids+smoke, vehicle light pools, steam`

---

# Phase 5 — Choreography (SEQUENTIAL — each task depends on the previous)

### Task 25: Camera rig, bike path, master timeline, scroll pin, intro segment

**Files:**
- Create: `src/choreography/cameraRig.ts`, `src/choreography/bikePath.ts`, `src/choreography/master.ts`, `src/choreography/segments/intro.ts`, `src/ui/loader.ts`, `tests/bikePath.test.ts`
- Modify: `src/main.ts`, `index.html` (hero gets `height: 1450vh` wrapper; loader div)

**Interfaces:**
- Produces (the spine of the whole hero — later segment tasks ONLY add keyframes/content through these APIs):
  - `interface CamPose { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll: number }`
  - `class CameraRig { addKeys(keys: { t: number; pose: CamPose; ease?: (x:number)=>number }[]): void; evaluate(t: number, out: THREE.PerspectiveCamera): void }` — keys sorted by t, piecewise eased Catmull-Rom on pos/look, lerp fov/roll. Segments append their keys; overlapping t ranges are a registration error (throw).
  - `bikePath.ts`: `class BikePath { addSpeedKeys(keys: { t: number; u: number }[]): void; addAir(air: { t0: number; t1: number; u0: number; u1: number; apexY: number; flips: number }[]): void; state(t: number): BikeState }` with `interface BikeState { pos: V3; quat: THREE.Quaternion; speed: number; airborne: boolean; pose: BikePose }`. Ground state: pos from `ROUTE.getPointAt(u(t))` + lateral weave `0.9·sin(37u) + 0.5·sin(89u+1.3)` m clamped to lane, heading from tangent + weave derivative, lean ∝ lateral accel (max 35°); air state: ballistic y-arc u0→u1 with `pitch = flips·2π·easeInOutSine(progress)`, crouch ramps 0→1→0.
  - `master.ts`: `initMaster(parts: { rig: CameraRig; bike: BikePath; updatables: { update(t: number): void }[] }): { setProgress(t): void }` — creates the pinned ScrollTrigger (`trigger: '#hero', start: 'top top', end: '+=1450%', scrub: 0.8, pin: true`), one proxy object tweened 0→1, onUpdate calls rig/bike/updatables; also honors `?shot=<t>` URL param (sets progress directly, then `window.__READY = true` after 2 frames — harness hook).
- Consumes: everything from Phases 1–4.

- [ ] **Step 1: bikePath tests first** — `tests/bikePath.test.ts`: u(t) monotonic non-decreasing over 500 samples given intro+about speed keys; state(0.2).pos within About street bounds; airborne flag true only inside registered air windows; quat has no NaN through a full flip. Run — FAIL, implement, PASS.
- [ ] **Step 2: master + rig + wiring** — implement per interface; `main.ts` boot order: loader shows → build world/fx/traffic (async chunks with progress ticks) → init master → loader fades (CSS opacity, 400 ms) revealing intro pose at t=0.
- [ ] **Step 3: Loader** — `ui/loader.ts`: full-viewport void panel; mono progress readout `LINKING NIGHT CITY … 42%`; wordmark "EVAN LI" in Unbounded with RGB-split idle glitch (CSS keyframes, 2 offset text-shadows); respects reduced-motion (no glitch).
- [ ] **Step 4: Intro segment (`segments/intro.ts`)** — registers: camera keys — t0: high overhead `(120, 190, -60)` looking down street grid, fov 48 → t 0.04: swooping between two talls `(20, 40, -18)` → t 0.08: low chase 6 m behind bike, fov 60; bike speed keys t0 u=`ROUTE_U.introStart` → t 0.10 u≈`ROUTE_U.aboutStart+0.02`; in-world title: giant holo wordmark "EVAN LI" + tagline + mono `SCROLL TO RIDE ▼` on the `introOverhead` anchor (billboard module, landscape format, custom texture via `drawPanel`), fading out over t 0.03–0.05 (material opacity keyed).
- [ ] **Step 5: Verify** — `npm run shoot -- --scroll 0,0.02,0.05,0.08,0.10`; check: title legible at 0, dive has no building clips (adjust keys), chase settles level. ALSO scrub-integrity check: shoot t=0.5 then t=0.1 in the same page session vs fresh session — pixels must match (deterministic replay proof; add `--seq` flag to shoot for same-session sequential shots).
- [ ] **Step 6: Commit** — `feat(choreography): camera rig, bike path, master scroll timeline, intro dive`

### Task 26: About segment

**Files:** Create `src/choreography/segments/about.ts`; Modify `src/main.ts` (register)

**Interfaces:** Consumes `anchors.aboutWall` (Task 20), `RESUME.about`, billboard module, `drawPanel`, placeholders.

- [ ] **Step 1: Displays** — mount on aboutWall anchors: (1) mega-banner strip billboard: name + "CS + ECON @ UW — ML / EDGE INFERENCE"; (2) landscape holo: the About paragraph via `drawPanel` (check wrap at 46 chars/line, min font 28 px at 1024 wide — legibility rule for all sections); (3) portrait holo-board: face placeholder 800×1000 + name plate; (4+5) two square/vcard boards: misc placeholders 800×600. Holos: additive, slight scanline shader, gentle 0.4° ambient sway; each fades/scales in (0.9→1) staggered over t 0.11–0.15.
- [ ] **Step 2: Camera** — keys: t 0.10 chase → t 0.12: camera decelerates rightward off the route to fixed pose `pos ≈ (bikeStreet.x mid, 9, +26)` (right side of street), `look` at the LEFT wall display cluster, fov 50 → hold static through t 0.26 → t 0.28 begins re-attach drift toward chase. Biker (with weave + traffic) crosses the LOWER THIRD of frame repeatedly — bike speed keys make it pass twice during the hold (u progresses through the street while camera holds; spec: biker small, zooming by).
- [ ] **Step 3: Verify + iterate ×3** — shoot t 0.11→0.27 in 6 steps: all 5 displays fully in frame at hold pose; paragraph readable at 1600×900 (zoom-read the PNG); metro pass visible over rooftops ≈ t 0.17; bike crosses frame bottom. Iterate composition like a photographer: adjust anchor heights/spacing, camera fov/height, display scale until the frame reads as one designed poster.
- [ ] **Step 4: Commit** — `feat(sections): about street displays + stationary side camera`

### Task 27: Drift segment (Shibuya)

**Files:** Create `src/choreography/segments/drift.ts`

**Interfaces:** Consumes bikePath (adds drift-shaped speed keys + the drift lean override window), driftFx windows, crowd/mega-screens already placed (Task 20).

- [ ] **Step 1: Bike drift** — speed keys: approach fast (t 0.28–0.30), through-turn u progresses along the corner arc (route already curves); drift OVERRIDE window t 0.30–0.345: yaw over-rotation (bike heading = tangent + 28° oversteer decaying to 0), lean 33° into turn, rear-wheel lateral offset 0.4 m (slide), exit snap + small counter-lean wobble (2 damped oscillations).
- [ ] **Step 2: Camera** — keys: chase (t 0.29) → swing WIDE outside the corner, height 4 m, looking across the intersection so the mega-screens + crowd + diagonal crossing fill the background during the drift (t 0.30–0.35) → settle to low rear chase, 1.4 m height, fov 66 (speed feel) aimed up the boulevard at the ramp (t 0.36–0.38).
- [ ] **Step 3: Verify + iterate ×3** — 8 shots through t 0.28–0.38: skid arcs align under wheels (fix drift curve offset if not), smoke kicks at rear wheel, crossing pattern + crowds visible mid-drift, exit frame shows ramp 1 dead ahead low-angle. Sandevistan ghosts should fan out wide through the turn (spacing check).
- [ ] **Step 4: Commit** — `feat(sections): shibuya drift with camera swing`

### Task 28: Projects segment (ramps, backflips, displays)

**Files:** Create `src/choreography/segments/projects.ts`

**Interfaces:** Consumes `anchors.projectsWall`, `RESUME.projectsMain/projectsSmall`, bikePath `addAir`, driftFx landing windows (retune the hardcoded windows now — update `driftFx.ts` consts).

- [ ] **Step 1: Flights** — air window 1: `t0 0.42, t1 0.475, u0=ROUTE_U.ramp1Base, u1=ROUTE_U.ramp1Land, apexY 14, flips 1`; air window 2: `t0 0.53, t1 0.565, ramp2, apexY 11, flips 1`. Speed keys: hard accel into each ramp (u-rate ×1.8), slow-mo feel THROUGH the flip (u-rate ×0.55 — sandevistan moment, trail thickens since spacing is distance-based), normal on landing.
- [ ] **Step 2: Camera** — keys: low chase behind ramp 1 (t 0.38–0.42) → at launch, pan to LEFT side of street perpendicular fixed pose `(190, 10, -125)` fov 46 looking at the +X wall: full display composition + biker arcing through it (t 0.42–0.50) → brief re-chase (t 0.50–0.53) → second fixed side pose at ramp 2 `(190, 9, -295)` (t 0.53–0.60) → pull back to chase rising toward skyway (t 0.60–0.62).
- [ ] **Step 3: Displays with trajectory negative space** — compute flight-arc points in the side-camera's screen space at its fixed pose (helper: project arc samples with the pose's view-projection matrix); wall 1: TTT-E2E + RememberMe as two large landscape holos (1280×720 placeholder + `drawPanel` title/stack/blurb strips beneath) placed ABOVE and BELOW the arc band with ≥ 1.5 m clearance — the arc reads as an intentional empty ribbon between them, punctuated with 6 small mono waypoint ticks (tiny holo chevrons along the arc, opacity 0.25); wall 2: three square card billboards (Mandarin / Bellevue 2nd / DubHacks, 800×600 + one-liner) arranged under the second arc. Displays glitch-in (RGB-split 3-frame) as camera arrives.
- [ ] **Step 4: Verify + iterate ×3** — shots at t 0.42/.44/.46/.475 (flip phases mid-arc must thread the gap — adjust apexY/anchor placement until clean), 0.55/.56, plus composition stills; check flip rotation completes exactly 360° at touchdown (no landing pop), landing skids + smoke fire, slow-mo trail visibly denser mid-air.
- [ ] **Step 5: Commit** — `feat(sections): ramp backflips through project display negative space`

### Task 29: Research segment

**Files:** Create `src/choreography/segments/research.ts`

**Interfaces:** Consumes `anchors.researchSky` (place 4 anchor slots along skyway flanks at y 34–40, alternating sides, plus 2 reserve), `RESUME.research`.

- [ ] **Step 1: Displays** — 2 large sky holo-panels (landscape 1280×720 + medium description via `drawPanel`, ~70 words each: Mobile Intelligence Lab / LLM Hardware Benchmarking) on huge floating frames (thin truss + corner thrusters glow — they hover, ambient bob 0.3 m); 2 small garnish holos (mono coordinates/eyebrow "RESEARCH 01/02"). Panels face the camera's lead position (billboarded on Y only).
- [ ] **Step 2: Camera** — leading pose: 9 m AHEAD of bike, 2.5 m above, looking back and slightly down at biker (center-frame lock, per spec), fov 55; panels drift past on both sides at slow relative rate — bike speed keys: gentle constant u-rate through t 0.62–0.79 (this section must feel unhurried — verify panels are on-screen ≥ 0.05 t each). Skyway height gives the far-field skyline + metro line below — depth showcase.
- [ ] **Step 3: Verify + iterate ×3** — 8 shots across the window: biker centered every shot; each panel fully readable for ≥ 3 consecutive shots; descriptions legible (zoom-read PNG); horizon shows moon growing near t 0.79 (pre-finale tease: moon subtends ~4° here).
- [ ] **Step 4: Commit** — `feat(sections): research skyway with leading camera + floating panels`

### Task 30: Finale segment

**Files:** Create `src/choreography/segments/finale.ts`

**Interfaces:** Consumes sandevistan `setMode('finale')`, farField moon/ocean, bridge (Task 7).

- [ ] **Step 1: Choreography** — bike speed keys: continuous acceleration t 0.79→1.0 (u-rate ramps ×2.5); sandevistan → finale mode at t 0.80 (crossfade ghost colors over 0.02); camera keys: chase 8 m (t 0.79) → slow pull-back-and-rise to 18 m behind / 7 m up so the moon dominates the frame with biker silhouetted center-bottom against the moon-glitter ocean streak (t 0.84–0.96) → final 0.96–1.0: camera holds, biker shrinks toward moon; bloom strength uniform ramps 0.9→1.5; exposure 1.1→1.25.
- [ ] **Step 2: Closing type** — in-world: two thin strip holos flanking the bridge exit: `EVAN LI — PORTFOLIO 2026` and mono `KEEP SCROLLING ▼` fading in t 0.94–0.98 (they lead the eye to the DOM sections below the pin).
- [ ] **Step 3: Verify + iterate ×3** — shots t 0.80/.85/.90/.95/1.0: rainbow trail reads clearly (against dark ocean it should be the brightest element after the moon), bridge cables frame the moon, no fog swallowing the moon (tune fog density falloff toward −Z if needed: reduce `FogExp2` density to 0.0011 and compensate near-city depth with a subtle distance dim). This is the money shot — hold the bar at "would screenshot this as a wallpaper."
- [ ] **Step 4: Commit** — `feat(sections): moonlit bridge finale with rainbow sandevistan`

---

# Phase 6 — Post-hero, accessibility, polish, deploy

### Task 31: Reduced-motion path + scroll hint

**Files:** Create `src/choreography/reducedMotion.ts`; Modify `src/main.ts`, `src/choreography/master.ts`

**Interfaces:** Produces `initReducedMotion(setProgress: (t) => void): boolean` — returns true if active.

- [ ] **Step 1:** If `matchMedia('(prefers-reduced-motion: reduce)')`: no scrub tweening — as the user scrolls the 1450vh hero, progress SNAPS (no easing, instant set) to the nearest of 7 authored vignette poses (t = 0, 0.19, 0.33, 0.46, 0.56, 0.70, 0.90 — one readable still per section/moment); disable cursor trail, smoke, flicker, ambient sway; sandevistan static at 4 ghosts. Content stays fully readable at each vignette.
- [ ] **Step 2:** Scroll hint: after 4 s idle at t=0 (non-reduced only), pulse the in-world `SCROLL TO RIDE` panel opacity; remove permanently once t > 0.02.
- [ ] **Step 3: Verify** — Playwright with `page.emulateMedia({ reducedMotion: 'reduce' })`: shoot the 7 vignettes; confirm static readable frames and no trail canvas in DOM.
- [ ] **Step 4: Commit** — `feat(a11y): reduced-motion vignette mode + scroll hint`

### Task 32: Post-hero DOM sections + contact

**Files:** Create `src/ui/postHero.ts`; Modify `index.html`, `src/styles.css`, `src/main.ts`

**Interfaces:** Consumes `RESUME` (education, skills, experience, achievements, contact). Produces semantic `<section>`s inside `#post-hero`, rendered from RESUME at boot (no hardcoded copy in markup).

- [ ] **Step 1: Shell + styling** — sections: `#education`, `#skills`, `#experience`, `#contact`; background: `--void` with a fixed faint radial city-glow gradient (magenta 4% + amber 3% blobs) + 1px scanline overlay at 2% opacity; each section: mono eyebrow (`// 01 EDUCATION` style), Unbounded heading with RGB-split glitch-in on first intersection (IntersectionObserver, replays never), Rajdhani body. Max-width 1100px, generous vertical rhythm (10rem gaps), full keyboard focus styles (`:focus-visible` 2px cyan outline + offset).
- [ ] **Step 2: Education** — HUD card: UW, B.S. CS + B.S. Economics, Interdisciplinary Honors, Expected June 2027, `GPA 3.9` as a big mono readout, coursework as a wrapped mono list; corner ticks + animated border shimmer on hover.
- [ ] **Step 3: Skills** — chip grid grouped by RESUME.skills keys (Languages / ML Frameworks / Techniques / Infrastructure / AI Dev Tools); chips: shadow-blue bg, 1px teal border; hover/focus: neon pulse (box-shadow cyan) AND dims non-sibling groups to 40% (group-relation highlight per spec); tap-friendly (min 44px target).
- [ ] **Step 4: Experience & achievements** — vertical timeline (2px teal rail, glowing nodes): Mobile Intelligence Lab (Spring 2026–Present, PI Wen Cheng, microLLM/MAM line), Panera Bread (Jun–Dec 2023, Jun–Aug 2025), Ross (Jun–Sep 2023); achievements strip: 4 badge cards (Bellevue 2nd 🏆-free, use chevron glyphs; DubHacks 2025; Honors Program; Dean's List Au25/Wi26) with mono captions.
- [ ] **Step 5: Contact** — "TRANSMISSION" panel: three neon-sign links (email `mailto:evanly@uw.edu`, `linkedin.com/in/evanhly`, `github.com/evanly-gh`) as large Unbounded wordmarks with flicker-on-hover (CSS steps() animation), each with mono sublabel; footer line: `© 2026 EVAN LI — BUILT WITH THREE.JS · NIGHT CITY LOOP`.
- [ ] **Step 6: Verify** — Playwright full-page screenshots at 1600w and 390w (mobile): hierarchy, spacing, focus ring shot (`page.keyboard.press('Tab')` ×n). Iterate ×2 on composition.
- [ ] **Step 7: Commit** — `feat(ui): post-hero resume sections + contact transmission panel`

### Task 33: Mobile + quality + accessibility hardening

**Files:** Modify `src/core/core.ts`, `src/world/cityLayout.ts`, `src/ui/postHero.ts`, `index.html`

- [ ] **Step 1: Mobile hero tier** — at boot, if `pointer: coarse` or viewport < 820px: start at quality tier 1, halve Ring 2 instance count + billboard count (layout accepts a `density: 0.5..1` param), skip drift smoke particles > 20; portrait framing fix: raise all fixed side-camera poses' fov by +8 and pull back 15% (check About/Projects compositions at 390×844 via shoot with mobile viewport).
- [ ] **Step 2: A11y pass** — `<title>Evan Li — CS + Econ @ UW</title>`, meta description, `#hero` gets `aria-label="Animated portfolio intro — content repeated below"` and `role="img"`; CRITICAL: all hero content must ALSO exist accessibly — add visually-hidden (`sr-only`) DOM copies of About/Projects/Research text inside `#post-hero` top (screen readers + SEO get everything); skip-link "Skip intro" anchored to `#post-hero` as first focusable element (visible on focus, also useful for humans — it fast-scrolls past the pin).
- [ ] **Step 3: Perf audit** — `npm run build`; check gzipped JS < 1 MB (`gzip -c dist/assets/*.js | wc -c`); run shoot at 6 scroll points logging `renderer.info` (add `?stats=1` param printing calls/triangles to console, harness captures) — every point < 300 calls; Lighthouse-style sanity: `npm run preview` + check first-load has loader within 1s (code-split: dynamic-import world build after loader paints).
- [ ] **Step 4: Verify + commit** — mobile shots (About, Projects, finale, post-hero), sr-only audit via `page.accessibility.snapshot()` contains project titles. `perf(quality): mobile tier, a11y mirror content, bundle+drawcall budget`

### Task 34: Full-ride critique passes ×2

**Files:** Modify anything flagged (composition/tuning only — no new features)

- [ ] **Step 1: Pass 1** — `npm run shoot -- --scroll 0,0.05,0.1,...,1.0` (21 shots, add a `--sweep 21` convenience flag). Review EVERY frame against: (a) spec §5/§7 requirements, (b) the calibration question "does any frame look empty, flat, or template-y?", (c) legibility of any on-screen text, (d) biker visibility (never fully occluded), (e) lighting: every emissive should bloom, streets should show light pools, no pitch-black dead zones. Write the defect list into `docs/superpowers/plans/critique-pass-1.md` with frame refs.
- [ ] **Step 2: Fix pass 1 defects** — commit per logical fix group.
- [ ] **Step 3: Pass 2** — re-sweep; new defect list must be strictly shorter; fix; if any CRITICAL composition defect remains (unreadable section content, broken flip, camera clip), do pass 3. Delete `testCube` viewer asset if still present.
- [ ] **Step 4: Commit** — `polish: full-ride critique passes with frame-by-frame fixes`

### Task 35: Deploy + live verification

**Files:** Create `README.md` (replace stub)

- [ ] **Step 1: README** — how to run (`npm i && npm run dev`), how to replace placeholder images (table of every ImageSlot: path in `src/content/resume.ts`, required px dims), how to edit copy, screenshot harness usage, architecture map (3 paragraphs).
- [ ] **Step 2: Final gates** — `npm test` (all green), `npm run build` (clean), fresh `npm run preview` + full sweep one last time.
- [ ] **Step 3: Push** — `git push origin main`. Vercel auto-builds (vercel.json present; project config "Other").
- [ ] **Step 4: Live check** — fetch the production URL (https://cybersite-dyo5-three.vercel.app/) until the new deploy is live; Playwright against PROD: shoot t 0, 0.45, 1.0 + post-hero; confirm fonts load (no FOUT to serif), no console errors, no 404s in network log.
- [ ] **Step 5: Commit + report** — `docs: readme with image-slot upload guide`; report live URL + the image-upload table to the user.

---

## Plan Self-Review (completed at write time)

1. **Spec coverage:** §3 palette/type/motif → Tasks 1/5/22/23/32; §4 route/rings/metro → 6/7/8/19; §5 full asset list → 9–19 (counts match: 2+1 tall, 3 medium, 4 short, 2 skinny, 5×3 billboards, 6+2 vehicles, bike, people/dogs, props); §6 lighting → 4/13/24/34; §7 choreography table → 25–30 (segment budgets in Global Constraints); §8 content + dims → 5/26/28/29; §9 post-hero → 32; §10 architecture/perf → File Map + 20/33; §11 process → asset workflow constraint + 34; §12 exclusions respected (no external models, placeholders only).
2. **Placeholder scan:** no TBDs; the two intentionally-tunable values (`METRO_SPEED`, driftFx windows) have named owners and retune steps (19→25, 24→28).
3. **Type consistency:** `Rng`, `CamPose`, `BikePose`, `BikeState`, `ImageSlot`, `Project`, `AdFormat`, `DisplayAnchors`, `City`, asset `{group, update, updateAmbient}` contract — cross-checked across consuming tasks.
