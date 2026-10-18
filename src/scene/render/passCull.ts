import * as THREE from 'three';

/**
 * Reduced layer sets for the secondary scene renders (planar water mirror and refraction, GI probe cubemaps): they never need
 * the small props, the figures, the particle systems or the decals the main view draws. `classify` splits the scene once
 * (re-run when the scene changes); the callers hide what they do not want around their render and restore it after.
 */
export interface PassCull {
  /** Meshes under `smallR` metres, decals (noAO + transparent) and transparent effect meshes flagged noAO: never drawn in a secondary pass. */
  small: THREE.Object3D[];
  /** Points, lines and sprites (rain, snow, fireflies, ribbons). */
  sprites: THREE.Object3D[];
  /** Skinned meshes (people, ravens): drawn only near the camera. */
  figures: THREE.SkinnedMesh[];
  /** Every other mesh. */
  meshes: THREE.Mesh[];
}

const _sph = new THREE.Sphere();
export function classify(scene: THREE.Scene, smallR: number, skip: (o: THREE.Object3D) => boolean = () => false): PassCull {
  const out: PassCull = { small: [], sprites: [], figures: [], meshes: [] };
  scene.traverse((o) => {
    if (skip(o)) return;
    if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) { out.sprites.push(o); return; }
    const m = o as THREE.Mesh; if (!m.isMesh || !m.geometry || Array.isArray(m.material)) return;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) { out.figures.push(m as THREE.SkinnedMesh); return; }
    out.meshes.push(m);
    if (o.userData.noAO && m.material.transparent) { out.small.push(o); return; }
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    o.updateWorldMatrix(true, false); _sph.copy(m.geometry.boundingSphere!).applyMatrix4(o.matrixWorld); if (_sph.radius < smallR) out.small.push(o);
  });
  return out;
}

/** Hide every visible object in `list`; returns the ones hidden so `restore` can undo exactly that. */
export function hideAll(list: readonly THREE.Object3D[], into: THREE.Object3D[] = []): THREE.Object3D[] {
  for (const o of list) if (o.visible) { o.visible = false; into.push(o); } return into;
}
export function restore(list: readonly THREE.Object3D[]): void { for (const o of list) o.visible = true; }
