/**
 * Task 25 — Master scroll timeline
 *
 * Creates ONE pinned ScrollTrigger tied to #hero with the hero's 1450vh scroll
 * length. A GSAP proxy object is tweened 0→1 scrubbed by scroll; its onUpdate
 * drives camera, bike, and all registered updatables.
 *
 * ## ?shot=<t> mode
 * When `?shot=<t>` is in the URL, bypasses ScrollTrigger and calls setProgress(t)
 * directly, then sets `window.__READY = true` after 2 rAF frames (harness hook).
 *
 * ## Camera roll
 * CameraRig.evaluate() handles position + lookAt + roll internally.
 * master.ts just calls rig.evaluate(t, camera) every update.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { CameraRig } from './cameraRig';
import type { BikePath } from './bikePath';
import type { BikeAsset } from '../assets/vehicles/bike';

gsap.registerPlugin(ScrollTrigger);

// Extend Window for the harness hook
declare global {
  interface Window {
    __READY?: boolean;
  }
}

export interface MasterParts {
  rig: CameraRig;
  bike: BikePath;
  bikeAsset: BikeAsset;
  camera: import('three').PerspectiveCamera;
  scene: import('three').Scene;
  updatables: { update(t: number): void }[];
  /** Called by master after setProgress to render one frame (used by ?shot= mode). */
  render?(): void;
  /**
   * When true, skip the GSAP ScrollTrigger setup — the scroll-driven progress
   * is instead handled by the reducedMotion module's own scroll listener.
   */
  isReducedMotion?: boolean;
  /**
   * Optional callback invoked each time setProgress is called with the clamped t value.
   * Used by reducedMotion.ts to gate the scroll-hint removal in standard mode.
   */
  onProgressNotify?: (t: number) => void;
}

export interface MasterHandle {
  setProgress(t: number): void;
}

export function initMaster(parts: MasterParts): MasterHandle {
  const { rig, bike, bikeAsset, camera, scene, updatables, render, isReducedMotion, onProgressNotify } = parts;

  function setProgress(t: number): void {
    const tClamped = Math.max(0, Math.min(1, t));

    // 1. Evaluate camera rig → sets camera position/rotation/fov
    rig.evaluate(tClamped, camera);

    // 2. Evaluate bike path → get state
    const bikeState = bike.state(tClamped);

    // 3. Position and orient the bike group from BikeState
    bikeAsset.group.position.copy(bikeState.pos);
    bikeAsset.group.quaternion.copy(bikeState.quat);

    // 4. Apply bike pose (lean, pitch, crouch, wheelSpin)
    bikeAsset.pose(bikeState.pose);

    // 5. Update world matrices so sandevistan/lightPools can read correct transforms
    scene.updateMatrixWorld(false);

    // 6. Drive all updatables (sandevistan record+update, lightPools, driftFx, traffic, city, etc.)
    for (const u of updatables) {
      u.update(tClamped);
    }

    // 7. Notify progress listener (used by reducedMotion.ts to gate scroll-hint removal)
    if (onProgressNotify) {
      onProgressNotify(tClamped);
    }
  }

  // ---------------------------------------------------------------------------
  // ?shot= mode: bypass ScrollTrigger, set progress directly
  // ---------------------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const shotParam = params.get('shot');

  if (shotParam !== null) {
    const shotT = parseFloat(shotParam);
    if (!isNaN(shotT)) {
      // Set progress immediately
      setProgress(shotT);
      // Render one frame, then signal harness after 2 rAF frames
      let frames = 0;
      function waitFrames(): void {
        frames++;
        if (render) render();
        if (frames >= 2) {
          window.__READY = true;
        } else {
          requestAnimationFrame(waitFrames);
        }
      }
      requestAnimationFrame(waitFrames);
    }
    return { setProgress };
  }

  // ---------------------------------------------------------------------------
  // ScrollTrigger mode: pin #hero, scrub 0→1 over 1450vh
  // ---------------------------------------------------------------------------

  // In reduced-motion mode the reducedMotion module owns the scroll listener
  // and calls setProgress directly with snapped vignette values.
  // We still set up the pin so the scroll space exists, but suppress the scrub.
  if (isReducedMotion) {
    // Pin without scrub — the hero element stays fixed in the viewport while
    // the user scrolls, but progress is driven externally by the snapping listener.
    ScrollTrigger.create({
      trigger: '#hero',
      start: 'top top',
      end: '+=1450%',
      pin: true
    });
  } else {
    const proxy = { t: 0 };
    gsap.to(proxy, {
      t: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: '+=1450%',
        scrub: 0.8,
        pin: true,
        onUpdate: (self) => {
          setProgress(self.progress);
        }
      }
    });
  }

  // Apply t=0 immediately so the scene initializes correctly before first scroll
  setProgress(0);

  return { setProgress };
}
