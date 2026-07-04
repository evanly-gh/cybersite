import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import * as THREE from 'three';
import { COLORS } from './theme';
import { registerAsset } from './viewer/registry';
import { runViewer } from './viewer/viewer';

function boot(): void {
  if (new URLSearchParams(location.search).has('viewer')) {
    // TEMP: verification asset for Task 2 — delete this block when Phase 2 starts.
    registerAsset('testCube', () => {
      const geo = new THREE.BoxGeometry(2, 2, 2);
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS.tronCyan,
        emissive: COLORS.tronCyan,
        emissiveIntensity: 1.2,
        metalness: 0.2,
        roughness: 0.3
      });
      return new THREE.Mesh(geo, mat);
    });

    runViewer();
    return;
  }

  // Temporary canvas setup
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.fillStyle = '#' + COLORS.void.toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  console.log('boot ok');
}

boot();
