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

