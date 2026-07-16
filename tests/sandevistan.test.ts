import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildSandevistan } from '../src/fx/sandevistan';

describe('sandevistan', () => {
  it('records and updates without error', () => {
    const s = buildSandevistan(new THREE.BoxGeometry(1, 1, 1));
    s.record(new THREE.Matrix4(), 0.1);
    s.update(0.1);
    expect(s.snapshotCount).toBeGreaterThan(0);
  });

  it('group is a THREE.Group', () => {
    const s = buildSandevistan(new THREE.BoxGeometry(1, 1, 1));
    expect(s.group).toBeInstanceOf(THREE.Group);
  });

  it('record + update multiple times stays deterministic', () => {
    const s = buildSandevistan(new THREE.BoxGeometry(1, 1, 1));
    const mat = new THREE.Matrix4().setPosition(1, 2, 3);
    s.record(mat, 0.1);
    s.record(mat, 0.2);
    s.update(0.2);
    const count1 = s.snapshotCount;
    s.update(0.2);
    expect(s.snapshotCount).toBe(count1);
  });
});
