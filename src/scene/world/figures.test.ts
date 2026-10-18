import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { rng } from '../rng';
import type { Mats } from '../types';
import { createFigures } from './figures';

const M = { skin: new THREE.MeshStandardMaterial({ color: 0xe8cdb5 }), ink: new THREE.MeshStandardMaterial({ color: 0x3a3532 }) } as unknown as Mats;
const meshes = (o: THREE.Object3D) => { let n = 0; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; }); return n; };

describe('figures', () => {
  const { person, seated } = createFigures(M);
  it('draws a person as one skinned mesh on a shared vertex-coloured material', () => {
    const p = person(rng('t'), 1); const mats = new Set<THREE.Material>(); p.traverse((c) => { if ((c as THREE.Mesh).isMesh) mats.add((c as THREE.Mesh).material as THREE.Material); });
    expect(meshes(p)).toBe(1); expect(p.children.some((c) => (c as THREE.SkinnedMesh).isSkinnedMesh)).toBe(true); expect(mats.size).toBe(1); expect([...mats][0]).toMatchObject({ vertexColors: true });
  });
  it('keeps the limb handles the town animates, and seats a person without extra meshes', () => {
    const p = person(rng('t'), 0); expect(p.userData.legs).toHaveLength(2); expect(p.userData.arms).toHaveLength(2);
    const sk = p.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh; expect(sk.skeleton.bones).toEqual([p.children[0], ...p.userData.legs, ...p.userData.arms]);
    expect(meshes(seated(rng('t'), 2))).toBe(1);
  });
  it('moves only the leg vertices when a leg bone swings', () => {
    const p = person(rng('t'), 1); const sk = p.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh; const idx = sk.geometry.getAttribute('skinIndex'); const n = idx.count;
    const at = () => { p.updateMatrixWorld(true); return Array.from({ length: n }, (_, i) => sk.getVertexPosition(i, new THREE.Vector3()).toArray()); };
    const before = at(); p.userData.legs[0].rotation.x = 0.8; const after = at();
    const moved = (i: number) => before[i].some((v, k) => Math.abs(v - after[i][k]) > 1e-6);
    let leg = 0, other = 0; for (let i = 0; i < n; i++) { if (idx.getX(i) === 1) { if (moved(i)) leg++; } else if (moved(i)) other++; }
    expect(leg).toBeGreaterThan(0); expect(other).toBe(0);
  });
  it('is deterministic per seed', () => {
    const a = person(rng('same'), 3), b = person(rng('same'), 3); expect(a.scale.x).toBe(b.scale.x);
    const colour = (o: THREE.Object3D) => (o.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh).geometry.getAttribute('color').array[0]; expect(colour(a)).toBe(colour(b));
  });
});
