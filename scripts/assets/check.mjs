// npm run assets:check  -> QA gate over the built asset tiers. Fails (exit 1) on:
//  size outside the real-world band of its category, degenerate faces, primitive stand-ins, overlapping UV2 (lightmap),
//  texel density below the authored floor, textures smaller than authored for the tier, missing KTX2 mip chains, bad LOD chain.
// Usage: node scripts/assets/check.mjs [--tier high|ultra|both] [--only id,id] [--file path.glb|gltf --id id] [--verbose]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { MODELS, MATERIALS } from './catalog.mjs';
import { BLENDER_MODELS } from './blender/catalog.mjs';
import { loadExtra } from './extra.mjs';
import { ROOT, readLock } from './lib.mjs';

const args = process.argv.slice(2); const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const tiers = { high: ['high'], ultra: ['ultra'], both: ['high', 'ultra'] }[opt('--tier', 'high')];
const only = opt('--only') ? new Set(opt('--only').split(',')) : null; const verbose = args.includes('--verbose');

/** Real-world height band (m) per category: catches assets authored at the wrong scale. [min, max] for height, and a footprint cap. */
const HEIGHT = {
  architecture: [0.04, 12], seating: [0.15, 1.4], table: [0.25, 1.25], storage: [0.1, 2.7], light: [0.04, 1.6], art: [0.02, 2.2], decor: [0.005, 1.3], plant: [0.1, 2.2], tableware: [0.01, 0.6],
  paper: [0.001, 0.7], tool: [0.01, 2.0], prop: [0.1, 2.2], fire: [0.05, 2.9], craft: [0.3, 2.6], play: [0.01, 0.6], books: [0.05, 0.5], structure: [0.3, 3.0],
};
const FOOT_MAX = { architecture: 40, seating: 2.4, table: 3.2, storage: 3.0, art: 3.0, decor: 3.6, fire: 3.0, craft: 3.0, structure: 3.5 };
const DEFAULT_FOOT = 2.0;
/** LOD0 triangle band: authored heroes must carry real detail, nothing ships absurdly heavy. */
const TRIS = { hero: [600, 90000], prop: [150, 60000] };
const TRIS_CAT = { art: [500, 90000], figure: [8000, 130000] }; // flat framed things are legitimately light, but never a bare slab
/** Texel density floor (px per metre, base colour), measured over the model's UV0 vs world area. */
/** architecture is authored in plan units (1 unit ~ 4 m): 40 px/unit is ~10 px/m on the atlas, the rest of the surface detail comes from the baked normal map and the high-poly source; props 30. */
const DENSITY_MIN = { hero: 250, prop: 150, architecture: 40 };
const DENSITY_SKIP = new Set(['paper', 'books', 'figure']); // many tiny pieces share a small atlas

const lock = readLock(); const extra = await loadExtra();
const PRUNE = new Set(JSON.parse(readFileSync(join(ROOT, 'scripts/assets/prune.json'), 'utf8')).ids); // see prune.json
const entries = [...MODELS, ...BLENDER_MODELS, ...extra].filter((e) => !PRUNE.has(e.id) && (!only || only.has(e.id)));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const ktx2Levels = (img) => { const b = Buffer.from(img); return b.length > 44 && b.readUInt32LE(0) === 0x58544bab ? { w: b.readUInt32LE(20), h: b.readUInt32LE(24), levels: b.readUInt32LE(40) } : null; };
const edge = (res) => parseInt(res) * 1024;

function geometry(doc) {
  const root = doc.getRoot(); const lod0 = root.listNodes().find((n) => n.getName() === 'LOD0') ?? root.listNodes().find((n) => n.getMesh());
  const fig = root.listNodes().filter((n) => n.getMesh() && /_LOD0_/.test(n.getName())).map((n) => n.getMesh());
  const meshes = fig.length ? fig : lod0?.getMesh() ? [lod0.getMesh()] : root.listMeshes().slice(0, 1);
  const M = lod0 ? lod0.getWorldMatrix() : null; // quantisation scale/offset lives on the node
  const xf = (A) => { if (!M) return A; const o = new Float32Array(A.length); for (let i = 0; i < A.length; i += 3) { const x = A[i], y = A[i + 1], z = A[i + 2]; o[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; o[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; o[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14]; } return o; };
  const tris = []; let total = 0;
  for (const mesh of meshes) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); const idx = p.getIndices(); const n = idx ? idx.getCount() : pos.getCount();
    const P = xf(Float32Array.from(pos.getArray())); const I = idx ? idx.getArray() : null; const uv0 = p.getAttribute('TEXCOORD_0'); const uv1 = p.getAttribute('TEXCOORD_1');
    tris.push({ P, I, n, uv0: uv0?.getArray() ?? null, uv1: uv1?.getArray() ?? null, mat: p.getMaterial() }); total += n / 3;
  }
  return { tris, total };
}
function stats(g, diag) {
  const degEps = (diag / 32768) ** 2; // below a quarter of the 14-bit position grid cell squared: collapsed by quantisation
  let degenerate = 0, areaW = 0, uvArea0 = 0; const normals = new Set(); const edges = new Map(); let open = 0;
  const grid = 256; const cells = new Uint8Array(grid * grid); let hit = 0, over = 0; const hasUV1 = g.tris.some((t) => t.uv1);
  for (const t of g.tris) for (let i = 0; i < t.n; i += 3) {
    const a = t.I ? t.I[i] : i, b = t.I ? t.I[i + 1] : i + 1, c = t.I ? t.I[i + 2] : i + 2; const P = t.P;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const len = Math.hypot(nx, ny, nz);
    if (len < degEps) { degenerate++; continue; }
    areaW += len / 2; normals.add(`${Math.round((nx / len) * 8)},${Math.round((ny / len) * 8)},${Math.round((nz / len) * 8)}`);
    if (t.uv0) { const U = t.uv0; uvArea0 += Math.abs((U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1])) / 2; }
    if (hasUV1 && t.uv1) { // rasterise the triangle centroid fan into a coverage grid; a cell claimed by two triangles is an overlap
      const U = t.uv1; const ax = U[a * 2] * grid, ay = U[a * 2 + 1] * grid, bx = U[b * 2] * grid, by = U[b * 2 + 1] * grid, cx = U[c * 2] * grid, cy = U[c * 2 + 1] * grid;
      const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(grid - 1, Math.ceil(Math.max(ax, bx, cx))), miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(grid - 1, Math.ceil(Math.max(ay, by, cy)));
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue; const seen = new Set();
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5; const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
        if (w0 >= 0.02 && w1 >= 0.02 && w2 >= 0.02) { const k = y * grid + x; if (!seen.has(k)) { seen.add(k); hit++; if (cells[k]) over++; cells[k] = 1; } }
      }
    }
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = `${Math.round(P[p * 3] * 1e4)},${Math.round(P[p * 3 + 1] * 1e4)},${Math.round(P[p * 3 + 2] * 1e4)}|${Math.round(P[q * 3] * 1e4)},${Math.round(P[q * 3 + 1] * 1e4)},${Math.round(P[q * 3 + 2] * 1e4)}`; const rk = key.split('|').reverse().join('|'); if (edges.has(rk)) edges.set(rk, edges.get(rk) + 1); else edges.set(key, (edges.get(key) ?? 0) + 1); }
  }
  for (const v of edges.values()) if (v === 1) open++;
  return { degenerate, areaW, uvArea0, uv2Overlap: hit ? over / hit : 0, hasUV1, faceNormals: normals.size, openEdges: open, uvScale: Math.sqrt(uvArea0 / Math.max(areaW, 1e-9)) };
}

const fails = []; const warns = []; let checked = 0; const rows = [];
async function checkModel(e, tier, file) {
  const id = e.id; const doc = await io.read(file); await doc.transform(dequantize());
  const g = geometry(doc); const bd = [[1e9, -1e9], [1e9, -1e9], [1e9, -1e9]]; for (const t of g.tris) for (let i = 0; i < t.P.length; i += 3) for (let k = 0; k < 3; k++) { bd[k][0] = Math.min(bd[k][0], t.P[i + k]); bd[k][1] = Math.max(bd[k][1], t.P[i + k]); } const st = stats(g, Math.hypot(...bd.map(([a, b]) => b - a))); const root = doc.getRoot(); const F = [];
  const sizes = [0, 0, 0]; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const t of g.tris) for (let i = 0; i < t.P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], t.P[i + k]); mx[k] = Math.max(mx[k], t.P[i + k]); }
  for (let k = 0; k < 3; k++) sizes[k] = mx[k] - mn[k];
  const [hMin, hMax] = HEIGHT[e.cat] ?? [0.01, 3]; const foot = Math.max(sizes[0], sizes[2]);
  if (sizes[1] < hMin || sizes[1] > hMax) F.push(`height ${sizes[1].toFixed(2)} m outside ${e.cat} band [${hMin}, ${hMax}]`);
  if (foot > (FOOT_MAX[e.cat] ?? DEFAULT_FOOT)) F.push(`footprint ${foot.toFixed(2)} m exceeds ${e.cat} cap ${FOOT_MAX[e.cat] ?? DEFAULT_FOOT}`);
  let band = TRIS_CAT[e.cat] ?? (e.hero ? TRIS.hero : TRIS.prop); if (tier === 'ultra') band = [band[0], band[1] * 4]; const tris = Math.round(g.total); // ultra keeps full-detail meshes
  if (tris < band[0] || tris > band[1]) F.push(`LOD0 ${tris} tris outside ${e.hero ? 'hero' : 'prop'} band [${band[0]}, ${band[1]}]`);
  if (st.degenerate) F.push(`${st.degenerate} degenerate (zero-area) faces`);
  if (tris < 200 && st.faceNormals <= 12 && !['art', 'paper'].includes(e.cat)) F.push(`primitive stand-in: ${tris} tris, ${st.faceNormals} distinct face normals`);
  if (st.hasUV1 && st.uv2Overlap > 0.01) F.push(`UV2 overlap ${(st.uv2Overlap * 100).toFixed(1)}% of covered cells`);
  if (st.openEdges > 0 && ['seating', 'table', 'storage', 'fire', 'craft'].includes(e.cat)) warns.push(`${id}/${tier}: ${st.openEdges} open edges`);
  // textures: authored size per tier, mip chains
  const a = lock.assets[id]; const srcEdge = a?.origin === 'blender' ? Infinity : a ? edge(a.res) : Infinity; const wantPx = Math.min(e.px[tier === 'high' ? 0 : 1], srcEdge);
  let maxTex = 0; const base = g.tris.map((t) => t.mat?.getBaseColorTexture()).find(Boolean);
  for (const t of root.listTextures()) {
    const k = t.getMimeType() === 'image/ktx2' ? ktx2Levels(t.getImage()) : null; const dim = k ? Math.max(k.w, k.h) : Math.max(...(t.getSize() ?? [0, 0]));
    if (/_slot$/.test(t.getName()) || dim <= 4) continue; // paintable content slots start as 4x4 and are replaced at runtime
    if (!k) F.push(`texture ${t.getName() || t.getURI()} is not KTX2`); else if (k.levels < 2) F.push(`texture ${t.getName()} has no mip chain`);
    maxTex = Math.max(maxTex, dim);
  }
  if (root.listTextures().length && maxTex < wantPx * 0.99 && !(e.cat === 'books' && tier === 'high')) F.push(`largest texture ${maxTex}px below authored ${wantPx}px for ${tier}`);
  // texel density on the base colour texture
  if (base && st.uvScale > 0 && !DENSITY_SKIP.has(e.cat)) {
    const k = base.getMimeType() === 'image/ktx2' ? ktx2Levels(base.getImage()) : null; const px = k ? Math.max(k.w, k.h) : Math.max(...base.getSize());
    const dens = st.uvScale * px; const min = e.cat === 'architecture' ? DENSITY_MIN.architecture : e.hero ? DENSITY_MIN.hero : DENSITY_MIN.prop; if (dens < min && px > 4) F.push(`texel density ${dens.toFixed(0)} px/m below ${min}`);
    rows.push(`${id.padEnd(30)} ${tier} ${String(tris).padStart(6)} tris  ${sizes.map((v) => v.toFixed(2)).join('x').padEnd(16)} ${String(px).padStart(5)}px  ${dens.toFixed(0).padStart(6)} px/m  uv2 ${(st.uv2Overlap * 100).toFixed(1)}%`);
  } else rows.push(`${id.padEnd(30)} ${tier} ${String(tris).padStart(6)} tris  ${sizes.map((v) => v.toFixed(2)).join('x').padEnd(16)}`);
  // LOD chain
  const lods = root.listNodes().filter((n) => /^LOD\d$/.test(n.getName())); if (lods.length >= 2) { const t = lods.map((n) => n.getMesh().listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0)); if (!(t[0] > t[1])) F.push(`LOD chain not decreasing: ${t.join(' > ')}`); }
  checked++; for (const f of F) fails.push(`${id}/${tier}: ${f}`);
}

if (opt('--file')) { const e = entries.find((x) => x.id === opt('--id')) ?? { id: opt('--id', 'file'), cat: opt('--cat', 'storage'), px: [1024, 2048], hero: false }; await checkModel(e, 'high', opt('--file')); }
else for (const tier of tiers) {
  const dir = tier === 'high' ? join(ROOT, 'public/assets/high') : join(ROOT, 'dist-assets/ultra');
  for (const e of entries) { const f = join(dir, 'models', `${e.id}.glb`); if (!existsSync(f)) { if (tier === 'high') fails.push(`${e.id}/${tier}: missing ${f}`); continue; } await checkModel(e, tier, f); }
  // tiling materials: authored size and mips
  for (const m of MATERIALS.filter((x) => !PRUNE.has(x.id) && (!only || only.has(x.id)))) {
    const a = lock.assets[m.id]; const want = Math.min(m.px[tier === 'high' ? 0 : 1], edge(a?.res ?? '8k'));
    for (const slot of ['base', 'normal', 'orm']) {
      const f = join(dir, 'materials', m.id, `${slot}.ktx2`); if (!existsSync(f)) { if (tier === 'high') fails.push(`${m.id}/${tier}: missing ${slot}.ktx2`); continue; }
      const k = ktx2Levels(readFileSync(f)); if (!k) { fails.push(`${m.id}/${slot}: not KTX2`); continue; }
      if (Math.max(k.w, k.h) < want) fails.push(`${m.id}/${tier}/${slot}: ${Math.max(k.w, k.h)}px below authored ${want}px`); if (k.levels < 2) fails.push(`${m.id}/${slot}: no mip chain`);
    }
  }
}
// sanctuary glb set (scripts/assets/site-pack.mjs -> public/assets/site, tier-less, plan units: 1 unit ~ 4 m, so bands use cat 'architecture')
{ const sd = join(ROOT, 'public/assets/site'); const rp = join(sd, 'pack-report.json');
  if (existsSync(rp)) for (const r of JSON.parse(readFileSync(rp, 'utf8'))) { if (only && !only.has(r.id)) continue; const f = join(sd, r.id + '.glb'); if (existsSync(f)) await checkModel({ id: r.id, cat: 'architecture', px: [r.px, r.px], hero: r.tris[0] >= 600 }, 'high', f); } }
// every asset id a room layout references must exist in the built manifest
{
  const { readdirSync: rd } = await import('node:fs'); const man = JSON.parse(readFileSync(join(ROOT, 'src/scene/assets/manifest.json'), 'utf8')).models; const dir = join(ROOT, 'src/scene/rooms/layouts');
  for (const f of rd(dir).filter((n) => n.endsWith('.json'))) {
    const l = JSON.parse(readFileSync(join(dir, f), 'utf8')); const ids = [];
    const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if ((k === 'asset' || k === 'table') && typeof v === 'string') ids.push(v); else if (['assets', 'traces', 'figures'].includes(k) && Array.isArray(v)) ids.push(...v); else walk(v); } };
    walk(l.rules); walk(l.shell.openings); walk(l.presence); (l.content ?? []).forEach((c) => ids.push(c.asset));
    for (const id of new Set(ids)) if (!man[id]) fails.push(`layout ${f}: asset ${id} is not in the manifest`);
  }
}
if (verbose) console.log(rows.join('\n'));
console.log(`checked ${checked} models`);
for (const w of warns) console.warn('warn  ' + w);
if (fails.length) { console.error(`FAIL (${fails.length})\n` + fails.map((f) => '  ' + f).join('\n')); process.exit(1); }
console.log('PASS');
