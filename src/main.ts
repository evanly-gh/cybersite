import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import * as THREE from 'three';
import { runViewer } from './viewer/viewer';
import { loadEntries } from './viewer/entries';
import { initCore } from './core/core';
import { initCursorTrail } from './fx/cursorTrail';
import { makeRng } from './utils/rng';

// World builders
import { buildCity } from './world/cityLayout';
import { buildStreets } from './world/streets';
import { buildFarField } from './world/farField';
import { buildTraffic } from './choreography/traffic';

// Bike
import { buildBike } from './assets/vehicles/bike';

// FX
import { buildSandevistan } from './fx/sandevistan';
import { buildLightPools } from './fx/lightPools';
import { buildDriftFx } from './fx/driftFx';

// Choreography
import { CameraRig } from './choreography/cameraRig';
import { BikePath } from './choreography/bikePath';
import { initMaster } from './choreography/master';
import { registerIntroSegment } from './choreography/segments/intro';
import { initReducedMotion } from './choreography/reducedMotion';
import { registerAboutSegment } from './choreography/segments/about';
import { registerDriftSegment } from './choreography/segments/drift';
import { registerProjectsSegment } from './choreography/segments/projects';
import { registerResearchSegment } from './choreography/segments/research';
import { registerFinaleSegment } from './choreography/segments/finale';

// Loader
import { createLoader } from './ui/loader';

// Post-hero DOM sections
import { renderPostHero } from './ui/postHero';

/**
 * Boot the real scroll-driven hero scene.
 * Replaces the temporary sanity scene (Task 4) with the full world.
 */
async function bootHero(canvas: HTMLCanvasElement): Promise<void> {
  // 1. Show loader
  const loader = createLoader();
  loader.setProgress(0);

  // 2. Init core renderer
  const core = initCore(canvas);
  loader.setProgress(5);

  // 3. Build world (city seed 1337, matching city.ts viewer entry)
  const rng = makeRng(1337);
  const city = buildCity(1337);
  const streets = buildStreets(makeRng(1337 + 1));
  const farField = buildFarField(makeRng(1337 + 2));
  loader.setProgress(30);

  // 4. Build traffic
  const traffic = buildTraffic(makeRng(1337 + 3));
  loader.setProgress(45);

  // 5. Build bike
  const bikeAsset = buildBike(makeRng(1337 + 4));
  bikeAsset.group.name = 'bike';
  bikeAsset.group.userData.isBike = true;
  loader.setProgress(55);

  // 6. Build FX
  const sandevistan = buildSandevistan(bikeAsset.ghostGeometry);
  const lightPools = buildLightPools([bikeAsset.group, traffic.group]);
  const driftFx = buildDriftFx();
  loader.setProgress(65);

  // 7. Assemble scene (same order as city.ts viewer entry: far → streets → city)
  core.scene.add(farField.group);
  core.scene.add(streets);
  core.scene.add(city.group);
  core.scene.add(traffic.group);
  core.scene.add(bikeAsset.group);
  core.scene.add(sandevistan.group);
  core.scene.add(lightPools.group);
  core.scene.add(driftFx.group);
  loader.setProgress(75);

  // 8. Add lighting (ambient + hemisphere for night city)
  const hemi = new THREE.HemisphereLight(0x1a2040, 0x07080f, 0.6);
  core.scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.4);
  key.position.set(50, 100, -50);
  core.scene.add(key);

  // 9. Build choreography components
  const rig = new CameraRig();
  const bikePath = new BikePath();

  // Updatables list (populated by segments + FX wiring)
  const updatables: { update(t: number): void }[] = [];

  // Wire sandevistan as an updatable (Pattern A: record then update, monotonic forward)
  updatables.push({
    update(t: number): void {
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

  // 10. Detect reduced-motion preference early so we can wire segments + master correctly.
  // We call initReducedMotion ONCE here just to check the flag; the full initialization
  // (with setProgress) happens after master is ready below.
  const isReducedMotion = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 10a. Register intro segment keys (camera + bike + in-world title)
  const introSegment = registerIntroSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables
  });

  // Register about segment keys (camera + bike + 5 holo displays)
  const aboutSegment = registerAboutSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables
  });

  // Register drift segment keys (Shibuya crossing, t 0.28–0.38)
  registerDriftSegment({
    rig,
    bike: bikePath
  });

  // Register projects segment (ramp backflips, t 0.38–0.62)
  const projectsSegment = registerProjectsSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables
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

  // 11. Detect ?shot= mode early — in shot mode we skip loader.hide() and
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
    // 12. Fade loader, start render loop
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

    // 13. Wire reduced-motion scroll snapping + scroll hint pulse.
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
}

function boot(): void {
  if (new URLSearchParams(location.search).has('viewer')) {
    // Viewer-asset registrations live in src/viewer/entries/*.ts (one file per asset
    // family, auto-discovered) so parallel asset tasks never edit a shared file.
    loadEntries();
    runViewer();
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
