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

