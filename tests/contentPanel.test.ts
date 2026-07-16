import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// Stub the DOM canvas exactly as tests/billboards.test.ts does (Node, no jsdom).
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain),
  set: () => true,
  apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};

import { makeProjectTexture, makeAboutHeroTexture } from '../src/content/contentPanel';
import { RESUME } from '../src/content/resume';

describe('contentPanel', () => {
  it('creates a CanvasTexture for a project', () => {
    expect(makeProjectTexture(RESUME.projectsMain[0])).toBeInstanceOf(THREE.CanvasTexture);
  });
  it('creates the about hero texture', () => {
    expect(makeAboutHeroTexture()).toBeInstanceOf(THREE.CanvasTexture);
  });
});
