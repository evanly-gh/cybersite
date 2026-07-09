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

