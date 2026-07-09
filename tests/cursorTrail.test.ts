/**
 * Unit tests for Task 23 — cursor trail DOM overlay.
 *
 * The cursorTrail module is browser-only (uses window, document, rAF, matchMedia).
 * We stub just enough of the DOM surface so the module can initialize under Node.
 *
 * Tests verify:
 * 1. Canvas is created with correct id, pointer-events:none, z-index
 * 2. destroy() removes the canvas and stops the rAF
 * 3. initCursorTrail() is a no-op (returns immediately) when prefers-reduced-motion: reduce
 * 4. initCursorTrail() is a no-op (returns immediately) when pointer: coarse (touch)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal DOM stubs
// ---------------------------------------------------------------------------

/** Tracks canvas elements "appended to body" */
const appendedCanvases: Record<string, MockCanvas> = {};

interface MockCanvas {
  id: string;
  style: Record<string, string>;
  width: number;
  height: number;
  parentNode: { removeChild: (c: MockCanvas) => void } | null;
  getContext: (_type: string) => MockCtx;
}

interface MockCtx {
  clearRect: (..._args: unknown[]) => void;
  beginPath: (..._args: unknown[]) => void;
  moveTo: (..._args: unknown[]) => void;
  lineTo: (..._args: unknown[]) => void;
  stroke: (..._args: unknown[]) => void;
  [key: string]: unknown;
}

function makeCtxStub(): MockCtx {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, _k) => {
        const fn = (..._args: unknown[]) => proxy;
        return fn;
      },
      set: () => true,
    }
  );
  return proxy as MockCtx;
}

function makeCanvas(): MockCanvas {
  const body = mockBody;
  const c: MockCanvas = {
    id: '',
    style: {},
    width: 800,
    height: 600,
    parentNode: null,
    getContext: (_type: string) => makeCtxStub(),
  };
  c.parentNode = {
    removeChild: (_child: MockCanvas) => {
      // remove from appendedCanvases on destroy
      delete appendedCanvases[_child.id];
    },
  };
  // track
  Object.defineProperty(c, 'parentNode', {
    get() { return appendedCanvases[c.id] ? body : null; },
    set(_v) { /* ignore */ },
  });
  return c;
}

const mockBody = {
  appendChild(child: MockCanvas): void {
    appendedCanvases[child.id] = child;
  },
  removeChild(child: MockCanvas): void {
    delete appendedCanvases[child.id];
  },
};

// matchMedia mock factory — controls which queries match
let reducedMotionMatches = false;
let pointerCoarseMatches = false;

function makeMockMatchMedia(): (query: string) => { matches: boolean; addEventListener: () => void; removeEventListener: () => void } {
  return (query: string) => {
    let matches = false;
    if (query.includes('prefers-reduced-motion') && query.includes('reduce')) {
      matches = reducedMotionMatches;
    } else if (query.includes('pointer') && query.includes('coarse')) {
      matches = pointerCoarseMatches;
    }
    return {
      matches,
      addEventListener: () => { /* stub */ },
      removeEventListener: () => { /* stub */ },
    };
  };
}

// rAF stubs — don't actually schedule, just record
let rafScheduled = false;
let rafCallback: FrameRequestCallback | null = null;
let rafIdCounter = 1;

function mockRaf(cb: FrameRequestCallback): number {
  rafScheduled = true;
  rafCallback = cb;
  return rafIdCounter++;
}

function mockCancelRaf(_id: number): void {
  rafScheduled = false;
  rafCallback = null;
}

// performance.now stub
let nowValue = 1000;
const mockPerformance = { now: () => nowValue };

// Pointer/visibility event stubs
type EventCallback = (e: unknown) => void;
const windowListeners: Record<string, EventCallback[]> = {};
const documentListeners: Record<string, EventCallback[]> = {};

function makeAddEventListener(store: Record<string, EventCallback[]>) {
  return (type: string, handler: EventCallback) => {
    if (!store[type]) store[type] = [];
    store[type].push(handler);
  };
}
function makeRemoveEventListener(store: Record<string, EventCallback[]>) {
  return (type: string, handler: EventCallback) => {
    if (store[type]) store[type] = store[type].filter(h => h !== handler);
  };
}

// ---------------------------------------------------------------------------
// Install / uninstall globals before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset state
  reducedMotionMatches = false;
  pointerCoarseMatches = false;
  rafScheduled = false;
  rafCallback = null;
  nowValue = 1000;

  for (const key of Object.keys(appendedCanvases)) delete appendedCanvases[key];
  for (const key of Object.keys(windowListeners)) delete windowListeners[key];
  for (const key of Object.keys(documentListeners)) delete documentListeners[key];

  // Install globals
  (globalThis as Record<string, unknown>).window = {
    matchMedia: makeMockMatchMedia(),
    addEventListener: makeAddEventListener(windowListeners),
    removeEventListener: makeRemoveEventListener(windowListeners),
    innerWidth: 800,
    innerHeight: 600,
  };
  (globalThis as Record<string, unknown>).document = {
    createElement: (_tag: string) => makeCanvas(),
    body: mockBody,
    hidden: false,
    addEventListener: makeAddEventListener(documentListeners),
    removeEventListener: makeRemoveEventListener(documentListeners),
  };
  (globalThis as Record<string, unknown>).requestAnimationFrame = mockRaf;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = mockCancelRaf;
  (globalThis as Record<string, unknown>).performance = mockPerformance;
});

afterEach(() => {
  // Clean up globals to avoid state leaking to other test files
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
  delete (globalThis as Record<string, unknown>).performance;
});

// ---------------------------------------------------------------------------
// Tests — import dynamically so our globals are in place first
// ---------------------------------------------------------------------------

describe('initCursorTrail', () => {
  it('creates canvas#cursor-fx with pointer-events:none and high z-index', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    // Canvas should have been appended
    const canvas = appendedCanvases['cursor-fx'];
    expect(canvas).toBeDefined();
    expect(canvas.style['pointerEvents']).toBe('none');

    // z-index should be a large number
    const z = Number(canvas.style['zIndex']);
    expect(z).toBeGreaterThan(9000);

    handle.destroy();
  });

  it('canvas position is fixed and covers the viewport', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    const canvas = appendedCanvases['cursor-fx'];
    expect(canvas.style['position']).toBe('fixed');
    expect(canvas.style['top']).toBe('0');
    expect(canvas.style['left']).toBe('0');

    handle.destroy();
  });

  it('schedules a rAF loop on init', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    rafScheduled = false;
    const handle = initCursorTrail();

    expect(rafScheduled).toBe(true);
    handle.destroy();
  });

  it('destroy() removes the canvas from the DOM and stops the rAF', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    expect(appendedCanvases['cursor-fx']).toBeDefined();
    handle.destroy();

    // Canvas should be removed
    expect(appendedCanvases['cursor-fx']).toBeUndefined();
    // rAF cancelled
    expect(rafScheduled).toBe(false);
  });

  it('is a no-op (no canvas) when prefers-reduced-motion: reduce', async () => {
    reducedMotionMatches = true;
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    // No canvas should be created
    expect(appendedCanvases['cursor-fx']).toBeUndefined();
    // No rAF should be scheduled
    expect(rafScheduled).toBe(false);

    // destroy is a safe no-op
    expect(() => handle.destroy()).not.toThrow();
  });

  it('is a no-op (no canvas) when pointer: coarse (touch device)', async () => {
    pointerCoarseMatches = true;
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    expect(appendedCanvases['cursor-fx']).toBeUndefined();
    expect(rafScheduled).toBe(false);
    expect(() => handle.destroy()).not.toThrow();
  });

  it('registers pointermove listener on window', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    expect(windowListeners['pointermove']).toBeDefined();
    expect(windowListeners['pointermove'].length).toBeGreaterThan(0);

    handle.destroy();
  });

  it('registers pointerdown listener on window (for chevron burst)', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    expect(windowListeners['pointerdown']).toBeDefined();
    expect(windowListeners['pointerdown'].length).toBeGreaterThan(0);

    handle.destroy();
  });

  it('destroy() removes all event listeners', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();

    handle.destroy();

    // Listeners should be gone (empty or removed)
    const pmListeners = windowListeners['pointermove'] ?? [];
    expect(pmListeners.length).toBe(0);
  });

  it('returns a { destroy } interface', async () => {
    const { initCursorTrail } = await import('../src/fx/cursorTrail');
    const handle = initCursorTrail();
    expect(typeof handle.destroy).toBe('function');
    handle.destroy();
  });
});
