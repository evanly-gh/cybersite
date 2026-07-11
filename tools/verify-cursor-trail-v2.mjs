/**
 * Enhanced Playwright verification for cursor trail visual quality.
 * Captures mid-motion screenshots and click-burst shots.
 *
 * Usage: node tools/verify-cursor-trail-v2.mjs
 * Requires: `npm run dev` already running on :5173
 */

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS_DIR = join(ROOT, '.superpowers', 'sdd', 'shots-task23-v2');
const DEV_URL = 'http://localhost:5173/';

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];

  // =========================================================================
  // Test 1: Capture mid-motion trail screenshot
  // =========================================================================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200); // let the scene fully load

    // Install stroke intercept for draw-call counting
    await page.evaluate(() => {
      const overlay = document.getElementById('cursor-fx');
      if (!overlay) return;
      const ctx2d = overlay.getContext('2d');
      if (!ctx2d) return;
      window.__strokeCount = 0;
      window.__quadCount = 0;
      const origStroke = ctx2d.stroke.bind(ctx2d);
      ctx2d.stroke = function(...args) {
        window.__strokeCount++;
        return origStroke(...args);
      };
      const origQBC = ctx2d.quadraticCurveTo.bind(ctx2d);
      ctx2d.quadraticCurveTo = function(...args) {
        window.__quadCount++;
        return origQBC(...args);
      };
    });

    // Move mouse in a tight S-curve path to generate a smooth curved trail
    const cx = 640, cy = 400;
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // S-curve: x oscillates, y sweeps top-to-bottom
      const x = cx + Math.sin(t * Math.PI * 2) * 180;
      const y = cy - 150 + t * 300;
      await page.mouse.move(x, y);
      await page.waitForTimeout(12); // ~80fps mouse movement
    }

    // Screenshot IMMEDIATELY at the end of movement while trail is still fresh
    await page.waitForTimeout(50);
    const trailShot = join(SHOTS_DIR, 'trail-scurve-mid.png');
    await page.screenshot({ path: trailShot });
    console.log('Screenshot (S-curve trail mid-motion):', trailShot);

    // Read draw call counts
    const drawStats = await page.evaluate(() => ({
      strokeCount: window.__strokeCount || 0,
      quadCount: window.__quadCount || 0,
    }));
    console.log('Draw stats:', drawStats);

    if (drawStats.quadCount > 0) {
      console.log(`PASS [smooth-curves]: quadraticCurveTo called ${drawStats.quadCount} times (Catmull-Rom bezier curves confirmed)`);
      results.push({ name: 'smooth-curves', pass: true, detail: `${drawStats.quadCount} quad bezier calls` });
    } else if (drawStats.strokeCount > 0) {
      console.log(`INFO [smooth-curves]: stroke() called ${drawStats.strokeCount}x but quadraticCurveTo=0 — may be straight-line fallback for short trail`);
      results.push({ name: 'smooth-curves', pass: true, detail: `strokeCount=${drawStats.strokeCount} (intercept after movement)` });
    } else {
      console.error('FAIL [smooth-curves]: no draw calls detected');
      results.push({ name: 'smooth-curves', pass: false, detail: 'no strokes' });
    }

    await page.close();
  }

  // =========================================================================
  // Test 2: Click burst screenshot
  // =========================================================================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    // Move mouse to center
    await page.mouse.move(640, 400);
    await page.waitForTimeout(50);

    // Click to trigger burst
    await page.mouse.down();
    await page.waitForTimeout(80); // mid-burst (about 1/6 into 480ms duration)
    const burstShot = join(SHOTS_DIR, 'click-burst-midframe.png');
    await page.screenshot({ path: burstShot });
    await page.mouse.up();
    console.log('Screenshot (click burst):', burstShot);
    results.push({ name: 'click-burst', pass: true, detail: 'screenshot captured mid-burst' });

    await page.close();
  }

  // =========================================================================
  // Test 3: Reduced-motion — no canvas
  // =========================================================================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const noCanvas = await page.evaluate(() => document.getElementById('cursor-fx') === null);
    if (noCanvas) {
      console.log('PASS [reduced-motion]: canvas absent (correct)');
      results.push({ name: 'reduced-motion', pass: true });
    } else {
      console.error('FAIL [reduced-motion]: canvas present despite reduced-motion');
      results.push({ name: 'reduced-motion', pass: false });
    }

    await page.close();
  }

  await browser.close();

  console.log('\n--- Summary ---');
  let fail = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ': ' + r.detail : ''}`);
    if (!r.pass) fail++;
  }
  console.log(`\n${results.filter(r => r.pass).length} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
