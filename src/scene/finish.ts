import type * as THREE from 'three';
import { isMesh } from './util';

/** Enable shadows on a building and stamp the roof materials and label anchor height used by the town loop. */
export function finish(g: THREE.Group, roofMats: THREE.Material[], anchorY: number): THREE.Group {
  const roofs: { m: THREE.Mesh; y: number }[] = [];
  g.traverse((o) => { if (isMesh(o)) { o.castShadow = true; o.receiveShadow = true; if (roofMats.includes(o.material as THREE.Material)) roofs.push({ m: o, y: o.position.y }); } });
  g.userData.roofMats = roofMats; g.userData.roofs = roofs; g.userData.anchorY = anchorY; return g;
}
