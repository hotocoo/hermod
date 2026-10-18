import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { classify, hideAll, restore } from '../passCull';

const box = (s: number, mat: THREE.Material = new THREE.MeshBasicMaterial()) => new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);

describe('passCull', () => {
  it('splits small props, decals, particles and figures from the big meshes', () => {
    const scene = new THREE.Scene();
    const big = box(6), small = box(0.5), decal = box(8, new THREE.MeshBasicMaterial({ transparent: true })); decal.userData.noAO = true;
    const pts = new THREE.Points(new THREE.BufferGeometry()); const fig = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const scaled = box(0.5); scaled.scale.setScalar(8); // a small geometry scaled up is a big mesh
    scene.add(big, small, decal, pts, fig, scaled);
    const c = classify(scene, 1);
    expect(c.small).toEqual(expect.arrayContaining([small, decal])); expect(c.small).not.toContain(big); expect(c.small).not.toContain(scaled);
    expect(c.sprites).toEqual([pts]); expect(c.figures).toEqual([fig]); expect(c.meshes).toEqual(expect.arrayContaining([big, small, decal, scaled]));
  });
  it('honours the skip predicate and restores exactly what it hid', () => {
    const scene = new THREE.Scene(); const a = box(0.5), b = box(0.5); b.visible = false; b.name = 'water:x'; scene.add(a, b);
    expect(classify(scene, 1, (o) => o.name.startsWith('water:')).meshes).toEqual([a]);
    const hid = hideAll([a, b]); expect(hid).toEqual([a]); expect(a.visible).toBe(false); restore(hid); expect(a.visible).toBe(true); expect(b.visible).toBe(false);
  });
});
