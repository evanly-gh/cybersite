/**
 * Task 23 — Cursor trail DOM overlay (sandevistan RGB-split afterimage)
 *
 * Implements a fixed full-viewport canvas overlay that renders a miniature
 * "sandevistan" cursor trail across the whole site — a segmented dashed trail
 * with RGB-split (cyan / magenta / white core), segments decaying over 450ms.
 *
 * Wall-clock / rAF driven (NOT scrubbed — explicitly correct per task brief).
 * No Math.random() — all geometry is deterministic.
 *
 * Interface: initCursorTrail(): { destroy(): void }
 */

// ---------------------------------------------------------------------------
// Palette — CSS hex strings matching theme.ts exactly
// ---------------------------------------------------------------------------
const CSS_CYAN    = '#00f0ff'; // COLORS.tronCyan
const CSS_MAGENTA = '#ff2bd6'; // COLORS.signalMagenta
const CSS_WHITE   = '#ffffff'; // white core

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TRAIL_DURATION_MS  = 450;   // ms for a point to fully decay
const MAX_TRAIL_POINTS   = 64;    // ring buffer capacity
const SEGMENT_COUNT      = 11;    // 8–14 segments to render per frame
const MIN_DELTA_PX       = 2;     // throttle: ignore moves < this many px
const MAX_SEGMENT_WIDTH  = 3;     // px at the newest end
const MAGENTA_OFFSET_PX  = 2;     // px lateral offset for magenta echo
const MAGENTA_LAG_FRAMES = 2;     // index lag for magenta echo
const Z_INDEX            = 99999; // above everything
const CANVAS_ID          = 'cursor-fx';

// Chevron burst on click
const BURST_CHEVRON_COUNT = 4;    // number of chevrons per burst
const BURST_DURATION_MS   = 320;  // ms for burst to decay
const BURST_SIZE_PX       = 14;   // half-size of chevron arm
const BURST_GAP_PX        = 6;    // initial gap from cursor center

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrailPoint {
  x: number;
  y: number;
  t: number; // wall-clock ms at time of recording
}

interface ChevronBurst {
  x: number;
  y: number;
  t: number; // wall-clock ms at time of click
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Draw a small ">" chevron shape centered at (cx, cy) pointing in the
 * direction (angle), with half-size `size` and gap `gap` from center.
 */
function drawChevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  size: number,
  gap: number
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // tip point (outward)
  const tx = cx + cos * (gap + size);
  const ty = cy + sin * (gap + size);

  // perpendicular direction for the two arms
  const px = -sin;
  const py = cos;

  // arm origin (back from tip)
  const ax = cx + cos * gap;
  const ay = cy + sin * gap;

  ctx.beginPath();
  ctx.moveTo(ax + px * size * 0.6, ay + py * size * 0.6);
  ctx.lineTo(tx, ty);
  ctx.lineTo(ax - px * size * 0.6, ay - py * size * 0.6);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// initCursorTrail
// ---------------------------------------------------------------------------

export function initCursorTrail(): { destroy(): void } {
  // ------------------------------------------------------------------
  // Accessibility / device guards
  // ------------------------------------------------------------------
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isTouch       = window.matchMedia('(pointer: coarse)');

  if (reducedMotion.matches || isTouch.matches) {
    // No canvas, no listeners — fully inert
    return { destroy() { /* nothing to clean up */ } };
  }

  // ------------------------------------------------------------------
  // Canvas setup
  // ------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.id = CANVAS_ID;

  const style = canvas.style;
  style.position       = 'fixed';
  style.top            = '0';
  style.left           = '0';
  style.width          = '100%';
  style.height         = '100%';
  style.pointerEvents  = 'none';
  style.zIndex         = String(Z_INDEX);
  style.imageRendering = 'pixelated';

  function syncSize(): void {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  syncSize();
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const trail: TrailPoint[] = [];
  const bursts: ChevronBurst[] = [];

  let lastX = -Infinity;
  let lastY = -Infinity;
  let rafId = 0;
  let running = true;

  // ------------------------------------------------------------------
  // Pointer event listeners
  // ------------------------------------------------------------------
  function onPointerMove(e: PointerEvent): void {
    if (document.hidden) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (dx * dx + dy * dy < MIN_DELTA_PX * MIN_DELTA_PX) return;

    lastX = e.clientX;
    lastY = e.clientY;

    trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (trail.length > MAX_TRAIL_POINTS) trail.shift();
  }

  function onPointerDown(e: PointerEvent): void {
    if (document.hidden) return;
    bursts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  }

  function onResize(): void {
    syncSize();
  }

  function onVisibilityChange(): void {
    // When tab hidden, clear trail so it doesn't ghost when returning
    if (document.hidden) {
      trail.length = 0;
    }
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Also disable when reduced-motion preference changes at runtime
  function onReducedMotionChange(): void {
    if (reducedMotion.matches) destroy();
  }
  reducedMotion.addEventListener('change', onReducedMotionChange);

  // ------------------------------------------------------------------
  // rAF render loop
  // ------------------------------------------------------------------
  function render(): void {
    if (!running) return;
    rafId = requestAnimationFrame(render);

    const now = performance.now();

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (document.hidden) return;

    // ------------------------------------------------------------------
    // Trail rendering
    // ------------------------------------------------------------------

    // Filter to points within TRAIL_DURATION_MS
    const cutoff = now - TRAIL_DURATION_MS;
    // Build a working list of live points (newest last)
    let live = trail.filter(p => p.t >= cutoff);

    if (live.length >= 2) {
      // Stride: how many points to skip to get approximately SEGMENT_COUNT segments
      const totalPts = live.length;
      const segCount  = Math.min(SEGMENT_COUNT, totalPts - 1);

      // Sample indices: evenly spaced across live array, newest at end
      const sampledIndices: number[] = [];
      for (let s = 0; s <= segCount; s++) {
        // s=0 → oldest visible, s=segCount → newest
        const idx = Math.round((s / segCount) * (totalPts - 1));
        sampledIndices.push(Math.min(idx, totalPts - 1));
      }

      // Deduplicate adjacent identical indices
      const unique: number[] = [sampledIndices[0]];
      for (let i = 1; i < sampledIndices.length; i++) {
        if (sampledIndices[i] !== unique[unique.length - 1]) {
          unique.push(sampledIndices[i]);
        }
      }

      // Draw segments: for each consecutive pair (older → newer)
      // Each segment is drawn 3× for RGB-split:
      //   1. Cyan (no offset, no lag)
      //   2. Magenta (lag 2 indices back, +MAGENTA_OFFSET_PX perpendicular)
      //   3. White core (no offset, no lag, thin)
      const numSegs = unique.length - 1;
      for (let si = 0; si < numSegs; si++) {
        const iA = unique[si];
        const iB = unique[si + 1];

        const pA = live[iA];
        const pB = live[iB];

        // Segment age: age of the midpoint (older = more decayed)
        const midT   = (pA.t + pB.t) * 0.5;
        const age    = now - midT;                          // 0..TRAIL_DURATION_MS
        const decay  = 1 - age / TRAIL_DURATION_MS;        // 1=newest, 0=oldest
        if (decay <= 0) continue;

        // Width decays from MAX_SEGMENT_WIDTH → 0
        const width = decay * MAX_SEGMENT_WIDTH;

        // Alpha also decays
        const alpha = decay;

        // Segment position fraction for magenta lag (index lag in unique array)
        const lagAIdx = Math.max(0, iA - MAGENTA_LAG_FRAMES);
        const lagBIdx = Math.max(0, iB - MAGENTA_LAG_FRAMES);
        const pALag   = live[lagAIdx];
        const pBLag   = live[lagBIdx];

        // Perpendicular offset direction (for magenta lateral shift)
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const perpX = len > 0.5 ? (-dy / len) * MAGENTA_OFFSET_PX : 0;
        const perpY = len > 0.5 ? ( dx / len) * MAGENTA_OFFSET_PX : 0;

        ctx.lineCap  = 'round';

        // ---- 1. Cyan (no offset) ----
        ctx.globalAlpha   = alpha * 0.85;
        ctx.strokeStyle   = CSS_CYAN;
        ctx.lineWidth     = width;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();

        // ---- 2. Magenta (lag + lateral offset) ----
        ctx.globalAlpha   = alpha * 0.65;
        ctx.strokeStyle   = CSS_MAGENTA;
        ctx.lineWidth     = width * 0.8;
        ctx.beginPath();
        ctx.moveTo(pALag.x + perpX, pALag.y + perpY);
        ctx.lineTo(pBLag.x + perpX, pBLag.y + perpY);
        ctx.stroke();

        // ---- 3. White core (no offset, thinner) ----
        ctx.globalAlpha   = alpha * 0.9;
        ctx.strokeStyle   = CSS_WHITE;
        ctx.lineWidth     = width * 0.4;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      }
    }

    // ------------------------------------------------------------------
    // Chevron burst rendering
    // ------------------------------------------------------------------
    ctx.lineCap = 'round';

    for (let bi = bursts.length - 1; bi >= 0; bi--) {
      const burst = bursts[bi];
      const age   = now - burst.t;
      if (age > BURST_DURATION_MS) {
        bursts.splice(bi, 1);
        continue;
      }

      const decay = 1 - age / BURST_DURATION_MS;
      const gap   = BURST_GAP_PX + (1 - decay) * BURST_SIZE_PX * 1.5; // expands outward
      const size  = BURST_SIZE_PX * decay;

      ctx.lineWidth   = Math.max(0.5, 1.5 * decay);

      // Draw BURST_CHEVRON_COUNT chevrons at evenly spaced angles (deterministic)
      for (let ci = 0; ci < BURST_CHEVRON_COUNT; ci++) {
        const angle = (ci / BURST_CHEVRON_COUNT) * Math.PI * 2;

        // Alternate cyan and magenta
        if (ci % 2 === 0) {
          ctx.globalAlpha = decay * 0.9;
          ctx.strokeStyle = CSS_CYAN;
        } else {
          ctx.globalAlpha = decay * 0.7;
          ctx.strokeStyle = CSS_MAGENTA;
        }

        drawChevron(ctx, burst.x, burst.y, angle, size, gap);
      }
    }

    // Reset composite state
    ctx.globalAlpha = 1;
  }

  rafId = requestAnimationFrame(render);

  // ------------------------------------------------------------------
  // destroy
  // ------------------------------------------------------------------
  function destroy(): void {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.removeEventListener('change', onReducedMotionChange);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { destroy };
}
