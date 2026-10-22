import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeTree, sharedOf } from '../dispose';

describe('disposeTree', () => {
  it('frees own geometry, cloned material, its own texture and skeleton, but not kit materials, their maps or shared geometry', () => {
    const map = new THREE.Texture(); const kitMat = new THREE.MeshStandardMaterial({ map }); const shared = sharedOf({ kitMat });
    const sharedGeo = new THREE.BoxGeometry(); shared.add(sharedGeo);
    const own = new THREE.BoxGeometry(); const clone = kitMat.clone(); const canvasTex = new THREE.Texture(); clone.emissiveMap = canvasTex;
    const bone = new THREE.Bone(); const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); skinned.add(bone); skinned.bind(new THREE.Skeleton([bone]));
    const root = new THREE.Group(); root.add(new THREE.Mesh(own, clone), new THREE.Mesh(sharedGeo, kitMat), skinned);
    const spies = [own, clone, canvasTex, skinned.skeleton, map, kitMat, sharedGeo].map((x) => vi.spyOn(x, 'dispose'));
    disposeTree(root, shared);
    const [dOwn, dClone, dTex, dSkel, dMap, dKit, dShGeo] = spies;
    for (const s of [dOwn, dClone, dTex, dSkel]) expect(s).toHaveBeenCalledTimes(1);
    for (const s of [dMap, dKit, dShGeo]) expect(s).not.toHaveBeenCalled();
  });
});
