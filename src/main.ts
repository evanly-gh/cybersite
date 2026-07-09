import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import * as THREE from 'three';
import { COLORS } from './theme';
import { runViewer } from './viewer/viewer';
import { loadEntries } from './viewer/entries';
import { initCore } from './core/core';
import { initCursorTrail } from './fx/cursorTrail';

/**
 * TEMP sanity scene for Task 4 verification: a grid of emissive-magenta boxes with a
 * slow orbiting camera. Exercised by `npm run shoot -- --scroll 0`. Superseded once
 * Task 25 wires the real scroll-driven scene graph.
 */
function buildSanityScene(canvas: HTMLCanvasElement): void {
  const core = initCore(canvas);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.signalMagenta,
    emissive: COLORS.signalMagenta,
    emissiveIntensity: 3,
    metalness: 0.2,
    roughness: 0.4
  });

  const cols = 5;
  const rows = 4;
  const spacing = 2.2;
  for (let i = 0; i < cols * rows; i++) {
    const box = new THREE.Mesh(geo, mat);
    const col = i % cols;
    const row = Math.floor(i / cols);
    box.position.set((col - (cols - 1) / 2) * spacing, (row - (rows - 1) / 2) * spacing, 0);
    core.scene.add(box);
  }

  const hemi = new THREE.HemisphereLight(0xffffff, COLORS.shadowBlue, 1.0);
  core.scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(5, 8, 5);
  core.scene.add(key);

  core.camera.position.set(0, 0, 16);
  core.camera.lookAt(0, 0, 0);

  const orbitRadius = 16;
  const orbitSpeed = 0.15; // rad/sec
  core.onFrame((sec) => {
    const angle = sec * orbitSpeed;
    core.camera.position.set(Math.sin(angle) * orbitRadius, 0, Math.cos(angle) * orbitRadius);
    core.camera.lookAt(0, 0, 0);
  });

  core.start();
  core.render();
  window.__READY = true;
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
    buildSanityScene(canvas);
  }

  // Task 23: site-wide cursor trail (sandevistan RGB-split). Self-disables on
  // touch (pointer:coarse) and prefers-reduced-motion — no config needed here.
  initCursorTrail();

  console.log('boot ok');
}

boot();
