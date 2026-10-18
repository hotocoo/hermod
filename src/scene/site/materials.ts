import * as THREE from 'three';
import { COL } from './config';

/** Materials the site needs. Pass the town's own shared materials where they exist (see INTEGRATION.md), or use makeSiteMaterials. */
export interface SiteMaterials {
  /** Terrain top, vertex coloured. */
  terrain: THREE.Material;
  /** Cliff and underside, vertex coloured. */
  rock: THREE.Material;
  /** Paving, vertex coloured (polygon offset keeps it above the terrain). */
  pave: THREE.Material;
  /** Generic vertex coloured stone and wood for merged structures and instanced props. */
  vcol: THREE.Material;
  water: THREE.Material;
  /** Unlit flame. */
  flame: THREE.MeshBasicMaterial;
}

export function makeSiteMaterials(): SiteMaterials {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  return {
    terrain: std({ vertexColors: true, roughness: 0.95 }),
    rock: std({ vertexColors: true, roughness: 1, flatShading: true }),
    pave: std({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    vcol: std({ vertexColors: true }),
    water: new THREE.MeshStandardMaterial({ color: COL.water, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide }),
    flame: new THREE.MeshBasicMaterial({ color: COL.flame, toneMapped: false }),
  };
}
