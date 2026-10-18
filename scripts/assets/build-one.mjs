// Build one asset for one tier. Invoked by build.mjs as: node build-one.mjs <id> <tier>
// Writes the output file and a manifest fragment to .cache/manifest/<id>.<tier>.json
import { cloneDocument, dedup, flatten, meshopt, prune, quantize, reorder, simplify, weld } from '@gltf-transform/functions';
import { encodeToKTX2 } from 'ktx2-encoder';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MODELS, MATERIALS, HDRIS } from './catalog.mjs';
import { BLENDER_MODELS } from './blender/catalog.mjs';
import { loadExtra } from './extra.mjs';
import { mergeScene, addLods, boundsOf, detectSurfaces, io, ktx2Passes, ktx2Cli, recentre, scaleDoc, dropDegenerate, pickNodes, decoder } from './gltf.mjs';
import { CACHE, ROOT, b3, readLock } from './lib.mjs';

const [id, tier] = process.argv.slice(2);
const lock = readLock(); const a = lock.assets[id];
const outRoot = tier === 'high' ? join(ROOT, 'public/assets/high') : join(ROOT, 'dist-assets/ultra');
const tierIdx = tier === 'high' ? 0 : 1;
const frag = (o) => { const p = join(ROOT, `.cache/manifest/${id}.${tier}.json`); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify({ ...o, stamp: process.env.ASSET_STAMP })); };
const write = (rel, buf) => { const p = join(outRoot, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); return { file: rel, bytes: buf.length, blake3: b3(buf) }; };
/** High tier caps LOD0 triangle count; ultra keeps the full-detail mesh. */
const HIGH_TRI_CAP = e => (e.hero ? 60000 : 30000);

/** Rigged figure: keep skins and animation clips, no merge or LOD regeneration (LOD0/LOD1 come from Blender), KTX2 textures per tier. */
async function figure(e) {
  const src = join(CACHE, 'blender', id, `${id}.glb`); const doc = await (await io()).read(src);
  dropDegenerate(doc, 1e-7); await doc.transform(dedup(), prune({ keepAttributes: true }));
  const px = e.px[tierIdx];
  if (px > 3072) await ktx2Cli(doc, px); else for (const pass of ktx2Passes(px, tier)) await doc.transform(pass);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  doc.getRoot().getAsset().generator = 'hermod-assets';
  const glb = Buffer.from(await (await io()).writeBinary(doc)); const out = write(`models/${id}.glb`, glb);
  const root = doc.getRoot(); const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const tris = { LOD0: 0, LOD1: 0 };
  for (const mesh of root.listMeshes()) {
    const lod = /_LOD1_/.test(mesh.getName()) ? 'LOD1' : 'LOD0';
    for (const p of mesh.listPrimitives()) { tris[lod] += (p.getIndices()?.getCount() ?? 0) / 3; if (lod === 'LOD0') { const a = p.getAttribute('POSITION'); const mi = a.getMin([]), ma = a.getMax([]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], mi[k]); mx[k] = Math.max(mx[k], ma[k]); } } }
  }
  const size = mx.map((v, i) => +(v - mn[i]).toFixed(3));
  const clips = root.listAnimations().map((a) => a.getName());
  frag({
    id, category: 'figure', tags: e.tags, hero: true, name: id.replace(/_/g, ' '),
    bounds: { min: mn.map((v) => +v.toFixed(3)), max: mx.map((v) => +v.toFixed(3)), size }, pivot: 'bottom-center', footprint: { w: size[0], d: size[2], h: size[1] }, radius: +(Math.hypot(...size) / 2).toFixed(3),
    lods: [{ tris: Math.round(tris.LOD0), dist: 0 }, { tris: Math.round(tris.LOD1), dist: 9 }], surfaces: [], lights: [], slots: {}, shadow: { cast: true, receive: true }, materials: root.listMaterials().length, texPx: px,
    texBytes: root.listTextures().reduce((s2, t) => s2 + (t.getImage()?.byteLength ?? 0), 0), figure: { ...e.figure, clips },
    source: { page: 'https://static.makehumancommunity.org/', authors: ['MakeHuman community (MPFB2 + CC0 asset packs, see assets/CREDITS.md)'], license: 'CC0-1.0', res: 'authored', origin: 'makehuman', lightmap: false },
    tier: { file: out.file, bytes: out.bytes, blake3: out.blake3 },
  });
}

async function model(e) {
  if (e.figure) return figure(e);
  const lmP = join(CACHE, 'blender-lm', id, `${id}.glb`);
  const src = a.origin === 'blender' ? join(CACHE, 'blender', id, `${id}.glb`) : (e.lm || e.refine) && existsSync(lmP) ? lmP : join(CACHE, 'model', id, a.res, `${id}.gltf`);
  const doc = await (await io()).read(src);
  if (e.pick) pickNodes(doc, e.pick);
  await doc.transform(flatten());
  mergeScene(doc);
  await doc.transform(weld({ tolerance: 1e-5 }), dedup(), prune({ keepAttributes: true }));
  dropDegenerate(doc, 1e-9); await doc.transform(prune({ keepAttributes: true }));
  const tris0 = doc.getRoot().listMeshes()[0].listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  if (tier === 'high' && tris0 > HIGH_TRI_CAP(e)) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: HIGH_TRI_CAP(e) / tris0, error: 0.002, lockBorder: true }), prune({ keepAttributes: true }));
    let b = boundsOf(doc);
  if (e.fit) { const [ax, v] = Object.entries(e.fit)[0]; const i = { w: 0, h: 1, d: 2 }[ax]; scaleDoc(doc, v / (b.max[i] - b.min[i])); b = boundsOf(doc); }
  recentre(doc, b);
  const bb = boundsOf(doc);
  const lods = addLods(doc);
  const surfaces = detectSurfaces(doc, bb);
  if (tier === 'high') { // untextured LOD1 proxy in final asset space: occluder for the offline room lightmap bake (Blender cannot read meshopt/KTX2)
    const pd = cloneDocument(doc); for (const t of pd.getRoot().listTextures()) t.dispose();
    for (const n of pd.getRoot().listNodes()) if (n.getName() !== 'LOD1') n.dispose();
    await pd.transform(prune({ keepAttributes: true }));
    const px2 = join(CACHE, 'proxy', `${id}.glb`); mkdirSync(dirname(px2), { recursive: true }); writeFileSync(px2, Buffer.from(await (await io()).writeBinary(pd)));
  }
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8, quantizeGeneric: 12 }), reorder({ encoder: MeshoptEncoder, target: 'size' }));
  dropDegenerate(doc, 0.5); // exact zeros in quantised integer space

  const px = e.px[tierIdx];
  if (px > 3072) await ktx2Cli(doc, px); else for (const pass of ktx2Passes(px, tier)) await doc.transform(pass);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  doc.getRoot().getAsset().generator = 'hermod-assets';
  const glb = Buffer.from(await (await io()).writeBinary(doc));
  const out = write(`models/${id}.glb`, glb);
  const size = bb.max.map((v, i) => +(v - bb.min[i]).toFixed(4)); const r = +Math.hypot(...size).toFixed(3) / 2;
  const mat = doc.getRoot().listMaterials().length; const texBytes = doc.getRoot().listTextures().reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0);
  frag({
    id, category: e.cat, tags: e.tags, hero: !!e.hero, name: id.replace(/_/g, ' '),
    bounds: { min: bb.min.map((v) => +v.toFixed(4)), max: bb.max.map((v) => +v.toFixed(4)), size }, pivot: 'bottom-center',
    footprint: { w: size[0], d: size[2], h: size[1] }, radius: +r.toFixed(3),
    lods: lods.map((t, i) => ({ tris: Math.round(t), dist: i === 0 ? 0 : +Math.max(i === 1 ? 5 : 12, r * (i === 1 ? 8 : 20)).toFixed(1) })),
    slots: e.slots ?? {}, surfaces, lights: (e.lights || []).map((l) => ({ kind: l.kind, n: l.n, pos: [0, 1, 2].map((k) => +(bb.min[k] + (bb.max[k] - bb.min[k]) * l.at[k]).toFixed(4)) })),
    shadow: { cast: r > 0.14 && e.cat !== 'art', receive: true }, materials: mat, texPx: px, texBytes,
    source: { page: a.page, authors: a.authors, license: 'CC0-1.0', res: a.res, origin: a.origin ?? 'polyhaven', lightmap: !!(e.lm && existsSync(lmP) && a.origin !== 'blender') },
    tier: { file: out.file, bytes: out.bytes, blake3: out.blake3 },
  });
}

async function material(e) {
  const dir = join(CACHE, 'material', id, a.res); const px = e.px[tierIdx]; const res = {};
  const { execFileSync } = await import('node:child_process'); const { mkdtempSync, readFileSync: rf } = await import('node:fs'); const { tmpdir } = await import('node:os');
  // The wasm encoder caps a source at ~12 Mpix; 4K sets go through the native basisu CLI (same Basis Universal codec).
  const encCli = async (src, o) => {
    const t = mkdtempSync(join(tmpdir(), 'basisu-')); const meta = await sharp(readFileSync(join(dir, src))).metadata(); const s = Math.min(1, px / Math.max(meta.width, meta.height));
    await sharp(readFileSync(join(dir, src))).resize(Math.round(meta.width * s), Math.round(meta.height * s), { kernel: 'lanczos3' }).png().toFile(join(t, 'in.png'));
    const a = ['-ktx2', '-mipmap', '-output_file', join(t, 'out.ktx2'), ...(o.uastc ? ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.5'] : ['-q', String(o.q ?? 170), '-comp_level', '2']), ...(o.linear ? ['-linear'] : []), join(t, 'in.png')];
    execFileSync('basisu', a, { stdio: 'ignore' }); return rf(join(t, 'out.ktx2'));
  };
  const enc = async (src, opts) => { const buf = readFileSync(join(dir, src)); if (px > 3072) return encCli(src, { uastc: opts.isUASTC, q: opts.qualityLevel, linear: opts.isPerceptual === false }); return encodeToKTX2(buf, { generateMipmap: true, imageDecoder: decoder(px), ...opts }); };
  const hasArm = existsSync(join(dir, 'arm.jpg'));
  const jobs = {
    base: () => enc('diff.jpg', { isUASTC: false, isPerceptual: true, qualityLevel: 170, compressionLevel: 2 }),
    normal: () => enc('nor.jpg', tier === 'ultra' ? { isUASTC: true, isNormalMap: true, isPerceptual: false, enableRDO: true, rdoQualityLevel: 1.5, uastcLDRQualityLevel: 2, needSupercompression: true } : { isUASTC: false, isNormalMap: true, isPerceptual: false, qualityLevel: 255, compressionLevel: 2 }),
    orm: () => (hasArm ? enc('arm.jpg', { isUASTC: false, isPerceptual: false, qualityLevel: 150, compressionLevel: 2 }) : null),
  };
  const files = {}; let bytes = 0;
  for (const [k, f] of Object.entries(jobs)) { const buf = await f(); if (!buf) continue; const w = write(`materials/${id}/${k}.ktx2`, Buffer.from(buf)); files[k] = w.file; bytes += w.bytes; res[k] = w.blake3; }
  frag({ id, use: e.use, tileM: a.tileM, files, bytes, hashes: res, source: { page: a.page, authors: a.authors, license: 'CC0-1.0', res: a.res } });
}

/** Radiance RGBE: decode, box-downsample, encode flat RGBE (no RLE) so the loader stays trivial. */
function readHdr(buf) {
  let p = 0; const line = () => { let s = ''; while (buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
  while (line() !== '') { /* header */ }
  const [, h, , w] = line().split(' ').map((x) => +x || x); const W = +w, H = +h; const data = new Float32Array(W * H * 3);
  const scan = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2 && !(buf[p + 2] & 128)) {
      p += 4; for (let c = 0; c < 4; c++) { let x = 0; while (x < W) { let n = buf[p++]; if (n > 128) { n -= 128; const v = buf[p++]; while (n--) scan[4 * x++ + c] = v; } else while (n--) scan[4 * x++ + c] = buf[p++]; } }
    } else { for (let x = 0; x < W * 4; x++) scan[x] = buf[p++]; }
    for (let x = 0; x < W; x++) { const e = scan[4 * x + 3]; const f = e ? 2 ** (e - 136) : 0; for (let c = 0; c < 3; c++) data[(y * W + x) * 3 + c] = scan[4 * x + c] * f; }
  }
  return { W, H, data };
}
function writeHdr({ W, H, data }) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`); const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]; const m = Math.max(r, g, b); if (m < 1e-32) continue; const ex = Math.ceil(Math.log2(m)); const f = 256 / 2 ** ex; px[i * 4] = Math.min(255, r * f); px[i * 4 + 1] = Math.min(255, g * f); px[i * 4 + 2] = Math.min(255, b * f); px[i * 4 + 3] = ex + 128; }
  return Buffer.concat([head, px]);
}
function down({ W, data }, tw) {
  const th = tw / 2, k = W / tw; const out = new Float32Array(tw * th * 3);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { for (let c = 0; c < 3; c++) { let s = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += data[((y * k + j) * W + x * k + i) * 3 + c]; out[(y * tw + x) * 3 + c] = s / (k * k); } }
  return { W: tw, H: th, data: out };
}
async function hdri(e) {
  const src = readFileSync(join(CACHE, 'hdri', id, a.res, `${id}.hdr`));
  const targetW = tier === 'high' ? 1024 : parseInt(a.res) * 1024;
  const img = readHdr(src); const buf = img.W > targetW ? writeHdr(down(img, targetW)) : src;
  const w = write(`hdri/${id}.hdr`, buf);
  frag({ id, use: e.use, width: Math.min(img.W, targetW), tier: w, source: { page: a.page, authors: a.authors, license: 'CC0-1.0', res: a.res } });
}

const e = [...MODELS, ...BLENDER_MODELS, ...(await loadExtra())].find((m) => m.id === id) || MATERIALS.find((m) => m.id === id) || HDRIS.find((m) => m.id === id);
if (!e || !a) throw new Error(`unknown asset ${id}`);
await (a.type === 'model' ? model(e) : a.type === 'material' ? material(e) : hdri(e));
