import * as THREE from 'three';

/** Every material in `kit`, plus the textures they hold: cloned materials share these maps, so freeing a clone must not free them. */
export function sharedOf(kit: object): Set<unknown> {
  const out = new Set<unknown>();
  for (const m of Object.values(kit)) {
    if (!(m instanceof THREE.Material)) continue;
    out.add(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) out.add(v);
  }
  return out;
}

/** Free the GPU resources of a removed subtree: geometries, skeleton bone textures, materials and their textures, except anything in `shared` or flagged `userData.shared` (kit materials, their maps, factory-level materials, cached geometry). */
export function disposeTree(root: THREE.Object3D, shared: ReadonlySet<unknown> = new Set()): void {
  const seen = new Set<unknown>();
  const free = (r: { dispose(): void } | null | undefined) => { if (r && !shared.has(r) && !seen.has(r) && !(r as { userData?: { shared?: boolean } }).userData?.shared) { seen.add(r); r.dispose(); } };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) (m as THREE.SkinnedMesh).skeleton?.dispose();
    if (!m.isMesh && !(o as THREE.Line).isLine && !(o as THREE.Points).isPoints) return;
    free(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat || shared.has(mat) || mat.userData.shared) continue;
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) free(v);
      free(mat);
    }
  });
}
