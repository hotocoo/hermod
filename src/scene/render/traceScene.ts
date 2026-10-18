import * as THREE from 'three';
import { STILL } from '@/config/scene';
import { layerMeans } from './terrainShader';

const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _c = new THREE.Color();

/** Things the path tracer must not see: decals and fx drawn for the raster look only. */
function traceable(o: THREE.Mesh): boolean {
  const mat = o.material as THREE.Material | THREE.Material[]; const m = Array.isArray(mat) ? mat[0] : mat;
  if (!m || o.userData.noAO || o.userData.noTrace) return false;
  if (o.name === 'village:paths') return false; // alpha-blended overlay: the tracer has no blending, so it would paint its texture over the whole footprint
  if ((m as THREE.ShadowMaterial).isShadowMaterial) return false;
  if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial && (m.transparent || m.blending === THREE.AdditiveBlending)) return false;
  return true;
}

/** Bake every instance of an InstancedMesh into one world space geometry (the tracer's scene generator ignores instancing). Colors become RGBA vertex colors. */
function expand(mesh: THREE.InstancedMesh): { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null {
  const g = mesh.geometry; const n = mesh.count; const pos = g.attributes.position as THREE.BufferAttribute | undefined; if (!n || !pos) return null;
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined, uv = g.attributes.uv as THREE.BufferAttribute | undefined, col = g.attributes.color as THREE.BufferAttribute | undefined; const idx = g.index;
  const vc = pos.count, ic = idx ? idx.count : vc;
  const P = new Float32Array(vc * n * 3), N = new Float32Array(vc * n * 3), UV = new Float32Array(vc * n * 2), C = new Float32Array(vc * n * 4), I = new Uint32Array(ic * n);
  const hasInstColor = !!mesh.instanceColor;
  for (let k = 0; k < n; k++) {
    mesh.getMatrixAt(k, _m); _m.premultiply(mesh.matrixWorld); _n.getNormalMatrix(_m); if (hasInstColor) mesh.getColorAt(k, _c); else _c.setRGB(1, 1, 1);
    for (let i = 0; i < vc; i++) {
      const o = k * vc + i; _v.fromBufferAttribute(pos, i).applyMatrix4(_m); P[o * 3] = _v.x; P[o * 3 + 1] = _v.y; P[o * 3 + 2] = _v.z;
      if (nor) { _v.fromBufferAttribute(nor, i).applyMatrix3(_n).normalize(); N[o * 3] = _v.x; N[o * 3 + 1] = _v.y; N[o * 3 + 2] = _v.z; }
      if (uv) { UV[o * 2] = uv.getX(i); UV[o * 2 + 1] = uv.getY(i); }
      C[o * 4] = (col ? col.getX(i) : 1) * _c.r; C[o * 4 + 1] = (col ? col.getY(i) : 1) * _c.g; C[o * 4 + 2] = (col ? col.getZ(i) : 1) * _c.b; C[o * 4 + 3] = 1;
    }
    for (let i = 0; i < ic; i++) I[k * ic + i] = (idx ? idx.getX(i) : i) + k * vc;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); geo.setAttribute('color', new THREE.BufferAttribute(C, 4)); geo.setIndex(new THREE.BufferAttribute(I, 1));
  const sm = stdMat(mesh.material, hasInstColor || !!col); return { geo, mat: Array.isArray(sm) ? sm[0] : sm }; // shortcut: an instanced multi-material mesh traces as its first material (none exist today), split by group like oneMaterialEach if one appears
}

let gpuRenderer: THREE.WebGLRenderer | null = null;
/** The live renderer: GPU-compressed (KTX2) textures have no CPU pixels, so the tracer copies get drawn through it. Set once by still.ts. */
export const setTraceRenderer = (r: THREE.WebGLRenderer): void => { gpuRenderer = r; };
const blits = new Map<string, { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial }>();
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
/** Draw `tex` through a one-line sampler into an 8-bit target (in `space`) and read the bytes back. `array` textures sample layer `layer` at a coarse mip (layer means). */
function gpuRead(tex: THREE.Texture, w: number, h: number, space: THREE.ColorSpace, array = false, layer = 0): Uint8Array | null {
  const r = gpuRenderer; if (!r) return null; const kind = array ? 'array' : 'flat';
  let b = blits.get(kind); if (!b) {
    const mat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null as THREE.Texture | null }, uLayer: { value: 0 } }, depthTest: false, depthWrite: false, vertexShader: VERT,
      fragmentShader: array ? 'uniform sampler2DArray tSrc; uniform float uLayer; varying vec2 vUv; void main() { gl_FragColor = textureLod(tSrc, vec3(vUv, uLayer), 3.0);\n#include <colorspace_fragment>\n}'
        : 'uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv);\n#include <colorspace_fragment>\n}' });
    const scene = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false; scene.add(q); b = { scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat }; blits.set(kind, b); }
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: space, depthBuffer: false, generateMipmaps: false });
  const prev = r.getRenderTarget(), ac = r.autoClear, tm = r.toneMapping; const px = new Uint8Array(w * h * 4);
  try { b.mat.uniforms.tSrc.value = tex; b.mat.uniforms.uLayer.value = layer; r.autoClear = true; r.toneMapping = THREE.NoToneMapping; r.setRenderTarget(rt); r.render(b.scene, b.cam); r.readRenderTargetPixels(rt, 0, 0, w, h, px); }
  catch { return null; } finally { r.setRenderTarget(prev); r.autoClear = ac; r.toneMapping = tm; b.mat.uniforms.tSrc.value = null; rt.dispose(); }
  return px;
}
const gpuCopy = (t: THREE.Texture, w: number, h: number) => gpuRead(t, w, h, t.colorSpace as THREE.ColorSpace);

const meanCache = new Map<string, THREE.Color[]>();
/** Mean linear albedo per splat layer of the texture set the terrain material is showing right now (the compressed set swaps in late, so the colours baked at build time can be stale): CPU pixels when present, else a GPU read at a coarse mip. */
function splatMeansOf(mat: THREE.Material): THREE.Color[] | undefined {
  const base = mat.userData.splatMeans as THREE.Color[] | undefined; const tex = (mat.userData.splatUniforms as { uSpA?: { value: THREE.Texture | null } } | undefined)?.uSpA?.value; if (!tex) return base;
  const key = tex.uuid + ':' + tex.version; const hit = meanCache.get(key); if (hit) return hit;
  let out: THREE.Color[] | null = null; const img = tex.image as { data?: ArrayLike<number> } | undefined;
  if (img?.data) out = layerMeans(tex);
  else { const layers = (tex.image as { depth?: number }).depth ?? 6; const cols: THREE.Color[] = []; for (let l = 0; l < Math.min(6, layers); l++) { const px = gpuRead(tex, 8, 8, THREE.SRGBColorSpace, true, l); if (!px) { cols.length = 0; break; } let rr = 0, gg = 0, bb = 0; for (let i = 0; i < 64; i++) { rr += px[i * 4]; gg += px[i * 4 + 1]; bb += px[i * 4 + 2]; } cols.push(new THREE.Color(rr / 64 / 255, gg / 64 / 255, bb / 64 / 255).convertSRGBToLinear()); } if (cols.length === 6) out = cols; }
  if (out) meanCache.set(key, out); return out ?? base;
}

/** Tracer-readable copy of a texture: drawn to a canvas (decodes ImageBitmap and canvas sources) or, for GPU-compressed KTX2 textures, through the renderer, and read back as RGBA bytes. Cached per source texture. */
const texCopies = new Map<string, THREE.DataTexture | null>();
export function readable(t: THREE.Texture | null | undefined): THREE.Texture | null {
  if (!t) return null; const key = t.uuid + ':' + t.version; if (texCopies.has(key)) return texCopies.get(key) ?? t;
  const img = t.image as { width: number; height: number } | undefined; let out: THREE.DataTexture | null = null;
  const finish = (data: Uint8Array, w: number, h: number) => { const d = new THREE.DataTexture(data, w, h, THREE.RGBAFormat); d.colorSpace = t.colorSpace; d.wrapS = t.wrapS; d.wrapT = t.wrapT; d.repeat.copy(t.repeat); d.offset.copy(t.offset); d.channel = t.channel; d.flipY = false; d.generateMipmaps = true; d.minFilter = THREE.LinearMipmapLinearFilter; d.needsUpdate = true; return d; };
  try {
    if (img && img.width && (t as THREE.CompressedTexture).isCompressedTexture && !(t as THREE.CompressedArrayTexture).isCompressedArrayTexture) {
      const w = Math.min(512, img.width), h = Math.min(512, img.height); const px = gpuCopy(t, w, h); if (px) out = finish(px, w, h);
    } else if (img && img.width && !(t as THREE.DataTexture).isDataTexture) {
      const w = Math.min(512, img.width), h = Math.min(512, img.height); const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(img as unknown as CanvasImageSource, 0, 0, w, h); const px = cx.getImageData(0, 0, w, h).data; const data = new Uint8Array(px.length);
      for (let y = 0; y < h; y++) { const src = (t.flipY ? h - 1 - y : y) * w * 4; data.set(px.subarray(src, src + w * 4), y * w * 4); }
      out = finish(data, w, h);
    }
  } catch { out = null; }
  if (!out && (t as THREE.CompressedTexture).isCompressedTexture && !gpuRenderer) return t; // no renderer yet: do not cache the miss
  texCopies.set(key, out); return out ?? t;
}

type Anyish = THREE.Material & Partial<THREE.MeshPhysicalMaterial> & { color?: THREE.Color };
const stdCache = new Map<string, THREE.MeshPhysicalMaterial>();
/** Physical-field copy of a material for the tracer (the one library that reads clearcoat, sheen, transmission, IOR, volume and specular); emissive is pre-multiplied by its intensity. Anisotropy has no tracer equivalent: brushed metal traces as isotropic at its raster roughness. */
function standard(m: THREE.Material, vertexColors: boolean): THREE.MeshPhysicalMaterial {
  const key = m.uuid + ':' + m.version + (vertexColors ? 'v' : ''); const hit = stdCache.get(key); if (hit) return hit;
  const a = m as Anyish; const e = new THREE.Color(0, 0, 0); if (a.emissive) e.copy(a.emissive).multiplyScalar(a.emissiveIntensity ?? 1);
  const o = new THREE.MeshPhysicalMaterial({ color: a.color ? a.color.clone() : new THREE.Color(1, 1, 1), map: readable(a.map), roughness: a.roughness ?? 0.9, metalness: a.metalness ?? 0, normalMap: readable(a.normalMap), emissive: e, emissiveMap: a.emissiveMap ?? null, roughnessMap: readable(a.roughnessMap), metalnessMap: readable(a.metalnessMap), vertexColors: vertexColors || !!a.vertexColors, alphaTest: a.alphaTest, transparent: a.transparent, opacity: a.opacity, side: a.side });
  if (a.normalScale) o.normalScale.copy(a.normalScale); o.alphaMap = a.alphaMap ?? null;
  if ((a as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    o.clearcoat = a.clearcoat ?? 0; o.clearcoatRoughness = a.clearcoatRoughness ?? 0; o.sheen = a.sheen ?? 0; o.sheenRoughness = a.sheenRoughness ?? 1; if (a.sheenColor) o.sheenColor.copy(a.sheenColor);
    o.ior = a.ior ?? 1.5; o.specularIntensity = a.specularIntensity ?? 1; if (a.specularColor) o.specularColor.copy(a.specularColor); o.iridescence = a.iridescence ?? 0; o.iridescenceIOR = a.iridescenceIOR ?? 1.3;
    o.transmission = a.transmission ?? 0; o.thickness = a.thickness ?? 0; o.attenuationDistance = a.attenuationDistance ?? Infinity; if (a.attenuationColor) o.attenuationColor.copy(a.attenuationColor);
    if (o.transmission > 0) { o.transparent = false; o.opacity = 1; }
  }
  stdCache.set(key, o); return o;
}
const stdMat = (m: THREE.Material | THREE.Material[], vc = false) => (Array.isArray(m) ? m.map((x) => standard(x, vc)) : standard(m, vc));

let waterMat: THREE.MeshPhysicalMaterial | null = null;
const waterTrace = () => (waterMat ??= new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.6, 0.95, 1), roughness: 0.03, metalness: 0, ior: 1.33, transmission: 1, thickness: 1.2, attenuationColor: new THREE.Color(0.5, 0.85, 0.9), attenuationDistance: 1, emissive: new THREE.Color(0.03, 0.09, 0.1), side: THREE.DoubleSide })); // emissive stands in for in-scattered sky light (no volume scattering in the tracer): without it a shallow pond traced a grey-green bed colour, the raster pond is cyan

/** Same geometry, RGBA vertex colors (the tracer packs them as vec4). */
function rgba(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = g.attributes.color as THREE.BufferAttribute | undefined; if (!c || c.itemSize === 4) return g;
  const out = g.clone(); const a = new Float32Array(c.count * 4); for (let i = 0; i < c.count; i++) { a[i * 4] = c.getX(i); a[i * 4 + 1] = c.getY(i); a[i * 4 + 2] = c.getZ(i); a[i * 4 + 3] = 1; }
  out.setAttribute('color', new THREE.BufferAttribute(a, 4)); return out;
}

/** The path tracer's generator maps merge group i to materials[i] and appends a mesh's whole material array to that list, so a mesh with an array material shifts every later mesh onto the wrong material (the uuid sort made it a coin flip per run). Split such a mesh into one single-material mesh per geometry group, sharing the attributes. */
export function oneMaterialEach(g: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  if (!Array.isArray(mat)) return [{ geo: g, mat }];
  const total = g.index ? g.index.count : g.attributes.position.count; const groups = g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }]; const out: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  for (const gr of groups) {
    const m = mat[gr.materialIndex ?? 0]; const count = Math.min(gr.count, total - gr.start); if (!m || count <= 0) continue;
    const geo = new THREE.BufferGeometry(); for (const k of Object.keys(g.attributes)) geo.setAttribute(k, g.attributes[k]);
    const ix = new Uint32Array(count); for (let i = 0; i < count; i++) ix[i] = g.index ? g.index.getX(gr.start + i) : gr.start + i; geo.setIndex(new THREE.BufferAttribute(ix, 1)); out.push({ geo, mat: m });
  }
  return out;
}

/** A flat, world space copy of the visible scene for the path tracer: instances expanded, raster only fx dropped, lights copied. Dispose `owned` afterwards. */
export function buildTraceScene(scene: THREE.Scene): { scene: THREE.Scene; owned: THREE.BufferGeometry[]; tris: number } {
  const out = new THREE.Scene(); const owned: THREE.BufferGeometry[] = []; let tris = 0; scene.updateMatrixWorld(true);
  scene.traverseVisible((o) => {
    if ((o as THREE.DirectionalLight).isDirectionalLight || (o as THREE.PointLight).isPointLight || (o as THREE.SpotLight).isSpotLight) {
      const l = o as THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight; if (l.intensity <= 0) return; const c = l.clone(false); c.matrixAutoUpdate = false; c.matrix.copy(l.matrixWorld); c.matrixWorld.copy(l.matrixWorld); c.castShadow = false;
      if ((l as THREE.DirectionalLight).isDirectionalLight || (l as THREE.SpotLight).isSpotLight) { const t = new THREE.Object3D(); _v.setFromMatrixPosition((l as THREE.DirectionalLight).target.matrixWorld); t.position.copy(_v); t.updateMatrixWorld(); out.add(t); (c as THREE.DirectionalLight).target = t; }
      out.add(c); return;
    }
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || !traceable(mesh)) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const im = mesh as THREE.InstancedMesh; const perInst = (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3;
      if (tris + perInst * im.count > STILL.maxTriangles) return; const e = expand(im); if (!e) return; owned.push(e.geo); tris += perInst * im.count;
      const m = new THREE.Mesh(e.geo, e.mat); m.matrixAutoUpdate = false; out.add(m); return;
    }
    const sm = splatMeansOf(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    if (sm && mesh.geometry.attributes.aW0) { // terrain splat: bake the layer blend into vertex colours (the tracer cannot run the splat shader)
      const base = mesh.geometry; const w0 = base.attributes.aW0 as THREE.BufferAttribute, w1 = base.attributes.aW1 as THREE.BufferAttribute; const n = w0.count; const C = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { const w = [w0.getX(i), w0.getY(i), w0.getZ(i), w0.getW(i), w1.getX(i), w1.getY(i)]; let r = 0, gg = 0, b = 0; for (let k = 0; k < 6; k++) { r += sm[k].r * w[k]; gg += sm[k].g * w[k]; b += sm[k].b * w[k]; } const lum = r * 0.3 + gg * 0.59 + b * 0.11; C[i * 4] = (r + (lum - r) * 0.28) * 1.18; C[i * 4 + 1] = (gg + (lum - gg) * 0.28) * 1.18; C[i * 4 + 2] = (b + (lum - b) * 0.28) * 1.18; C[i * 4 + 3] = 1; } // desaturate and lift: the raster adds sky and probe light the tracer's gradient sky lacks
      const g2 = base.clone(); g2.setAttribute('color', new THREE.BufferAttribute(C, 4)); g2.deleteAttribute('aW0'); g2.deleteAttribute('aW1'); owned.push(g2); tris += (g2.index ? g2.index.count : n) / 3;
      // double sided: the raster top may be wound either way, and a culled top shows the cliff hull through it
      const tm = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }); const m2 = new THREE.Mesh(g2, tm); m2.matrixAutoUpdate = false; m2.matrix.copy(mesh.matrixWorld); m2.matrixWorld.copy(mesh.matrixWorld); out.add(m2); return;
    }
    if (mesh.name.startsWith('water:')) { // water: a real dielectric (IOR 1.33, transmission, depth absorption) over the carved bed; the tracer has no alpha blending, so the raster's shore fade and foam ramp (vertex colour) is dropped
      const wg = mesh.geometry; tris += (wg.index ? wg.index.count : wg.attributes.position.count) / 3;
      const wm = new THREE.Mesh(wg, waterTrace()); wm.matrixAutoUpdate = false; wm.matrix.copy(mesh.matrixWorld); wm.matrixWorld.copy(mesh.matrixWorld); out.add(wm); return;
    }
    const g = rgba(mesh.geometry); if (g !== mesh.geometry) owned.push(g); tris += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
    for (const part of oneMaterialEach(g, stdMat(mesh.material))) { if (part.geo !== g) owned.push(part.geo); const m = new THREE.Mesh(part.geo, part.mat); m.name = mesh.name; m.matrixAutoUpdate = false; m.matrix.copy(mesh.matrixWorld); m.matrixWorld.copy(mesh.matrixWorld); out.add(m); }
  });
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') (window as unknown as { __traceScene: unknown }).__traceScene = out; // dev only: material parity probes
  return { scene: out, owned, tris };
}

/** Convert the scene's textures to tracer-readable copies a few at a time (call every idle frame; returns true when nothing is left), so engaging the tracer never pays for a burst of canvas readbacks. */
export function warmTraceTextures(scene: THREE.Object3D, budgetMs = 3): boolean {
  const t0 = performance.now(); let left = false;
  scene.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (!mm || left && performance.now() - t0 > budgetMs) return;
    for (const m of Array.isArray(mm) ? mm : [mm]) { const a = m as Anyish; for (const t of [a.map, a.normalMap]) { if (!t) continue; if (texCopies.has(t.uuid + ':' + t.version)) continue; if (performance.now() - t0 > budgetMs) { left = true; return; } readable(t); } } });
  return !left;
}

/** three-gpu-pathtracer 0.0.24 appends one merge group per mesh on every generate and never clears the shared target geometry's groups, so a rebuild (hour change, invalidate) traces with stale groups: blank or mis-textured frames. Call before every rebuild. shortcut: private field, drop once the library clears groups itself (traceRebuild.test.ts fails then). */
export function resetMergeGroups(pt: unknown): void { (pt as { _generator?: { geometry?: THREE.BufferGeometry } })._generator?.geometry?.clearGroups(); }
