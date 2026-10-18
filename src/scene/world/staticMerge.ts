import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isMesh } from '../util';

/**
 * Collapse a static group's meshes into one mesh per material and shadow flags (position, normal, uv, colour only).
 * Cuts draw calls (buildings and cottages are hundreds of small meshes). Meshes at or under any `keep` node stay as they are
 * (doors, spools, flames, figures: anything the town animates).
 */
export function mergeStatic(group: THREE.Group, keep: Iterable<THREE.Object3D | null | undefined> = []): THREE.Group {
  group.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(); const roots = new Set<THREE.Object3D>(); for (const k of keep) if (k) roots.add(k);
  const held = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== group; p = p.parent) if (roots.has(p)) return true; return false; };
  const buckets = new Map<THREE.Material, Map<number, THREE.BufferGeometry[]>>(); const drop: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (!isMesh(o) || Array.isArray(o.material) || (o as THREE.InstancedMesh).isInstancedMesh || !o.visible || held(o)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const flag = (o.castShadow ? 1 : 0) | (o.receiveShadow ? 2 : 0); let byFlag = buckets.get(o.material); if (!byFlag) buckets.set(o.material, (byFlag = new Map()));
    const l = byFlag.get(flag); if (l) l.push(g); else byFlag.set(flag, [g]); drop.push(o);
  });
  drop.forEach((m) => { m.removeFromParent(); m.geometry.dispose(); });
  const prune = (n: THREE.Object3D) => { for (const c of n.children.slice()) { prune(c); if (!(c as THREE.Mesh).isMesh && !(c as THREE.Light).isLight && c.children.length === 0 && !roots.has(c)) n.remove(c); } };
  prune(group);
  buckets.forEach((byFlag, mat) => byFlag.forEach((geos, flag) => {
    if (geos.some((g) => g.attributes.color)) geos.forEach((g) => { if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); });
    const merged = mergeGeometries(geos, false); geos.forEach((g) => g.dispose()); if (!merged) return;
    const m = new THREE.Mesh(merged, mat); m.castShadow = !!(flag & 1); m.receiveShadow = !!(flag & 2); group.add(m);
  }));
  return group;
}
