/**
 * Task 25 — Loader overlay
 *
 * Full-viewport void-colored panel shown while the scene graph builds.
 * Features:
 *  - Mono progress readout: "LINKING NIGHT CITY … 42%"
 *  - "EVAN LI" wordmark in Unbounded with RGB-split idle glitch (CSS, 2 text-shadows)
 *  - Respects prefers-reduced-motion (no glitch animation)
 *  - Fades out over 400ms (CSS transition) when hide() is called
 *
 * The loader div (#loader) is injected into the DOM on init() and removed
 * after the fade-out transition completes (to not block pointer events).
 */

export interface Loader {
  /** Set progress 0–100 and update the readout text. */
  setProgress(pct: number): void;
  /** Fade the overlay out over 400ms, resolve when done. */
  hide(): Promise<void>;
}

export function createLoader(): Loader {
  // Create overlay element
  const overlay = document.createElement('div');
  overlay.id = 'loader';
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('role', 'status');

  // Wordmark
  const wordmark = document.createElement('div');
  wordmark.id = 'loader-wordmark';
  wordmark.textContent = 'EVAN LI';
  wordmark.setAttribute('aria-hidden', 'true');

  // Progress readout
  const readout = document.createElement('div');
  readout.id = 'loader-readout';
  readout.textContent = 'LINKING NIGHT CITY … 0%';

  overlay.appendChild(wordmark);
  overlay.appendChild(readout);

  // Insert into hero div (or body as fallback)
  const hero = document.getElementById('hero') ?? document.body;
  hero.appendChild(overlay);

  function setProgress(pct: number): void {
    const clamped = Math.round(Math.max(0, Math.min(100, pct)));
    readout.textContent = `LINKING NIGHT CITY … ${clamped}%`;
  }

  function hide(): Promise<void> {
    return new Promise((resolve) => {
      overlay.classList.add('loader-hidden');
      const onEnd = (): void => {
        overlay.removeEventListener('transitionend', onEnd);
        overlay.remove();
        resolve();
      };
      overlay.addEventListener('transitionend', onEnd);
      // Fallback in case transition doesn't fire (e.g., reduced-motion / hidden doc)
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 600);
    });
  }

  return { setProgress, hide };
}
