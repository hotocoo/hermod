import type * as THREE from 'three';

/** Type guard for meshes found while traversing a scene graph. */
export const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;
