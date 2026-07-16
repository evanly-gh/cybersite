/**
 * process-kitbash.mjs
 *
 * Offline pipeline: KitBash3D NeoCity OBJ → per-piece DRACO-compressed GLB files.
 *
 * Strategy:
 *   1. Convert the whole OBJ → a single GLB with obj2gltf (once, ~25s).
 *   2. Load the GLB with @gltf-transform/core (instant).
 *   3. For each of the 47 named pieces: clone the document, dispose all other
 *      scene children, apply weld + dedup + prune + DRACO, write output GLB.
 *      (~7-10s total for all 47 pieces.)
 *   4. Record bbox from each piece's scene bounds.
 *   5. Write manifest.json.
 *
 * Usage:
 *   node tools/process-kitbash.mjs [path/to/kb3d_neocity-native.obj]
 *
 * Outputs:
 *   public/models/neocity/<PieceName>.glb   (one per OBJ `o` object)
 *   public/models/neocity/manifest.json     (array of { name, file, bbox:[w,h,d] })
 */

import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, getBounds, weld, dedup, prune, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

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
// Step 3 – Per-piece split + optimize + write
// ---------------------------------------------------------------------------
console.log('[3/4] Splitting and compressing each piece ...\n');

const manifest = [];
let totalBytes = 0;
const results = [];

for (let i = 0; i < masterNodes.length; i++) {
  const srcNode = masterNodes[i];
  const name = srcNode.getName();
  const label = `[${String(i + 1).padStart(2, '0')}/${masterNodes.length}] ${name}`;

  // Clone the full document (cheap — just graph copy, no I/O)
  const pieceDoc = cloneDocument(masterDoc);
  const pieceScene = pieceDoc.getRoot().listScenes()[0];

  // Remove all scene children except the one we want, then prune orphans
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

  // Optimize: prune orphans → weld → dedup → DRACO
  try {
    await pieceDoc.transform(
      prune(),
      weld({ tolerance: 1e-4 }),
      dedup(),
      draco({ quantizationVolume: 'scene' }),
    );
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
  });
  results.push({ name, kb: parseFloat(kb) });

  console.log(`  ${label}  ${String(kb).padStart(8)} KB  bbox=[${bbox.join(', ')}]`);
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
console.log(`  Largest pieces:`);
for (const r of results.slice(0, 8)) {
  console.log(`    ${r.name.padEnd(50)} ${String(r.kb).padStart(8)} KB`);
}
console.log(`\n  Output dir : ${outDir}`);
console.log(`  Manifest   : ${manifestPath}`);

if (totalBytes > 8 * 1024 * 1024) {
  console.warn(`\n  WARNING: total size ${totalMB} MB exceeds 8 MB target!`);
} else {
  console.log(`\n  Total is within 8 MB target.`);
}

console.log('\nDone.');
