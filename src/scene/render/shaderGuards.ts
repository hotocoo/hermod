import * as THREE from 'three';

/**
 * Finite-normal guards for every built-in lit material. The stock chunks call `normalize( tbn * mapN )` and `normalize( vNormal )`: when the normal map texel
 * (a far mip of opposing normals averages to ~0) or the interpolated normal collapses to a zero or underflowing vector, normalize returns NaN. One NaN pixel in the
 * half-float scene target is spread over the whole frame by bloom and kept by the TAA history, which blanked the screen for a few frames at a time.
 * Both lookups now fall back to the geometric normal.
 */
const SAFE = /* glsl */ `
vec3 hermodSafeNormal( vec3 v, vec3 fallback ) { float l = dot( v, v ); bool ok = l > 1.0e-12 && ( floatBitsToUint( l ) & 0x7F800000u ) != 0x7F800000u; return ok ? v * inversesqrt( l ) : fallback; }
`;
const edits: [keyof typeof THREE.ShaderChunk, string, string][] = [
  ['normal_fragment_maps', 'normal = normalize( tbn * mapN );', 'normal = hermodSafeNormal( tbn * mapN, nonPerturbedNormal );'],
  ['normal_fragment_begin', 'vec3 normal = normalize( vNormal );', 'vec3 normal = hermodSafeNormal( vNormal, vec3( 0.0, 0.0, 1.0 ) );'],
];
let installed = false;
/** Patch the shared shader chunks once, before the first program compiles. */
export function installShaderGuards(): void {
  if (installed) return; installed = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  if (!C.common.includes('hermodSafeNormal')) C.common += SAFE;
  for (const [k, from, to] of edits) { if (C[k].includes(from)) C[k] = C[k].replace(from, to); else console.warn(`[shaderGuards] chunk ${String(k)} changed, normal guard not applied`); }
}
installShaderGuards();
