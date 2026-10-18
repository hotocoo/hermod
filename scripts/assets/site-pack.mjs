// KTX2 pack for the sanctuary glb set: assets/cache/site-src/*.glb (webp, from scripts/assets/blender/landmarks/build.py) -> public/assets/site/*.glb
// (UASTC normals, ETC1S colour / metal-rough / lightmap occlusion, mipmaps) + a QA/budget report. Usage: node scripts/assets/site-pack.mjs [id ...]
import { readdirSync, mkdirSync, copyFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { boundsOf, dropDegenerate, io, ktx2Passes, triCount } from './gltf.mjs';
import { ROOT } from './lib.mjs';

const SRC = join(ROOT, 'assets/cache/site-src'), OUT = join(ROOT, 'public/assets/site'), BASIS = join(ROOT, 'public/basis');
mkdirSync(OUT, { recursive: true }); mkdirSync(BASIS, { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) copyFileSync(join(ROOT, 'node_modules/three/examples/jsm/libs/basis', f), join(BASIS, f));
const only = process.argv.slice(2); const ids = readdirSync(SRC).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).filter((i) => !only.length || only.includes(i));
const rep = []; const nio = await io(); const man = {};
for (const id of ids) {
  const doc = await nio.read(join(SRC, id + '.glb')); const px = Math.max(...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0]))));
  dropDegenerate(doc, 1e-7);
  await doc.transform(...ktx2Passes(Math.min(2048, px || 1024), 'high'));
  await nio.write(join(OUT, id + '.glb'), doc);
  const tris = doc.getRoot().listMeshes().map((m) => triCount(m));
  const b = boundsOf(doc); const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3)); const kb = statSync(join(OUT, id + '.glb')).size;
  man['site_' + id] = { id: 'site_' + id, category: 'architecture', tags: ['sanctuary', 'exterior'], hero: tris[0] >= 600, name: id.replace(/_/g, ' '), bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)), size }, pivot: 'footprint-centre', footprint: { w: size[0], d: size[2], h: size[1] }, radius: +(Math.hypot(...size) / 2).toFixed(3), lods: tris.map((t, i) => ({ tris: Math.round(t), dist: [0, 34, 72][i] ?? 100 })), surfaces: [], lights: [], shadow: { cast: true, receive: true }, materials: 1, texPx: px, source: { origin: 'site', license: 'CC0-1.0', authors: ['Hermod'], lightmap: true, page: 'scripts/assets/blender/landmarks', res: 'authored' }, tiers: { high: { file: 'site/' + id + '.glb', root: 'assets', bytes: kb } } };
  rep.push({ id, tris, kb: Math.round(statSync(join(OUT, id + '.glb')).size / 1024), textures: doc.getRoot().listTextures().length, px }); process.stdout.write('.');
}
const prev = existsSync(join(OUT, 'pack-report.json')) ? JSON.parse((await import('node:fs')).readFileSync(join(OUT, 'pack-report.json'), 'utf8')) : [];
const m = new Map(prev.map((r) => [r.id, r])); rep.forEach((r) => m.set(r.id, r)); writeFileSync(join(OUT, 'pack-report.json'), JSON.stringify([...m.values()], null, 1));
console.log(`\npacked ${rep.length} glb, ${rep.reduce((s, r) => s + r.kb, 0)} KB`);

{ const mp = join(ROOT, 'src/scene/assets/site.manifest.json'); const old = existsSync(mp) ? JSON.parse((await import('node:fs')).readFileSync(mp, 'utf8')).models : {};
  const models = { ...old, ...man }; writeFileSync(mp, JSON.stringify({ schema: 'hermod-assets/1', models }, null, 1) + '\n');
  const fp = join(ROOT, 'src/scene/assets/manifest.json'); const { readFileSync } = await import('node:fs'); const full = JSON.parse(readFileSync(fp, 'utf8')); Object.assign(full.models, models); writeFileSync(fp, JSON.stringify(full, null, 1) + '\n'); }
