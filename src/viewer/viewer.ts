import * as THREE from 'three';
import { COLORS } from '../theme';
import { getAsset, listAssets, type AssetEntry } from './registry';
import { makeRng } from '../utils/rng';
import { initCore } from '../core/core';

function hexColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function showMessage(text: string): void {
  const msg = document.createElement('div');
  msg.style.cssText =
    'position:fixed;top:0;left:0;padding:8px 12px;color:#fff;font-family:monospace;font-size:14px;' +
    `background:${hexColor(COLORS.void)};z-index:10`;
  msg.textContent = text;
  document.body.appendChild(msg);
}

/** Parsed `?cam=x,y,z,tx,ty,tz` override: absolute camera position + lookAt target. */
interface CamOverride {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

function parseCamOverride(raw: string | null): CamOverride | null {
  if (!raw) return null;
  const nums = raw.split(',').map(Number);
  if (nums.length !== 6 || nums.some((n) => !Number.isFinite(n))) {
    showMessage(`viewer: invalid ?cam="${raw}", expected 6 comma-separated numbers (x,y,z,tx,ty,tz)`);
    return null;
  }
  return {
    pos: new THREE.Vector3(nums[0], nums[1], nums[2]),
    target: new THREE.Vector3(nums[3], nums[4], nums[5])
  };
}

/**
 * Reads `?viewer=<name>&angle=<0-3>&t=<0..1>` from location.search, builds a minimal
 * preview scene for the requested registered asset, frames the camera at one of four
 * orbit angles (45° azimuth steps, 20° elevation), and exposes `window.__READY = true`
 * once the first frame has been rendered. Uses core/core.ts for a consistent
 * bloom/tonemap/vignette look; the viewer renders a single static frame via
 * `core.render()` rather than starting core's animation loop.
 *
 * `?cam=x,y,z,tx,ty,tz` overrides the auto-framing entirely with an absolute camera
 * position + lookAt target (world-space, no origin-centering). This exists for assets
 * authored at true world scale (e.g. farField's ~3000m sky dome) where the default
 * "center the bounding box over the origin, auto-distance the camera" logic produces a
 * useless frame — there is no single small bounding box to frame a turntable shot of.
 */
export function runViewer(): void {
  const params = new URLSearchParams(location.search);
  const name = params.get('viewer');
  const angleIndex = Number(params.get('angle') ?? '0');
  const t = Number(params.get('t') ?? '0.5');
  // Fixed ambient time (seconds) so screenshots stay deterministic — not wall-clock.
  const sec = Number(params.get('sec') ?? '2');
  const camOverride = parseCamOverride(params.get('cam'));

  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';

  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const core = initCore(canvas);
  const { scene, camera } = core;

  const grid = new THREE.GridHelper(40, 40, COLORS.holoTeal, COLORS.shadowBlue);
  scene.add(grid);

  const hemi = new THREE.HemisphereLight(0xffffff, COLORS.shadowBlue, 1.0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(5, 8, 5);
  scene.add(key);

  camera.position.set(0, 3, 8);
  camera.lookAt(0, 0, 0);

  if (!name) {
    showMessage('viewer: missing ?viewer=<name>');
  } else {
    const make = getAsset(name);
    if (!make) {
      showMessage(`viewer: unknown asset "${name}". registered: ${listAssets().join(', ') || '(none)'}`);
    } else {
      // On throw, show the diagnostic and fall through to render + __READY so the
      // harness screenshots the error instead of hanging 30s per angle.
      try {
        const rng = makeRng(1);
        const entry: AssetEntry = make(rng);
        const object = entry instanceof THREE.Object3D ? entry : entry.group;
        const update = entry instanceof THREE.Object3D ? undefined : entry.update;
        const updateAmbient = entry instanceof THREE.Object3D ? undefined : entry.updateAmbient;

        scene.add(object);

        if (camOverride) {
          // World-scale asset: keep its authored absolute coordinates untouched and
          // point the camera exactly where the caller asked, skipping the
          // center-on-origin + auto-distance framing below entirely.
          if (update) update(t);
          if (updateAmbient) updateAmbient(sec);
          camera.position.copy(camOverride.pos);
          camera.lookAt(camOverride.target);
        } else {
          // Center the asset over the origin and rest it on the ground grid.
          const initialBox = new THREE.Box3().setFromObject(object);
          const center = initialBox.getCenter(new THREE.Vector3());
          object.position.x -= center.x;
          object.position.z -= center.z;
          object.position.y -= initialBox.min.y;

          if (update) update(t);
          if (updateAmbient) updateAmbient(sec);

          const framedBox = new THREE.Box3().setFromObject(object);
          const sphere = framedBox.getBoundingSphere(new THREE.Sphere());
          const radius = Math.max(sphere.radius, 0.5);
          const fovRad = THREE.MathUtils.degToRad(camera.fov);
          const distance = (radius / Math.sin(fovRad / 2)) * 1.6;

          const azimuth = THREE.MathUtils.degToRad(angleIndex * 45);
          const elevation = THREE.MathUtils.degToRad(20);
          const focus = sphere.center;
          camera.position.set(
            focus.x + distance * Math.cos(elevation) * Math.sin(azimuth),
            focus.y + distance * Math.sin(elevation),
            focus.z + distance * Math.cos(elevation) * Math.cos(azimuth)
          );
          camera.lookAt(focus);
        }
      } catch (err) {
        console.error(`viewer: asset "${name}" threw`, err);
        showMessage(`viewer: asset "${name}" threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  core.render();
  // WebGL canvases (no `preserveDrawingBuffer`) only guarantee their drawing buffer is
  // visible to the compositor for the paint that immediately follows the draw call --
  // flipping `__READY` synchronously right after `core.render()` races that paint, and
  // Playwright's screenshot can land on a still-blank canvas (composited to plain white)
  // often enough to matter on heavier scenes (e.g. farField's ~1100-instance skyline)
  // even though it "usually" works for tiny sanity-scene props. Two nested rAFs push
  // `__READY` past at least one full paint cycle so the harness always screenshots the
  // frame that was actually drawn.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.__READY = true;
    });
  });
}
