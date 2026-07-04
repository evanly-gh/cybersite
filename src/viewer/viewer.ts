import * as THREE from 'three';
import { COLORS } from '../theme';
import { getAsset, listAssets, type AssetEntry } from './registry';

// replaced by utils/rng in Task 3
type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/**
 * Reads `?viewer=<name>&angle=<0-3>&t=<0..1>` from location.search, builds a minimal
 * preview scene for the requested registered asset, frames the camera at one of four
 * orbit angles (45° azimuth steps, 20° elevation), and exposes `window.__READY = true`
 * once the first frame has been rendered. Bloom composer arrives with core/core.ts in
 * Task 4 — for now this uses a plain WebGLRenderer.
 */
export function runViewer(): void {
  const params = new URLSearchParams(location.search);
  const name = params.get('viewer');
  const angleIndex = Number(params.get('angle') ?? '0');
  const t = Number(params.get('t') ?? '0.5');
  // Fixed ambient time (seconds) so screenshots stay deterministic — not wall-clock.
  const sec = Number(params.get('sec') ?? '2');

  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.void);

  const grid = new THREE.GridHelper(40, 40, COLORS.holoTeal, COLORS.shadowBlue);
  scene.add(grid);

  const hemi = new THREE.HemisphereLight(0xffffff, COLORS.shadowBlue, 1.0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(5, 8, 5);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
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
        const rng = mulberry32(1);
        const entry: AssetEntry = make(rng);
        const object = entry instanceof THREE.Object3D ? entry : entry.group;
        const update = entry instanceof THREE.Object3D ? undefined : entry.update;
        const updateAmbient = entry instanceof THREE.Object3D ? undefined : entry.updateAmbient;

        scene.add(object);

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
      } catch (err) {
        console.error(`viewer: asset "${name}" threw`, err);
        showMessage(`viewer: asset "${name}" threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  function onResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  renderer.render(scene, camera);
  window.__READY = true;
}
