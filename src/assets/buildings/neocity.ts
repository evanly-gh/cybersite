/**
 * NeoCity Loader
 *
 * Loads the 47 DRACO-compressed KitBash NeoCity glb pieces from
 * /models/neocity/ and assigns project neon materials keyed off the
 * two-bucket material naming convention:
 *   NEO_BODY    — concrete/steel/metal → dark lit material
 *   NEO_EMISSIVE — lights/glass/neon   → glowing emissive material
 *
 * Neon palette: holoTeal, signalMagenta, sodiumAmber, moonlight.
 * tronCyan is NEVER used here (reserved for the bike).
 */

import * as THREE from 'three';
import { tryLoadScene } from '../gltfLoader';
import { COLORS } from '../../theme';
import { makeRng } from '../../utils/rng';
import type { Rng } from '../../utils/rng';

// ---------------------------------------------------------------------------
// Neon palette (tronCyan excluded — reserved for the bike)
// ---------------------------------------------------------------------------

const NEON_PALETTE = [
  COLORS.holoTeal,
  COLORS.signalMagenta,
  COLORS.sodiumAmber,
  COLORS.moonlight,
] as const;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface NeoPiece {
  name: string;
  /** Loaded scene from glb, or null if load failed (graceful fallback). */
  scene: THREE.Group | null;
  /** Bounding box [width, height, depth] in metres from manifest. */
  bbox: [number, number, number];
  hasEmissive: boolean;
}

export interface NeoLibrary {
  pieces: Record<string, NeoPiece>;
  /**
   * Returns a deep clone of the named piece's scene with neon materials
   * already applied (deterministic per piece name), or null if the piece
   * failed to load or does not exist.
   */
  get(name: string): THREE.Group | null;
}

// ---------------------------------------------------------------------------
// Manifest shape (matches public/models/neocity/manifest.json)
// ---------------------------------------------------------------------------

interface ManifestEntry {
  name: string;
  file: string;
  bbox: [number, number, number];
  hasEmissive: boolean;
}

// ---------------------------------------------------------------------------
// applyNeonMaterials
// ---------------------------------------------------------------------------

/**
 * Traverses a THREE.Group and replaces materials on all meshes:
 *
 * - `NEO_EMISSIVE` → glowing MeshStandardMaterial, neon color from rng.
 * - `NEO_BODY` (or anything else) → dark lit MeshStandardMaterial.
 *
 * Uses COLOR_0 vertex colors (present on all pieces) via `vertexColors: true`.
 * Deterministic: rng controls neon color pick.
 */
export function applyNeonMaterials(group: THREE.Group, rng: Rng): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const mat = child.material as THREE.MeshStandardMaterial;
    const matName: string = mat?.name ?? '';

    if (matName === 'NEO_EMISSIVE') {
      // Pick a neon hue from the allowed palette (never tronCyan)
      const neonHex = rng.pick(NEON_PALETTE);
      const emissiveColor = new THREE.Color(neonHex);

      // emissiveIntensity: 1.6 – 2.4, deterministically via rng
      const intensity = 1.6 + rng() * 0.8;

      child.material = new THREE.MeshStandardMaterial({
        name: 'NEO_EMISSIVE',
        color: new THREE.Color(0x0a0a14),   // very dark base
        emissive: emissiveColor,
        emissiveIntensity: intensity,
        roughness: 0.3,
        metalness: 0.5,
        vertexColors: true,
      });
    } else {
      // NEO_BODY or any unrecognised primitive — dark lit material
      child.material = new THREE.MeshStandardMaterial({
        name: 'NEO_BODY',
        color: new THREE.Color(COLORS.shadowBlue),
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
        roughness: 0.85,
        metalness: 0.25,
        vertexColors: true,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Internal: derive a stable numeric seed from a piece name string
// ---------------------------------------------------------------------------

function hashName(name: string): number {
  // djb2-style hash — collision-free enough for a ~47-entry catalogue
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// loadNeoCity
// ---------------------------------------------------------------------------

/**
 * Fetches manifest.json from `basePath`, then loads each glb piece via
 * `tryLoadScene`. On fetch failure (e.g. unit-test environment, no network)
 * returns an empty library rather than throwing.
 *
 * @param basePath - URL prefix for the neocity model directory.
 *   Defaults to '/models/neocity/'.
 * @param manifestOverride - Optional pre-parsed manifest array for testing
 *   (avoids a real fetch; pieces without URLs are marked scene:null).
 */
export async function loadNeoCity(
  basePath = '/models/neocity/',
  manifestOverride?: ManifestEntry[],
): Promise<NeoLibrary> {
  let entries: ManifestEntry[] = [];

  if (manifestOverride) {
    entries = manifestOverride;
  } else {
    try {
      const res = await fetch(`${basePath}manifest.json`);
      entries = (await res.json()) as ManifestEntry[];
    } catch {
      // No network / unit-test environment → return empty library
      return makeLibrary({});
    }
  }

  // Load all pieces in parallel; failures → null (graceful)
  const loadResults = await Promise.all(
    entries.map(async (entry) => {
      const scene = await tryLoadScene(basePath + entry.file).catch(() => null);
      const piece: NeoPiece = {
        name: entry.name,
        scene,
        bbox: entry.bbox,
        hasEmissive: entry.hasEmissive,
      };
      return { name: entry.name, piece };
    }),
  );

  const piecesRecord: Record<string, NeoPiece> = {};
  for (const { name, piece } of loadResults) {
    piecesRecord[name] = piece;
  }

  return makeLibrary(piecesRecord);
}

// ---------------------------------------------------------------------------
// Internal: factory for NeoLibrary
// ---------------------------------------------------------------------------

function makeLibrary(pieces: Record<string, NeoPiece>): NeoLibrary {
  return {
    pieces,
    get(name: string): THREE.Group | null {
      const piece = pieces[name];
      if (!piece || !piece.scene) return null;

      const clone = piece.scene.clone(true) as THREE.Group;
      // Derive a deterministic rng from the piece name so every call to
      // get('foo') produces the same neon assignment for 'foo'.
      const rng = makeRng(hashName(name));
      applyNeonMaterials(clone, rng);
      return clone;
    },
  };
}
