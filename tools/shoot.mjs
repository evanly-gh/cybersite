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
