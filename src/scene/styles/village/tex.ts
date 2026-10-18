/**
 * Texture sets the village ground consumes. The interface is the contract: authored KTX2 PBR sets (albedo, normal, ORM = AO red, roughness green,
 * metal blue) drop in by assigning a TerrainTextureSet; `fallbackTextureSet` is TEMPORARY procedural stand-in data until those assets exist.
 */
import * as THREE from 'three';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export const SPLAT_LAYERS = ['grass', 'meadow', 'path', 'sand', 'rock', 'mud'] as const;
export interface Pbr2D { albedo: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture }
export interface TerrainTextureSet {
  /** 6 layers in SPLAT_LAYERS order, one array texture per channel set (same size per array). */
  splat: { albedo: THREE.DataArrayTexture | THREE.CompressedArrayTexture; normal: THREE.DataArrayTexture | THREE.CompressedArrayTexture; orm: THREE.DataArrayTexture | THREE.CompressedArrayTexture };
  /** Texture repeats per world unit for each layer. */
  tile: readonly number[];
  cliff: Pbr2D; cobble: Pbr2D;
  waterNormal: THREE.Texture;
  /** Called when `splat` is replaced by the compressed KTX2 arrays (a different texture class, so it cannot be swapped in place): repoint the material uniforms. */
  onSplat?: (splat: TerrainTextureSet['splat']) => void;
  /** Same for the single 2D sets (cobble, cliff, water normal) once their KTX2 versions replace the placeholder DataTextures: every consumer registers one listener and repoints its material. */
  onMaps: Array<(which: 'cobble' | 'cliff' | 'water') => void>;
  dispose(): void;
}

// tileable value noise: blend four shifted samples across the seam
const hash = (x: number, y: number, s: number) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (t: number) => t * t * (3 - 2 * t);
function vnoise(u: number, v: number, p: number, s: number): number {
  const x = u * p, y = v * p; const xi = Math.floor(x), yi = Math.floor(y); const fx = sm(x - xi), fy = sm(y - yi);
  const g = (i: number, j: number) => hash(((i % p) + p) % p, ((j % p) + p) % p, s);
  return (g(xi, yi) * (1 - fx) + g(xi + 1, yi) * fx) * (1 - fy) + (g(xi, yi + 1) * (1 - fx) + g(xi + 1, yi + 1) * fx) * fy;
}
const fbmT = (u: number, v: number, base: number, oct: number, s: number) => { let a = 0, amp = 0.5, p = base; for (let i = 0; i < oct; i++) { a += amp * vnoise(u, v, p, s + i * 17); p *= 2; amp *= 0.5; } return a; };

function heightToNormal(h: Float32Array, n: number, k: number): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const xm = (x - 1 + n) % n, xp = (x + 1) % n, ym = (y - 1 + n) % n, yp = (y + 1) % n;
    let nx = (h[y * n + xm] - h[y * n + xp]) * k, ny = (h[ym * n + x] - h[yp * n + x]) * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * n + x) * 4; out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (nz * 0.5 + 0.5) * 255; out[o + 3] = 255;
  }
  return out;
}
const tex2D = (data: Uint8Array, n: number, srgb: boolean): THREE.DataTexture => { const t = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t; };
const arr = (layers: Uint8Array[], n: number, srgb: boolean): THREE.DataArrayTexture => {
  const all = new Uint8Array(n * n * 4 * layers.length); layers.forEach((l, i) => all.set(l, i * n * n * 4));
  const t = new THREE.DataArrayTexture(all, n, n, layers.length); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.format = THREE.RGBAFormat; t.needsUpdate = true; return t;
};
interface Layer { a: [number, number, number]; b: [number, number, number]; freq: number; rough: number; relief: number; seed: number }
const LAYERS: Layer[] = [
  { a: [0.46, 0.55, 0.28], b: [0.58, 0.64, 0.34], freq: 6, rough: 0.9, relief: 2.2, seed: 1 }, // grass
  { a: [0.62, 0.64, 0.36], b: [0.74, 0.7, 0.42], freq: 5, rough: 0.9, relief: 2.0, seed: 2 }, // meadow
  { a: [0.62, 0.55, 0.42], b: [0.74, 0.67, 0.52], freq: 10, rough: 0.92, relief: 4.0, seed: 3 }, // path (dirt under cobbles)
  { a: [0.82, 0.74, 0.55], b: [0.9, 0.83, 0.64], freq: 12, rough: 0.95, relief: 1.2, seed: 4 }, // sand
  { a: [0.46, 0.43, 0.38], b: [0.62, 0.58, 0.5], freq: 6, rough: 0.88, relief: 5.5, seed: 5 }, // rock
  { a: [0.34, 0.26, 0.19], b: [0.46, 0.36, 0.26], freq: 8, rough: 0.8, relief: 2.5, seed: 6 }, // mud
];
function layerData(L: Layer, n: number) {
  const alb = new Uint8Array(n * n * 4), orm = new Uint8Array(n * n * 4), h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n; const f = fbmT(u, v, L.freq, 4, L.seed * 31), d = fbmT(u, v, L.freq * 5, 2, L.seed * 7); h[y * n + x] = f * 0.6 + d * 0.4;
    const k = 0.3 + f * 1.1; const o = (y * n + x) * 4; const sh = 0.86 + d * 0.28;
    alb[o] = Math.min(255, (L.a[0] + (L.b[0] - L.a[0]) * k) * sh * 255); alb[o + 1] = Math.min(255, (L.a[1] + (L.b[1] - L.a[1]) * k) * sh * 255); alb[o + 2] = Math.min(255, (L.a[2] + (L.b[2] - L.a[2]) * k) * sh * 255); alb[o + 3] = 255;
    orm[o] = (0.7 + h[y * n + x] * 0.3) * 255; orm[o + 1] = Math.min(1, L.rough + (d - 0.5) * 0.1) * 255; orm[o + 2] = 0; orm[o + 3] = 255;
  }
  return { alb, orm, nor: heightToNormal(h, n, L.relief) };
}
function cellData(n: number, kind: 'cobble' | 'cliff') {
  const alb = new Uint8Array(n * n * 4), orm = new Uint8Array(n * n * 4), h = new Float32Array(n * n); const C = kind === 'cobble' ? 9 : 5;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n; let best = 9, second = 9, id = 0;
    const cx = Math.floor(u * C), cy = Math.floor(v * C);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j; const wx = ((gx % C) + C) % C, wy = ((gy % C) + C) % C; const px = (gx + 0.15 + 0.7 * hash(wx, wy, 5)) / C, py = (gy + 0.15 + 0.7 * hash(wx, wy, 9)) / C;
      const stretch = kind === 'cliff' ? 3.2 : 1; const d = Math.hypot((u - px) * C, (v - py) * C * stretch); if (d < best) { second = best; best = d; id = wx * 131 + wy; } else if (d < second) second = d;
    }
    const edge = Math.min(1, (second - best) * 3); const dome = kind === 'cobble' ? Math.sqrt(Math.max(0, 1 - best * best * 0.9)) : 0.55 + 0.45 * fbmT(u, v, 8, 3, 3); const hh = edge * (0.6 + 0.4 * dome); h[y * n + x] = hh;
    const tint = 0.8 + 0.35 * hash(id, 3, 8); const base = kind === 'cobble' ? [0.66, 0.6, 0.5] : [0.5, 0.46, 0.4]; const grime = 0.55 + 0.45 * edge; const o = (y * n + x) * 4;
    alb[o] = base[0] * tint * grime * 255; alb[o + 1] = base[1] * tint * grime * 255; alb[o + 2] = base[2] * tint * grime * 255; alb[o + 3] = 255;
    orm[o] = (0.45 + 0.55 * edge) * 255; orm[o + 1] = (0.88 - edge * 0.12) * 255; orm[o + 2] = 0; orm[o + 3] = 255;
  }
  return { alb, orm, nor: heightToNormal(h, n, kind === 'cobble' ? 6 : 4) };
}
function waterData(n: number) {
  const h = new Float32Array(n * n); const T = Math.PI * 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const u = x / n, v = y / n; h[y * n + x] = Math.sin(T * (2 * u + v)) * 0.5 + Math.sin(T * (u - 3 * v) + 1.3) * 0.35 + Math.sin(T * (4 * u + 3 * v) + 2.1) * 0.2 + fbmT(u, v, 8, 3, 11) * 0.6; }
  return heightToNormal(h, n, 1.6);
}
/** TEMPORARY: procedural stand-in for the authored KTX2 terrain, cliff, cobble and water sets. Browser or node (no canvas). */
export function fallbackTextureSet(size = 256): TerrainTextureSet {
  const ls = LAYERS.map((L) => layerData(L, size)); const cob = cellData(size, 'cobble'), cl = cellData(size, 'cliff');
  const splat = { albedo: arr(ls.map((l) => l.alb), size, true), normal: arr(ls.map((l) => l.nor), size, false), orm: arr(ls.map((l) => l.orm), size, false) };
  const cobble: Pbr2D = { albedo: tex2D(cob.alb, size, true), normal: tex2D(cob.nor, size, false), orm: tex2D(cob.orm, size, false) };
  const cliff: Pbr2D = { albedo: tex2D(cl.alb, size, true), normal: tex2D(cl.nor, size, false), orm: tex2D(cl.orm, size, false) };
  const waterNormal = tex2D(waterData(size), size, false);
  const all: THREE.Texture[] = [splat.albedo, splat.normal, splat.orm, cobble.albedo, cobble.normal, cobble.orm, cliff.albedo, cliff.normal, cliff.orm, waterNormal];
  return { splat, tile: [0.42, 0.34, 0.5, 0.45, 0.3, 0.5], cliff, cobble, waterNormal, onMaps: [], dispose: () => all.forEach((t) => t.dispose()) };
}

const SPLAT_FILES = ['grass', 'meadow', 'dirt', 'sand', 'cliff', 'mud'] as const;
const KIND = { albedo: 'bc', normal: 'n', orm: 'orm' } as const;
/** Six single-layer KTX2 files -> one CompressedArrayTexture per channel (whole-mip data is layer-major, as WebGLTextures uploads it). Null when the layers disagree on format or mips. */
async function loadSplatKtx2(ktx: KTX2Loader, base: string): Promise<TerrainTextureSet['splat'] | null> {
  const out: Partial<TerrainTextureSet['splat']> = {};
  for (const ch of ['albedo', 'normal', 'orm'] as const) {
    const layers = await Promise.all(SPLAT_FILES.map((k) => ktx.loadAsync(`${base}${k}_${KIND[ch]}.ktx2`))); const f = layers[0]; const mm = f.mipmaps;
    const same = layers.every((l) => l.format === f.format && l.type === f.type && l.mipmaps.length === mm.length && l.mipmaps[0].width === mm[0].width && l.mipmaps[0].height === mm[0].height);
    if (!same) { layers.forEach((l) => l.dispose()); Object.values(out).forEach((t) => t.dispose()); return null; }
    const mips = mm.map((m, i) => { const parts = layers.map((l) => l.mipmaps[i].data as Uint8Array); const data = new Uint8Array(parts.reduce((a, d) => a + d.byteLength, 0)); let o = 0; for (const d of parts) { data.set(d, o); o += d.byteLength; } return { data, width: m.width, height: m.height }; });
    const t = new THREE.CompressedArrayTexture(mips, mm[0].width, mm[0].height, SPLAT_FILES.length, f.format, f.type);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.generateMipmaps = false; t.anisotropy = 8;
    t.colorSpace = ch === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.onUpdate = () => { t.mipmaps = mips.map((m) => ({ ...m, data: new Uint8Array(0) })); }; // GPU has it; drop the CPU copy
    t.needsUpdate = true; out[ch] = t; layers.forEach((l) => l.dispose());
  }
  return out as TerrainTextureSet['splat'];
}
/** Drop the CPU copy of a compressed texture once the GPU has it (the clones the water makes each upload separately, so each calls this). */
export function gpuOnly<T extends THREE.CompressedTexture>(t: T): T { t.onUpdate = () => { t.mipmaps = t.mipmaps.map((m) => ({ ...m, data: new Uint8Array(0) })); }; return t; }
/** One KTX2 file -> repeat-wrapped, mipmapped, anisotropic compressed texture (null on any failure so the caller can fall back to the webp). */
async function loadMapKtx2(ktx: KTX2Loader, url: string, srgb: boolean): Promise<THREE.CompressedTexture | null> {
  try {
    const t = await ktx.loadAsync(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return gpuOnly(t);
  } catch { return null; }
}
async function decode(url: string, n: number): Promise<Uint8Array | null> {
  try {
    const bm = await createImageBitmap(await (await fetch(url)).blob()); const c = new OffscreenCanvas(n, n); const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(bm, 0, 0, n, n); const d = x.getImageData(0, 0, n, n).data; bm.close(); return new Uint8Array(d.buffer.slice(0));
  } catch { return null; }
}
/**
 * Replace the procedural stand-in pixels of `set` (created at size n) with the authored PBR maps from public/assets/nature/terrain/<palette>
 * (Blender-baked: terrain_tex.py). Done in place so materials already built from `set` pick the maps up on the next upload. Resolves false if any map is missing.
 */
export async function applyAuthoredTerrain(set: TerrainTextureSet, palette: 'village' | 'sanctuary', n: number, ktx: KTX2Loader | null = null): Promise<boolean> {
  // Splat arrays: the KTX2 path (preferred) loads each file at its native size, so ultra holds 6 layers x 3 maps at 4096 and high holds 2048. GPU memory depends on the transcode target
  // three's KTX2Loader picks (probed on Apple M-series via ANGLE-Metal, which exposes ASTC, BPTC, S3TC and ETC2: albedo and ORM are ETC1S -> ETC2 RGB 0.5 byte/texel, normals are UASTC -> ASTC 1 byte/texel;
  // measured 256 MB at ultra). A GPU without ETC2 (most desktop D3D/GL drivers) takes the BC7 branch for every map, 1 byte/texel: albedo and ORM double, so ultra is ~403 MB there
  // (3 maps x 6 layers x 4096^2 x 4/3 mips) against ~268 MB, and high ~101 MB against ~67 MB. Only the webp fallback below is capped at 2048 (RGBA8 at 4096 would be ~1.6 GB).
  // Single 2D sets (cobble, cliff, water) use the full n on both paths.
  const ns = Math.min(n, 2048);
  const base = `/assets/nature/terrain/${palette}/${n >= 4096 ? 'ultra' : 'high'}/`;
  const grab = async (k: string, m: 'bc' | 'n' | 'orm', sz = n) => decode(`${base}${k}_${m}.webp`, sz);
  const chans = { albedo: 'bc', normal: 'n', orm: 'orm' } as const;
  // preferred: compressed KTX2 arrays (GPU-resident BC/ASTC, full mips, native size on every tier); the webp decode below is the fallback
  const ks = ktx ? await loadSplatKtx2(ktx, base).catch(() => null) : null;
  if (ks) { const prevDispose = set.dispose; const old = set.splat; set.splat = ks; set.onSplat?.(ks); old.albedo.dispose(); old.normal.dispose(); old.orm.dispose(); set.dispose = () => { prevDispose(); ks.albedo.dispose(); ks.normal.dispose(); ks.orm.dispose(); }; }
  else {
    for (const ch of ['albedo', 'normal', 'orm'] as const) {
      const layers = await Promise.all(SPLAT_FILES.map((k) => grab(k, chans[ch], ns))); if (layers.some((l) => !l)) return false;
      const t = set.splat[ch] as THREE.DataArrayTexture; const data = new Uint8Array(ns * ns * 4 * SPLAT_FILES.length); layers.forEach((l, i) => data.set(l!, i * ns * ns * 4));
      t.dispose(); t.image = { data, width: ns, height: ns, depth: SPLAT_FILES.length } as never; t.needsUpdate = true;
    }
  }
  // single 2D sets: KTX2 when every channel loads, else the webp decode below (RGBA8, 64 MB each at 4096 before mips)
  const ktxSet = async (k: 'cobble' | 'cliff'): Promise<Pbr2D | null> => {
    if (!ktx) return null; const [albedo, normal, orm] = await Promise.all([loadMapKtx2(ktx, `${base}${k}_bc.ktx2`, true), loadMapKtx2(ktx, `${base}${k}_n.ktx2`, false), loadMapKtx2(ktx, `${base}${k}_orm.ktx2`, false)]);
    if (albedo && normal && orm) return { albedo, normal, orm }; for (const t of [albedo, normal, orm]) t?.dispose(); return null;
  };
  const swap = (which: 'cobble' | 'cliff', n2: Pbr2D) => { const old = set[which]; set[which] = n2; const pd = set.dispose; set.dispose = () => { pd(); n2.albedo.dispose(); n2.normal.dispose(); n2.orm.dispose(); }; set.onMaps.forEach((f) => f(which)); old.albedo.dispose(); old.normal.dispose(); old.orm.dispose(); };
  const kc = await ktxSet('cobble'), kl = await ktxSet('cliff'); if (kc) swap('cobble', kc); if (kl) swap('cliff', kl);
  const kw = ktx ? await loadMapKtx2(ktx, `${base}water_n.ktx2`, false) : null;
  if (kw) { const old = set.waterNormal; set.waterNormal = kw; const pd = set.dispose; set.dispose = () => { pd(); kw.dispose(); }; set.onMaps.forEach((f) => f('water')); old.dispose(); }
  const one = async (t: Pbr2D, k: string) => {
    for (const ch of ['albedo', 'normal', 'orm'] as const) { const px = await grab(k, chans[ch]); if (!px) return false; const tx = t[ch] as THREE.DataTexture; tx.dispose(); tx.image = { data: px, width: n, height: n } as never; tx.needsUpdate = true; }
    return true;
  };
  if (!kc && !(await one(set.cobble, 'cobble'))) return false; if (!kl && !(await one(set.cliff, 'cliff'))) return false;
  if (kw) return true;
  const wn = await decode(`${base}water_n.webp`, n); const wt = set.waterNormal as THREE.DataTexture; if (wn) { wt.dispose(); wt.image = { data: wn, width: n, height: n } as never; wt.needsUpdate = true; }
  return true;
}
