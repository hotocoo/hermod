import * as THREE from 'three';

/** Shared surface weather uniforms: rain wetness (0..1) and snow cover (0..1); the town loop writes them. */
export const surfaceU = { uWet: { value: 0 }, uSnow: { value: 0 } };

const FRAG = `
{ vec3 wN = inverseTransformDirection(normal, viewMatrix); vec3 wP = cameraPosition - inverseTransformDirection(vViewPosition, viewMatrix);
  vec2 q = wP.xz * 0.9; float n1 = sin(q.x * 1.7 + sin(q.y * 2.3)) * sin(q.y * 1.9 - sin(q.x * 1.3)); float n2 = sin(q.x * 4.1 + q.y * 3.3) * 0.5; float nz = n1 * 0.5 + n2 * 0.25 + 0.5;
  float up = smoothstep(0.35, 0.85, wN.y + (nz - 0.5) * 0.25);
  float snow = uSnow * up; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), snow); roughnessFactor = mix(roughnessFactor, 0.88, snow);
  float fl = smoothstep(0.88, 0.98, wN.y); float pud = smoothstep(0.52, 0.6, nz) * fl * uWet; float damp = uWet * (0.35 + 0.4 * fl);
  diffuseColor.rgb *= 1.0 - 0.38 * damp * (1.0 - snow); roughnessFactor = mix(roughnessFactor, 0.05, pud * (1.0 - snow)); roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, damp * 0.5); }
`;

const done = new WeakSet<THREE.Material>();
export const fxStats = { patched: 0, swept: 0 };
/** Snow accumulation by normal, rain damp and puddles on up-facing surfaces. Chains any existing onBeforeCompile (wind, terrain blend). */
export function surfaceFx(mat: THREE.Material): void {
  if (done.has(mat)) return; const m = mat as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.transparent || m.userData.noFx) return; done.add(mat); fxStats.patched++;
  const prev = m.onBeforeCompile; const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r); sh.uniforms.uWet = surfaceU.uWet; sh.uniforms.uSnow = surfaceU.uSnow;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;\nuniform float uSnow;').replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG);
  };
  m.customProgramCacheKey = () => prevKey() + '|sfx'; m.needsUpdate = true;
}
/** Apply to every opaque standard material under `root` (new ones only). */
export function surfaceFxTree(root: THREE.Object3D): void { root.traverse((o) => { const mm = (o as THREE.Mesh).material; if (!mm) return; if (Array.isArray(mm)) mm.forEach(surfaceFx); else surfaceFx(mm); }); }
