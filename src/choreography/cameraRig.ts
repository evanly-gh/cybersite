import * as THREE from 'three';

// ──────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────────────────────────────────────

export interface CamPose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export interface CamKey extends CamPose {
  t: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Smoothstep easing: 3t² - 2t³, maps [0,1] → [0,1] with ease-in-out. */
function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

// ──────────────────────────────────────────────────────────────────────────────
// CameraRig
// ──────────────────────────────────────────────────────────────────────────────

export class CameraRig {
  private keys: CamKey[] = [];

  /** Add a keyframe. Keys are kept sorted by t. */
  addKey(k: CamKey): void {
    this.keys.push(k);
    this.keys.sort((a, b) => a.t - b.t);
  }

  /**
   * Sample a CamPose at time t.
   * - t is clamped to [firstKey.t, lastKey.t].
   * - Interpolation uses smoothstep-eased fraction.
   * - pos and target are lerped with Vector3.lerpVectors; fov is linearly interpolated.
   * - Pure/deterministic: identical t + key set → identical result.
   */
  sample(t: number): CamPose {
    const keys = this.keys;
    if (keys.length === 0) {
      throw new Error('CameraRig: no keys added');
    }
    if (keys.length === 1) {
      const k = keys[0];
      return {
        pos: k.pos.clone(),
        target: k.target.clone(),
        fov: k.fov,
      };
    }

    const first = keys[0];
    const last = keys[keys.length - 1];

    // Clamp t to [firstKey.t, lastKey.t]
    const tc = Math.max(first.t, Math.min(last.t, t));

    // Find bracketing keys
    let loIdx = 0;
    for (let i = 0; i < keys.length - 1; i++) {
      if (tc >= keys[i].t && tc <= keys[i + 1].t) {
        loIdx = i;
        break;
      }
    }

    const lo = keys[loIdx];
    const hi = keys[loIdx + 1];

    const span = hi.t - lo.t;
    const rawFrac = span === 0 ? 0 : (tc - lo.t) / span;
    const frac = smoothstep(rawFrac);

    const pos = new THREE.Vector3().lerpVectors(lo.pos, hi.pos, frac);
    const target = new THREE.Vector3().lerpVectors(lo.target, hi.target, frac);
    const fov = lo.fov + (hi.fov - lo.fov) * frac;

    return { pos, target, fov };
  }

  /**
   * Apply the sampled pose at time t to a PerspectiveCamera.
   * Sets position, lookAt, fov, and calls updateProjectionMatrix().
   */
  apply(cam: THREE.PerspectiveCamera, t: number): void {
    const pose = this.sample(t);
    cam.position.copy(pose.pos);
    cam.lookAt(pose.target);
    cam.fov = pose.fov;
    cam.updateProjectionMatrix();
  }
}
