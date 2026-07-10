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
import { registerAboutSegment } from './choreography/segments/about';

// Loader
import { createLoader } from './ui/loader';

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

  // 10. Register intro segment keys (camera + bike + in-world title)
  registerIntroSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables
  });

  // Register about segment keys (camera + bike + 5 holo displays)
  registerAboutSegment({
    rig,
    bike: bikePath,
    anchors: city.anchors,
    updatables
  });
  loader.setProgress(90);

  loader.setProgress(100);

  // 11. Detect ?shot= mode early — in shot mode we skip loader.hide() and
  // render synchronously, then the master signals __READY after 2 frames.
  const isShotMode = new URLSearchParams(window.location.search).has('shot');

  // Wire ambient updates (wall-clock) via core.onFrame
  core.onFrame((sec: number) => {
    city.updateAmbient(sec);
    farField.updateAmbient(sec);
  });

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
      render: () => core.render()
    });
  } else {
    // 12. Fade loader, start render loop
    await loader.hide();

    // Start the render loop
    core.start();

    // Init master timeline (wires ScrollTrigger)
    initMaster({
      rig,
      bike: bikePath,
      bikeAsset,
      camera: core.camera,
      scene: core.scene,
      updatables
    });
  }

  // master handle is not stored separately since it's inlined above
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

  console.log('boot ok');
}

boot();
