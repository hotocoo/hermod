import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { rng } from '../rng';
import type { Mats } from '../types';
import { FIGURE } from '@/config/scene';
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
    const sk = p.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh; expect(sk.skeleton.bones).toEqual([p.children[0], ...p.userData.legs, ...p.userData.arms, ...p.userData.shins]);
    expect(meshes(seated(rng('t'), 2))).toBe(1);
  });
  it('moves only that leg (thigh and its shin) when a leg bone swings', () => {
    const p = person(rng('t'), 1); const sk = p.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh; const idx = sk.geometry.getAttribute('skinIndex'); const n = idx.count;
    const at = () => { p.updateMatrixWorld(true); return Array.from({ length: n }, (_, i) => sk.getVertexPosition(i, new THREE.Vector3()).toArray()); };
    const before = at(); p.userData.legs[0].rotation.x = 0.8; const after = at();
    const moved = (i: number) => before[i].some((v, k) => Math.abs(v - after[i][k]) > 1e-6);
    let leg = 0, other = 0; for (let i = 0; i < n; i++) { if (idx.getX(i) === 1 || idx.getX(i) === 5) { if (moved(i)) leg++; } else if (moved(i)) other++; }
    expect(leg).toBeGreaterThan(0); expect(other).toBe(0);
  });
  const skinned = (o: THREE.Object3D) => o.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
  const verts = (o: THREE.Object3D) => { o.updateMatrixWorld(true); const sk = skinned(o); const idx = sk.geometry.getAttribute('skinIndex'); return Array.from({ length: idx.count }, (_, i) => ({ bone: idx.getX(i), p: sk.getVertexPosition(i, new THREE.Vector3()) })); };
  it('bends only the shin vertices when a knee flexes', () => {
    const p = person(rng('t'), 1); const before = verts(p); p.userData.shins[0].rotation.x = 0.9; const after = verts(p);
    let shin = 0, other = 0; before.forEach((v, i) => { if (v.p.distanceTo(after[i].p) > 1e-6) { if (v.bone === 5) shin++; else other++; } });
    expect(shin).toBeGreaterThan(0); expect(other).toBe(0);
  });
  it('seats with the soles on the floor and the thighs at seat height', () => {
    const vs = verts(seated(rng('t'), 2)); const feet = vs.filter((v) => v.bone >= 5); const thighs = vs.filter((v) => v.bone === 1 || v.bone === 2);
    expect(Math.min(...vs.map((v) => v.p.y))).toBeGreaterThan(-1e-3); expect(Math.min(...feet.map((v) => v.p.y))).toBeLessThan(1e-3);
    expect(Math.min(...thighs.map((v) => v.p.y))).toBeCloseTo(FIGURE.seatHeight, 1);
  });
  it('keeps the arm surface clear of the torso at rest', () => {
    const radiusAt = (y: number) => { const t = FIGURE.torso; for (let i = 1; i < t.length; i++) if (y <= t[i][1] && y >= t[i - 1][1]) { const k = (y - t[i - 1][1]) / (t[i][1] - t[i - 1][1] || 1); return t[i - 1][0] + k * (t[i][0] - t[i - 1][0]); } return 0; };
    for (const v of verts(person(rng('t'), 1)).filter((q) => q.bone === 3 || q.bone === 4)) expect(Math.hypot(v.p.x, v.p.z)).toBeGreaterThan(radiusAt(v.p.y));
  });
  it('is deterministic per seed', () => {
    const a = person(rng('same'), 3), b = person(rng('same'), 3); expect(a.scale.x).toBe(b.scale.x);
    const colour = (o: THREE.Object3D) => (o.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh).geometry.getAttribute('color').array[0]; expect(colour(a)).toBe(colour(b));
  });
});
