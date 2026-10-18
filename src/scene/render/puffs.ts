import * as THREE from 'three';

/**
 * Smoke puffs as ONE instanced draw call. A puff is any `{ m: Object3D }` (position and scale in the parent's space, opacity in
 * `m.userData.o`); `sync` copies them into the instance buffers. Per-instance opacity rides in instanceColor.r and is split back
 * out in the fragment shader (rgb is divided by it again), so the tint stays constant while the alpha fades.
 */
export function createPuffs(geo: THREE.BufferGeometry, max: number) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, depthWrite: false, color: 0xeee8de });
  mat.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vColor.r; diffuseColor.rgb /= max(vColor.r, 0.001);'); };
  mat.customProgramCacheKey = () => 'puffs';
  const mesh = new THREE.InstancedMesh(geo, mat, max); mesh.name = 'smoke'; mesh.frustumCulled = false; mesh.count = 0;
  mesh.setColorAt(0, new THREE.Color(0, 0, 0)); // allocate instanceColor up front: adding it later changes the program key
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const c = new THREE.Color();
  return {
    mesh,
    sync(...lists: readonly { m: THREE.Object3D }[][]) {
      let n = 0;
      for (const list of lists) for (const { m } of list) {
        if (n >= max) break;
        m4.compose(m.position, q, m.scale); mesh.setMatrixAt(n, m4); const o = (m.userData.o as number | undefined) ?? 0; c.setRGB(o, o, o); mesh.setColorAt(n, c); n++;
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { mesh.removeFromParent(); mesh.dispose(); mat.dispose(); },
  };
}
