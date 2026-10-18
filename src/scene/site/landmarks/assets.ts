import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { acquireKtx2, releaseKtx2 } from '../../assets/ktx2';
import { ASSET_BASE } from '../config';

/** Geometry per LOD (index = LOD number), one shared PBR material (base colour, normal, metal/rough, lightmap occlusion on uv1), and bounds. */
export interface LoadedAsset { geometry: THREE.BufferGeometry; lods: THREE.BufferGeometry[]; material: THREE.Material; bounds: THREE.Box3; bytes: number }
/** Upper bound for the metalness factor of site materials (baked metal texels 0.9 to 0.95 become about 0.5). */
const METAL_CAP = 0.55;
/** aoMapIntensity of the baked lightmap occlusion: 0 would ignore it, 1 is the raw (too dark in interiors) map. */
const AO_INTENSITY = 0.45;
const cache = new Map<string, Promise<THREE.Group>>();
let loader: GLTFLoader | null = null;
let ktx: KTX2Loader | null = null; let ktxFor: THREE.WebGLRenderer | null = null;

/** Register the renderer so KTX2 textures can be transcoded (call once, before building a site). Transcoder files: public/basis (copied from three/examples/jsm/libs/basis). */
export function setSiteAssetRenderer(r: THREE.WebGLRenderer, transcoderPath = '/basis/'): void {
  if (ktxFor) releaseKtx2(ktxFor); ktxFor = r; ktx = acquireKtx2(r, transcoderPath); loader = null; cache.clear();
}
/** The KTX2 loader registered by `setSiteAssetRenderer` (null before it). Terrain maps reuse it so only one transcoder pool runs. */
export function getSiteKtx2(): KTX2Loader | null { return ktx; }
/** Shared glTF loader (KTX2 + meshopt) for every authored asset in the scene. */
export function getLoader(): GLTFLoader { if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); if (ktx) loader.setKTX2Loader(ktx); } return loader; }

/** Load (once) the baked glTF for an asset id and return every LOD as geometry in asset space plus the shared material. `lod` picks the default `geometry`. */
export async function loadAsset(id: string, lod: number, base = ASSET_BASE): Promise<LoadedAsset> {
  let p = cache.get(base + id);
  if (!p) { p = getLoader().loadAsync(base + id + '.glb').then((g) => g.scene); cache.set(base + id, p); p.catch(() => cache.delete(base + id)); }
  const scene = await p; scene.updateMatrixWorld(true); const lods: THREE.BufferGeometry[] = []; let material: THREE.Material | null = null;
  scene.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return; const k = /_LOD(\d+)/.exec(m.name); if (!k) return;
    lods[Number(k[1])] = m.geometry.clone().applyMatrix4(m.matrixWorld); material ??= m.material as THREE.Material;
  });
  const have = lods.filter(Boolean); if (!have.length || !material) throw new Error(`asset ${id} has no mesh`);
  // Gilded and bronze parts bake metallic 0.9 to 0.95: a near perfect mirror shows only the sky gradient, so under-sides and shaded faces (acroteria, torch stands) went black. Cap the factor
  // so the baked albedo keeps a diffuse share (the metal map B channel still decides where the metal is).
  // The baked lightmap occlusion is sky + one ground bounce only, so deep interiors (stoa, palaestra halls) bake near 0 and went black under hemisphere + env light alone (with the map removed they read
  // correctly lit). Intensity < 1 keeps open surfaces at full light and lifts fully occluded ones to a floor of 1 - AO_INTENSITY (the interreflection the bake does not model).
  const sm = material as THREE.MeshStandardMaterial; if (sm.isMeshStandardMaterial) { sm.metalness = Math.min(sm.metalness, METAL_CAP); if (sm.aoMap) sm.aoMapIntensity = AO_INTENSITY; }
  have.forEach((g) => g.computeBoundingBox());
  return { geometry: lods[lod] ?? have[0], lods: have, material, bounds: have[0].boundingBox!.clone(), bytes: 0 };
}
