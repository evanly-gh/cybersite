import { ZONES } from '../world/route';

// ──────────────────────────────────────────────────────────────────────────────
// Zone boundaries — sorted unique t-values at the start/end of every zone.
// ──────────────────────────────────────────────────────────────────────────────

const ZONE_BOUNDARIES: number[] = (() => {
  const set = new Set<number>();
  for (const [a, b] of Object.values(ZONES)) {
    set.add(a);
    set.add(b);
  }
  return [...set].sort((a, b) => a - b);
})();

/**
 * Snap a scroll progress t ∈ [0,1] to the nearest zone boundary.
 */
function snapToNearest(t: number): number {
  let best = ZONE_BOUNDARIES[0];
  let bestDist = Math.abs(t - best);
  for (const b of ZONE_BOUNDARIES) {
    const d = Math.abs(t - b);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

// ──────────────────────────────────────────────────────────────────────────────
// initReducedMotion
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Initialise reduced-motion mode.
 *
 * In reduced-motion mode the user still scrolls, but progress is snapped to
 * the nearest zone boundary so no continuous animation plays between zones.
 *
 * @param setProgress - The master setProgress function to call with snapped t.
 * @param pulseHint  - Optional opacity pulse (0→1 blink) for a skip-hint UI.
 * @returns { onProgress } — call this with the raw scroll progress each frame.
 */
export function initReducedMotion(
  setProgress: (t: number) => void,
  pulseHint?: (opacity: number) => void
): { onProgress: (t: number) => void } {
  let lastSnapped = -1;

  function onProgress(t: number): void {
    const snapped = snapToNearest(t);
    if (snapped !== lastSnapped) {
      lastSnapped = snapped;
      setProgress(snapped);
      // Brief opacity flash to signal a zone change to the user.
      pulseHint?.(1);
      requestAnimationFrame(() => pulseHint?.(0));
    }
  }

  return { onProgress };
}
