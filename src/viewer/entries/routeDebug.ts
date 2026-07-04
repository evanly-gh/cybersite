import * as THREE from 'three';
import { registerAsset } from '../registry';
import { COLORS } from '../../theme';
import { ROUTE, WAYPOINTS } from '../../world/route';
import { makeCanvasTexture } from '../../utils/canvasText';

// The real ROUTE spans ~2000m (introStart to bridgeEnd); core's FogExp2 (density 0.0016)
// and the viewer's auto-framing camera distance are tuned for the small (~10-20 unit)
// sanity-scene props. At true scale the auto-framed camera sits ~2600 units back, which
// is deep enough into the exponential fog falloff to render fully black. Per the task
// brief ("adjust the debug asset, not the route"), the whole debug group is rendered at
// DISPLAY_SCALE and the tube/marker/label sizes are pre-multiplied by 1/DISPLAY_SCALE so
// their final on-screen size is unchanged — only the positions (and thus camera
// distance / fog depth) shrink.
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

// Task 6 verification: the authored city route spline + labeled waypoint markers.
registerAsset('routeDebug', () => buildRouteDebug());
