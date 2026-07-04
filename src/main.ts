import '@fontsource/unbounded';
import '@fontsource/rajdhani';
import '@fontsource/share-tech-mono';
import './styles.css';
import * as THREE from 'three';
import { COLORS } from './theme';
import { registerAsset } from './viewer/registry';
import { runViewer } from './viewer/viewer';
import { initCore } from './core/core';
import { RESUME, type ImageSlot } from './content/resume';
import { makePlaceholder } from './content/placeholders';
import { AD_SIZES, makeAd, type AdFormat } from './content/adGenerator';
import { ROUTE, WAYPOINTS } from './world/route';
import { makeCanvasTexture } from './utils/canvasText';
import { buildStreets, buildStreetsShibuya, buildStreetsRamp, buildStreetsBridge } from './world/streets';
import { buildFarField } from './world/farField';

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

interface WallCell {
  texture: THREE.Texture;
  w: number;
  h: number;
}

/**
 * Task 5 verification helper: lays `cells` out into a `cols`-wide grid of emissive
 * planes, each fitted (aspect preserved) inside a uniform `cellW`x`cellH` slot so wildly
 * different image aspect ratios (e.g. 512x1194 portrait vs. 2048x256 strip) don't distort
 * the overall grid pitch. Materials are emissive-only (no lit `map`) so brightness is
 * fully controlled by the texture + emissiveIntensity, independent of scene lighting —
 * that's what keeps bloom consistent instead of blowing bright textures out to white.
 * Used by the `adWall` and `placeholderWall` viewer assets only.
 */
function buildWall(cells: WallCell[], cols: number, cellW: number, cellH: number, gap: number): THREE.Group {
  const group = new THREE.Group();
  const rows = Math.ceil(cells.length / cols);
  const pitchX = cellW + gap;
  const pitchY = cellH + gap;
  const totalWidth = cols * pitchX - gap;
  const totalHeight = rows * pitchY - gap;

  cells.forEach((cell, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const fit = Math.min(cellW / cell.w, cellH / cell.h);
    const geo = new THREE.PlaneGeometry(cell.w * fit, cell.h * fit);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: cell.texture,
      emissiveIntensity: 1.1
    });
    const mesh = new THREE.Mesh(geo, mat);
    const x = -totalWidth / 2 + col * pitchX + cellW / 2;
    const y = totalHeight / 2 - row * pitchY - cellH / 2;
    mesh.position.set(x, y, 0);
    group.add(mesh);
  });

  return group;
}

// The real ROUTE spans ~2000m (introStart to bridgeEnd); core's FogExp2 (density 0.0016)
// and the viewer's auto-framing camera distance are tuned for the small (~10-20 unit)
// sanity-scene props elsewhere in this file. At true scale the auto-framed camera sits
// ~2600 units back, which is deep enough into the exponential fog falloff to render
// fully black. Per the task brief ("adjust the debug asset, not the route"), the whole
// debug group is rendered at DISPLAY_SCALE and the tube/marker/label sizes are
// pre-multiplied by 1/DISPLAY_SCALE so their final on-screen size is unchanged — only
// the positions (and thus camera distance / fog depth) shrink.
const DISPLAY_SCALE = 0.15;
const TUBE_RADIUS = 1.2;
const MARKER_RADIUS = 3.5;
const LABEL_OFFSET_Y = 10;
const LABEL_WIDTH = 32;
const LABEL_HEIGHT = 8;

/**
 * Task 6 verification asset: renders the authored ROUTE spline as an emissive-cyan tube
 * with a small magenta marker sphere and a canvas-sprite text label at every named
 * WAYPOINTS entry. Lets us eyeball the L-shaped street layout, the ramp/skyway/bridge
 * elevation changes, and waypoint naming before any real street/building geometry
 * exists. See DISPLAY_SCALE comment above for why this isn't rendered at true scale.
 */
function buildRouteDebug(): THREE.Group {
  const group = new THREE.Group();

  const tubeGeo = new THREE.TubeGeometry(ROUTE, 512, TUBE_RADIUS / DISPLAY_SCALE, 12, false);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: COLORS.tronCyan,
    emissive: COLORS.tronCyan,
    emissiveIntensity: 2.5,
    metalness: 0.1,
    roughness: 0.3
  });
  group.add(new THREE.Mesh(tubeGeo, tubeMat));

  const markerGeo = new THREE.SphereGeometry(MARKER_RADIUS / DISPLAY_SCALE, 16, 16);
  const markerMat = new THREE.MeshStandardMaterial({
    color: COLORS.signalMagenta,
    emissive: COLORS.signalMagenta,
    emissiveIntensity: 1.8
  });

  for (const [name, pos] of Object.entries(WAYPOINTS)) {
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.copy(pos);
    group.add(marker);

    const texture = makeCanvasTexture(320, 80, (ctx) => {
      ctx.clearRect(0, 0, 320, 80);
      ctx.fillStyle = 'rgba(7, 8, 15, 0.8)';
      ctx.fillRect(0, 20, 320, 40);
      ctx.font = 'bold 28px "Share Tech Mono", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 160, 40);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.position.copy(pos).add(new THREE.Vector3(0, LABEL_OFFSET_Y / DISPLAY_SCALE, 0));
    sprite.scale.set(LABEL_WIDTH / DISPLAY_SCALE, LABEL_HEIGHT / DISPLAY_SCALE, 1);
    group.add(sprite);
  }

  group.scale.setScalar(DISPLAY_SCALE);
  return group;
}

const AD_FORMATS: AdFormat[] = ['landscape', 'portrait', 'square', 'strip', 'vcard'];

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

    // Task 5 verification: 6x2 grid sampling all 5 ad formats + rng-picked brands.
    registerAsset('adWall', (rng) => {
      const cells: WallCell[] = Array.from({ length: 12 }, (_, i) => {
        const format = AD_FORMATS[i % AD_FORMATS.length];
        const [w, h] = AD_SIZES[format];
        return { texture: makeAd(format, rng), w, h };
      });
      return buildWall(cells, 6, 3, 3, 0.5);
    });

    // Task 5 verification: every RESUME ImageSlot rendered as its placeholder texture.
    registerAsset('placeholderWall', () => {
      const slots: ImageSlot[] = [
        RESUME.about.faceImage,
        ...RESUME.about.misc,
        ...RESUME.projectsMain.map((p) => p.image),
        ...RESUME.projectsSmall.map((p) => p.image),
        ...RESUME.research.map((p) => p.image)
      ];
      const cells: WallCell[] = slots.map((slot) => ({ texture: makePlaceholder(slot), w: slot.w, h: slot.h }));
      return buildWall(cells, 5, 3, 3, 0.5);
    });

    // Task 6 verification: the authored city route spline + labeled waypoint markers.
    registerAsset('routeDebug', () => buildRouteDebug());

    // Task 7 verification: the full street network, plus zoomed-in sub-assets for the
    // Shibuya crossing and a ramp jump (the whole network is ~1800m long, too big to
    // judge fine detail in one auto-framed shot).
    registerAsset('streets', (rng) => buildStreets(rng));
    registerAsset('streetsShibuya', (rng) => buildStreetsShibuya(rng));
    registerAsset('streetsRamp', (rng) => buildStreetsRamp(rng));
    registerAsset('streetsBridge', (rng) => buildStreetsBridge(rng));

    // Task 8 verification: Ring 2 skyline + sky/moon/ocean backdrop. World-scale (sky
    // dome r=3200m) — always view this one via `?cam=` (see viewer.ts), not the default
    // auto-framed turntable.
    registerAsset('farField', (rng) => buildFarField(rng));

    runViewer();
    return;
  }

  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  if (canvas) {
    buildSanityScene(canvas);
  }

  console.log('boot ok');
}

boot();
