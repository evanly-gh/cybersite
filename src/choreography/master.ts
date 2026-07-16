import * as THREE from 'three';
import type { CameraRig } from './cameraRig';
import type { BikePath } from './bikePath';
import type { BikeAsset } from '../assets/vehicles/bike';

// ──────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────────────────────────────────────

export interface Updatable {
  update(t: number): void;
}

export interface MasterOpts {
  rig: CameraRig;
  bike: BikePath;
  bikeAsset: BikeAsset;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  updatables: Updatable[];
  render?: () => void;
  isReducedMotion: boolean;
  onProgressNotify?: (t: number) => void;
}

export interface MasterHandle {
  setProgress(t: number): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// initMaster
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Wire up the master timeline that maps scroll progress t ∈ [0,1] to world state.
 *
 * In browser mode (non-reduced-motion), ScrollTrigger is dynamically imported
 * so this function is safe to call in plain Node (vitest) with zero GSAP present.
 *
 * In ?shot=<t> mode or reduced-motion mode, no ScrollTrigger is wired; the
 * caller drives setProgress directly.
 */
export function initMaster(o: MasterOpts): MasterHandle {
  const { rig, bike, bikeAsset, camera, updatables, render, onProgressNotify, isReducedMotion } = o;

  function setProgress(t: number): void {
    // 1. Bike position / orientation / pose
    const st = bike.state(t);
    bikeAsset.group.position.copy(st.pos);
    bikeAsset.group.quaternion.copy(st.quat);
    bikeAsset.pose(st.pose);

    // 2. Flush matrixWorld so FX consumers see current transforms
    bikeAsset.group.updateMatrixWorld(true);

    // 3. Camera rig
    rig.apply(camera, t);

    // 4. Updatables
    for (const u of updatables) {
      u.update(t);
    }

    // 5. Notify + render
    onProgressNotify?.(t);
    render?.();
  }

  const handle: MasterHandle = { setProgress };

  // ── Browser-only wiring ────────────────────────────────────────────────────
  // Guard with typeof window so vitest (Node) never reaches this branch.
  if (typeof window !== 'undefined' && !isReducedMotion) {
    const shotParam = new URLSearchParams(window.location.search).get('shot');

    if (shotParam !== null) {
      // ?shot=<t> mode: render one frame at the given progress, signal ready.
      const t = Number(shotParam);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setProgress(t);
          (window as unknown as Record<string, unknown>)['__READY'] = true;
        });
      });
    } else {
      // Standard scroll mode: dynamically import GSAP + ScrollTrigger.
      void (async () => {
        const [{ gsap }, { ScrollTrigger }] = await Promise.all([
          import('gsap'),
          import('gsap/ScrollTrigger'),
        ]);
        gsap.registerPlugin(ScrollTrigger);

        // Build a tall scroll container and pin the canvas.
        const scrollEl = document.createElement('div');
        scrollEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;';
        document.body.appendChild(scrollEl);

        const sentinel = document.createElement('div');
        // Height drives total scroll distance: 500vh gives comfortable scrub range.
        sentinel.style.height = '500vh';
        document.body.insertBefore(sentinel, document.body.firstChild);

        const canvas = document.querySelector('canvas');

        ScrollTrigger.create({
          trigger: sentinel,
          start: 'top top',
          end: 'bottom bottom',
          pin: canvas ?? undefined,
          scrub: true,
          onUpdate: (self) => setProgress(self.progress),
        });
      })();
    }
  }

  return handle;
}
