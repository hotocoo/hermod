/**
 * Instanced bank for authored glb assets (props, trees): one InstancedMesh per (asset part, LOD). Instances are re-bucketed by camera
 * distance (LOD0 near, LOD1/LOD2 far) a few times per second and frustum culled. Glb contract: meshes named `*_LOD<k>` (parts without LOD1/2 keep LOD0);
 * materials named `*_windows` join `windowMats` (night glow). Foliage assets carry vertex colour; per-instance tint multiplies it.
 */
import * as THREE from 'three';
import { dropMips, getLoader, textureDrop } from '../../site/landmarks/assets';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { windify } from '../../render/wind';

export interface Placement { x: number; y: number; z: number; yaw: number; scale: number; tint?: THREE.Color }
export const LOD_AT = [0, 34, 72] as const;
const files = new Map<string, Promise<THREE.Group>>(); let ultra = false;
/** Ultra tier prefers `<id>.ultra.glb` (4K textures) for village assets, falling back to the high file. */
export const preferUltraAssets = (on: boolean): void => { ultra = on; };
export const loadGlb = (url: string): Promise<THREE.Group> => {
  const n = textureDrop(); const key = (ultra && url.includes('/village/') ? url + '#u' : url) + '#d' + n;
  let p = files.get(key); if (!p) { p = (ultra && url.includes('/village/') ? getLoader().loadAsync(url.replace(/\.glb$/, '.ultra.glb')).catch(() => getLoader().loadAsync(url)) : getLoader().loadAsync(url)).then((g) => { dropMips(g.scene, n); return g.scene; }); files.set(key, p); p.catch(() => files.delete(key)); } return p;
};
export const windowMats = new Set<THREE.MeshStandardMaterial>();

interface Part { geo: (THREE.BufferGeometry | null)[]; mat: THREE.Material }
/** Clone with float32 attributes: KHR_mesh_quantization assets decode to normalized int16, which cannot hold a transformed position or be merged with float data. */
export function floatGeo(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(); if (src.index) g.setIndex(src.index.clone());
  for (const [k, a] of Object.entries(src.attributes)) {
    const at = a as THREE.BufferAttribute; if (at.array instanceof Float32Array && !at.normalized && !('isInterleavedBufferAttribute' in at)) { g.setAttribute(k, at.clone()); continue; }
    const out = new Float32Array(at.count * at.itemSize); for (let i = 0; i < at.count; i++) { out[i * at.itemSize] = at.getX(i); if (at.itemSize > 1) out[i * at.itemSize + 1] = at.getY(i); if (at.itemSize > 2) out[i * at.itemSize + 2] = at.getZ(i); if (at.itemSize > 3) out[i * at.itemSize + 3] = at.getW(i); }
    g.setAttribute(k, new THREE.BufferAttribute(out, at.itemSize));
  }
  return g;
}
const GLOW = /_(windows|sign)$/;
/** Merge every non-glow mesh of one LOD into a single geometry (one draw call per asset and LOD); glow parts keep their own material for the night emissive. */
export function mergeByLod(meshes: THREE.Mesh[]): { solid: THREE.BufferGeometry | null; solidMat: THREE.Material | null; glow: { geo: THREE.BufferGeometry; mat: THREE.Material }[] } {
  const solid: THREE.BufferGeometry[] = []; let solidMat: THREE.Material | null = null; const glow: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false); const g = floatGeo(m.geometry).applyMatrix4(m.matrixWorld); const mt = m.material as THREE.Material;
    if (GLOW.test(mt.name)) glow.push({ geo: g, mat: mt }); else { if (!solidMat || /_(roof|cloth|L\d)/.test(solidMat.name) && !/_(roof|cloth|L\d)/.test(mt.name)) solidMat = mt; solid.push(g); }
  }
  let merged: THREE.BufferGeometry | null = null;
  if (solid.length) {
    const keep = ['position', 'normal', 'uv', 'uv1', 'color']; solid.forEach((g) => { for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k); if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]); });
    const names = new Set(solid.flatMap((g) => Object.keys(g.attributes))); const ok = solid.filter((g) => [...names].every((n) => g.attributes[n]));
    merged = ok.length > 1 ? mergeGeometries(ok, false) : ok[0] ?? null; if (ok.length > 1) ok.forEach((g) => g.dispose());
  }
  return { solid: merged, solidMat, glow };
}
function parts(scene: THREE.Group, foliage: boolean): Part[] {
  scene.updateMatrixWorld(true); const lods: THREE.Mesh[][] = [[], [], []]; let any0 = false;
  scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const k = /_LOD([0-2])/.exec(m.name); const lod = k ? Number(k[1]) : 0; lods[lod].push(m); if (lod === 0) any0 = true; });
  void any0; const out: Part[] = []; const res = lods.map((l) => (l.length ? mergeByLod(l) : null));
  const prep = (mt: THREE.Material) => { const m = mt as THREE.MeshStandardMaterial; if (GLOW.test(m.name)) windowMats.add(m); if (foliage) { m.side = THREE.DoubleSide; m.alphaToCoverage = false; m.userData.noA2C = true; windify(m, 'leaf'); } };
  const solid: Part = { geo: [res[0]?.solid ?? null, res[1]?.solid ?? res[0]?.solid ?? null, res[2]?.solid ?? res[1]?.solid ?? res[0]?.solid ?? null], mat: (res[0]?.solidMat ?? res[1]?.solidMat ?? res[2]?.solidMat)! };
  if (solid.mat) { prep(solid.mat); out.push(solid); }
  // glow parts exist at LOD0 only (no LOD1/2 in the glb): shown at every distance
  (res[0]?.glow ?? []).forEach((g) => { prep(g.mat); out.push({ geo: [g.geo, g.geo, null], mat: g.mat }); });
  return out;
}

export class InstancedBank {
  readonly group = new THREE.Group(); private sets: { list: Placement[]; meshes: THREE.InstancedMesh[][]; cap: number; live: boolean; cullBeyond: number; lodSwitch?: (p: Placement) => number }[] = []; private tick = 0; private owned: THREE.BufferGeometry[] = [];
  private dm = new THREE.Object3D(); private sph = new THREE.Sphere(); shadows = true;
  constructor(parent: THREE.Object3D) { this.group.name = 'instanced-bank'; parent.add(this.group); }
  /** Add `list` of `url` (resolves when loaded; rejects on load failure). */
  /** `live`: `list` is kept by reference (mutate it freely, placements may be getters) and re-bucketed every frame; `capacity` bounds it. */
  async add(url: string, list: Placement[], foliage = false, live = false, capacity = 0, cullBeyond = Infinity, lodSwitch?: (p: Placement) => number): Promise<void> {
    if (!list.length && !live) return; const scene = await loadGlb(url); const ps = parts(scene, foliage); const entry = { list: live ? list : [...list], meshes: [] as THREE.InstancedMesh[][], cap: Math.max(capacity, list.length, 1), live, cullBeyond, lodSwitch };
    for (const p of ps) {
      const row: THREE.InstancedMesh[] = [];
      for (let l = 0; l < 3; l++) {
        const g = p.geo[l] ?? p.geo[0]; if (!g) { row.push(null as never); continue; } this.owned.push(g);
        const im = new THREE.InstancedMesh(g, p.mat, entry.cap); im.count = 0; im.frustumCulled = false; im.castShadow = this.shadows; im.receiveShadow = true; im.name = url + ':LOD' + l; this.group.add(im); row.push(im);
      }
      entry.meshes.push(row);
    }
    this.sets.push(entry); this.tick = 0;
  }
  update(fr: THREE.Frustum, cam: THREE.Vector3, force = false): void {
    const slow = ++this.tick % 6 !== 1; const d = this.dm;
    for (const s of this.sets) {
      if (!force && !s.live && slow) continue;
      const cnt = [0, 0, 0];
      for (const p of s.list) {
        if (cnt[0] + cnt[1] + cnt[2] >= s.cap) break; if (p.scale < 0.002) continue;
        this.sph.center.set(p.x, p.y + 1, p.z); this.sph.radius = 3 * p.scale + 8; if (!fr.intersectsSphere(this.sph)) continue;
        const dist = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z); if (dist > (s.lodSwitch ? s.lodSwitch(p) : s.cullBeyond)) continue; const l = dist < LOD_AT[1] ? 0 : dist < LOD_AT[2] ? 1 : 2;
        d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.yaw, 0); d.scale.setScalar(p.scale); d.updateMatrix();
        for (const row of s.meshes) { const im = row[l]; if (!im) continue; im.setMatrixAt(cnt[l], d.matrix); if (p.tint) im.setColorAt(cnt[l], p.tint); }
        cnt[l]++;
      }
      for (const row of s.meshes) row.forEach((im, l) => { if (!im) return; im.count = cnt[l]; im.visible = cnt[l] > 0; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
    }
  }
  setShadows(on: boolean): void { this.shadows = on; this.sets.forEach((s) => s.meshes.forEach((r) => r.forEach((im) => { if (im) im.castShadow = on; }))); }
  stats(): { drawn: number } { let n = 0; this.sets.forEach((s) => s.meshes.forEach((r) => r.forEach((im) => { if (im && im.count > 0) n++; }))); return { drawn: n }; }
  dispose(): void { this.sets.forEach((s) => s.meshes.forEach((r) => r.forEach((im) => im?.dispose()))); this.owned.forEach((g) => g.dispose()); this.group.removeFromParent(); this.sets = []; }
}
