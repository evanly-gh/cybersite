/**
 * Task 23 — Cursor trail DOM overlay (sandevistan RGB-split afterimage)
 *
 * Implements a fixed full-viewport canvas overlay that renders a sleek
 * "sandevistan" cursor trail: a smooth tapering neon ribbon with chromatic
 * aberration (cyan/magenta RGB-split), additive compositing for neon glow,
 * and a sandevistan pulse burst on click.
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
const TRAIL_DURATION_MS  = 500;   // ms for a point to fully decay
const MAX_TRAIL_POINTS   = 80;    // ring buffer capacity
const MIN_DELTA_PX       = 3;     // throttle: ignore moves < this many px
const HEAD_WIDTH_PX      = 4.5;   // stroke width at the newest (head) end
const Z_INDEX            = 99999; // above everything
const CANVAS_ID          = 'cursor-fx';

// RGB-split config
const CYAN_OFFSET_X      = -2.5;  // px: cyan shifted slightly left/back
const CYAN_OFFSET_Y      = -1.5;
const MAGENTA_OFFSET_X   = 2.5;   // px: magenta shifted slightly right/forward
const MAGENTA_OFFSET_Y   = 1.5;
const MAGENTA_LAG        = 4;     // how many trail points behind magenta lags

// Glow: wide soft underpass drawn before the bright core
const GLOW_WIDTH_MULT    = 6;     // glow stroke width = head_width * this
const GLOW_ALPHA_MAX     = 0.18;  // max alpha for the glow pass

// Sandevistan pulse burst on click
const BURST_RINGS        = 3;     // concentric rings
const BURST_DURATION_MS  = 480;   // ms for burst to fully decay
const BURST_CHEVRON_COUNT = 6;    // chevrons per burst
const BURST_MAX_RADIUS   = 38;    // max ring expansion radius
const BURST_CHEVRON_SIZE = 10;    // half-size of chevron arm
const BURST_CHEVRON_GAP  = 8;     // initial gap from center

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
 * Catmull-Rom → quadratic bezier approximation.
 * Given four control points p0..p3, compute the bezier control point
 * that approximates the Catmull-Rom segment p1→p2.
 * Returns the quadratic midpoint control point for ctx.quadraticCurveTo.
 */
function catmullRomCP(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
): [number, number] {
  // Catmull-Rom tangent at p1 = (p2 - p0) / 2
  // Catmull-Rom tangent at p2 = (p3 - p1) / 2
  // Cubic bezier: B1 = p1 + t1/3, B2 = p2 - t2/3
  // For quadratic approximation, use single control pt = intersection of tangent lines
  // Simple approach: control pt = average of tangent-projected midpoints
  const cpx = (p1x + p2x) * 0.5 + (p2x - p0x) * 0.1667 - (p3x - p1x) * 0.1667;
  const cpy = (p1y + p2y) * 0.5 + (p2y - p0y) * 0.1667 - (p3y - p1y) * 0.1667;
  return [cpx, cpy];
}

/**
 * Draw a smooth continuous stroke through the points array using quadratic
 * bezier curves (Catmull-Rom style). All points use the same ctx style settings.
 */
function drawSmoothStroke(
  ctx: CanvasRenderingContext2D,
  pts: TrailPoint[],
  offsetX: number,
  offsetY: number,
): void {
  if (pts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x + offsetX, pts[0].y + offsetY);

  if (pts.length === 2) {
    ctx.lineTo(pts[1].x + offsetX, pts[1].y + offsetY);
    ctx.stroke();
    return;
  }

  // Use quadratic bezier through each triplet; chain them together
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    const [cpx, cpy] = catmullRomCP(
      p0.x, p0.y,
      p1.x, p1.y,
      p2.x, p2.y,
      p3.x, p3.y,
    );

    ctx.quadraticCurveTo(cpx + offsetX, cpy + offsetY, p2.x + offsetX, p2.y + offsetY);
  }

  ctx.stroke();
}

/**
 * Draw a ">" chevron pointing in `angle` direction, centered on (cx, cy).
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

  const tx = cx + cos * (gap + size);
  const ty = cy + sin * (gap + size);

  const px = -sin;
  const py = cos;

  const ax = cx + cos * gap;
  const ay = cy + sin * gap;

  ctx.beginPath();
  ctx.moveTo(ax + px * size * 0.55, ay + py * size * 0.55);
  ctx.lineTo(tx, ty);
  ctx.lineTo(ax - px * size * 0.55, ay - py * size * 0.55);
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
    if (document.hidden) {
      trail.length = 0;
    }
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);

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

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (document.hidden) return;

    // ------------------------------------------------------------------
    // Trail rendering — smooth tapering neon ribbon
    // ------------------------------------------------------------------
    const cutoff = now - TRAIL_DURATION_MS;
    const live = trail.filter(p => p.t >= cutoff);

    if (live.length >= 2) {
      // Pre-compute per-point decay values (0=oldest, 1=newest)
      // newest point is live[live.length-1]
      const n = live.length;
      const decays: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const age = now - live[i].t;
        decays[i] = Math.max(0, 1 - age / TRAIL_DURATION_MS);
      }

      // Build magenta-lagged point list (shift back by MAGENTA_LAG indices)
      const magPts: TrailPoint[] = live.map((_, i) => live[Math.max(0, i - MAGENTA_LAG)]);

      // We draw 3 passes using additive compositing so colors bloom:
      // Pass 1: soft wide glow (cyan, low alpha) — makes trail feel neon/lit
      // Pass 2: cyan channel slightly offset backward
      // Pass 3: magenta channel lagged + laterally offset
      // Pass 4: white/cyan bright core

      // --- GLOW PASS ---
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Glow: draw the full trail as one wide dim stroke
      // We approximate with segment-by-segment since lineWidth varies per-segment
      // For the glow, use a single wide uniform pass at average decay
      const avgDecay = decays.reduce((s, d) => s + d, 0) / n;
      ctx.globalAlpha = avgDecay * GLOW_ALPHA_MAX;
      ctx.strokeStyle = CSS_CYAN;
      ctx.lineWidth = HEAD_WIDTH_PX * GLOW_WIDTH_MULT * avgDecay;
      ctx.shadowBlur = 0; // skip shadowBlur (expensive), the 'lighter' pass IS the glow
      drawSmoothStroke(ctx, live, 0, 0);

      // A second, slightly narrower glow pass with magenta for RGB bloom
      ctx.globalAlpha = avgDecay * GLOW_ALPHA_MAX * 0.5;
      ctx.strokeStyle = CSS_MAGENTA;
      ctx.lineWidth = HEAD_WIDTH_PX * GLOW_WIDTH_MULT * 0.6 * avgDecay;
      drawSmoothStroke(ctx, magPts, MAGENTA_OFFSET_X, MAGENTA_OFFSET_Y);

      ctx.restore();

      // --- SEGMENT-BY-SEGMENT TAPERING PASSES ---
      // Each segment gets its own lineWidth/alpha for the taper effect.
      // We draw individual quadratic bezier segments for each.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < n - 1; i++) {
        const dA = decays[i];
        const dB = decays[i + 1];
        const d  = (dA + dB) * 0.5; // segment's decay = average of endpoints
        if (d <= 0.02) continue;

        // Width tapers from 0 at tail to HEAD_WIDTH_PX at head
        // i=0 is oldest, i=n-1 is newest; fraction = (i+1)/(n-1)
        const frac = n > 2 ? (i + 1) / (n - 1) : 1;
        const w = frac * HEAD_WIDTH_PX * d;
        if (w < 0.3) continue;

        const p0 = live[Math.max(0, i - 1)];
        const p1 = live[i];
        const p2 = live[i + 1];
        const p3 = live[Math.min(n - 1, i + 2)];

        const [cpx, cpy] = catmullRomCP(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);

        // ---- Cyan channel (offset backward along direction) ----
        ctx.globalAlpha = d * 0.82;
        ctx.strokeStyle = CSS_CYAN;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(p1.x + CYAN_OFFSET_X, p1.y + CYAN_OFFSET_Y);
        ctx.quadraticCurveTo(cpx + CYAN_OFFSET_X, cpy + CYAN_OFFSET_Y, p2.x + CYAN_OFFSET_X, p2.y + CYAN_OFFSET_Y);
        ctx.stroke();

        // ---- Magenta channel (lagged + offset forward) ----
        const mi1 = Math.max(0, i - MAGENTA_LAG);
        const mi2 = Math.max(0, i + 1 - MAGENTA_LAG);
        const mp0 = live[Math.max(0, mi1 - 1)];
        const mp1 = live[mi1];
        const mp2 = live[mi2];
        const mp3 = live[Math.min(n - 1, mi2 + 1)];
        const [mcpx, mcpy] = catmullRomCP(mp0.x, mp0.y, mp1.x, mp1.y, mp2.x, mp2.y, mp3.x, mp3.y);

        const magDecay = (decays[mi1] + decays[mi2]) * 0.5;
        const magFrac = n > 2 ? (mi1 + 1) / (n - 1) : 1;
        const magW = magFrac * HEAD_WIDTH_PX * 0.85 * magDecay;

        ctx.globalAlpha = magDecay * 0.65;
        ctx.strokeStyle = CSS_MAGENTA;
        ctx.lineWidth = Math.max(0.3, magW);
        ctx.beginPath();
        ctx.moveTo(mp1.x + MAGENTA_OFFSET_X, mp1.y + MAGENTA_OFFSET_Y);
        ctx.quadraticCurveTo(mcpx + MAGENTA_OFFSET_X, mcpy + MAGENTA_OFFSET_Y, mp2.x + MAGENTA_OFFSET_X, mp2.y + MAGENTA_OFFSET_Y);
        ctx.stroke();

        // ---- White/cyan core (bright, thin, no offset) ----
        ctx.globalAlpha = d * 0.95;
        ctx.strokeStyle = CSS_WHITE;
        ctx.lineWidth = Math.max(0.5, w * 0.45);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(cpx, cpy, p2.x, p2.y);
        ctx.stroke();
      }

      ctx.restore();
    }

    // ------------------------------------------------------------------
    // Sandevistan pulse burst on click
    // ------------------------------------------------------------------
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let bi = bursts.length - 1; bi >= 0; bi--) {
      const burst = bursts[bi];
      const age   = now - burst.t;
      if (age > BURST_DURATION_MS) {
        bursts.splice(bi, 1);
        continue;
      }

      // easeOut: fast expand then slow
      const t     = age / BURST_DURATION_MS;
      const eased = 1 - (1 - t) * (1 - t); // quadratic ease-out
      const decay = 1 - t;

      // --- Concentric pulse rings ---
      for (let ri = 0; ri < BURST_RINGS; ri++) {
        // Each ring has a phase offset so they stagger outward
        const ringPhase = ri / BURST_RINGS;
        const ringT     = Math.max(0, Math.min(1, (t - ringPhase * 0.25) / 0.75));
        if (ringT <= 0) continue;
        const ringEased = 1 - (1 - ringT) * (1 - ringT);
        const ringDecay = 1 - ringT;
        const radius = BURST_MAX_RADIUS * ringEased;

        const isCyan = ri % 2 === 0;
        ctx.strokeStyle = isCyan ? CSS_CYAN : CSS_MAGENTA;
        ctx.globalAlpha = ringDecay * (0.7 - ri * 0.15);
        ctx.lineWidth   = Math.max(0.3, 2.5 * ringDecay);

        ctx.beginPath();
        ctx.arc(burst.x, burst.y, Math.max(1, radius), 0, Math.PI * 2);
        ctx.stroke();
      }

      // --- Chevron spokes ---
      const chevGap  = BURST_CHEVRON_GAP + eased * BURST_MAX_RADIUS * 0.8;
      const chevSize = BURST_CHEVRON_SIZE * decay;

      ctx.lineWidth = Math.max(0.4, 1.8 * decay);

      for (let ci = 0; ci < BURST_CHEVRON_COUNT; ci++) {
        const angle = (ci / BURST_CHEVRON_COUNT) * Math.PI * 2;
        const isCyan = ci % 2 === 0;
        ctx.globalAlpha = decay * (isCyan ? 0.92 : 0.72);
        ctx.strokeStyle = isCyan ? CSS_CYAN : CSS_MAGENTA;
        drawChevron(ctx, burst.x, burst.y, angle, chevSize, chevGap);
      }
    }

    ctx.restore();

    // Reset composite state
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
