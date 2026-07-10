/**
 * Task 31 — Reduced-motion path + scroll hint
 *
 * Two responsibilities:
 *
 * 1. REDUCED-MOTION mode (prefers-reduced-motion: reduce):
 *    - Snaps scroll progress to the nearest of 7 authored vignette t values
 *      (one readable still per section/moment).
 *    - No easing — instant setProgress call on scroll.
 *    - Returns `{ isReducedMotion: true, onProgress: noop, destroy }`.
 *
 * 2. STANDARD mode (no reduced-motion preference):
 *    - Starts a 4-second idle timer at t=0.
 *    - After 4s, pulses the intro panel opacity via `pulseScrollHint`.
 *    - Permanently removes the pulse once onProgress is called with t > 0.02.
 *    - Returns `{ isReducedMotion: false, onProgress, destroy }`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 7 authored vignette t-values — one readable still per section/moment */
const VIGNETTE_TS: readonly number[] = [0, 0.19, 0.33, 0.46, 0.56, 0.70, 0.90] as const;

/** Total hero scroll height in viewport-heights (must match master.ts ScrollTrigger end) */
const HERO_SCROLL_VH = 1450;

/** Idle time (ms) before the scroll hint pulse begins */
const SCROLL_HINT_IDLE_MS = 4000;

/** t threshold above which the scroll hint is permanently removed */
const SCROLL_HINT_REMOVE_T = 0.02;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Finds the vignette t-value nearest to rawT.
 * Linear scan over a 7-element array — acceptable cost.
 */
function snapToNearest(rawT: number): number {
  let best = VIGNETTE_TS[0];
  let bestDist = Math.abs(rawT - best);
  for (let i = 1; i < VIGNETTE_TS.length; i++) {
    const d = Math.abs(rawT - VIGNETTE_TS[i]);
    if (d < bestDist) {
      bestDist = d;
      best = VIGNETTE_TS[i];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReducedMotionHandle {
  /** Whether prefers-reduced-motion is active. */
  isReducedMotion: boolean;
  /**
   * Notify the module of the current timeline progress t.
   * In reduced-motion mode this is a no-op (progress is driven by the scroll listener).
   * In standard mode it gates the scroll-hint removal.
   */
  onProgress(t: number): void;
  /** Clean up all listeners, timers, and rAF loops. */
  destroy(): void;
}

/**
 * Initialize reduced-motion handling.
 *
 * @param setProgress - The master timeline's setProgress function.
 * @param pulseScrollHint - Optional fn called each rAF frame while hint pulse is active;
 *                          the callee controls the visual opacity change.
 * @returns A ReducedMotionHandle with `isReducedMotion` flag.
 */
export function initReducedMotion(
  setProgress: (t: number) => void,
  pulseScrollHint?: (opacity: number) => void
): ReducedMotionHandle {
  // Guard: not in a browser environment
  if (typeof window === 'undefined') {
    return {
      isReducedMotion: false,
      onProgress: () => { /* noop */ },
      destroy: () => { /* noop */ }
    };
  }

  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (reducedMotionMQ.matches) {
    // ------------------------------------------------------------------
    // REDUCED-MOTION MODE: snap scroll to nearest vignette t
    // ------------------------------------------------------------------

    function onScroll(): void {
      const scrollY = window.scrollY;
      const totalScrollPx = (HERO_SCROLL_VH / 100) * window.innerHeight;
      // rawT: fraction of total hero scroll space consumed
      const rawT = totalScrollPx > 0 ? Math.max(0, Math.min(1, scrollY / totalScrollPx)) : 0;
      const snapped = snapToNearest(rawT);
      setProgress(snapped);
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    // Apply immediately at current scroll position
    onScroll();

    function destroy(): void {
      window.removeEventListener('scroll', onScroll);
    }

    return {
      isReducedMotion: true,
      onProgress: () => { /* noop — progress is driven by scroll */ },
      destroy
    };
  }

  // ------------------------------------------------------------------
  // STANDARD MODE: 4-second idle scroll hint
  // ------------------------------------------------------------------

  let hintTimerId: ReturnType<typeof setTimeout> | null = null;
  let hintActive = false;
  let hintPermanentlyRemoved = false;
  let rafId: number | null = null;
  let pulseStart = 0;

  const PULSE_PERIOD_MS = 1200; // ms per pulse cycle (0→1→0 sine)

  function stopPulse(): void {
    hintActive = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function pulseFrame(now: number): void {
    if (!hintActive) return;
    if (pulseScrollHint) {
      const elapsed = now - pulseStart;
      const phase = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS; // 0..1
      // Sine curve gives a smooth 0.4→1.0→0.4 pulse
      const opacity = 0.4 + 0.6 * Math.abs(Math.sin(phase * Math.PI));
      pulseScrollHint(opacity);
    }
    rafId = requestAnimationFrame(pulseFrame);
  }

  // Start the idle timer
  hintTimerId = setTimeout(() => {
    if (hintPermanentlyRemoved) return;
    hintActive = true;
    pulseStart = performance.now();
    rafId = requestAnimationFrame(pulseFrame);
  }, SCROLL_HINT_IDLE_MS);

  function onProgress(t: number): void {
    if (hintPermanentlyRemoved) return;
    if (t > SCROLL_HINT_REMOVE_T) {
      hintPermanentlyRemoved = true;
      if (hintTimerId !== null) {
        clearTimeout(hintTimerId);
        hintTimerId = null;
      }
      stopPulse();
    }
  }

  function destroy(): void {
    if (hintTimerId !== null) {
      clearTimeout(hintTimerId);
      hintTimerId = null;
    }
    stopPulse();
  }

  return {
    isReducedMotion: false,
    onProgress,
    destroy
  };
}
