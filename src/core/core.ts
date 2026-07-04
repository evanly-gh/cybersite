import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { COLORS } from '../theme';

export interface Core {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render(): void;
  onFrame(cb: (sec: number) => void): void;
  start(): void;
  setQuality(tier: 0 | 1 | 2): void;
  quality: 0 | 1 | 2;
}

const MAX_DPR_FULL = 1.75;
const MAX_DPR_MED = 1.25;
const MAX_DPR_LOW = 1;

const AUTO_DROP_MS = 22;
const AUTO_DROP_INTERVAL_SEC = 5;
const ROLLING_FRAMES = 60;

// Chromatic aberration (radial RGB offset) + vignette (smoothstep 0.55 -> 0.95, 35% strength).
const CA_VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5, 0.5);
      vec2 toCenter = vUv - center;
      float dist = length(toCenter);
      vec2 dir = normalize(toCenter + 1e-6);
      float offset = 0.0015;

      float r = texture2D(tDiffuse, vUv - dir * offset * dist).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv + dir * offset * dist).b;
      float a = texture2D(tDiffuse, vUv).a;

      vec3 color = vec3(r, g, b);

      float vignette = smoothstep(0.95, 0.55, dist);
      vignette = mix(1.0, vignette, 0.35);
      color *= vignette;

      gl_FragColor = vec4(color, a);
    }
  `
};

export function initCore(canvas: HTMLCanvasElement): Core {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR_FULL));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.void);
  scene.fog = new THREE.FogExp2(COLORS.void, 0.0016);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(0, 0, 10);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // UnrealBloomPass internally renders its brightness/blur targets at half of
  // whatever width/height it is given via setSize(). EffectComposer drives that
  // setSize() call directly with the full effective (DPR-scaled) resolution, which
  // is exactly the "resolution 1/2" tier-2 spec. For tier 1 (bloom res 1/4) we
  // re-invoke bloomPass.setSize() ourselves with half of the effective size so its
  // internal halving lands on a quarter of the real resolution.
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.75);
  composer.addPass(bloomPass);

  const caVignettePass = new ShaderPass(CA_VIGNETTE_SHADER);
  composer.addPass(caVignettePass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let quality: 0 | 1 | 2 = 2;
  const frameCallbacks: Array<(sec: number) => void> = [];

  function applyQuality(tier: 0 | 1 | 2): void {
    quality = tier;

    if (tier === 2) {
      bloomPass.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR_FULL));
    } else if (tier === 1) {
      bloomPass.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR_MED));
    } else {
      bloomPass.enabled = false;
      renderer.setPixelRatio(MAX_DPR_LOW);
    }

    onResize();
  }

  function onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);

    if (bloomPass.enabled) {
      const effectiveW = w * renderer.getPixelRatio();
      const effectiveH = h * renderer.getPixelRatio();
      // Tier 2: leave composer's default setSize() call in place (bloom res = 1/2).
      // Tier 1: re-halve it ourselves (bloom res = 1/4).
      if (quality === 1) {
        bloomPass.setSize(effectiveW / 2, effectiveH / 2);
      }
    }
  }
  window.addEventListener('resize', onResize);

  // Rolling 60-frame average frame time, auto-dropping quality once per 5s if > 22ms.
  const frameTimes: number[] = [];
  let lastAutoDropSec = -Infinity;
  let lastFrameStart = -1;

  function render(): void {
    composer.render();
  }

  let rafId = 0;
  let startTimeSec = -1;

  function tick(nowMs: number): void {
    rafId = requestAnimationFrame(tick);
    const nowSec = nowMs / 1000;
    if (startTimeSec < 0) startTimeSec = nowSec;
    const elapsed = nowSec - startTimeSec;

    if (lastFrameStart >= 0) {
      const dt = nowMs - lastFrameStart;
      frameTimes.push(dt);
      if (frameTimes.length > ROLLING_FRAMES) frameTimes.shift();

      if (
        frameTimes.length === ROLLING_FRAMES &&
        elapsed - lastAutoDropSec >= AUTO_DROP_INTERVAL_SEC
      ) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        if (avg > AUTO_DROP_MS && quality > 0) {
          applyQuality((quality - 1) as 0 | 1 | 2);
          lastAutoDropSec = elapsed;
        }
      }
    }
    lastFrameStart = nowMs;

    for (const cb of frameCallbacks) cb(elapsed);
    render();
  }

  const core: Core = {
    renderer,
    scene,
    camera,
    render,
    onFrame(cb: (sec: number) => void): void {
      frameCallbacks.push(cb);
    },
    start(): void {
      if (rafId) return;
      rafId = requestAnimationFrame(tick);
    },
    setQuality(tier: 0 | 1 | 2): void {
      applyQuality(tier);
    },
    get quality(): 0 | 1 | 2 {
      return quality;
    }
  };

  return core;
}
