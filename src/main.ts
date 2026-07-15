import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import * as THREE from 'three';
import { initCore } from './core/core';
import { initCursorTrail } from './fx/cursorTrail';

// Loader (small, loaded eagerly — appears within ~1s)
import { createLoader } from './ui/loader';

// Post-hero DOM sections (lightweight, no Three.js dependency)
import { renderPostHero } from './ui/postHero';

/**
 * Detect mobile: pointer:coarse (touch) OR narrow viewport.
 * Used at boot to downgrade quality tier and density.
 */
function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
}

/**
 * Boot the real scroll-driven hero scene.
 * World build is deferred via dynamic import so the loader paints within ~1s.
 */
async function bootHero(canvas: HTMLCanvasElement): Promise<void> {
  // 1. Detect mobile early
  const isMobile = detectMobile();

  // 2. Show loader (small, eager import — paints fast)
  const loader = createLoader();
  loader.setProgress(0);

  // 3. Init core renderer
  const core = initCore(canvas);

  // 4. On mobile: start at quality tier 1 (lower DPR, smaller bloom)
  if (isMobile) {
    core.setQuality(1);
  }
  loader.setProgress(5);

  // 5. Dynamic import the heavy world-building code AFTER loader has painted.
  //    This is the main lever for first-paint latency and bundle chunk splitting.
  //    Vite will code-split everything reachable only from these dynamic imports.
  const [
    { makeRng },
    { buildCity },
    { buildStreets },
    { buildFarField },
    { buildTraffic },
    { buildBike },
    { buildSandevistan },
    { buildLightPools },
    { buildDriftFx },
    { CameraRig },
    { BikePath },
    { initMaster },
    { registerIntroSegment },
    { initReducedMotion },
    { registerAboutSegment },
    { registerDriftSegment },
    { registerProjectsSegment },
    { registerResearchSegment },
    { registerFinaleSegment },
    { loadGltfModels }
  ] = await Promise.all([
    import('./utils/rng'),
    import('./world/cityLayout'),
    import('./world/streets'),
    import('./world/farField'),
    import('./choreography/traffic'),
    import('./assets/vehicles/bike'),
    import('./fx/sandevistan'),
    import('./fx/lightPools'),
    import('./fx/driftFx'),
    import('./choreography/cameraRig'),
    import('./choreography/bikePath'),
    import('./choreography/master'),
    import('./choreography/segments/intro'),
    import('./choreography/reducedMotion'),
    import('./choreography/segments/about'),
    import('./choreography/segments/drift'),
    import('./choreography/segments/projects'),
    import('./choreography/segments/research'),
    import('./choreography/segments/finale'),
    import('./assets/buildings/gltfBuildings')
  ]);

  // 6. Preload GLTF model library — resolves gracefully with {available:false} entries
  //    when .glb files are absent (they are not present yet). buildCity uses the library
  //    as visual templates; layout positions remain seed-deterministic regardless.
  const gltf = await loadGltfModels('/models/');
  loader.setProgress(20);

  // 7. Build world (city seed 1337, matching city.ts viewer entry)
  // On mobile: density=0.5 halves Ring 2 far-field instance count + billboard repeats.
  const density = isMobile ? 0.5 : 1;
  const rng = makeRng(1337);
  const city = buildCity(1337, { density, gltf });
  const streets = buildStreets(makeRng(1337 + 1));
  const farField = buildFarField(makeRng(1337 + 2), density);
  loader.setProgress(30);

  // 8. Build traffic
  const traffic = buildTraffic(makeRng(1337 + 3));
  loader.setProgress(45);

  // 9. Build bike
  const bikeAsset = buildBike(makeRng(1337 + 4));
  bikeAsset.group.name = 'bike';
  bikeAsset.group.userData.isBike = true;
  loader.setProgress(55);

  // 10. Build FX
  // On mobile: cap smoke particles at 20 per window (default 40)
  const maxSmoke = isMobile ? 20 : 40;
  const sandevistan = buildSandevistan(bikeAsset.ghostGeometry);
  const lightPools = buildLightPools([bikeAsset.group, traffic.group]);
  const driftFx = buildDriftFx(maxSmoke);
  loader.setProgress(65);

  // 11. Assemble scene (same order as city.ts viewer entry: far → streets → city)
  core.scene.add(farField.group);
  core.scene.add(streets);
  core.scene.add(city.group);
  core.scene.add(traffic.group);
  core.scene.add(bikeAsset.group);
  core.scene.add(sandevistan.group);
  core.scene.add(lightPools.group);
  core.scene.add(driftFx.group);
  loader.setProgress(75);

  // 12. Add lighting (ambient + hemisphere for night city)
  const hemi = new THREE.HemisphereLight(0x1a2040, 0x07080f, 0.6);
  core.scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.4);
  key.position.set(50, 100, -50);
  core.scene.add(key);

  // 13. Build choreography components
  const rig = new CameraRig();
  const bikePath = new BikePath();

  // Updatables list (populated by segments + FX wiring)
  const updatables: { update(t: number): void }[] = [];

  // Reusable scratch objects for trail seeding (no per-call allocation)
  const _seedMat = new THREE.Matrix4();
  const _seedScale = new THREE.Vector3(1, 1, 1);

  // Wire sandevistan as an updatable (Pattern A: record then update, monotonic forward)
  updatables.push({
    update(t: number): void {
      // Seed trail when under-populated (e.g. in ?shot= mode where setProgress is called
      // only once, producing only a single snapshot). We replay bikePath.state() from 0→t
      // in 80 steps so the ghost chain fills both ride (12 slots) and finale (24 slots).
      if (t > 0.01 && sandevistan.snapshotCount < 12) {
        for (let si = 0; si <= 80; si++) {
          const tStep = (si / 80) * t;
          const st = bikePath.state(tStep);
          _seedMat.compose(st.pos, st.quat, _seedScale);
          sandevistan.record(_seedMat, tStep);
        }
      }
      // Record current bike world matrix (must be called AFTER bike positioning in master)
      sandevistan.record(bikeAsset.group.matrixWorld, t);
      sandevistan.update(t);
    }
  });

  // Wire light pools (depends on bike matrix being current — master ensures updateMatrixWorld before updatables)
  updatables.push(lightPools);

  // Wire drift FX
  updatables.push(driftFx);

  // Wire traffic
  updatables.push(traffic);

  // Wire city t-driven updatables (metro, etc.)
  updatables.push(city);

  loader.setProgress(85);

  // 14. Detect reduced-motion preference early so we can wire segments + master correctly.
  // We call initReducedMotion ONCE here just to check the flag; the full initialization
  // (with setProgress) happens after master is ready below.
  const isReducedMotion = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 15a. Register intro segment keys (camera + bike + in-world title)
  const introSegment = registerIntroSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables
  });

  // Register about segment keys (camera + bike + 5 holo displays)
  // Pass mobile flag so fixed-side poses get fov+8 and 15% pull-back for portrait framing.
  const aboutSegment = registerAboutSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables,
    mobile: isMobile
  });

  // Register drift segment keys (Shibuya crossing, t 0.28–0.38)
  registerDriftSegment({
    rig,
    bike: bikePath
  });

  // Register projects segment (ramp backflips, t 0.38–0.62)
  // Pass mobile flag so fixed-side poses get fov+8 and 15% pull-back for portrait framing.
  const projectsSegment = registerProjectsSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables,
    mobile: isMobile
  });

  // Register research segment (skyway lead-camera, t 0.62–0.79)
  const researchSegment = registerResearchSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables
  });

  // Register finale segment (moonlit bridge run, t 0.79–1.0)
  const finaleSegment = registerFinaleSegment({
    rig,
    bike: bikePath,
    sandevistan,
    core,
    updatables
  });
  loader.setProgress(90);

  loader.setProgress(100);

  // 16. Detect ?shot= mode early — in shot mode we skip loader.hide() and
  // render synchronously, then the master signals __READY after 2 frames.
  const isShotMode = new URLSearchParams(window.location.search).has('shot');

  // Wire ambient updates (wall-clock) via core.onFrame.
  // Fix 3: about segment's billboard flicker/scroll/sway also driven here so
  // they animate every frame, including during the static scroll hold (t=0.12–0.26).
  // In reduced-motion mode, skip ambient sway/flicker/smoke — only static geometry.
  if (!isReducedMotion) {
    core.onFrame((sec: number) => {
      city.updateAmbient(sec);
      farField.updateAmbient(sec);
      aboutSegment.updateAmbient(sec);
      projectsSegment.updateAmbient(sec);
      researchSegment.updateAmbient(sec);
      finaleSegment.updateAmbient(sec);
    });
  }

  if (isShotMode) {
    // In shot mode: hide loader instantly (no animation), start render loop,
    // then init master which handles setProgress + __READY signaling.
    await loader.hide();
    core.start();
    initMaster({
      rig,
      bike: bikePath,
      bikeAsset,
      camera: core.camera,
      scene: core.scene,
      updatables,
      render: () => core.render(),
      isReducedMotion
    });
  } else {
    // 16. Fade loader, start render loop
    await loader.hide();

    // Start the render loop
    core.start();

    // Init master timeline (wires ScrollTrigger in standard mode, pin-only in RM mode).
    // onProgressNotify lets master call back on every setProgress so we can gate the
    // scroll-hint removal in standard mode (we wire it after initReducedMotion below).
    let rmOnProgress: ((t: number) => void) | undefined;

    const masterHandle = initMaster({
      rig,
      bike: bikePath,
      bikeAsset,
      camera: core.camera,
      scene: core.scene,
      updatables,
      isReducedMotion,
      onProgressNotify: isReducedMotion ? undefined : (t: number) => {
        if (rmOnProgress) rmOnProgress(t);
      }
    });

    // 18. Wire reduced-motion scroll snapping + scroll hint pulse.
    // initReducedMotion receives masterHandle.setProgress so that:
    //  - In RM mode: the scroll listener calls setProgress with snapped vignette values.
    //  - In standard mode: the 4-second idle timer starts; pulseScrollHint modulates
    //    the intro panel opacity while the user hasn't scrolled.
    const rmHandle = initReducedMotion(
      masterHandle.setProgress,
      isReducedMotion ? undefined : (opacity: number) => introSegment.pulseScrollHint(opacity)
    );

    // Wire rmHandle.onProgress into the master's onProgressNotify callback chain.
    rmOnProgress = rmHandle.onProgress;
  }

  // 19. ?stats=1 — print draw-call + triangle info to console after first render.
  if (new URLSearchParams(window.location.search).has('stats')) {
    // After 2 rAFs (past the loader hide), renderer.info will reflect the live scene.
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
    // Dynamic import keeps them out of the main bundle.
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
      // Signal harness even on error so shoot doesn't hang
      window.__READY = true;
    });
  }

  // Task 23: site-wide cursor trail (sandevistan RGB-split). Self-disables on
  // touch (pointer:coarse) and prefers-reduced-motion — no config needed here.
  initCursorTrail();

  // Task 32: render post-hero DOM sections (Education, Skills, Experience, Contact)
  renderPostHero();

  console.log('boot ok');
}

boot();
