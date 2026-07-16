import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import * as THREE from 'three';
import { initCore } from './core/core';
import { makeRng } from './utils/rng';

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
 * Boot the grey-box scroll ride. Assembles route + road + bike + camera rig +
 * master timeline, then signals the screenshot/test harness when ready.
 */
async function bootHero(canvas: HTMLCanvasElement): Promise<void> {
  const isMobile = detectMobile();
  const isReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const loader = createLoader();
  loader.setProgress(0);

  // ── Core renderer ──────────────────────────────────────────────────────────
  const core = initCore(canvas);
  if (isMobile) core.setQuality(1);
  loader.setProgress(15);

  // ── Lighting ───────────────────────────────────────────────────────────────
  // Hemisphere: deep blue sky + near-black ground for night scene.
  const hemi = new THREE.HemisphereLight(0x1a2040, 0x07080f, 0.6);
  core.scene.add(hemi);
  // Key light: directional, positioned high + to the side for rim lighting.
  const key = new THREE.DirectionalLight(0xffffff, 0.4);
  key.position.set(50, 100, -50);
  core.scene.add(key);
  loader.setProgress(25);

  // ── Dynamic imports: world + choreography (code-split, not in initial bundle)
  const [
    { buildStreets },
    { buildBike },
    { BikePath },
    { CameraRig },
    { registerRideSegments },
    { initMaster },
    { initReducedMotion },
  ] = await Promise.all([
    import('./world/streets'),
    import('./assets/vehicles/bike'),
    import('./choreography/bikePath'),
    import('./choreography/cameraRig'),
    import('./choreography/segments/ride'),
    import('./choreography/master'),
    import('./choreography/reducedMotion'),
  ]);
  loader.setProgress(60);

  // ── Build world geometry ───────────────────────────────────────────────────
  const rngCity    = makeRng(1337);
  const rngStreets = makeRng(1338);

  const streets    = buildStreets(rngStreets);
  const bikeAsset  = buildBike(rngCity);
  bikeAsset.group.name = 'bike';
  loader.setProgress(80);

  // ── Choreography objects ───────────────────────────────────────────────────
  const rig  = new CameraRig();
  const bike = new BikePath();
  registerRideSegments(rig, bike);

  // ── Scene assembly ─────────────────────────────────────────────────────────
  core.scene.add(streets);
  core.scene.add(bikeAsset.group);

  // ── Updatables (empty for grey-box; Phase 8+ assets add to this list) ─────
  const updatables: Array<{ update(t: number): void }> = [];

  // ── Master timeline ────────────────────────────────────────────────────────
  const master = initMaster({
    rig,
    bike,
    bikeAsset,
    camera: core.camera,
    scene:  core.scene,
    updatables,
    render: core.render,
    isReducedMotion,
  });

  // In reduced-motion mode, wrap setProgress with zone-snapping behaviour.
  if (isReducedMotion) {
    const rm = initReducedMotion(master.setProgress);
    // Scroll drives onProgress; ScrollTrigger is NOT loaded in reduced-motion mode.
    if (typeof window !== 'undefined') {
      const sentinel = document.createElement('div');
      sentinel.style.height = '500vh';
      document.body.insertBefore(sentinel, document.body.firstChild);

      const onScroll = (): void => {
        const scrollY  = window.scrollY;
        const maxScroll = document.body.scrollHeight - window.innerHeight;
        rm.onProgress(maxScroll > 0 ? scrollY / maxScroll : 0);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  loader.setProgress(100);
  await loader.hide();
  core.start();

  // Signal test/screenshot harness that first paint is ready.
  // initMaster handles ?shot= mode itself (sets __READY after rAF).
  // For the standard live-scroll mode we set it here.
  const shotParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('shot')
      : null;

  if (shotParam === null) {
    window.__READY = true;
  }

  // ?stats=1 — print draw-call + triangle info after first render.
  if (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('stats')
  ) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const info = core.renderer.info.render;
        console.log(
          `[stats] draw calls: ${info.calls}, triangles: ${info.triangles}, lines: ${info.lines}, points: ${info.points}`
        );
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
