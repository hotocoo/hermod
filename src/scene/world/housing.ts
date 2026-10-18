import * as THREE from 'three';
import { GROWTH } from '@/config/scene';
import { isMesh } from '../util';
import { rng } from '../rng';
import type { Cottage } from './houses';

const VARIANTS = 8;
const sph = new THREE.Sphere();
/**
 * Instanced cottages: a few template variants (walls and roof), one InstancedMesh per template mesh, so 80 houses cost about
 * as many draw calls as 8. Houses are Object3D transform holders; `update()` copies matrices into the instances, culls those
 * outside the camera frustum (plus shadow reach) and swaps far ones to a low-poly template (box and pyramid roof).
 */
export function createHousing(parent: THREE.Object3D, cottage: Cottage, capacity: number, decal: { material: THREE.Material; geometry: THREE.BufferGeometry }, roofMats: readonly THREE.Material[]) {
  type Tpl = { meshes: THREE.InstancedMesh[]; lowWall: THREE.InstancedMesh; lowRoof: THREE.InstancedMesh };
  const tpls: Tpl[] = []; const lists: THREE.Object3D[][] = Array.from({ length: VARIANTS }, () => []); let shadows = true;
  const dec = new THREE.InstancedMesh(decal.geometry, decal.material, capacity); dec.count = 0; dec.frustumCulled = false; dec.renderOrder = 1; dec.userData.noAO = true; dec.raycast = () => undefined; parent.add(dec);
  const lowWallGeo = new THREE.BoxGeometry(GROWTH.cottage.w, GROWTH.cottage.wallH + 0.12, GROWTH.cottage.d).translate(0, (GROWTH.cottage.wallH + 0.12) / 2, 0);
  const lowRoofGeo = new THREE.ConeGeometry(0.62 * GROWTH.cottage.w * 1.3, 0.7, 4).rotateY(Math.PI / 4).scale(1, 1, GROWTH.cottage.d / GROWTH.cottage.w).translate(0, GROWTH.cottage.wallH + 0.12 + 0.35, 0);
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean) => { const m = new THREE.InstancedMesh(geo, mat, capacity); m.count = 0; m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
  function tplOf(v: number): Tpl {
    if (!tpls[v]) {
      const g = cottage(rng('cottage' + v)); const meshes: THREE.InstancedMesh[] = []; let wall: THREE.Material | null = null, roof: THREE.Material | null = null, best = 0; const bb = new THREE.Box3(), sz = new THREE.Vector3();
      g.traverse((o) => {
        if (!isMesh(o) || Array.isArray(o.material)) return; meshes.push(inst(o.geometry, o.material, shadows && o.castShadow));
        if (roofMats.includes(o.material)) roof = o.material; else { o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox!); bb.getSize(sz); const vol = sz.x * sz.y * sz.z; if (vol > best && !(o.material as THREE.MeshStandardMaterial).vertexColors) { best = vol; wall = o.material; } }
      });
      tpls[v] = { meshes, lowWall: inst(lowWallGeo, wall || roofMats[0], shadows), lowRoof: inst(lowRoofGeo, roof || roofMats[0], shadows) };
    }
    return tpls[v];
  }
  const variantOf = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % VARIANTS; };
  return {
    add(userId: string): THREE.Object3D { const v = variantOf(userId); tplOf(v); const g = new THREE.Object3D(); g.userData.variant = v; lists[v].push(g); return g; },
    remove(g: THREE.Object3D) { const l = lists[g.userData.variant as number]; const k = l.indexOf(g); if (k >= 0) l.splice(k, 1); },
    clear() { lists.forEach((l) => { l.length = 0; }); this.update(); },
    update(fr?: THREE.Frustum, cam?: THREE.Vector3, lodDist = Infinity) {
      let nd = 0;
      lists.forEach((l, v) => {
        const t = tpls[v]; if (!t) return; let nf = 0, nl = 0;
        l.forEach((g) => {
          if (fr) { sph.center.set(g.position.x, g.position.y + 1, g.position.z); sph.radius = 2 + GROWTH.lod.cullMargin; if (!fr.intersectsSphere(sph)) return; }
          g.updateMatrix(); dec.setMatrixAt(nd++, g.matrix);
          if (cam && g.position.distanceTo(cam) > lodDist) { t.lowWall.setMatrixAt(nl, g.matrix); t.lowRoof.setMatrixAt(nl, g.matrix); nl++; } else { for (const m of t.meshes) m.setMatrixAt(nf, g.matrix); nf++; }
        });
        for (const m of t.meshes) { m.count = nf; m.instanceMatrix.needsUpdate = true; } t.lowWall.count = t.lowRoof.count = nl; t.lowWall.instanceMatrix.needsUpdate = t.lowRoof.instanceMatrix.needsUpdate = true;
      });
      dec.count = nd; dec.instanceMatrix.needsUpdate = true;
    },
    setShadows(on: boolean) { shadows = on; tpls.forEach((t) => { t.meshes.forEach((m) => { m.castShadow = on; }); t.lowWall.castShadow = t.lowRoof.castShadow = on; }); },
  };
}
export type Housing = ReturnType<typeof createHousing>;
