import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { acquireKtx2, releaseKtx2 } from './ktx2';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AssetTier, HdriEntry, Manifest, MaterialEntry, MaterialOverride, ModelEntry } from './types';

/** Where tier files live. 'ultra' is the downloaded pack (cached by the app); a missing ultra file falls back to 'high'. */
export interface AssetLibraryOptions {
  renderer: THREE.WebGLRenderer;
  tier?: AssetTier;
  /** URL prefix per tier, with trailing slash. */
  base?: Record<AssetTier, string>;
  /** KTX2 transcoder directory (public/assets/basis/), with trailing slash. */
  basis?: string;
  /** Unreferenced assets kept warm before GPU/CPU disposal. */
  warm?: number;
}
const DEFAULT_BASE: Record<AssetTier, string> = { high: '/assets/high/', ultra: '/assets/ultra/' };

export interface RoomBakeEntry { glb: string; lightmap: string; furniture?: { image: string; grid: number; tiles: ({ key: string; tile: [number, number, number] } | null)[] } | null }
export interface RoomBake { parts: ShellPartLike[]; lightMap: THREE.Texture; furnitureMap: THREE.Texture | null; tiles: Map<number, [number, number, number]>; grid: number }
export interface ShellPartLike { name: string; material: string; geometry: THREE.BufferGeometry }
export interface PbrOptions { repeat?: [number, number]; rotation?: number; normalScale?: number; color?: THREE.ColorRepresentation }

/** Seated figures are 5 to 8 m from a room camera: beyond this the lighter LOD1 skin is drawn (about a third of the triangles). */
const FIGURE_LOD1_M = 3.5;

/** A loaded model: shared LOD node templates. Use `spawn` / `instanced`, never mutate the templates. */
export interface ModelAsset {
  entry: ModelEntry; tier: AssetTier; lods: THREE.Object3D[]; refs: number;
  /** Material names (from manifest `slots`) a room replaces per instance. */
  slotNames: string[];
  /** Rigged figures keep their whole scene and clips; `lods` is empty for them. */
  figure?: { scene: THREE.Object3D; clips: THREE.AnimationClip[] };
}
/** A live person: mixer-driven idle clip with mesh LOD by camera distance. */
export interface Figure { object: THREE.Object3D; play(clip: string, fade?: number): void; update(dt: number, camDist: number): void; dispose(): void }
export interface Spawned { object: THREE.Object3D; slots: Record<string, THREE.MeshStandardMaterial> }

const key = (...p: (string | number)[]) => p.join('|');
const abortErr = () => new DOMException('aborted', 'AbortError');
const raceAbort = <T,>(p: Promise<T>, s?: AbortSignal): Promise<T> => {
  if (!s) return p;
  if (s.aborted) return Promise.reject(abortErr());
  return new Promise<T>((res, rej) => { const f = () => rej(abortErr()); s.addEventListener('abort', f, { once: true }); p.then((v) => { s.removeEventListener('abort', f); res(v); }, (e) => { s.removeEventListener('abort', f); rej(e); }); });
};

/** Loads manifest-described assets: GLTF + Meshopt + KTX2, shared texture and material caches, ref-counted leases and LRU disposal. */
export class AssetLibrary {
  readonly tier: AssetTier;
  readonly renderer: THREE.WebGLRenderer;
  private readonly base: Record<AssetTier, string>;
  private readonly gltf: GLTFLoader;
  private readonly ktx2: KTX2Loader;
  private readonly aniso: number;
  private readonly warm: number;
  private man: Promise<Manifest> | null = null;
  private models = new Map<string, Promise<ModelAsset>>();
  private ready = new Map<string, ModelAsset>();
  private texCache = new Map<string, Promise<THREE.Texture>>();
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private lru: string[] = [];
  private disposed = false;
  private roomsMan: Promise<Record<string, Partial<Record<AssetTier, RoomBakeEntry>>>> | null = null;

  constructor(o: AssetLibraryOptions) {
    this.renderer = o.renderer; this.tier = o.tier ?? 'high'; this.base = o.base ?? DEFAULT_BASE; this.warm = o.warm ?? 24;
    this.aniso = o.renderer.capabilities.getMaxAnisotropy();
    this.ktx2 = acquireKtx2(o.renderer, o.basis);
    this.gltf = new GLTFLoader().setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  manifest(): Promise<Manifest> { return (this.man ??= import('./manifest.json').then((m) => (m.default ?? m) as unknown as Manifest)); }
  async entry(id: string): Promise<ModelEntry> { const e = (await this.manifest()).models[id]; if (!e) throw new Error(`unknown model ${id}`); return e; }

  private url(rel: string, tier: AssetTier) { return this.base[tier] + rel; }
  /** URL of a loose high-tier file (room artwork); never ultra-only, so it resolves without the pack. */
  highUrl(rel: string) { return this.url(rel, 'high'); }
  private pick<T extends { tiers: Partial<Record<AssetTier, unknown>> }>(e: T): AssetTier { return e.tiers[this.tier] ? this.tier : 'high'; }

  private fixTexture(t: THREE.Texture, srgb: boolean): THREE.Texture {
    t.anisotropy = this.aniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
  }
  private texture(url: string, srgb: boolean): Promise<THREE.Texture> {
    const k = key(url, srgb ? 's' : 'l'); let p = this.texCache.get(k);
    if (!p) { p = this.ktx2.loadAsync(url).then((t) => this.fixTexture(t, srgb)); p.catch(() => this.texCache.delete(k)); this.texCache.set(k, p); }
    return p;
  }

  /** Tiling PBR set (base, normal, ORM). Textures are shared; `repeat` clones only the sampler state. */
  async material(id: string, opt: PbrOptions = {}, signal?: AbortSignal): Promise<THREE.MeshStandardMaterial> {
    const e: MaterialEntry | undefined = (await this.manifest()).materials[id]; if (!e) throw new Error(`unknown material ${id}`);
    const tier = this.pick(e); const f = e.tiers[tier]!.file; const rep = opt.repeat ?? [1, 1];
    const k = key('mat', id, tier, rep[0], rep[1], opt.rotation ?? 0, opt.normalScale ?? 1, String(opt.color ?? ''));
    const hit = this.matCache.get(k); if (hit) return hit;
    const [base, nor, orm] = await raceAbort(Promise.all([this.texture(this.url(f.base, tier), true), this.texture(this.url(f.normal, tier), false), this.texture(this.url(f.orm, tier), false)]), signal);
    const again = this.matCache.get(k); if (again) return again;
    const tune = (t: THREE.Texture) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rep[0], rep[1]); c.rotation = opt.rotation ?? 0; c.anisotropy = this.aniso; c.colorSpace = t.colorSpace; c.needsUpdate = true; return c; };
    const bt = tune(base), nt = tune(nor), ot = tune(orm);
    const m = new THREE.MeshStandardMaterial({ map: bt, normalMap: nt, aoMap: ot, roughnessMap: ot, metalnessMap: ot, roughness: 1, metalness: 1, color: opt.color ?? 0xffffff });
    m.normalScale.setScalar(opt.normalScale ?? 1); m.name = id; this.matCache.set(k, m); return m;
  }

  async hdri(id: string, signal?: AbortSignal): Promise<THREE.DataTexture> {
    const e: HdriEntry | undefined = (await this.manifest()).hdris[id]; if (!e) throw new Error(`unknown hdri ${id}`);
    const tier = this.pick(e); const t = await raceAbort(new HDRLoader().loadAsync(this.url(e.tiers[tier]!.file, tier)), signal);
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.NoColorSpace; return t;
  }

  /** Baked room shell (UV0 PBR + UV1 lightmap, from scripts/assets/rooms/bake.mjs). Null when the room has no bake for this tier. */
  async bakedRoom(section: string, signal?: AbortSignal): Promise<RoomBake | null> {
    if (!this.roomsMan) this.roomsMan = import('./rooms.json').then((m) => (m.default ?? m) as unknown as Record<string, Partial<Record<AssetTier, RoomBakeEntry>>>).catch(() => ({}));
    const e = (await this.roomsMan)[section]; const tier: AssetTier = e?.[this.tier] ? this.tier : 'high'; const f = e?.[tier]; if (!f) return null;
    const tl = new THREE.TextureLoader(); const [g, lm, fmT] = await raceAbort(Promise.all([this.gltf.loadAsync(this.url(f.glb, tier)), tl.loadAsync(this.url(f.lightmap, tier)), f.furniture ? tl.loadAsync(this.url(f.furniture.image, tier)) : Promise.resolve(null)]), signal);
    if (fmT) { fmT.flipY = false; fmT.colorSpace = THREE.NoColorSpace; fmT.channel = 1; fmT.anisotropy = this.aniso; fmT.needsUpdate = true; }
    lm.flipY = false; lm.colorSpace = THREE.NoColorSpace; lm.channel = 1; lm.anisotropy = this.aniso; lm.generateMipmaps = true; lm.minFilter = THREE.LinearMipmapLinearFilter; lm.needsUpdate = true;
    const parts: ShellPartLike[] = []; g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) parts.push({ name: (m.material as THREE.Material).name.split('@')[1] ? (m.material as THREE.Material).name.split('@')[0] : m.name, material: (m.material as THREE.Material).name.split('@')[1] ?? (m.material as THREE.Material).name, geometry: m.geometry }); });
    const tiles = new Map<number, [number, number, number]>(); f.furniture?.tiles.forEach((t, i) => { if (t) tiles.set(i, t.tile); });
    return { parts, lightMap: lm, furnitureMap: fmT, tiles, grid: f.furniture?.grid ?? 1 };
  }

  /** Load a model (deduplicated). Callers hold it through a `lease()` so disposal knows who still needs it. */
  async model(id: string, signal?: AbortSignal): Promise<ModelAsset> {
    if (this.disposed) throw abortErr();
    const hit = this.ready.get(id); if (hit) return hit;
    let p = this.models.get(id);
    if (!p) {
      p = this.entry(id).then(async (entry) => {
        const tier = this.pick(entry); const g = await this.gltf.loadAsync(this.url(entry.tiers[tier]!.file, tier));
        const ups = new Map<THREE.Material, THREE.Material>();
        if (entry.figure) {
          g.scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (!m.isMesh) return; m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false; this.upgrade(m, entry, ups);
            // seated hips fold the pants into the hem of the top: a small depth bias keeps upper garments in front there (grey spikes through the sweater)
            if (/sweater|polo|shirt|turtleneck|blouse|dress|jacket|top\b/i.test(m.name)) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) { mm.polygonOffset = true; mm.polygonOffsetFactor = -2; mm.polygonOffsetUnits = -8; } });
          const fa: ModelAsset = { entry, tier, lods: [], refs: 0, slotNames: [], figure: { scene: g.scene, clips: g.animations } };
          if (!this.disposed) this.ready.set(id, fa); return fa;
        }
        const lods = [0, 1, 2].map((i) => g.scene.getObjectByName(`LOD${i}`)).filter((o): o is THREE.Object3D => !!o);
        lods.forEach((l) => l.removeFromParent());
        const slotNames = Object.keys(entry.slots ?? {});
        for (const l of lods) l.traverse((o) => {
          const m = o as THREE.Mesh; if (!m.isMesh) return;
          // Picture-frame glass sits in the artwork plane and rendered opaque black; art keeps its (painted) surface, no pane.
          if (entry.category === 'art' && /glass/i.test((m.material as THREE.Material).name)) { m.visible = false; return; }
          m.castShadow = entry.shadow.cast; m.receiveShadow = entry.shadow.receive; m.matrixAutoUpdate = false;
          this.upgrade(m, entry, ups);
        });
        const asset: ModelAsset = { entry, tier, lods, refs: 0, slotNames };
        if (!this.disposed) this.ready.set(id, asset);
        return asset;
      });
      p.catch(() => this.models.delete(id)); this.models.set(id, p);
    }
    return raceAbort(p, signal);
  }

  /** Per-material fidelity: manifest `materialOverrides` (clearcoat, sheen, anisotropy, transmission, volume, ior) on top of whatever the glTF carried (KHR_materials_*), on high and ultra alike. */
  private upgrade(mesh: THREE.Mesh, entry: ModelEntry, ups: Map<THREE.Material, THREE.Material>) {
    const fix = (mm: THREE.Material): THREE.Material => {
      let out = ups.get(mm); if (out) return out;
      const ov = entry.materialOverrides?.[mm.name]; out = ov && (mm as THREE.MeshStandardMaterial).isMeshStandardMaterial ? this.override(mm as THREE.MeshStandardMaterial, ov) : mm;
      this.tuneMaterial(out as THREE.MeshStandardMaterial); ups.set(mm, out); return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
  }

  /** Physical copy of a standard material with the override fields applied (authored glTF values stay where the override does not name them). */
  private override(m: THREE.MeshStandardMaterial, ov: MaterialOverride): THREE.MeshStandardMaterial {
    const { pom, ...phys } = ov; if (pom) m.userData.pom = true; if (!Object.keys(phys).length) return m;
    let p = m as THREE.MeshPhysicalMaterial;
    if (!p.isMeshPhysicalMaterial) { p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, m); p.name = m.name; p.defines = { STANDARD: '', PHYSICAL: '' }; } // the standard copy() drops PHYSICAL: no #define IOR, so transmission glass failed to compile
    const o = phys as Record<string, number | string>;
    for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string') ((p as unknown as Record<string, THREE.Color>)[k]).set(v); else (p as unknown as Record<string, number>)[k] = v; }
    if (p.transmission > 0) { p.transparent = false; p.depthWrite = true; p.opacity = 1; }
    p.needsUpdate = true; return p;
  }

  private tuneMaterial(m: THREE.MeshStandardMaterial) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) { const t = m[k]; if (t) t.anisotropy = this.aniso; }
    if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
    // Glass (authored or tagged) keeps real transmission, IOR and volume on high and ultra: the pane refracts the scene behind it at 1x.
    const t = m as THREE.MeshPhysicalMaterial;
    if (t.isMeshPhysicalMaterial && t.transmission > 0) { t.thickness = Math.max(t.thickness, 0.02); t.ior = t.ior || 1.5; t.envMapIntensity = Math.max(t.envMapIntensity, 1.2); t.needsUpdate = true; }
  }

  /** One LOD-switching object (or a single mesh group when the asset has one LOD) that shares geometry and materials with every other spawn. */
  spawn(a: ModelAsset): Spawned {
    const slots: Record<string, THREE.MeshStandardMaterial> = {};
    const lod = new THREE.LOD();
    a.lods.forEach((tpl, i) => {
      const n = tpl.clone(true);
      n.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const mm = m.material as THREE.MeshStandardMaterial;
        if (a.slotNames.includes(mm.name)) { slots[mm.name] ??= mm.clone(); m.material = slots[mm.name]; }
      });
      lod.addLevel(n, a.entry.lods[i]?.dist ?? 0);
    });
    lod.autoUpdate = true; lod.userData.assetId = a.entry.id;
    return { object: lod, slots };
  }

  /** A rigged person with its own skeleton, playing baked clips; swaps to the LOD1 meshes beyond the manifest distance. */
  spawnFigure(a: ModelAsset): Figure {
    if (!a.figure) throw new Error(`${a.entry.id} is not a figure`);
    const root = cloneSkinned(a.figure.scene); const mixer = new THREE.AnimationMixer(root); const far = Math.min(a.entry.lods[1]?.dist ?? 9, FIGURE_LOD1_M);
    const meshes: { m: THREE.Object3D; lod: number }[] = []; const dirty = new Map<THREE.Skeleton, boolean>();
    root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh; if (!sm.isMesh) return; meshes.push({ m: o, lod: /_LOD1_/.test(o.name) ? 1 : 0 });
      // bones only change when the mixer steps: recompute and re-upload the bone texture once per step, not on every render pass of every frame
      if (sm.isSkinnedMesh && !dirty.has(sm.skeleton)) { const sk = sm.skeleton; const upd = sk.update.bind(sk); dirty.set(sk, true); sk.update = () => { if (dirty.get(sk)) { dirty.set(sk, false); upd(); } }; }
    });
    let cur: THREE.AnimationAction | null = null; let lod = 0;
    const apply = (l: number) => { lod = l; meshes.forEach((x) => { x.m.visible = x.lod === l; }); }; apply(0);
    return {
      object: root,
      play: (name, fade = 0.3) => { const c = THREE.AnimationClip.findByName(a.figure!.clips, name); if (!c) return; const next = mixer.clipAction(c); if (cur === next) return; next.reset().fadeIn(fade).play(); cur?.fadeOut(fade); cur = next; next.time = Math.random() * c.duration; },
      update: (dt, camDist) => { mixer.update(dt); dirty.forEach((_, sk) => dirty.set(sk, true)); const want = camDist > far ? 1 : 0; if (want !== lod) apply(want); },
      dispose: () => { mixer.stopAllAction(); mixer.uncacheRoot(root); },
    };
  }

  /** Many copies of one model as GPU instances (LOD0). Matrices are copied; call `setMatrixAt` to move them later. */
  instanced(a: ModelAsset, matrices: readonly THREE.Matrix4[]): THREE.Group {
    const g = new THREE.Group(); g.userData.assetId = a.entry.id;
    a.lods[0].updateMatrixWorld(true); const local = new THREE.Matrix4();
    a.lods[0].traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, matrices.length); im.castShadow = m.castShadow; im.receiveShadow = m.receiveShadow;
      local.copy(m.matrixWorld); // the LOD node carries the dequantisation scale/offset
      matrices.forEach((mx, i) => im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mx, local))); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); g.add(im);
    });
    return g;
  }

  /** A room's claim on assets. `release()` drops the claim; unclaimed assets age out of a small warm LRU and are disposed. */
  lease(): AssetLease {
    const held = new Set<string>(); const ac = new AbortController(); let done = false;
    return {
      signal: ac.signal,
      model: async (id) => { const a = await this.model(id, ac.signal); if (done) throw abortErr(); if (!held.has(id)) { held.add(id); a.refs++; this.lru = this.lru.filter((x) => x !== id); } return a; },
      release: () => {
        if (done) return; done = true; ac.abort();
        held.forEach((id) => { const a = this.ready.get(id); if (!a) return; a.refs = Math.max(0, a.refs - 1); if (!a.refs) { this.lru.push(id); } });
        this.trim();
      },
    };
  }

  private trim() {
    while (this.lru.length > this.warm) { const id = this.lru.shift()!; const a = this.ready.get(id); if (!a || a.refs) continue; this.free(a); this.ready.delete(id); this.models.delete(id); }
  }
  private free(a: ModelAsset) {
    const mats = new Set<THREE.Material>(); const geos = new Set<THREE.BufferGeometry>();
    const roots = a.figure ? [a.figure.scene] : a.lods;
    roots.forEach((l) => l.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; geos.add(m.geometry); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x)); }));
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => { for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose(); m.dispose(); });
  }

  /** Cache stats for the dev page. */
  stats() { return { loaded: this.ready.size, warm: this.lru.length, materials: this.matCache.size, textures: this.texCache.size }; }

  dispose() {
    this.disposed = true; this.ready.forEach((a) => this.free(a)); this.ready.clear(); this.models.clear(); this.lru = [];
    this.matCache.forEach((m) => { for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose(); m.dispose(); }); this.matCache.clear();
    this.texCache.forEach((p) => { void p.then((t) => t.dispose(), () => undefined); }); this.texCache.clear(); releaseKtx2(this.renderer);
  }
}

export interface AssetLease { signal: AbortSignal; model(id: string): Promise<ModelAsset>; release(): void }
