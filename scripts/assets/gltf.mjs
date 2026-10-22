// gltf-transform helpers: IO setup, geometry stats, surface detection, LOD generation, KTX2 passes.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { ktx2 } from 'ktx2-encoder/gltf-transform';

export const io = async () => {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
};

/** Resize to <= px (multiple of 4, as KTX2 block compression needs) and return raw RGBA for the Basis encoder. */
export const decoder = (px) => async (buf) => {
  const meta = await sharp(buf).metadata();
  const s = Math.min(1, px / Math.max(meta.width, meta.height));
  const q4 = (n) => Math.max(4, Math.round((n * s) / 4) * 4);
  const { data, info } = await sharp(buf).resize(q4(meta.width), q4(meta.height), { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

/** KTX2 pass: normal maps UASTC (+RDO, zstd), colour and ORM maps ETC1S. */
export const ktx2Passes = (px, tier, q = {}) => [
  tier === 'ultra'
    ? ktx2({ isUASTC: true, isNormalMap: true, isPerceptual: false, enableRDO: true, rdoQualityLevel: q.rdo ?? 1.5, uastcLDRQualityLevel: 2, needSupercompression: true, generateMipmap: true, slots: /normalTexture/, imageDecoder: decoder(px) })
    : ktx2({ isUASTC: false, isNormalMap: true, isPerceptual: false, qualityLevel: 255, compressionLevel: 2, generateMipmap: true, slots: /normalTexture/, imageDecoder: decoder(px) }),
  ktx2({ isUASTC: false, isPerceptual: true, qualityLevel: q.etc ?? 150, compressionLevel: 2, needSupercompression: false, generateMipmap: true, slots: /baseColorTexture|emissiveTexture/, imageDecoder: decoder(px) }),
  ktx2({ isUASTC: false, isPerceptual: false, qualityLevel: q.etc ?? 150, compressionLevel: 2, needSupercompression: false, generateMipmap: true, slots: /metallicRoughnessTexture|occlusionTexture|clearcoat|transmission|specular|sheen|thickness/, imageDecoder: decoder(px) }),
];

const posOf = (prim) => prim.getAttribute('POSITION');
export function primTriangles(prim) {
  const pos = posOf(prim).getArray(); const idx = prim.getIndices()?.getArray();
  const n = idx ? idx.length : pos.length / 3; return { pos, idx, n };
}
export function boundsOf(doc) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const a = posOf(p).getArray(); for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]); } }
  return { min, max };
}
export const triCount = (mesh) => mesh.listPrimitives().reduce((s, p) => s + primTriangles(p).n / 3, 0);

/** Up-facing planar clusters (table tops, shelves, seats) in the asset's local space. Data-driven placement slots. */
export function detectSurfaces(doc, b) {
  const W = b.max[0] - b.min[0], D = b.max[2] - b.min[2], foot = Math.max(W * D, 1e-6);
  const buckets = new Map();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const { pos, idx, n } = primTriangles(p); const g = (i) => (idx ? idx[i] : i) * 3;
    for (let t = 0; t < n; t += 3) {
      const a = g(t), bb = g(t + 1), c = g(t + 2);
      const ux = pos[bb] - pos[a], uy = pos[bb + 1] - pos[a + 1], uz = pos[bb + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12 || ny / len < 0.94) continue;
      const y = (pos[a + 1] + pos[bb + 1] + pos[c + 1]) / 3; const key = Math.round(y / 0.02);
      const e = buckets.get(key) || { area: 0, y: 0, w: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
      const area = len / 2; e.area += area; e.y += y * area; e.w += area;
      for (const q of [a, bb, c]) { e.x0 = Math.min(e.x0, pos[q]); e.x1 = Math.max(e.x1, pos[q]); e.z0 = Math.min(e.z0, pos[q + 2]); e.z1 = Math.max(e.z1, pos[q + 2]); }
      buckets.set(key, e);
    }
  }
  const out = [];
  for (const e of [...buckets.values()].sort((a, b2) => a.y / a.w - b2.y / b2.w)) {
    const y = e.y / e.w; if (e.area < foot * 0.12 || y < b.min[1] + 0.04) continue;
    const prev = out[out.length - 1]; if (prev && Math.abs(prev.y - y) < 0.04) { prev.area += e.area; prev.x0 = Math.min(prev.x0, e.x0); prev.x1 = Math.max(prev.x1, e.x1); prev.z0 = Math.min(prev.z0, e.z0); prev.z1 = Math.max(prev.z1, e.z1); continue; }
    out.push({ y, area: e.area, x0: e.x0, x1: e.x1, z0: e.z0, z1: e.z1 });
  }
  return out.slice(0, 8).map((s) => ({ y: +s.y.toFixed(4), min: [+s.x0.toFixed(4), +s.z0.toFixed(4)], max: [+s.x1.toFixed(4), +s.z1.toFixed(4)], area: +s.area.toFixed(4) }));
}

/** Remove zero-area and index-collapsed triangles (scan and CAD exports carry slivers that break baking and shading). */
export function dropDegenerate(doc, eps = 1e-10) {
  let dropped = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices(); if (!idx) continue; const I = idx.getArray(); const P = p.getAttribute('POSITION').getArray(); const keep = [];
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], c = I[i + 2]; if (a === b || b === c || a === c) { dropped++; continue; }
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < eps) { dropped++; continue; }
      keep.push(a, b, c);
    }
    if (keep.length !== I.length) idx.setArray(I instanceof Uint32Array ? new Uint32Array(keep) : new Uint16Array(keep));
  }
  return dropped;
}
/** Uniformly scale every vertex position (real-world size fix for sources authored at the wrong scale). */
export function scaleDoc(doc, k) {
  const seen = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const a = posOf(p); if (seen.has(a)) continue; seen.add(a); const arr = a.getArray(); for (let i = 0; i < arr.length; i++) arr[i] *= k; a.setArray(arr); }
}
/** Keep only the named top-level nodes (Poly Haven variant sets ship several variants side by side). */
export function pickNodes(doc, names) {
  for (const n of doc.getRoot().listNodes()) if (n.getMesh() && !names.includes(n.getName())) n.dispose();
  for (const n of doc.getRoot().listNodes()) { const t = n.getTranslation(); if (names.length === 1 && names.includes(n.getName())) n.setTranslation([0, t[1], 0]); }
}
/** Shift every vertex so the asset sits on y=0 centred on x/z (pivot = bottom-centre). */
export function recentre(doc, b) {
  const off = [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2];
  const seen = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const a = posOf(p); if (seen.has(a)) continue; seen.add(a); const arr = a.getArray(); for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) arr[i + k] += off[k]; a.setArray(arr); }
  return off;
}

/** Add LOD1/LOD2 nodes that share vertex buffers with LOD0 but use meshopt-simplified index buffers. */
export function addLods(doc, ratios = [0.5, 0.15]) {
  const root = doc.getRoot(); const scene = root.listScenes()[0];
  const lod0 = root.listNodes().find((n) => n.getMesh()); lod0.setName('LOD0');
  scene.listChildren().forEach((c) => c !== lod0 && scene.removeChild(c));
  scene.addChild(lod0);
  const src = lod0.getMesh(); const tris = [triCount(src)];
  ratios.forEach((r, li) => {
    const mesh = doc.createMesh(`LOD${li + 1}`);
    for (const p of src.listPrimitives()) {
      const { idx } = primTriangles(p); const pos = posOf(p).getArray();
      const full = idx ? Uint32Array.from(idx) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      const target = Math.max(36, Math.floor((full.length * r) / 3) * 3);
      const uv = p.getAttribute('TEXCOORD_0')?.getArray();
      let res;
      if (full.length <= 36 * 4) res = full;
      else if (uv) { const attr = new Float32Array(uv.length); attr.set(uv); res = MeshoptSimplifier.simplifyWithAttributes(full, pos, 3, attr, 2, [1, 1], null, target, 0.03 * (li + 1), ['LockBorder'])[0]; }
      else res = MeshoptSimplifier.simplify(full, pos, 3, target, 0.03 * (li + 1), ['LockBorder'])[0];
      if (res.length > full.length * 0.92 && full.length > 36 * 4) { // borders locked everything: unlock, then fall back to sloppy
        res = MeshoptSimplifier.simplify(full, pos, 3, target, 0.08 * (li + 1), [])[0];
        if (res.length > full.length * 0.92) res = MeshoptSimplifier.simplifySloppy(full, pos, 3, null, target, 0.15 * (li + 1))[0];
      }
      const ia = doc.createAccessor().setType('SCALAR').setArray(res.length > 65535 ? new Uint32Array(res) : new Uint16Array(res)).setBuffer(root.listBuffers()[0]);
      const np = doc.createPrimitive().setIndices(ia).setMaterial(p.getMaterial()).setMode(p.getMode());
      for (const s of p.listSemantics()) np.setAttribute(s, p.getAttribute(s));
      mesh.addPrimitive(np);
    }
    tris.push(triCount(mesh)); scene.addChild(doc.createNode(`LOD${li + 1}`).setMesh(mesh));
  });
  return tris;
}

/** Bake node world transforms and merge every mesh node into a single mesh with one primitive per (material, attribute set). */
export function mergeScene(doc) {
  const root = doc.getRoot(); const scene = root.listScenes()[0]; const buffer = root.listBuffers()[0];
  const groups = new Map();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix(); // column-major
    const nm = normalMat(m);
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue;
      const sems = p.listSemantics().filter((s) => !/^(JOINTS|WEIGHTS)/.test(s)).sort();
      const key = `${root.listMaterials().indexOf(p.getMaterial())}|${sems.join(',')}`;
      const g = groups.get(key) || { mat: p.getMaterial(), sems, parts: [] }; g.parts.push({ p, m, nm }); groups.set(key, g);
    }
  }
  const out = doc.createMesh('merged');
  for (const g of groups.values()) {
    const vcount = g.parts.reduce((s, x) => s + x.p.getAttribute('POSITION').getCount(), 0);
    const arrs = Object.fromEntries(g.sems.map((s) => { const a = g.parts[0].p.getAttribute(s); return [s, new Float32Array(vcount * a.getElementSize())]; }));
    const icount = g.parts.reduce((s, x) => s + (x.p.getIndices()?.getCount() ?? x.p.getAttribute('POSITION').getCount()), 0);
    const idx = new Uint32Array(icount); let vo = 0, io2 = 0;
    for (const { p, m, nm } of g.parts) {
      const n = p.getAttribute('POSITION').getCount();
      for (const s of g.sems) {
        const src = p.getAttribute(s); const es = src.getElementSize(); const dst = arrs[s];         const a = src.getArray(); const norm = src.getNormalized();
        for (let i = 0; i < n; i++) {
          const o = (vo + i) * es; const v = [0, 0, 0, 0].map((_, k) => (k < es ? deq(a[i * es + k], a, norm) : 0));
          if (s === 'POSITION') { const t = mulPt(m, v); dst[o] = t[0]; dst[o + 1] = t[1]; dst[o + 2] = t[2]; }
          else if (s === 'NORMAL') { const t = norm3(mulDir(nm, v)); dst[o] = t[0]; dst[o + 1] = t[1]; dst[o + 2] = t[2]; }
          else if (s === 'TANGENT') { const t = norm3(mulDir(m, v)); dst[o] = t[0]; dst[o + 1] = t[1]; dst[o + 2] = t[2]; dst[o + 3] = v[3]; }
          else for (let k = 0; k < es; k++) dst[o + k] = v[k];
        }
      }
      const ia = p.getIndices()?.getArray(); const cnt = ia ? ia.length : n;
      const flip = det3(m) < 0;
      for (let i = 0; i < cnt; i += 3) { const x = ia ? ia[i] : i, y = ia ? ia[i + 1] : i + 1, z = ia ? ia[i + 2] : i + 2; idx[io2 + i] = x + vo; idx[io2 + i + (flip ? 2 : 1)] = y + vo; idx[io2 + i + (flip ? 1 : 2)] = z + vo; }
      vo += n; io2 += cnt;
    }
    const prim = doc.createPrimitive().setMaterial(g.mat).setIndices(doc.createAccessor().setType('SCALAR').setArray(vcount > 65535 ? idx : new Uint16Array(idx)).setBuffer(buffer));
    for (const s of g.sems) { const t = g.parts[0].p.getAttribute(s).getType(); prim.setAttribute(s, doc.createAccessor().setType(t).setArray(arrs[s]).setBuffer(buffer)); }
    out.addPrimitive(prim);
  }
  for (const n of root.listNodes()) n.dispose();
  for (const m of root.listMeshes()) if (m !== out) m.dispose();
  scene.listChildren().forEach((c) => scene.removeChild(c));
  scene.addChild(doc.createNode('LOD0').setMesh(out));
}
const deq = (v, a, norm) => (norm ? (a instanceof Int8Array ? Math.max(v / 127, -1) : a instanceof Int16Array ? Math.max(v / 32767, -1) : a instanceof Uint8Array ? v / 255 : a instanceof Uint16Array ? v / 65535 : v) : v);
const mulPt = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const mulDir = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
/** Inverse-transpose of the upper 3x3 as a column-major 4x4 (translation dropped). */
function normalMat(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g; const det = a * A + b * B + c * C || 1;
  const r = [A, B, C, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d].map((x) => x / det);
  // r is the inverse transpose, row-major 3x3 -> emit column-major 4x4
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1];
}

/** Native basisu KTX2 pass for 4K sources (the wasm encoder caps a source at ~12 Mpix). Same slot policy as ktx2Passes. */
export async function ktx2Cli(doc, px) {
  const { execFileSync } = await import('node:child_process'); const { mkdtempSync, readFileSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { KHRTextureBasisu } = await import('@gltf-transform/extensions');
  const slots = new Map();
  for (const m of doc.getRoot().listMaterials()) {
    const set = (t, k) => { if (t && !slots.has(t)) slots.set(t, k); };
    set(m.getBaseColorTexture(), 'color'); set(m.getEmissiveTexture(), 'color'); set(m.getNormalTexture(), 'normal');
    set(m.getMetallicRoughnessTexture(), 'data'); set(m.getOcclusionTexture(), 'data');
  }
  if (!doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_texture_basisu')) doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const [tex, kind] of slots) {
    const img = tex.getImage(); if (!img || tex.getMimeType() === 'image/ktx2') continue; const meta = await sharp(img).metadata(); const sc = Math.min(1, px / Math.max(meta.width, meta.height));
    const t = mkdtempSync(join(tmpdir(), 'basisu-'));
    const w = Math.max(4, Math.round((meta.width * sc) / 4) * 4), h = Math.max(4, Math.round((meta.height * sc) / 4) * 4);
    await sharp(img).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toFile(join(t, 'in.png'));
    const a = ['-ktx2', '-mipmap', '-output_file', join(t, 'out.ktx2'), ...(kind === 'normal' ? ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.5', '-linear'] : ['-q', '170', '-comp_level', '2', ...(kind === 'data' ? ['-linear'] : [])]), join(t, 'in.png')];
    execFileSync('basisu', a, { stdio: 'ignore' }); tex.setImage(new Uint8Array(readFileSync(join(t, 'out.ktx2')))).setMimeType('image/ktx2'); rmSync(t, { recursive: true, force: true });
  }
}
