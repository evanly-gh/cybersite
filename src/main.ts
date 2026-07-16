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
 * Boot the fully-dressed scroll ride. Assembles all world geometry, FX, and
 * choreography, then signals the screenshot/test harness when ready.
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
  loader.setProgress(10);

  // ── Lighting ───────────────────────────────────────────────────────────────
  // Hemisphere: deep blue sky + near-black ground for night scene.
  const hemi = new THREE.HemisphereLight(0x1a2040, 0x07080f, 0.6);
  core.scene.add(hemi);
  // Key light: directional, positioned high + to the side for rim lighting.
  const key = new THREE.DirectionalLight(0xffffff, 0.4);
  key.position.set(50, 100, -50);
  core.scene.add(key);
  loader.setProgress(15);

  // ── NeoCity library (GLTF preload) ────────────────────────────────────────
  // Dynamic import so the loader/DRACO parser is code-split from the initial bundle.
  const { loadNeoCity } = await import('./assets/buildings/neocity');
  loader.setProgress(20);

  // loadNeoCity swallows fetch errors internally (returns makeLibrary({}) on failure).
  const neoLib = await loadNeoCity('/models/neocity/');
  loader.setProgress(40);

  // ── Dynamic imports: world + choreography (code-split, not in initial bundle)
  const [
    { buildStreets, buildShibuya, buildScaffolding },
    { buildFarField, buildMoon },
    { buildCity },
    { buildDisplays },
    { buildTraffic },
    { buildBike },
    { BikePath },
    { CameraRig },
    { registerRideSegments },
    { initMaster },
    { initReducedMotion },
    { buildSandevistan },
    { buildLightPools },
    { buildDriftFx },
  ] = await Promise.all([
    import('./world/streets'),
    import('./world/farField'),
    import('./world/cityLayout'),
    import('./world/displays'),
    import('./choreography/traffic'),
    import('./assets/vehicles/bike'),
    import('./choreography/bikePath'),
    import('./choreography/cameraRig'),
    import('./choreography/segments/ride'),
    import('./choreography/master'),
    import('./choreography/reducedMotion'),
    import('./fx/sandevistan'),
    import('./fx/lightPools'),
    import('./fx/driftFx'),
  ]);
  loader.setProgress(60);

  // ── Far-field density (mobile quality tier) ────────────────────────────────
  const density = isMobile ? 0.5 : 1;

  // ── Build world geometry ───────────────────────────────────────────────────
  const city      = buildCity(neoLib, 1337);
  const streets   = buildStreets(makeRng(1338));
  const shibuya   = buildShibuya(makeRng(1339));
  const scaffold  = buildScaffolding(makeRng(1340));
  const farField  = buildFarField(makeRng(1341), density);
  const moon      = buildMoon(makeRng(1342));
  const displays  = buildDisplays(city.anchors);
  const traffic   = buildTraffic(makeRng(1343));
  const bikeAsset = buildBike(makeRng(1337));
  bikeAsset.group.name = 'bike';
  loader.setProgress(70);

  // ── FX ─────────────────────────────────────────────────────────────────────
  const sandevistan = buildSandevistan(bikeAsset.ghostGeometry);
  const lightPools  = buildLightPools([bikeAsset.group, traffic.group]);
  const driftFx     = buildDriftFx(isMobile ? 20 : 40);
  loader.setProgress(75);

  // ── Choreography objects ───────────────────────────────────────────────────
  const rig  = new CameraRig();
  const bike = new BikePath();
  registerRideSegments(rig, bike, city.anchors);
  loader.setProgress(80);

  // ── Scene assembly (far → near → fx) ──────────────────────────────────────
  // Layer order: far-field silhouettes → moon → ground world → city → life → fx
  core.scene.add(farField.group);
  core.scene.add(moon);
  core.scene.add(streets);
  core.scene.add(shibuya);
  core.scene.add(scaffold);
  core.scene.add(city.group);
  core.scene.add(displays.group);
  core.scene.add(traffic.group);
  core.scene.add(bikeAsset.group);
  core.scene.add(sandevistan.group);
  core.scene.add(lightPools.group);
  core.scene.add(driftFx.group);

  // ── Updatables (ordered — bike positioned first by master's setProgress) ──
  // Order matters: traffic + city before FX so FX sees correct world positions.
  const updatables: Array<{ update(t: number): void }> = [];

  // 1. Traffic (cars + hover + metro positioned for this t)
  updatables.push(traffic);

  // 2. City (metro window flicker, etc. — stub for now)
  updatables.push(city);

  // 3. Sandevistan — record bike matrix then update trail
  // Seed the trail on first frames when snapshotCount is low by replaying
  // bikePath.state 0→t in ~80 steps (mirrors the pattern described in task brief).
  // Guard: seed only once — scrubbing back to t=0 drops snapshotCount but we
  // must not re-seed with all-zero tSeed values (80 identical zero records).
  let sandevistanSeeded = false;
  updatables.push({
    update(t: number): void {
      // Record current bike world matrix
      sandevistan.record(bikeAsset.group.matrixWorld, t);

      // Seed trail once when starting fresh (snapshotCount low)
      if (!sandevistanSeeded && sandevistan.snapshotCount < 8) {
        sandevistanSeeded = true;
        const steps = 80;
        for (let i = 0; i < steps; i++) {
          const tSeed = (i / steps) * t;
          const st = bike.state(tSeed);
          bikeAsset.group.position.copy(st.pos);
          bikeAsset.group.quaternion.copy(st.quat);
          bikeAsset.group.updateMatrixWorld(true);
          sandevistan.record(bikeAsset.group.matrixWorld, tSeed);
        }
        // Restore current bike position
        const stCurrent = bike.state(t);
        bikeAsset.group.position.copy(stCurrent.pos);
        bikeAsset.group.quaternion.copy(stCurrent.quat);
        bikeAsset.group.updateMatrixWorld(true);
      }

      sandevistan.update(t);
    }
  });

  // 4. LightPools — AFTER bike+traffic positioned (per ordering contract)
  updatables.push(lightPools);

  // 5. DriftFx
  updatables.push(driftFx);

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

  // ── Ambient updates (wall-clock, skip if reduced-motion) ──────────────────
  if (!isReducedMotion) {
    core.onFrame((sec: number) => {
      city.updateAmbient(sec);
      farField.updateAmbient(sec);
      displays.updateAmbient(sec);
    });
  }

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
