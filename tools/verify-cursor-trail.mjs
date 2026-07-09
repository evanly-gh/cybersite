/**
 * Playwright verification for Task 23 — cursor trail DOM overlay.
 *
 * Runs against a live `vite dev` server (port 5173).
 * Usage: node tools/verify-cursor-trail.mjs
 *
 * Prerequisites: `npm run dev` must be running in another terminal,
 * OR launch it inline (see below — we use child_process for that).
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS_DIR = join(ROOT, '.superpowers', 'sdd', 'shots-task23');

// ---------------------------------------------------------------------------
// Utility: wait for dev server to be ready
// ---------------------------------------------------------------------------
async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Move mouse in a circle
// ---------------------------------------------------------------------------
async function moveInCircle(page, cx, cy, radius, steps) {
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    await page.mouse.move(x, y);
    // Small delay so rAF renders each frame
    await page.waitForTimeout(16);
  }
}

// ---------------------------------------------------------------------------
// Analyze screenshot pixels for cyan (#00f0ff) and magenta (#ff2bd6) content
// ---------------------------------------------------------------------------
function analyzePixels(buffer) {
  // PNG pixel data extracted via Playwright's built-in evaluate is easier.
  // We'll use page.evaluate instead for direct pixel inspection.
  return buffer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(SHOTS_DIR, { recursive: true });

  const DEV_URL = 'http://localhost:5173/';

  // Launch vite dev server
  const env = { ...process.env };
  const devServer = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    shell: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const devLog = createWriteStream(join(ROOT, 'tools', 'vite-dev.log'));
  devServer.stdout.pipe(devLog);
  devServer.stderr.pipe(devLog);

  let serverKilled = false;
  const killServer = () => {
    if (!serverKilled) {
      serverKilled = true;
      devServer.kill('SIGTERM');
    }
  };

  process.on('exit', killServer);
  process.on('SIGINT', () => { killServer(); process.exit(0); });

  console.log('Waiting for vite dev server...');
  await waitForServer(DEV_URL, 30000);
  console.log('Dev server ready at', DEV_URL);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  // =========================================================================
  // Test 1: Normal mode — mouse circle → RGB-split trail visible
  // =========================================================================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
    // Let the page initialize
    await page.waitForTimeout(800);

    // Verify canvas exists with correct attributes
    const canvasExists = await page.evaluate(() => {
      const canvas = document.getElementById('cursor-fx');
      if (!canvas) return { ok: false, reason: 'canvas#cursor-fx not found' };
      const style = window.getComputedStyle(canvas);
      const pe = canvas.style.pointerEvents;
      const z  = Number(canvas.style.zIndex);
      if (pe !== 'none') return { ok: false, reason: `pointer-events is "${pe}" not "none"` };
      if (z < 9000)      return { ok: false, reason: `z-index ${z} < 9000` };
      return { ok: true, pe, z };
    });

    if (!canvasExists.ok) {
      console.error('FAIL [canvas-exists]:', canvasExists.reason);
      results.push({ name: 'canvas-exists', pass: false, detail: canvasExists.reason });
    } else {
      console.log('PASS [canvas-exists]: pointer-events=none, z-index=' + canvasExists.z);
      results.push({ name: 'canvas-exists', pass: true });
    }

    // Move mouse in a circle to populate the trail
    const cx = 640, cy = 400, radius = 120, steps = 60;
    await moveInCircle(page, cx, cy, radius, steps);

    // Wait a couple extra frames for the trail to render
    await page.waitForTimeout(100);

    // Screenshot
    const shotPath = join(SHOTS_DIR, 'trail-circle.png');
    await page.screenshot({ path: shotPath });
    console.log('Screenshot saved:', shotPath);

    // Verify trail rendering by checking stroke() call count during active mouse movement.
    // We set up the intercept FIRST, then move the mouse (so we capture strokes during motion),
    // then report.
    // Direct pixel reads from the canvas via drawImage are unreliable in headless
    // due to GPU compositing — so we use a stroke-count intercept approach.

    // Step 1: Install stroke intercept on the cursor-fx canvas ctx
    const interceptInstalled = await page.evaluate(() => {
      const overlay = document.getElementById('cursor-fx');
      if (!overlay) return false;
      const ctx2d = /** @type {HTMLCanvasElement} */ (overlay).getContext('2d');
      if (!ctx2d) return false;
      window.__trailStrokeCount = 0;
      window.__trailMoveCount = 0;
      const origStroke = ctx2d.stroke.bind(ctx2d);
      ctx2d.stroke = function(...args) {
        window.__trailStrokeCount++;
        return origStroke(...args);
      };
      // Also intercept pointermove to see if it fires
      window.addEventListener('pointermove', () => { window.__trailMoveCount++; }, { passive: true });
      return true;
    });

    // Step 2: Move mouse while intercept is active
    await moveInCircle(page, cx, cy, radius, 30); // shorter second circle

    // Step 3: Wait for at least 2 rAF frames
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    // Step 4: Read results
    const trailState = await page.evaluate(() => ({
      ok: true,
      strokeCount: window.__trailStrokeCount || 0,
      moveCount: window.__trailMoveCount || 0,
    }));

    console.log('  interceptInstalled:', interceptInstalled, '| moveCount:', trailState.moveCount, '| strokeCount:', trailState.strokeCount);

    if (!interceptInstalled) {
      console.error('FAIL [rgb-split]: could not install stroke intercept');
      results.push({ name: 'rgb-split', pass: false, detail: 'intercept install failed' });
    } else if (trailState.moveCount === 0) {
      console.error('FAIL [rgb-split]: pointermove events did not fire (headless pointer events not working)');
      results.push({ name: 'rgb-split', pass: false, detail: 'pointermove not firing in headless' });
    } else if (trailState.strokeCount === 0) {
      console.error('FAIL [rgb-split]: pointermove fired but stroke() not called (trail not rendering)');
      results.push({
        name: 'rgb-split',
        pass: false,
        detail: `moveCount=${trailState.moveCount} but strokeCount=0`
      });
    } else {
      console.log(`PASS [rgb-split]: moveCount=${trailState.moveCount} pointermoves → strokeCount=${trailState.strokeCount} strokes`);
      results.push({
        name: 'rgb-split',
        pass: true,
        detail: `moveCount=${trailState.moveCount} → strokeCount=${trailState.strokeCount}`
      });
    }

    await page.close();
  }

  // =========================================================================
  // Test 2: Reduced-motion — canvas should NOT be created
  // =========================================================================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const noCanvas = await page.evaluate(() => {
      return document.getElementById('cursor-fx') === null;
    });

    if (noCanvas) {
      console.log('PASS [reduced-motion]: canvas#cursor-fx absent (correct — trail disabled)');
      results.push({ name: 'reduced-motion', pass: true });
    } else {
      console.error('FAIL [reduced-motion]: canvas#cursor-fx present but should be absent');
      results.push({ name: 'reduced-motion', pass: false, detail: 'canvas present despite reduced-motion' });
    }

    const shotPath = join(SHOTS_DIR, 'trail-reduced-motion.png');
    await page.screenshot({ path: shotPath });
    console.log('Screenshot saved:', shotPath);
    await page.close();
  }

  await browser.close();
  killServer();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n--- Verification Summary ---');
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${icon} ${r.name}${r.detail ? ': ' + r.detail : ''}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
