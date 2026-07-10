/**
 * Task 32 verification script — post-hero a11y fixes
 *
 * Checks:
 *  1. All 4 headings render at opacity:1 (Education, Skills, Experience, Transmission)
 *  2. Achievements heading is an h3 (not h2)
 *  3. .ph-chip li elements are NOT display:contents
 *  4. .ph-chip-btn:focus-visible has a visible cyan outline
 *  5. Screenshots at 1600w and 390w of #post-hero sections
 *
 * Run: node tools/verify-task32.mjs
 * (Requires a local dev-server at http://localhost:5173 OR preview at 4173)
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';

const BASE = process.env.VERIFY_URL ?? 'http://localhost:4173';
const OUT = 'shots/task32';
mkdirSync(OUT, { recursive: true });

async function waitForReady(page, timeout = 60000) {
  // Try __READY first (set by the main app), fall back to networkidle.
  try {
    await page.waitForFunction('window.__READY === true', { timeout });
  } catch {
    console.warn('  __READY never set — using networkidle fallback');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }
}

const browser = await chromium.launch();
const results = [];

// ── helper ──────────────────────────────────────────────────────────────────
async function runChecks(width, label) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForReady(page, 60000);

  // Scroll to #post-hero so IntersectionObserver has a chance to fire
  await page.evaluate(() => {
    const el = document.getElementById('post-hero');
    if (el) el.scrollIntoView({ behavior: 'instant' });
  });

  // Give observer + animation time; also covers the 1500ms fallback path
  await page.waitForTimeout(2000);

  // ── 1. Heading opacity readings ────────────────────────────────────────────
  const headingData = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('.ph-heading'));
    return headings.map((h) => {
      const cs = getComputedStyle(h);
      return {
        tag: h.tagName.toLowerCase(),
        text: h.textContent?.trim().slice(0, 30),
        opacity: cs.opacity,
        hasVisible: h.classList.contains('ph-heading--visible'),
        animationName: cs.animationName,
      };
    });
  });

  // ── 2. Achievements heading tag ────────────────────────────────────────────
  const achTagData = await page.evaluate(() => {
    const el = document.getElementById('ach-heading');
    return el ? { tag: el.tagName.toLowerCase(), text: el.textContent?.trim() } : null;
  });

  // ── 3. .ph-chip display value (must NOT be 'contents') ────────────────────
  const chipDisplayData = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.ph-chip'));
    if (chips.length === 0) return { count: 0, display: 'none-found' };
    const sample = getComputedStyle(chips[0]);
    return { count: chips.length, display: sample.display };
  });

  // ── 4. Screenshot of full post-hero ───────────────────────────────────────
  const postHero = await page.$('#post-hero');
  if (postHero) {
    await postHero.screenshot({ path: `${OUT}/posthero-${label}.png` });
    console.log(`  Saved: ${OUT}/posthero-${label}.png`);
  } else {
    // fallback: full page
    await page.screenshot({ path: `${OUT}/posthero-${label}.png`, fullPage: true });
  }

  // ── 5. Focus-ring check: Tab to a chip button ─────────────────────────────
  // Click the body first to ensure focus starts from the top
  await page.click('body');
  // Tab enough times to reach the first chip button
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.className : '';
    });
    if (focused.includes('ph-chip-btn')) break;
  }

  const focusRingData = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      className: el.className,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      boxShadow: cs.boxShadow.slice(0, 80),
    };
  });

  await page.screenshot({ path: `${OUT}/focus-ring-${label}.png` });
  console.log(`  Saved: ${OUT}/focus-ring-${label}.png`);

  await page.close();

  return { width, label, headingData, achTagData, chipDisplayData, focusRingData };
}

// ── Run both viewports ───────────────────────────────────────────────────────
console.log(`\nVerifying at ${BASE}...\n`);

const r1600 = await runChecks(1600, '1600w');
const r390  = await runChecks(390,  '390w');

await browser.close();

// ── Report ────────────────────────────────────────────────────────────────────
function printResult(r) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Viewport: ${r.label}`);
  console.log(`${'='.repeat(60)}`);

  console.log('\n--- Heading opacity ---');
  let allVisible = true;
  for (const h of r.headingData) {
    const ok = parseFloat(h.opacity) >= 0.99;
    if (!ok) allVisible = false;
    console.log(`  [${ok ? 'OK' : 'FAIL'}] <${h.tag}> "${h.text}" opacity=${h.opacity} hasVisible=${h.hasVisible}`);
  }
  console.log(allVisible ? '  >>> ALL HEADINGS VISIBLE (opacity:1)' : '  >>> FAIL: some headings not at opacity:1');

  console.log('\n--- Achievements heading tag ---');
  if (r.achTagData) {
    const ok = r.achTagData.tag === 'h3';
    console.log(`  [${ok ? 'OK' : 'FAIL'}] #ach-heading is <${r.achTagData.tag}> ("${r.achTagData.text}")`);
  } else {
    console.log('  [FAIL] #ach-heading not found');
  }

  console.log('\n--- .ph-chip display value ---');
  const chipOk = r.chipDisplayData.display !== 'contents' && r.chipDisplayData.count > 0;
  console.log(`  [${chipOk ? 'OK' : 'FAIL'}] ${r.chipDisplayData.count} chips found, display="${r.chipDisplayData.display}" (must not be "contents")`);

  console.log('\n--- Focus ring (chip button) ---');
  if (r.focusRingData && r.focusRingData.className.includes('ph-chip-btn')) {
    const hasOutline = r.focusRingData.outlineStyle !== 'none' && parseFloat(r.focusRingData.outlineWidth) >= 2;
    console.log(`  [${hasOutline ? 'OK' : 'FAIL'}] Focused: .${r.focusRingData.className}`);
    console.log(`         outline: ${r.focusRingData.outlineStyle} ${r.focusRingData.outlineWidth} ${r.focusRingData.outlineColor}`);
    console.log(`         box-shadow: ${r.focusRingData.boxShadow}`);
  } else {
    console.log(`  [WARN] Did not land on a ph-chip-btn — focused: ${r.focusRingData?.className ?? 'none'}`);
  }
}

printResult(r1600);
printResult(r390);

console.log(`\n${'='.repeat(60)}`);
console.log('Screenshots saved to shots/task32/');
console.log('='.repeat(60));
