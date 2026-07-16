import { describe, it, expect } from 'vitest';
// --- DOM canvas stub (see tests/billboards.test.ts) — builders draw to canvas ---
const chain: any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : chain), set: () => true, apply: () => chain
});
(globalThis as any).document = (globalThis as any).document ?? {
  createElement: () => ({ width: 0, height: 0, getContext: () => chain })
};
import { buildTraffic } from '../src/choreography/traffic';
import { makeRng } from '../src/utils/rng';

describe('traffic', () => {
  it('is deterministic under update(t)', () => {
    const a = buildTraffic(makeRng(3)); a.update(0.5);
    const b = buildTraffic(makeRng(3)); b.update(0.5);
    const pa: number[] = []; a.group.traverse(o => pa.push(o.position.x));
    const pb: number[] = []; b.group.traverse(o => pb.push(o.position.x));
    expect(pa).toEqual(pb);
  });

  it('has the Traffic interface: group + update', () => {
    const traffic = buildTraffic(makeRng(42));
    expect(traffic.group).toBeTruthy();
    expect(typeof traffic.update).toBe('function');
    // update must be callable with any t without throwing
    expect(() => traffic.update(0)).not.toThrow();
    expect(() => traffic.update(0.5)).not.toThrow();
    expect(() => traffic.update(1.0)).not.toThrow();
  });

  it('group has children (vehicles, crowd, metro)', () => {
    const traffic = buildTraffic(makeRng(1));
    expect(traffic.group.children.length).toBeGreaterThan(0);
  });

  it('scrub-safe: same t in opposite order yields same positions', () => {
    // Build once, call update forward then backward — must match
    const traffic = buildTraffic(makeRng(7));
    traffic.update(0.3);
    const pos1: number[] = [];
    traffic.group.traverse(o => pos1.push(o.position.x, o.position.y, o.position.z));

    traffic.update(0.8);
    traffic.update(0.3); // back to same t
    const pos2: number[] = [];
    traffic.group.traverse(o => pos2.push(o.position.x, o.position.y, o.position.z));

    expect(pos1).toEqual(pos2);
  });
});
