import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// Task 20 helper: shoots a `?viewer=city&cam=...` screenshot AND reads the
// window.__DRAW_CALLS__ hook (viewer.ts) for the per-viewpoint draw-call audit.
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : [])).filter(Boolean)
);
const base = args.url ?? 'http://localhost:5173';
const out = args.out ?? '.superpowers/sdd/shots-final';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const url = `${base}/?viewer=${args.viewer}&cam=${args.cam}&t=${args.t ?? 0.5}&sec=${args.sec ?? 2}`;
await page.goto(url);
await page.waitForFunction('window.__READY === true', { timeout: 30000 });
const draws = await page.evaluate(() => window.__DRAW_CALLS__);
const file = `${out}/${args.viewer}-${args.tag}.png`;
await page.screenshot({ path: file });
console.log(`${args.tag}: draw calls = ${draws}  (${file})`);
await browser.close();
