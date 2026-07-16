/**
 * process-kitbash.mjs
 *
 * Offline pipeline: KitBash3D NeoCity OBJ → per-piece DRACO-compressed GLB files.
 *
 * Strategy:
 *   1. Convert the whole OBJ → a single GLB with obj2gltf (once, ~25s).
 *   2. Load the GLB with @gltf-transform/core (instant).
 *   3. For each of the 47 named pieces: clone the document, dispose all other
 *      scene children, then:
 *      a. Classify each primitive as BODY or EMISSIVE by material name.
 *      b. Bake baseColorFactor → vertex COLOR_0 on each primitive (so tonal
 *         variety survives the merge into a shared material).
 *      c. Manually concatenate all BODY prim positions into ONE primitive,
 *         and all EMISSIVE prim positions into ONE primitive.
 *         Result: ≤2 primitives per piece, named NEO_BODY / NEO_EMISSIVE.
 *      d. weld → simplify (meshopt 0.5) → dedup → DRACO → write GLB.
 *   4. Record bbox + hasEmissive from each piece's scene bounds.
 *   5. Write manifest.json.
 *
 * Usage:
 *   node tools/process-kitbash.mjs [path/to/kb3d_neocity-native.obj]
 *
 * Outputs:
 *   public/models/neocity/<PieceName>.glb   (one per OBJ `o` object)
 *   public/models/neocity/manifest.json     (array of { name, file, bbox, hasEmissive })
 */

import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { NodeIO, Document, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  cloneDocument, getBounds, weld, dedup, prune, draco, simplify,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_OBJ = path.join(
  os.homedir(),
  'Downloads',
  'Cyber Assets',
  'Cyber kitbash',
  'kb3d_neocity-native.obj'
);

const srcObj = process.argv[2]
  ? path.resolve(process.argv[2].replace(/^~/, os.homedir()))
  : DEFAULT_OBJ;

const outDir = path.resolve(__dirname, '..', 'public', 'models', 'neocity');

// ---------------------------------------------------------------------------
// Emissive classification: material name substrings (case-insensitive)
// Matches: Light*, Glass*, Banner*, Letters, Neon*, Decal*, Screens
// ---------------------------------------------------------------------------
const EMISSIVE_PATTERNS = [
  'light',    // LightBlue, LightRed, LightWhite, LightYellow, LightsA
  'glass',    // GlassTinted, GlassLamps, GlassBlack, GlassBottle
  'banner',   // BannerA
  'letters',  // Letters
  'neon',     // NeonSign*
  'decal',    // DecalSheet
  'screen',   // Screens
];

/**
 * Returns true if the material name indicates emissive/glass/neon intent.
 */
function isEmissiveMaterial(matName) {
  if (!matName) return false;
  const lower = matName.toLowerCase();
  return EMISSIVE_PATTERNS.some(p => lower.includes(p));
}

/**
 * Extract all vertex positions from a primitive, resolving indices if present.
 * Returns a flat Float32Array of [x0,y0,z0, x1,y1,z1, ...].
 */
function extractPositions(prim) {
  const posAccessor = prim.getAttribute('POSITION');
  if (!posAccessor) return new Float32Array(0);

  const indexAccessor = prim.getIndices();
  if (indexAccessor) {
    // Indexed — dereference indices
    const indices = indexAccessor.getArray();
    const posArray = posAccessor.getArray();
    const out = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      const vi = indices[i];
      out[i * 3 + 0] = posArray[vi * 3 + 0];
      out[i * 3 + 1] = posArray[vi * 3 + 1];
      out[i * 3 + 2] = posArray[vi * 3 + 2];
    }
    return out;
  } else {
    // Non-indexed — positions already sequential
    return new Float32Array(posAccessor.getArray());
  }
}

/**
 * Build one merged primitive from a list of classified primitives.
 * Each input prim may have different attributes; we only keep POSITION + COLOR_0.
 * Colors come from the per-prim material baseColorFactor.
 *
 * @param {Array<{prim: Primitive, color: number[]}>} entries
 * @param {Document} doc
 * @param {Material} material  The NEO_BODY or NEO_EMISSIVE material
 * @returns {Primitive|null}
 */
function buildMergedPrimitive(entries, doc, material) {
  if (entries.length === 0) return null;

  // Collect all position data, dereferencing indices
  const posChunks = [];
  let totalVerts = 0;

  for (const { prim, color: _color } of entries) {
    const pos = extractPositions(prim);
    posChunks.push(pos);
    totalVerts += pos.length / 3;
  }

  if (totalVerts === 0) return null;

  const mergedPos = new Float32Array(totalVerts * 3);
  const mergedColor = new Float32Array(totalVerts * 4);
  let offset = 0;

  for (const { prim, color } of entries) {
    const pos = extractPositions(prim);
    const vertCount = pos.length / 3;
    mergedPos.set(pos, offset * 3);
    for (let vi = 0; vi < vertCount; vi++) {
      mergedColor[(offset + vi) * 4 + 0] = color[0];
      mergedColor[(offset + vi) * 4 + 1] = color[1];
      mergedColor[(offset + vi) * 4 + 2] = color[2];
      mergedColor[(offset + vi) * 4 + 3] = color[3];
    }
    offset += vertCount;
  }

  // Create accessors
  const posAccessor = doc.createAccessor()
    .setArray(mergedPos)
    .setType(Accessor.Type.VEC3);
  const colorAccessor = doc.createAccessor()
    .setArray(mergedColor)
    .setType(Accessor.Type.VEC4)
    .setNormalized(false);

  const merged = doc.createPrimitive()
    .setMode(4) // TRIANGLES
    .setMaterial(material)
    .setAttribute('POSITION', posAccessor)
    .setAttribute('COLOR_0', colorAccessor);

  return merged;
}

// ---------------------------------------------------------------------------
// Step 0 – Validate source
// ---------------------------------------------------------------------------
if (!fs.existsSync(srcObj)) {
  console.error(`ERROR: source OBJ not found: ${srcObj}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

console.log(`Source OBJ : ${srcObj}`);
console.log(`Output dir : ${outDir}\n`);

// ---------------------------------------------------------------------------
// Step 1 – Convert whole OBJ → single GLB (in-memory)
// ---------------------------------------------------------------------------
console.log('[1/4] Converting OBJ → GLB (whole kit, ~25s) ...');
const obj2gltf = require('obj2gltf');

let fullGlbBuffer;
{
  const t0 = Date.now();
  fullGlbBuffer = await obj2gltf(srcObj, {
    binary: true,
    unlit: true,
    checkTransparency: false,
    // Missing textures produce warnings on stderr; they are non-fatal and expected.
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  Done in ${elapsed}s, GLB size: ${(fullGlbBuffer.length / 1024 / 1024).toFixed(1)} MB\n`);
}

// ---------------------------------------------------------------------------
// Step 2 – Load full GLB into gltf-transform
// ---------------------------------------------------------------------------
console.log('[2/4] Loading GLB into gltf-transform ...');

const encoderModule = await draco3d.createEncoderModule({});
const decoderModule = await draco3d.createDecoderModule({});

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.encoder': encoderModule,
    'draco3d.decoder': decoderModule,
  });

// readBinary expects Uint8Array
const masterDoc = await io.readBinary(new Uint8Array(fullGlbBuffer));
// Free the raw buffer — we no longer need it
fullGlbBuffer = null;

const masterRoot = masterDoc.getRoot();
const masterScene = masterRoot.listScenes()[0];
const masterNodes = masterScene.listChildren();

console.log(`  Found ${masterNodes.length} scene children (should be 47)\n`);

// ---------------------------------------------------------------------------
// Step 3 – Per-piece split + classify + bake + merge + optimize + write
// ---------------------------------------------------------------------------
console.log('[3/4] Splitting and compressing each piece ...\n');

const manifest = [];
let totalBytes = 0;
const results = [];
let maxPrimCount = 0;

for (let i = 0; i < masterNodes.length; i++) {
  const srcNode = masterNodes[i];
  const name = srcNode.getName();
  const label = `[${String(i + 1).padStart(2, '0')}/${masterNodes.length}] ${name}`;

  // Clone the full document (cheap — just graph copy, no I/O)
  const pieceDoc = cloneDocument(masterDoc);
  const pieceScene = pieceDoc.getRoot().listScenes()[0];

  // Remove all scene children except the one we want
  for (const ch of pieceScene.listChildren()) {
    if (ch.getName() !== name) {
      ch.dispose();
    }
  }

  // Compute bbox BEFORE further transforms (original geometry)
  let bbox = [0, 0, 0];
  try {
    const remaining = pieceScene.listChildren();
    if (remaining.length > 0) {
      const bounds = getBounds(pieceScene);
      const w = bounds.max[0] - bounds.min[0];
      const h = bounds.max[1] - bounds.min[1];
      const d = bounds.max[2] - bounds.min[2];
      bbox = [
        parseFloat(w.toFixed(4)),
        parseFloat(h.toFixed(4)),
        parseFloat(d.toFixed(4)),
      ];
    }
  } catch (_) {
    // leave as zeros
  }

  // --- Prune orphaned data BEFORE classify (dispose only removed scene refs) ---
  try {
    await pieceDoc.transform(prune());
  } catch (err) {
    console.warn(`  ${label}  WARN prune failed: ${err.message}`);
  }

  // --- Classify each primitive as BODY or EMISSIVE ---
  let hasEmissive = false;
  const bodyEntries = [];    // [{prim, color}]
  const emissiveEntries = []; // [{prim, color}]

  try {
    const pieceRoot = pieceDoc.getRoot();

    for (const mesh of pieceRoot.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        const matName = mat ? mat.getName() : '';
        const color = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1.0];

        if (isEmissiveMaterial(matName)) {
          emissiveEntries.push({ prim, color });
        } else {
          bodyEntries.push({ prim, color });
        }
      }
    }
    hasEmissive = emissiveEntries.length > 0;
  } catch (err) {
    console.warn(`  ${label}  WARN classify failed: ${err.message}`);
  }

  // --- Build merged document with ≤2 prims ---
  try {
    const pieceRoot = pieceDoc.getRoot();

    // Create bucket materials
    const bodyMat = pieceDoc.createMaterial('NEO_BODY')
      .setBaseColorFactor([0.8, 0.8, 0.8, 1.0])
      .setRoughnessFactor(1.0)
      .setMetallicFactor(0.0);

    const emissiveMat = pieceDoc.createMaterial('NEO_EMISSIVE')
      .setBaseColorFactor([1.0, 1.0, 1.0, 1.0])
      .setEmissiveFactor([1.0, 1.0, 1.0])
      .setRoughnessFactor(1.0)
      .setMetallicFactor(0.0);

    // Build merged primitives
    const bodyPrim = buildMergedPrimitive(bodyEntries, pieceDoc, bodyMat);
    const emissivePrim = buildMergedPrimitive(emissiveEntries, pieceDoc, emissiveMat);

    // Create a fresh mesh with the merged prim(s)
    const mergedMesh = pieceDoc.createMesh(`${name}-Mesh`);
    if (bodyPrim) mergedMesh.addPrimitive(bodyPrim);
    if (emissivePrim) mergedMesh.addPrimitive(emissivePrim);

    // Dispose all old meshes
    for (const mesh of pieceRoot.listMeshes()) {
      if (mesh !== mergedMesh) {
        mesh.dispose();
      }
    }

    // Attach to scene node
    const pieceNode = pieceScene.listChildren()[0];
    if (pieceNode) {
      pieceNode.setMesh(mergedMesh);
    }

  } catch (err) {
    console.warn(`  ${label}  WARN merge failed: ${err.message}`);
  }

  // --- Optimize: prune → weld → simplify → dedup → DRACO ---
  let primCountAfter = '?';
  try {
    await pieceDoc.transform(
      prune(),
      weld({ tolerance: 1e-4 }),
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.01 }),
      dedup(),
      draco({ quantizationVolume: 'scene' }),
    );
    // Count primitives after merge
    const meshes = pieceDoc.getRoot().listMeshes();
    primCountAfter = meshes.reduce((s, m) => s + m.listPrimitives().length, 0);
    if (primCountAfter > maxPrimCount) maxPrimCount = primCountAfter;
  } catch (err) {
    console.warn(`  ${label}  WARN optimize failed: ${err.message}`);
  }

  // Write output GLB
  const outFile = path.join(outDir, `${name}.glb`);
  let outBytes;
  try {
    const glb = await io.writeBinary(pieceDoc);
    outBytes = glb;
    fs.writeFileSync(outFile, Buffer.from(glb));
  } catch (err) {
    console.warn(`  ${label}  WARN write failed: ${err.message} — skipping`);
    continue;
  }

  const fileSize = outBytes.byteLength;
  totalBytes += fileSize;
  const kb = (fileSize / 1024).toFixed(1);

  manifest.push({
    name,
    file: `neocity/${name}.glb`,
    bbox,
    hasEmissive,
  });
  results.push({ name, kb: parseFloat(kb), prims: primCountAfter, hasEmissive });

  const emissiveTag = hasEmissive ? ' [emissive]' : '';
  console.log(`  ${label}  ${String(kb).padStart(8)} KB  prims=${primCountAfter}${emissiveTag}  bbox=[${bbox.join(', ')}]`);
}

// ---------------------------------------------------------------------------
// Step 4 – Write manifest
// ---------------------------------------------------------------------------
console.log('\n[4/4] Writing manifest.json ...');
const manifestPath = path.join(outDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const totalKB = (totalBytes / 1024).toFixed(1);
const totalMB = (totalBytes / 1024 / 1024).toFixed(3);
results.sort((a, b) => b.kb - a.kb);

console.log('\n=== Summary ===');
console.log(`  Pieces processed : ${manifest.length} / ${masterNodes.length}`);
console.log(`  Total size       : ${totalKB} KB (${totalMB} MB)`);
console.log(`  Max prims/piece  : ${maxPrimCount}  (target ≤ 2)`);
console.log(`  Pieces w/ emissive: ${manifest.filter(m => m.hasEmissive).length}`);
console.log(`  Largest pieces:`);
for (const r of results.slice(0, 8)) {
  const tag = r.hasEmissive ? ' [E]' : '    ';
  console.log(`    ${r.name.padEnd(50)} ${String(r.kb).padStart(8)} KB  prims=${r.prims}${tag}`);
}
console.log(`\n  Output dir : ${outDir}`);
console.log(`  Manifest   : ${manifestPath}`);

if (totalBytes > 8 * 1024 * 1024) {
  console.warn(`\n  WARNING: total size ${totalMB} MB exceeds 8 MB target!`);
} else {
  console.log(`\n  Total is within 8 MB target.`);
}

console.log('\nDone.');
