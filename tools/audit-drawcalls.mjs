/**
 * Draw-call audit for the assembled city at each debug viewpoint.
 *
 * Usage: node tools/audit-drawcalls.mjs [--url http://localhost:PORT]
 * Requires the dev server running. Reads window.__DRAW_CALLS__ (set by the viewer
 * after render) at each of the 6 authored city debug cameras and reports whether the
 * 5 route/street viewpoints stay under the 260 hard budget (overhead is a debug-only
 * aerial that sees the whole city — reported but not gated).
 */
import { chromium } from 'playwright';

const base = (() => {
  const i = process.argv.indexOf('--url');
  return i >= 0 ? process.argv[i + 1] : 'http://localhost:5173';
})();

// world-space --cam presets, kept in sync with src/viewer/entries/city.ts
const CAMS = {
  aboutWall: '-70,6,25,-70,10,-11',
  shibuya: '200,10,32,255,10,-8',
  boulevard: '240,2.5,-60,240,4,-300',
  skyway: '240,20,-500,240,28,-650',
  bridge: '240,6,-900,240,260,-2600',
  overhead: '240,150,-40,240,0,-120',
};
const STREET = ['aboutWall', 'shibuya', 'boulevard', 'skyway', 'bridge'];
const BUDGET = 260;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let over = 0;
for (const [name, cam] of Object.entries(CAMS)) {
  await page.goto(`${base}/?viewer=city&cam=${cam}`, { waitUntil: 'commit', timeout: 0 });
  await page.waitForFunction('window.__READY === true', { timeout: 120000 });
  const calls = Number(await page.evaluate('window.__DRAW_CALLS__'));
  const gated = STREET.includes(name);
  const flag = calls >= BUDGET ? (gated ? '  ** OVER BUDGET **' : '  (overhead, ungated)') : '';
  if (gated && calls >= BUDGET) over++;
  console.log(`${name.padEnd(11)} ${String(calls).padStart(4)}${flag}`);
}
await browser.close();
console.log(over === 0 ? 'PASS: all street viewpoints < 260' : `FAIL: ${over} street viewpoint(s) over budget`);
process.exit(over === 0 ? 0 : 1);
