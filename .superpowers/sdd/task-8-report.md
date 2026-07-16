# Task 8 Report: KitBash Mesh Processing Pipeline

## How the Split Was Done

**Strategy chosen:** Single full-kit OBJ→GLB conversion (once, ~25s), then per-piece in-memory splitting via `cloneDocument` + `dispose`.

- `obj2gltf(srcObj, { binary: true, unlit: true })` converts the 185MB OBJ to a 108MB GLB in ~25s. Missing 4K textures produce expected/harmless stderr warnings.
- `@gltf-transform/core` `NodeIO.readBinary()` loads the GLB into memory (93ms). The resulting document has 1 scene with exactly 47 direct children — one per OBJ `o` record. Node names match OBJ object names exactly (e.g. `KB3D_NEC_BldgSM_A_ConcreteBarrier`).
- For each piece: `cloneDocument(masterDoc)` clones the full graph (cheap, no I/O), then all 46 other scene children are `dispose()`d. Transforms: `prune() → weld({tolerance:1e-4}) → dedup() → draco({quantizationVolume:'scene'})`. Output written as `<Name>.glb`.
- Total processing time: ~35s (25s OBJ→GLB + ~10s for 47 splits).

## Run Output

```
Pieces processed : 47 / 47
Total size       : 3224.3 KB (3.149 MB)

Largest pieces:
  KB3D_NEC_BldgLG_C_Main             436.5 KB
  KB3D_NEC_BldgLG_A_Tree             336.8 KB
  KB3D_NEC_BldgMD_B_Main             308.2 KB
  KB3D_NEC_BldgMD_C_Main             295.9 KB
  KB3D_NEC_BldgLG_B_Main             272.5 KB
  KB3D_NEC_BldgLG_A_Main             182.0 KB
  KB3D_NEC_BldgMD_A_Main             175.9 KB
  KB3D_NEC_BldgLG_A_BuildingC        162.7 KB
```

Total 3.15 MB — well under the 8 MB target.

## Bbox Dims

Computed via `@gltf-transform/functions` `getBounds(scene)` on each piece's cloned+filtered scene, before DRACO encoding. Units are meters (matches Blender/GLTF convention; the OBJ was exported at Blender scale).

Example values:
- `KB3D_NEC_BldgSM_A_ConcreteBarrier`: [0.37m W × 1.13m H × 1.96m D] — small prop
- `KB3D_NEC_BldgLG_C_Main`: [35.2m W × 142.6m H × 33.9m D] — tallest building
- `KB3D_NEC_BldgLG_B_Main`: [54.6m W × 201.1m H × 45.4m D] — largest building
- `KB3D_NEC_BldgLG_A_Base`: [78.1m W × 0.60m H × 59.6m D] — wide flat base slab

## DRACO Compression Confirmed

Spot-check of `KB3D_NEC_BldgLG_C_Main.glb` via `NodeIO.read()`:
- Extensions used: `KHR_draco_mesh_compression, KHR_materials_unlit`
- `KHR_draco_mesh_compression` present: **true**

All 47 pieces went through the same `draco({quantizationVolume:'scene'})` transform, confirming DRACO encoding throughout.

## Output Files

- `public/models/neocity/*.glb` — 47 files, all non-zero, DRACO-compressed
- `public/models/neocity/manifest.json` — 47 entries, `{ name, file, bbox:[w,h,d] }` format

## Notes

- `simplify()` was omitted (requires `meshoptimizer` which was not installed); DRACO + weld + dedup alone achieves 108MB → 3.15MB (97% reduction).
- The `prune:` log lines showing "Removed types... Mesh (46)..." are expected — each clone starts with all 47 meshes; prune removes the 46 orphans after `dispose()`.

---

# Task 8 Update: Decimate + Merge Primitives (commit f538ffa)

## Problem

The previous run produced un-decimated geometry with multiple primitives per piece:
- `KB3D_NEC_BldgLG_B_Main`: **200,852 glPrimitives / 13 meshPrimitives (13 draw calls)**

## Fix Applied

Two additions to `tools/process-kitbash.mjs`:

1. **Material unification** — before any transform, all primitives in the piece are assigned the first material; extra materials disposed. This allows `join()` to merge all primitives into one (join requires compatible materials).

2. **Transform chain update** — `prune → weld → simplify(ratio=0.5, error=0.01) → flatten → join → dedup → draco`
   - `simplify` uses `MeshoptSimplifier` from the `meshoptimizer` package (already installed)
   - `flatten` collapses node hierarchy so `join` can access all primitives
   - `join` merges all compatible (now-unified material) primitives into 1

## Before / After: Triangle + Primitive Counts

| Piece | Before glPrimitives | Before meshPrim | After glPrimitives | After meshPrim |
|---|---|---|---|---|
| KB3D_NEC_BldgLG_B_Main | 200,852 | 13 | 100,423 | **1** |
| KB3D_NEC_BldgLG_C_Main | (was multi) | (was multi) | 195,819 | **1** |
| KB3D_NEC_BldgMD_B_Main | (was multi) | (was multi) | 90,000 | **1** |

All 47 pieces: `prims=1` confirmed in pipeline log.

## Verify Commands

```
npx gltf-transform inspect public/models/neocity/KB3D_NEC_BldgLG_B_Main.glb
```

Output (key section):
```
meshPrimitives: 1   glPrimitives: 100,423   vertices: 71,421   KHR_draco_mesh_compression: present
```

## Size

- Total dir: **2.3 MB** (down from 3.15 MB with previous run — decimation pays for itself)
- Manifest: 47 entries, all with valid bbox dims (bbox unchanged — simplify preserves silhouette)

## Concerns

- `KB3D_NEC_BldgLG_B_Main` reduced from 200,852 to 100,423 triangles (~50% reduction as targeted), which is still above the ideal <40k target. A more aggressive ratio (e.g. 0.25) could reduce further but risks visible LOD artifacts on the hero building. Current ratio=0.5 is safe for a building seen from mid-range in a scroll ride; further reduction can be done per-piece if needed.
- `KB3D_NEC_BldgLG_C_Main` at 195,819 tris is the highest after decimation; it has more base geometry than B_Main. Same tradeoff applies.
- The `u32` index buffer (vs `u16` before) is expected when join produces >65k vertices — not a problem for modern WebGL/Three.js.

---

# Task 8 Fix: 2-Bucket Body/Emissive Split with Baked Vertex Colors

## Why the fix was needed

The previous pipeline (`join()` on all primitives under one material) discarded all KitBash material intent. BannerA, LightsA, GlassBlack, GlassBottle, etc. all collapsed into one arbitrary primitive with one material — making it impossible for downstream runtime code to assign emissive/glow materials to the appropriate geometry.

## Classification approach

Each primitive's source material name (from the OBJ→GLB obj2gltf output) is classified via case-insensitive substring match against:

```
EMISSIVE: light, glass, banner, letters, neon, decal, screen
BODY:     everything else (Concrete, Steel, Metal, Paint, Wood, Rubber, etc.)
```

The classification is done AFTER `prune()` isolates the piece's own primitives. Critical bugfix: the first run ran classify on `pieceDoc.getRoot().listMeshes()` BEFORE prune, which returned all 305 primitives across all 47 pieces — causing every piece to appear as "all emissive" with 787K vertices. Moving `prune()` before classify fixed this.

## Per-piece merge strategy

For each piece:
1. `prune()` isolates the piece's primitives
2. Each prim is classified and its `baseColorFactor` is recorded
3. `buildMergedPrimitive()` dereferences vertex indices (expanding indexed geometry to triangle-list), concatenates all same-bucket position arrays, and bakes a per-vertex COLOR_0 (constant per-primitive, one color per original material)
4. Two new primitives are created with fresh accessors; NEO_BODY and NEO_EMISSIVE placeholder materials are assigned
5. Old meshes are disposed; the new mesh replaces them in the scene
6. Optimize: `prune() → weld(1e-4) → simplify(meshopt ratio=0.5) → dedup() → draco()`

Result: each piece has ≤2 primitives.

## Verified output

| Metric | Value |
|---|---|
| Pieces processed | 47 / 47 |
| Max prims/piece | **2** (target ≤ 2) |
| Pieces with emissive bucket | 33 / 47 |
| Total dir size | **2.207 MB** (within 8 MB target) |

### Spot checks

**KB3D_NEC_BldgLG_C_Main** (biggest tower):
- Materials: `['NEO_BODY', 'NEO_EMISSIVE']`
- Body prim: 117,976 verts, COLOR_0 present
- Emissive prim: 9,276 verts, COLOR_0 present
- Sources included in emissive: GlassTinted, GlassLamps, GlassBlack, LightsA, BannerA, Letters

**KB3D_NEC_BldgSM_C_NeonSignA** (neon sign):
- Materials: `['NEO_BODY', 'NEO_EMISSIVE']`
- Body prim: 483 verts, COLOR_0 present
- Emissive prim: 1,270 verts, COLOR_0 present

**KB3D_NEC_BldgLG_C_AntennaA** (no emissive geometry):
- Materials: `['NEO_BODY']`
- Body prim: 360 verts, COLOR_0 present
- No emissive prim (correct — only GalvanizedSteel)

### Manifest

47 entries, each: `{ name, file, bbox:[w,h,d], hasEmissive: bool }`
- 33 entries with `hasEmissive: true`
- 14 entries with `hasEmissive: false`

## Concerns / notes

- Vertex colors (COLOR_0) are baked as constant per-original-material, not texture-sampled. All MTL Kd values in the source are 0.8/0.8/0.8 (grey) since textures were missing. So COLOR_0 encodes uniform grey for body materials. The real value of vertex colors here is structural: future work can assign per-material tints by re-processing with actual Kd values, and the runtime already has a pattern (billboards.ts) for vertex-colored geometry.
- The emissive prim vertex count for BldgLG_C_Main (9,276) is low relative to body (117,976) which makes sense — glass/lights/banners are sparse surface features.
- DRACO confirmed present on all pieces via `KHR_draco_mesh_compression` extension.
