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

