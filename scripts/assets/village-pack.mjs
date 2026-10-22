// KTX2 + meshopt pack of the Blender village glbs in place: public/assets/village/<id>[.ultra].glb (webp from scripts/assets/blender/village/build.py) ->
// UASTC normals, ETC1S colour/ORM, mipmaps. Skips files that are already KTX2. Usage: node scripts/assets/village-pack.mjs [id ...]   (BLENDER=/path/to/blender pins the binary)
// GATE: before anything is packed, every file about to be packed is run through scripts/assets/blender/village/check.py in Blender (node contract, LOD bands, UV overlap,
// texel density, degenerate faces) on a geometry-only copy of the unpacked float data (packing quantises UVs, which would fake degenerate faces). Any failure exits 1
// and leaves public/assets/village untouched.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { dropDegenerate, io, ktx2Cli, ktx2Passes, triCount } from './gltf.mjs';
import { ROOT } from './lib.mjs';
const DIR = join(ROOT, 'public/assets/village'); const only = process.argv.slice(2); const nio = await io(); await MeshoptEncoder.ready; const rep = [];
const isKtx2 = (doc) => doc.getRoot().listTextures().every((t) => t.getMimeType() === 'image/ktx2'); // LOD0 stays webp when only the LODs were packed
const idOf = (f) => f.replace(/(\.ultra)?\.glb$/, '');
const maxPx = (doc) => Math.max(0, ...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0]))));

// ---- gate: stage geometry-only copies of the files to pack, check them, abort before touching anything on failure
const todo = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.glb')).sort()) { if (only.length && !only.includes(idOf(f))) continue; const doc = await nio.read(join(DIR, f)); if (!isKtx2(doc)) todo.push({ f, px: maxPx(doc), packed: doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression') }); }
const gate = todo.filter((t) => !t.packed); // geometry already meshopt-quantised (texture-only repack): check.py needs float data, so it is not re-run
if (gate.length) {
  const GEO = join(ROOT, '.cache/village-check'); rmSync(GEO, { recursive: true, force: true }); mkdirSync(GEO, { recursive: true });
  for (const { f } of gate) { const doc = await nio.read(join(DIR, f)); for (const t of doc.getRoot().listTextures()) t.dispose(); for (const e of doc.getRoot().listExtensionsUsed()) e.dispose(); await nio.write(join(GEO, f), doc); }
  writeFileSync(join(GEO, 'px.json'), JSON.stringify(Object.fromEntries(gate.map((t) => [t.f, t.px || 1024]))));
  const r = spawnSync(process.env.BLENDER || 'blender', ['-b', '--factory-startup', '-P', join(ROOT, 'scripts/assets/blender/village/check.py'), '--', ...gate.map((t) => t.f.slice(0, -4))], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, VILLAGE_ASSET_OUT: GEO } });
  const lines = (r.stdout ?? '').split('\n').filter((l) => /^(PASS|FAIL) /.test(l)); const bad = lines.filter((l) => l.startsWith('FAIL'));
  if (r.error || lines.length !== gate.length) { console.error(`check.py did not complete (${lines.length}/${gate.length}): ${r.error?.message ?? (r.stdout + r.stderr).split('\n').filter((l) => /Error|Traceback/.test(l)).slice(0, 6).join('\n')}`); process.exit(1); }
  if (existsSync(join(GEO, 'check-report.json'))) copyFileSync(join(GEO, 'check-report.json'), join(DIR, 'check-report.json'));
  console.log(`check.py: ${lines.length - bad.length}/${lines.length} pass`);
  if (bad.length) { for (const l of bad) console.log(l.replace(/ \| \{.*?\} \|/, ' |')); console.error('village-pack: check failed, nothing packed'); process.exit(1); }
}

for (const { f, px, packed } of todo) {
  const doc = await nio.read(join(DIR, f)); const ultra = f.includes('.ultra.');
  if (!packed) dropDegenerate(doc, 1e-9);
  const cap = Math.min(ultra ? 4096 : 2048, px || 1024); await doc.transform(prune());
  if (cap > 3072) await ktx2Cli(doc, cap); else await doc.transform(...ktx2Passes(cap, ultra ? 'ultra' : 'high')); // the wasm encoder fails above ~12 Mpix (4096 heroes): native basisu there
  if (!packed) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await nio.write(join(DIR, f), doc); rep.push({ id: f.slice(0, -4), tris: doc.getRoot().listMeshes().map((m) => Math.round(triCount(m))), kb: Math.round(statSync(join(DIR, f)).size / 1024), px }); process.stdout.write('.');
}
console.log(`\npacked ${rep.length} glb`); if (rep.length) writeFileSync(join(DIR, 'pack-report.json'), JSON.stringify(rep, null, 1));
