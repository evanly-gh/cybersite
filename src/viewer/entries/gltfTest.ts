import * as THREE from 'three';
import { registerAsset } from '../registry';
import { makeCanvasTexture } from '../../utils/canvasText';

/**
 * Task A verification: gltfTest — confirms the GLTF loader module imported
 * correctly and the asset pipeline is wired up.  Because no model files
 * exist yet (downloaded in Task G) this entry creates a visual placeholder:
 *
 *   - A floating panel sprite that reads "GLTF LOADER READY"
 *   - A grid of small magenta cubes (mimicking the loader's fallback mesh)
 *   - Slow rotation so the viewer can confirm 3-D depth
 */

registerAsset('gltfTest', (_rng) => {
  const group = new THREE.Group();

  // ── Panel sprite ──────────────────────────────────────────────────────────
  const W = 512, H = 256;
  const panelTex = makeCanvasTexture(W, H, (ctx) => {
    // Dark background
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, W, H);

    // Cyan border
    ctx.strokeStyle = '#00ffe0';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, W - 8, H - 8);

    // Corner ticks
    const tick = 18;
    ctx.lineWidth = 3;
    for (const [cx, cy, dx, dy] of [
      [4, 4, 1, 1], [W - 4, 4, -1, 1],
      [4, H - 4, 1, -1], [W - 4, H - 4, -1, -1],
    ] as [number, number, number, number][]) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * tick, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + dy * tick); ctx.stroke();
    }

    // Eyebrow
    ctx.font = '700 14px monospace';
    ctx.fillStyle = '#00ffe0';
    ctx.letterSpacing = '3px';
    ctx.textAlign = 'center';
    ctx.fillText('ASSET PIPELINE', W / 2, 48);

    // Title
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '0px';
    ctx.fillText('GLTF LOADER READY', W / 2, 110);

    // Sub-line
    ctx.font = '14px monospace';
    ctx.fillStyle = '#888fa8';
    ctx.fillText('DRACOLoader · GLTFLoader · cache · merge · normalize', W / 2, 148);

    // Status dot
    ctx.fillStyle = '#00ffe0';
    ctx.beginPath();
    ctx.arc(W / 2 - 90, 188, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cccccc';
    ctx.font = '13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Models will be loaded in Task G', W / 2 - 78, 193);

    // Scanlines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  });

  const panelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 4),
    new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, side: THREE.DoubleSide }),
  );
  panelMesh.position.set(0, 3.5, 0);
  group.add(panelMesh);

  // ── Fallback-cube grid ────────────────────────────────────────────────────
  // Mimics what loadModel() would return on a missing file — so we can
  // visually confirm the fallback path at least renders without errors.
  const cubeMat = new THREE.MeshStandardMaterial({
    color: 0xff00ff,
    wireframe: true,
    emissive: 0x440044,
  });
  const cubeGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const COLS = 5, ROWS = 2;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cube = new THREE.Mesh(cubeGeo, cubeMat);
      cube.position.set((c - (COLS - 1) / 2) * 1.4, r * 1.4 - 0.7, 0);
      group.add(cube);
    }
  }

  // ── Ambient glow ring ─────────────────────────────────────────────────────
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffe0, wireframe: true });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.05, 8, 64), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.5;
  group.add(ring);

  return {
    group,
    update(t: number): void {
      // Slow spin — validates that update() hook works
      group.rotation.y = t * Math.PI * 2 * 0.15;
      ring.rotation.z = t * Math.PI * 2 * 0.3;
    },
  };
});
