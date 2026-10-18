/**
 * Binder for the authored village buildings (public/assets/village/<id>.glb, scripts/assets/blender/village).
 * Contract (bake.py): nodes `<id>_L1|_L2|_L3` hold meshes `*_LOD0|1|2` (L2 additive over L1, L3 over L1+L2); empties `<id>_door`, `<id>_fire`, `<id>_smoke`.
 * Windows use materials named `*_windows` (night glow). Loading is lazy and cached; the procedural building stays until the glb is in.
 */
import * as THREE from 'three';
import { loadGlb, mergeByLod } from '../shared/instanced';

export const VILLAGE_ASSET_BASE = '/assets/village/';
export const LOD_DIST = [0, 34, 72] as const;
export const loadVillageGlb = (id: string): Promise<THREE.Group> => loadGlb(VILLAGE_ASSET_BASE + id + '.glb');
/** Night glow of every authored window material (shared by all clones, driven once per frame). */
export const windowMats = new Set<THREE.MeshStandardMaterial>();

export interface Authored { group: THREE.Group; door: THREE.Vector3 | null; fire: THREE.Vector3 | null; smoke: THREE.Vector3 | null; top: number }
/** Instantiate `id` showing modules up to `level`, each module as a LOD (LOD0 near). */
export function instantiate(scene: THREE.Group, id: string, level: number): Authored {
  const root = new THREE.Group(); root.name = id; scene.updateMatrixWorld(true);
  const pos = (n: string) => { const o = scene.getObjectByName(id + '_' + n); return o ? o.getWorldPosition(new THREE.Vector3()) : null; };
  for (let L = 1; L <= Math.min(3, level); L++) {
    const mod = scene.getObjectByName(`${id}_L${L}`); if (!mod) continue;
    const lod = new THREE.LOD(); const byLod: THREE.Object3D[][] = [[], [], []];
    mod.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const k = /_LOD([0-2])/.exec(o.name); byLod[k ? Number(k[1]) : 0].push(o); });
    byLod.forEach((list, i) => {
      if (!list.length) return; const g = new THREE.Group(); const mg = mergeByLod(list as THREE.Mesh[]);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); if (/_windows$/.test(mat.name)) windowMats.add(mat as THREE.MeshStandardMaterial); };
      if (mg.solid && mg.solidMat) add(mg.solid, mg.solidMat); mg.glow.forEach((x) => add(x.geo, x.mat));
      lod.addLevel(g, LOD_DIST[i]);
    });
    if (lod.levels.length) root.add(lod);
  }
  const bb = new THREE.Box3().setFromObject(root);
  return { group: root, door: pos('door'), fire: pos('fire'), smoke: pos('smoke'), top: Number.isFinite(bb.max.y) ? bb.max.y : 3 };
}
