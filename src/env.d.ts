/// <reference types="vite/client" />

declare module '@fontsource/unbounded';
declare module '@fontsource/rajdhani';
declare module '@fontsource/share-tech-mono';

interface Window {
  /** Set to true after the viewer/screenshot harness renders its first frame. */
  __READY?: boolean;
  /**
   * Test hook: current intro panel material opacity, updated each frame by pulseScrollHint.
   * Allows Playwright verification scripts to confirm the pulse is driving rendered opacity.
   * Only set while the scroll-hint pulse is active (t=0 idle, standard mode).
   */
  __introMatOpacity?: number;
}
