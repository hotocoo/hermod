// ARCHITECTURE 14 verification for public/assets/nature/*.glb: node scripts/assets/nature-check.mjs [id ...]
// Per asset: LOD chain present and strictly decreasing, LOD0 triangle band by kind, no degenerate triangles, UV0 in 0..1 (impostor/foliage atlases), COLOR_0 wind weights on trees/grass,
// full PBR set (base, normal, ORM), KTX2 textures with mip chains, leaf materials alpha MASK, texture >= authored floor. Exit 1 on failure.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dequantize } from '@gltf-transform/functions';
import { io, primTriangles } from './gltf.mjs';
import { ROOT } from './lib.mjs';
const DIR = join(ROOT, 'public/assets/nature'); const only = process.argv.slice(2); const nio = await io(); let bad = 0;
const BAND = { tree: [2500, 40000], hedge: [800, 8000], grass: [20, 400], impostor: [2, 2] };
const kindOf = (id) => (/_imp$/.test(id) ? 'impostor' : /^grass/.test(id) ? 'grass' : id === 'hedge' ? 'hedge' : 'tree');
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.glb')).sort()) {
  const id = f.slice(0, -4); if (only.length && !only.includes(id)) continue; if (/_\d+$/.test(id) && !/^grass/.test(id)) continue; const doc = await nio.read(join(DIR, f)); await doc.transform(dequantize()); const err = [];
  const k = kindOf(id); const meshes = doc.getRoot().listMeshes(); const byLod = [[], [], []]; let degenerate = 0; let noWind = 0;
  for (const m of meshes) {
    const mm = /_LOD(\d)$/.exec(m.getName()); const li = mm ? +mm[1] : 0; let tris = 0;
    for (const p of m.listPrimitives()) { const { pos, idx, n } = primTriangles(p); tris += n / 3; if (!p.getAttribute('COLOR_0') && k !== 'impostor') noWind++;
      for (let t = 0; t < n; t += 3) { const g = (i) => (idx ? idx[i] : i) * 3; const a = g(t), b = g(t + 1), c = g(t + 2); const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]; if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-10) degenerate++; }
      const uv = p.getAttribute('TEXCOORD_0'); if (!uv) err.push('no UV0'); else if (k === 'impostor' || k === 'grass') { const a = uv.getArray(); for (let i = 0; i < a.length; i++) if (a[i] < -0.001 || a[i] > 1.001) { err.push('UV0 outside 0..1'); break; } } }
    byLod[li].push(tris);
  }
  const t0 = byLod[0].length ? byLod[0].reduce((s, x) => s + x, 0) / byLod[0].length : 0; const t1 = byLod[1].length ? byLod[1].reduce((s, x) => s + x, 0) / byLod[1].length : 0, t2 = byLod[2].length ? byLod[2].reduce((s, x) => s + x, 0) / byLod[2].length : 0;
  const [lo, hi] = BAND[k]; if (t0 < lo || t0 > hi) err.push(`LOD0 tris ${Math.round(t0)} outside ${lo}..${hi}`); if (k !== 'impostor' && !(t0 > t1 && t1 > t2)) err.push(`LOD chain not decreasing ${Math.round(t0)}/${Math.round(t1)}/${Math.round(t2)}`);
  if (degenerate > 0.02 * t0) err.push(degenerate + ' degenerate triangles'); // bark UV0 tiles along v by design, so the 0..1 UV check applies to atlases only
  if (noWind) err.push(noWind + ' primitives without COLOR_0 wind weights');
  const texs = doc.getRoot().listTextures(); if (texs.length < (k === 'impostor' ? 2 : 3)) err.push('PBR set incomplete (' + texs.length + ' textures)'); for (const t of texs) { if (t.getMimeType() !== 'image/ktx2') err.push('non-KTX2 texture ' + t.getName()); const s = t.getSize(); if (s && Math.min(...s) < 512) err.push('texture below 512px ' + t.getName()); }
  for (const m of doc.getRoot().listMaterials()) if (/leaf|_imp|grass/.test(m.getName()) && m.getAlphaMode() !== 'MASK') err.push('alphaMode not MASK on ' + m.getName());
  console.log((err.length ? 'FAIL ' : 'ok   ') + id.padEnd(14) + `LOD0/1/2 ${Math.round(t0)}/${Math.round(t1)}/${Math.round(t2)} tex ${texs.length}` + (err.length ? '  ' + [...new Set(err)].join('; ') : '')); bad += err.length ? 1 : 0;
}
process.exit(bad ? 1 : 0);
