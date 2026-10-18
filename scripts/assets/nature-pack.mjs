// Pack Blender-authored nature assets and publish manifest entries (same pattern as site-pack.mjs).
//  node scripts/assets/nature-pack.mjs [models|terrain|manifest ...]   (no args = all)
//  models:   .cache/nature/raw/*.glb (trees, hedge, grass, impostors)  -> public/assets/nature/<id>.glb  (KTX2 + meshopt, leaf materials alphaMode MASK 0.42)
//  terrain:  .cache/nature/maps/<palette>/<kind>_{bc,n,orm}.png         -> public/assets/nature/terrain/<palette>/{high,ultra}/<kind>_{bc,n,orm}.ktx2 (2048 / 4096)
//  manifest: nature + village glb entries (additive) -> src/scene/assets/nature.manifest.json and manifest.json
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { boundsOf, io, ktx2Passes, triCount } from './gltf.mjs';
import { encodeTerrain } from './ktx2-terrain.mjs';
import { b3, ROOT } from './lib.mjs';

const KEYS = ['models', 'terrain', 'manifest']; const argv = process.argv.slice(2); const todo = new Set(argv.filter((a) => KEYS.includes(a)).length ? argv.filter((a) => KEYS.includes(a)) : KEYS); const ids = argv.filter((a) => !KEYS.includes(a));
const RAW = join(ROOT, '.cache/nature/raw'), MAPS = join(ROOT, '.cache/nature/maps'), OUT = join(ROOT, 'public/assets/nature'), VIL = join(ROOT, 'public/assets/village');
const nio = await io(); await MeshoptEncoder.ready;
const LEAF = /_leaf$|_imp$|^grass/;

if (todo.has('models')) {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(RAW).filter((n) => n.endsWith('.glb') && (!ids.length || ids.includes(n.slice(0, -4))))) {
    const id = f.slice(0, -4); const doc = await nio.read(join(RAW, f));
    for (const m of doc.getRoot().listMaterials()) {
      if (LEAF.test(m.getName()) || LEAF.test(id)) { if (/leaf|_imp|grass/.test(m.getName())) { m.setAlphaMode('MASK').setAlphaCutoff(0.42).setDoubleSided(true); m.setExtras({ ...m.getExtras(), alphaToCoverage: true, alphaMipCoverage: 'rescale alpha per mip so coverage at cutoff equals mip0 (shader: a = (a - cutoff) / max(fwidth(a), 1e-4) + 0.5 when alphaToCoverage)' }); } }
    }
    const px = Math.max(...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0]))));
    await doc.transform(prune(), ...ktx2Passes(Math.min(2048, px || 1024), 'high'), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await nio.write(join(OUT, f), doc); process.stdout.write('.');
  }
}
if (todo.has('terrain')) await encodeTerrain(MAPS, OUT); // native basisu CLI (see ktx2-terrain.mjs)
if (todo.has('manifest')) {
  const man = {}; const nm = (id) => id.replace(/_/g, ' ');
  const CAT = (id) => (/^(oak|birch|apple|willow|plane|olive|pine|stonepine|cypress|poplar|hedge)/.test(id) ? 'plant' : /^grass/.test(id) ? 'plant' : 'prop');
  const entry = async (root, rel, prefix, tags, extra = {}) => {
    const id = prefix + rel.slice(0, -4); const doc = await nio.read(join(root, rel)); const b = boundsOf(doc); const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(4));
    const lods = doc.getRoot().listMeshes().map((m) => ({ name: m.getName(), tris: Math.round(triCount(m)) })).sort((a, c) => a.name.localeCompare(c.name));
    const l0 = lods.filter((l) => /_LOD0$/.test(l.name) || !/_LOD\d$/.test(l.name)); const r = Math.hypot(...size) / 2; const bytes = statSync(join(root, rel)).size;
    const texBytes = doc.getRoot().listTextures().reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0); const px = Math.max(0, ...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0]))));
    man[id] = { id, category: extra.category ?? CAT(id), tags, hero: false, name: nm(id), bounds: { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)), size }, pivot: 'bottom-center', footprint: { w: size[0], d: size[2], h: size[1] }, radius: +r.toFixed(3),
      lods: [0, 1, 2].map((i) => ({ tris: Math.round(lods.filter((l) => l.name.endsWith('_LOD' + i)).reduce((s, l) => s + l.tris, 0) / Math.max(1, lods.filter((l) => l.name.endsWith('_LOD' + i)).length)) || l0.reduce((s, l) => s + l.tris, 0), dist: [0, +(Math.max(5, r * 8)).toFixed(1), +(Math.max(12, r * 20)).toFixed(1)][i] })),
      surfaces: [], lights: [], shadow: { cast: true, receive: true }, materials: doc.getRoot().listMaterials().length, texPx: px, texBytes,
      source: { page: 'scripts/assets/blender/' + extra.dir, authors: ['Hermod'], license: 'CC0-1.0 (authored here)', res: px + 'px', origin: 'blender', lightmap: false }, tiers: { high: { file: extra.file(rel), bytes, blake3: b3(readFileSync(join(root, rel))) } } };
  };
  for (const f of readdirSync(OUT).filter((n) => n.endsWith('.glb')).sort()) await entry(OUT, f, 'nature_', ['nature', 'exterior', /_imp\.glb$/.test(f) ? 'impostor' : 'authored'], { dir: 'nature', file: (r) => 'nature/' + r });
  for (const f of readdirSync(VIL).filter((n) => n.endsWith('.glb') && !n.includes('.ultra.')).sort()) await entry(VIL, f, 'village_', ['village', 'exterior'], { dir: 'village', file: (r) => 'village/' + r, category: /^(cottage|arcade|board|chat|desk|feed|hearth|skein|signpost|lighthouse|watermill|craft|fisher)/.test(f) ? 'structure' : undefined });
  const mp = join(ROOT, 'src/scene/assets/nature.manifest.json'); const terrain = {};
  if (existsSync(join(OUT, 'terrain'))) for (const pal of readdirSync(join(OUT, 'terrain'))) for (const tier of ['high', 'ultra']) { const d = join(OUT, 'terrain', pal, tier); if (!existsSync(d)) continue; for (const f of readdirSync(d).filter((n) => /\.ktx2$/.test(n))) (terrain[pal + '_' + f.replace(/_(bc|n|orm|flow)\.ktx2$/, '')] ??= { palette: pal, files: {} }).files[tier + ':' + f.match(/_(bc|n|orm|flow)\.ktx2$/)[1]] = `nature/terrain/${pal}/${tier}/${f}`; }
  writeFileSync(mp, JSON.stringify({ schema: 'hermod-assets/1', models: man, terrain }, null, 1) + '\n');
  const fp = join(ROOT, 'src/scene/assets/manifest.json'); const full = JSON.parse(readFileSync(fp, 'utf8')); Object.assign(full.models, man); full.terrainSets = terrain; writeFileSync(fp, JSON.stringify(full, null, 1) + '\n');
  console.log(`\nmanifest: ${Object.keys(man).length} models, ${Object.keys(terrain).length} terrain sets`);
}
