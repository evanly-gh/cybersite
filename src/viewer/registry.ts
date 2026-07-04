import type * as THREE from 'three';
import type { Rng } from '../utils/rng';

export type AssetEntry =
  | THREE.Object3D
  | { group: THREE.Object3D; update?: (t: number) => void; updateAmbient?: (sec: number) => void };

const registry = new Map<string, (rng: Rng) => AssetEntry>();

export function registerAsset(name: string, make: (rng: Rng) => AssetEntry): void {
  registry.set(name, make);
}

export function getAsset(name: string): ((rng: Rng) => AssetEntry) | undefined {
  return registry.get(name);
}

export function listAssets(): string[] {
  return [...registry.keys()];
}
