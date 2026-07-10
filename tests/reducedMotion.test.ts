/**
 * Task 31 TDD: reducedMotion + intro scroll hint pulse tests.
 *
 * Covers:
 *  1. initReducedMotion standard mode: returns isReducedMotion=false
 *  2. initReducedMotion standard mode: starts rAF loop after idle timer fires
 *  3. initReducedMotion standard mode: pulseScrollHint is called with sine-wave opacity each frame
 *  4. initReducedMotion standard mode: pulse stops permanently once onProgress(t>0.02) called
 *  5. initReducedMotion standard mode: destroy() cancels the idle timer and stops rAF
 *  6. initReducedMotion reduced-motion mode: returns isReducedMotion=true
 *  7. initReducedMotion reduced-motion mode: scroll listener calls setProgress with snapped vignette t
 *  8. CRITICAL C1 fix: pulseScrollHint writes mat.opacity directly (not just closure var)
 *  9. Minor m1: scrollHintOpacity cleared when t > SCROLL_HINT_T_MAX so stale value not reapplied
 * 10. intro updatable: while hint active, skips t-driven opacity (pulse owns mat.opacity)
 * 11. intro updatable: after hint cleared, t-driven fade resumes correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type { CameraRig } from '../src/choreography/cameraRig';
import type { BikePath } from '../src/choreography/bikePath';
import type { DisplayAnchors } from '../src/world/cityLayout';

// ---------------------------------------------------------------------------
// Minimal browser environment stubs
// ---------------------------------------------------------------------------

let reducedMotionMatches = false;
let scrollY = 0;
let rafIdCounter = 1;
let scheduledRafs: Array<{ id: number; cb: FrameRequestCallback }> = [];
let scheduledTimeouts: Array<{ id: ReturnType<typeof setTimeout>; delay: number; cb: () => void }> = [];
let timeoutIdCounter = 100;

const windowListeners: Record<string, Array<() => void>> = {};

function mockRaf(cb: FrameRequestCallback): number {
  const id = rafIdCounter++;
  scheduledRafs.push({ id, cb });
  return id;
}

function mockCancelRaf(id: number): void {
  scheduledRafs = scheduledRafs.filter(r => r.id !== id);
}

/** Fire all currently scheduled rAF callbacks with given timestamp */
function flushRafs(now: number): void {
  const batch = scheduledRafs.slice();
  scheduledRafs = [];
  for (const r of batch) {
    r.cb(now);
  }
}

function mockSetTimeout(cb: () => void, delay: number): ReturnType<typeof setTimeout> {
  const id = timeoutIdCounter++ as unknown as ReturnType<typeof setTimeout>;
  scheduledTimeouts.push({ id, delay, cb });
  return id;
}

function mockClearTimeout(id: ReturnType<typeof setTimeout>): void {
  scheduledTimeouts = scheduledTimeouts.filter(t => t.id !== id);
}

/** Fire all scheduled timeouts (regardless of delay) */
function flushTimeouts(): void {
  const batch = scheduledTimeouts.slice();
  scheduledTimeouts = [];
  for (const t of batch) {
    t.cb();
  }
}

let nowValue = 0;
const mockPerformance = { now: () => nowValue };

function makeMockMatchMedia(reducedMotion: boolean) {
  return (query: string) => {
    let matches = false;
    if (query.includes('prefers-reduced-motion') && query.includes('reduce')) {
      matches = reducedMotion;
    }
    return {
      matches,
      addEventListener: () => { /* noop */ },
      removeEventListener: () => { /* noop */ },
    };
  };
}

function makeWindow(reducedMotion: boolean) {
  return {
    matchMedia: makeMockMatchMedia(reducedMotion),
    scrollY,
    innerHeight: 1000,
    addEventListener: (type: string, cb: () => void, _opts?: unknown) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(cb);
    },
    removeEventListener: (type: string, cb: () => void) => {
      if (windowListeners[type]) {
        windowListeners[type] = windowListeners[type].filter(h => h !== cb);
      }
    },
  };
}

beforeEach(() => {
  reducedMotionMatches = false;
  scrollY = 0;
  rafIdCounter = 1;
  scheduledRafs = [];
  scheduledTimeouts = [];
  timeoutIdCounter = 100;
  nowValue = 0;

  for (const key of Object.keys(windowListeners)) delete windowListeners[key];

  (globalThis as Record<string, unknown>).window = makeWindow(false);
  (globalThis as Record<string, unknown>).requestAnimationFrame = mockRaf;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = mockCancelRaf;
  (globalThis as Record<string, unknown>).setTimeout = mockSetTimeout;
  (globalThis as Record<string, unknown>).clearTimeout = mockClearTimeout;
  (globalThis as Record<string, unknown>).performance = mockPerformance;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
  delete (globalThis as Record<string, unknown>).setTimeout;
  delete (globalThis as Record<string, unknown>).clearTimeout;
  delete (globalThis as Record<string, unknown>).performance;
});

// ---------------------------------------------------------------------------
// Tests: initReducedMotion — standard mode
// ---------------------------------------------------------------------------

describe('initReducedMotion — standard mode (no reduced-motion)', () => {
  it('returns isReducedMotion: false', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const handle = initReducedMotion(() => { /* noop setProgress */ });
    expect(handle.isReducedMotion).toBe(false);
    handle.destroy();
  });

  it('starts rAF loop after idle timer fires', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const pulseOpacities: number[] = [];
    const handle = initReducedMotion(
      () => { /* noop */ },
      (opacity) => pulseOpacities.push(opacity)
    );

    // No rAF should be scheduled yet (only setTimeout)
    expect(scheduledRafs.length).toBe(0);

    // Fire idle timeout
    flushTimeouts();
    nowValue = 0;

    // rAF should now be scheduled
    expect(scheduledRafs.length).toBeGreaterThan(0);

    handle.destroy();
  });

  it('pulseScrollHint called with sine-based opacity each rAF frame', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const opacities: number[] = [];
    const handle = initReducedMotion(
      () => { /* noop */ },
      (opacity) => opacities.push(opacity)
    );

    flushTimeouts();     // fire 4s idle timer
    nowValue = 0;
    flushRafs(0);        // frame 1 at t=0ms
    nowValue = 300;
    flushRafs(300);      // frame 2 at t=300ms (quarter cycle of 1200ms period)
    nowValue = 600;
    flushRafs(600);      // frame 3 at t=600ms (half cycle)

    // Should have received 3 opacity values
    expect(opacities.length).toBe(3);

    // All values should be in [0.4, 1.0] range (sine wave 0.4 + 0.6*|sin|)
    for (const o of opacities) {
      expect(o).toBeGreaterThanOrEqual(0.4);
      expect(o).toBeLessThanOrEqual(1.0);
    }

    // Values at t=0 and t=600ms (half period) should differ from t=300ms (quarter period)
    // At phase=0: 0.4 + 0.6*|sin(0)| = 0.4
    // At phase=0.25: 0.4 + 0.6*|sin(0.25π)| ≈ 0.4 + 0.6*0.707 ≈ 0.824
    // At phase=0.5: 0.4 + 0.6*|sin(0.5π)| = 0.4 + 0.6*1.0 = 1.0
    expect(opacities[0]).toBeCloseTo(0.4, 5);    // phase=0
    expect(opacities[2]).toBeCloseTo(1.0, 5);    // phase=0.5

    handle.destroy();
  });

  it('pulse stops permanently once onProgress called with t > 0.02', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const opacities: number[] = [];
    const handle = initReducedMotion(
      () => { /* noop */ },
      (opacity) => opacities.push(opacity)
    );

    flushTimeouts(); // fire idle timer
    flushRafs(0);    // one pulse frame

    const countBefore = opacities.length;

    // Signal scrolled past threshold
    handle.onProgress(0.05);

    // Further rAF frames should not produce more pulses
    flushRafs(300);
    flushRafs(600);

    // No new opacities
    expect(opacities.length).toBe(countBefore);

    handle.destroy();
  });

  it('onProgress(t <= 0.02) does NOT stop the pulse', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const opacities: number[] = [];
    const handle = initReducedMotion(
      () => { /* noop */ },
      (opacity) => opacities.push(opacity)
    );

    flushTimeouts();
    flushRafs(0);

    handle.onProgress(0.01); // within threshold — should not stop

    flushRafs(100);
    flushRafs(200);

    // Pulse should still be running (3 frames total)
    expect(opacities.length).toBe(3);

    handle.destroy();
  });

  it('destroy() stops the rAF loop and cancels idle timer', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const opacities: number[] = [];
    const handle = initReducedMotion(
      () => { /* noop */ },
      (opacity) => opacities.push(opacity)
    );

    // Destroy BEFORE idle timer fires
    handle.destroy();
    flushTimeouts(); // timer fires but pulse should not start

    expect(scheduledRafs.length).toBe(0);
    expect(opacities.length).toBe(0);
  });

  it('destroy() after pulse started stops further frames', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const opacities: number[] = [];
    const handle = initReducedMotion(
      () => { /* noop */ },
      (opacity) => opacities.push(opacity)
    );

    flushTimeouts();
    flushRafs(0); // 1 frame
    handle.destroy();

    const countAtDestroy = opacities.length;
    flushRafs(100); // should not fire
    expect(opacities.length).toBe(countAtDestroy);
  });
});

// ---------------------------------------------------------------------------
// Tests: initReducedMotion — reduced-motion mode
// ---------------------------------------------------------------------------

describe('initReducedMotion — reduced-motion mode', () => {
  beforeEach(() => {
    // Reinstall window with reducedMotion=true
    (globalThis as Record<string, unknown>).window = makeWindow(true);
  });

  it('returns isReducedMotion: true', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const handle = initReducedMotion(() => { /* noop */ });
    expect(handle.isReducedMotion).toBe(true);
    handle.destroy();
  });

  it('registers scroll listener and calls setProgress immediately', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const progressValues: number[] = [];
    const handle = initReducedMotion((t) => progressValues.push(t));

    // Should have been called at least once (immediate call with scrollY=0)
    expect(progressValues.length).toBeGreaterThan(0);

    handle.destroy();
  });

  it('scroll listener snaps rawT to nearest vignette t-value', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const VIGNETTE_TS = [0, 0.19, 0.33, 0.46, 0.56, 0.70, 0.90];
    const progressValues: number[] = [];
    const handle = initReducedMotion((t) => progressValues.push(t));

    // Simulate scroll to 10% of total scroll height (rawT=0.10 → nearest is 0.19)
    const totalScrollPx = (1450 / 100) * 1000; // HERO_SCROLL_VH=1450, innerHeight=1000
    (globalThis as Record<string, unknown>).window = {
      ...makeWindow(true),
      scrollY: totalScrollPx * 0.10,
      innerHeight: 1000,
    };

    // Trigger scroll event
    const scrollHandlers = windowListeners['scroll'] ?? [];
    for (const h of scrollHandlers) h();

    if (progressValues.length > 0) {
      const snapped = progressValues[progressValues.length - 1];
      // 0.10 is equidistant between 0 and 0.19 — but 0 is first, so nearest favors 0.19 at 0.10
      // Actually |0.10 - 0| = 0.10, |0.10 - 0.19| = 0.09 → nearest is 0.19
      expect(VIGNETTE_TS).toContain(snapped);
      expect(snapped).toBe(0.19);
    }

    handle.destroy();
  });

  it('onProgress is a no-op in reduced-motion mode', async () => {
    const { initReducedMotion } = await import('../src/choreography/reducedMotion');
    const handle = initReducedMotion(() => { /* noop */ });
    expect(() => handle.onProgress(0.5)).not.toThrow();
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: CRITICAL C1 fix — pulseScrollHint writes mat.opacity directly
// ---------------------------------------------------------------------------

describe('intro pulseScrollHint — C1 fix: writes mat.opacity directly', () => {
  // We test intro.ts by constructing a minimal stub environment with THREE mocks.
  // The key assertion: calling pulseScrollHint(0.5) sets mat.opacity = 0.5 IMMEDIATELY,
  // without requiring update(t) to be called first.

  beforeEach(() => {
    // Provide a document stub so registerIntroSegment builds the panel
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect: () => { /* noop */ },
        strokeRect: () => { /* noop */ },
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        beginPath: () => { /* noop */ },
        moveTo: () => { /* noop */ },
        lineTo: () => { /* noop */ },
        stroke: () => { /* noop */ },
        font: '',
        textAlign: '',
        textBaseline: '',
        fillText: () => { /* noop */ },
      }),
    };
    (globalThis as Record<string, unknown>).document = {
      createElement: (_tag: string) => mockCanvas,
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it('pulseScrollHint sets mat.opacity directly (C1 fix: no update(t) needed)', async () => {
    const { registerIntroSegment } = await import('../src/choreography/segments/intro');

    // Minimal stubs
    const rig = {
      addKeys: () => { /* noop */ }
    } as unknown as CameraRig;

    const bike = {
      addSpeedKeys: () => { /* noop */ }
    } as unknown as BikePath;

    const anchors = {
      introOverhead: new THREE.Object3D(),
    } as unknown as DisplayAnchors;

    const updatables: Array<{ update(t: number): void }> = [];

    const handle = registerIntroSegment({ rig, bike, anchors, updatables });

    // Find the intro panel mesh added to the anchor
    const children = anchors.introOverhead.children;
    expect(children.length).toBe(1);
    const mesh = children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;

    // Before any pulse: material opacity should be 1.0 (initial)
    expect(mat.opacity).toBe(1);

    // Call pulseScrollHint — this should set mat.opacity DIRECTLY
    handle.pulseScrollHint(0.5);

    // CRITICAL: mat.opacity must be 0.5 immediately, without calling update(t)
    expect(mat.opacity).toBeCloseTo(0.5, 5);
  });

  it('pulseScrollHint clamps opacity to [0, 1]', async () => {
    const { registerIntroSegment } = await import('../src/choreography/segments/intro');

    const rig = { addKeys: () => { /* noop */ } } as unknown as CameraRig;
    const bike = { addSpeedKeys: () => { /* noop */ } } as unknown as BikePath;
    const anchors = { introOverhead: new THREE.Object3D() } as unknown as DisplayAnchors;
    const updatables: Array<{ update(t: number): void }> = [];

    const handle = registerIntroSegment({ rig, bike, anchors, updatables });
    const mesh = anchors.introOverhead.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;

    handle.pulseScrollHint(1.5); // above 1.0 → clamped to 1.0
    expect(mat.opacity).toBe(1.0);

    handle.pulseScrollHint(-0.3); // below 0 → clamped to 0
    expect(mat.opacity).toBe(0);
  });

  it('updatable skips setting mat.opacity while hint is active (pulse owns it)', async () => {
    const { registerIntroSegment } = await import('../src/choreography/segments/intro');

    const rig = { addKeys: () => { /* noop */ } } as unknown as CameraRig;
    const bike = { addSpeedKeys: () => { /* noop */ } } as unknown as BikePath;
    const anchors = { introOverhead: new THREE.Object3D() } as unknown as DisplayAnchors;
    const updatables: Array<{ update(t: number): void }> = [];

    const handle = registerIntroSegment({ rig, bike, anchors, updatables });
    const mesh = anchors.introOverhead.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;

    // Pulse sets opacity to 0.5
    handle.pulseScrollHint(0.5);
    expect(mat.opacity).toBeCloseTo(0.5, 5);

    // Now call update(t=0) — while hint is active, updatable must NOT override mat.opacity
    const updatable = updatables[updatables.length - 1];
    updatable.update(0);

    // mat.opacity should still be 0.5 (set by pulse, not overridden by updatable)
    expect(mat.opacity).toBeCloseTo(0.5, 5);
  });

  it('m1: scrollHintOpacity cleared when t > SCROLL_HINT_T_MAX so update(t) resumes', async () => {
    const { registerIntroSegment } = await import('../src/choreography/segments/intro');

    const rig = { addKeys: () => { /* noop */ } } as unknown as CameraRig;
    const bike = { addSpeedKeys: () => { /* noop */ } } as unknown as BikePath;
    const anchors = { introOverhead: new THREE.Object3D() } as unknown as DisplayAnchors;
    const updatables: Array<{ update(t: number): void }> = [];

    const handle = registerIntroSegment({ rig, bike, anchors, updatables });
    const mesh = anchors.introOverhead.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const updatable = updatables[updatables.length - 1];

    // Pulse sets opacity to 0.4 (last pulsed value — a dimmed state)
    handle.pulseScrollHint(0.4);
    expect(mat.opacity).toBeCloseTo(0.4, 5);

    // Now user scrolls — t advances beyond SCROLL_HINT_T_MAX (0.02)
    // update(t=0.03) → t <= 0.03, so should set opacity to 1.0 (no fade yet)
    updatable.update(0.03);

    // update(t) should have taken over: t=0.03 → opacity=1.0, and the hint flag cleared
    expect(mat.opacity).toBe(1);

    // Verify scrollHintOpacity is now cleared: calling update(t=0.01) again
    // should set opacity based on t-driven logic (t<=0.03 → opacity=1), NOT reapply 0.4
    updatable.update(0.01);
    expect(mat.opacity).toBe(1); // NOT 0.4 (stale hint value)
  });

  it('t-driven fade resumes correctly after hint cleared: t=0.04 fades out', async () => {
    const { registerIntroSegment } = await import('../src/choreography/segments/intro');

    const rig = { addKeys: () => { /* noop */ } } as unknown as CameraRig;
    const bike = { addSpeedKeys: () => { /* noop */ } } as unknown as BikePath;
    const anchors = { introOverhead: new THREE.Object3D() } as unknown as DisplayAnchors;
    const updatables: Array<{ update(t: number): void }> = [];

    registerIntroSegment({ rig, bike, anchors, updatables });
    const mesh = anchors.introOverhead.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const updatable = updatables[updatables.length - 1];

    // t=0.04 is in the fade region (0.03→0.05). fade = 1 - (0.04-0.03)/0.02 = 0.5
    updatable.update(0.04);
    expect(mat.opacity).toBeCloseTo(0.5, 5);
    expect(mesh.visible).toBe(true);
  });

  it('t-driven: t >= 0.05 hides mesh', async () => {
    const { registerIntroSegment } = await import('../src/choreography/segments/intro');

    const rig = { addKeys: () => { /* noop */ } } as unknown as CameraRig;
    const bike = { addSpeedKeys: () => { /* noop */ } } as unknown as BikePath;
    const anchors = { introOverhead: new THREE.Object3D() } as unknown as DisplayAnchors;
    const updatables: Array<{ update(t: number): void }> = [];

    registerIntroSegment({ rig, bike, anchors, updatables });
    const mesh = anchors.introOverhead.children[0] as THREE.Mesh;
    const updatable = updatables[updatables.length - 1];

    updatable.update(0.05);
    expect(mesh.visible).toBe(false);

    updatable.update(1.0);
    expect(mesh.visible).toBe(false);
  });
});
