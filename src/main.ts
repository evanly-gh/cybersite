import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import * as THREE from 'three';
import { initCore } from './core/core';

// Loader (small, loaded eagerly — appears within ~1s)
import { createLoader } from './ui/loader';

// Post-hero DOM sections (lightweight, no Three.js dependency)
import { renderPostHero } from './ui/postHero';

/**
 * Detect mobile: pointer:coarse (touch) OR narrow viewport.
 */
function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
}

/**
 * Boot an empty scene. The city construction was scrapped; this leaves a clean
 * renderer with lighting so a fresh world can be assembled from the kept assets.
 */
async function bootHero(canvas: HTMLCanvasElement): Promise<void> {
  const isMobile = detectMobile();

  const loader = createLoader();
  loader.setProgress(0);

  const core = initCore(canvas);
  if (isMobile) core.setQuality(1);
  loader.setProgress(50);

  // Lighting (ambient + hemisphere for a night scene)
  const hemi = new THREE.HemisphereLight(0x1a2040, 0x07080f, 0.6);
  core.scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.4);
  key.position.set(50, 100, -50);
  core.scene.add(key);
  loader.setProgress(100);

  await loader.hide();
  core.start();

  // Signal test/screenshot harness that first paint is ready.
  window.__READY = true;

  // ?stats=1 — print draw-call + triangle info after first render.
  if (new URLSearchParams(window.location.search).has('stats')) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const info = core.renderer.info.render;
        console.log(`[stats] draw calls: ${info.calls}, triangles: ${info.triangles}, lines: ${info.lines}, points: ${info.points}`);
      });
    });
  }
}

function boot(): void {
  if (new URLSearchParams(location.search).has('viewer')) {
    // Viewer-asset registrations live in src/viewer/entries/*.ts (one file per asset
    // family, auto-discovered) so parallel asset tasks never edit a shared file.
    Promise.all([
      import('./viewer/entries'),
      import('./viewer/viewer')
    ]).then(([{ loadEntries }, { runViewer }]) => {
      loadEntries();
      runViewer();
    }).catch((err) => {
      console.error('viewer boot failed:', err);
      window.__READY = true;
    });
    return;
  }

  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  if (canvas) {
    bootHero(canvas).catch((err) => {
      console.error('bootHero failed:', err);
      window.__READY = true;
    });
  }

  // Post-hero DOM sections (Education, Skills, Experience, Contact)
  renderPostHero();

  console.log('boot ok');
}

boot();
