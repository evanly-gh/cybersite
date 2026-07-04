/// <reference types="vite/client" />

declare module '@fontsource/unbounded';
declare module '@fontsource/rajdhani';
declare module '@fontsource/share-tech-mono';

interface Window {
  /** Set to true after the viewer/screenshot harness renders its first frame. */
  __READY?: boolean;
}
