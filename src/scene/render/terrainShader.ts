/**
 * One terrain shader for every map style: 6-layer PBR splat (texture arrays, per-vertex weights `aW0` vec4 + `aW1` vec2) with
 *  - height-based layer blending (each layer's own AO/albedo relief decides who wins a transition, so stones poke through grass and mud pools in hollows)
 *  - triplanar projection on steep faces (cliffs, terraces, banks): top projection on flats stays one sample, side projections only run where the slope needs them
 * Used by the village splat and the sanctuary ground. `applyTerrainSplat` patches an existing MeshStandardMaterial in place.
 */
import * as THREE from 'three';
import { fxU } from './materialFx';

export interface TerrainSplatSet {
  albedo: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture;
  /** Texture repeats per world unit, one per layer (6). */
  tile: readonly number[];
}
export interface TerrainSplatOptions {
  /** Normal map strength. */
  normalStrength?: number;
  /** How strongly layer relief reorders a transition (0 = plain linear weights). */
  heightBlend?: number;
  /** Width of the blend band in weight units (smaller = crisper transitions). */
  blendBand?: number;
  /** Slope (world normal y) below which the side projections are blended in. */
  triplanarBelow?: number;
  /** Desaturate towards luminance (0..1) and overall albedo multiplier (the village ground is tuned against the sky and probe light). */
  desaturate?: number; albedoGain?: number;
  /** Shader cache key (distinct tunings must differ). */
  key?: string;
}

const HEAD_V = 'attribute vec4 aW0;\nattribute vec2 aW1;\nvarying vec3 vSpWorld;\nvarying vec4 vSpW0;\nvarying vec2 vSpW1;\nvarying vec3 vSpN;';
const HEAD_F = `varying vec3 vSpWorld;
varying vec4 vSpW0;
varying vec2 vSpW1;
varying vec3 vSpN;
uniform sampler2DArray uSpA;
uniform sampler2DArray uSpN;
uniform sampler2DArray uSpO;
uniform float uTile[6];
uniform float uNS;
uniform float uHB;
uniform float uBand;
uniform float uTri;
uniform float uDesat;
uniform float uGain;
uniform float uPom;
uniform float uPomK;`;

/** Layer blend with height reorder, then top and (on steep faces) side projections. Leaves spAlb, spOrm and spNrm* for the normal and roughness stages. */
const FRAG_MAP = `#include <map_fragment>
float spW[6]; spW[0] = vSpW0.x; spW[1] = vSpW0.y; spW[2] = vSpW0.z; spW[3] = vSpW0.w; spW[4] = vSpW1.x; spW[5] = vSpW1.y;
vec3 spGN = normalize(vSpN); vec3 spTw = pow(abs(spGN), vec3(4.0)); spTw /= max(spTw.x + spTw.y + spTw.z, 1e-4);
bool spSteep = abs(spGN.y) < uTri;
// ultra: parallax occlusion on flats near the camera. Height is each layer's AO (cracks, gaps and mortar are low), marched in world xz along the eye ray over 0.4 * uPom metres of relief (ground relief is millimetres: more reads as a smeared texture); one fetch per active layer per step.
vec2 spXZ = vSpWorld.xz; float spPk = uPom * 0.4 * uPomK * (1.0 - smoothstep(9.0, 20.0, length(vViewPosition)));
vec2 gx = dFdx(vSpWorld.xz), gy = dFdy(vSpWorld.xz);
if (spPk > 0.0 && !spSteep) {
  vec3 spV = normalize(inverseTransformDirection(vViewPosition, viewMatrix)); vec2 spStp = -spV.xz / max(spV.y, 0.18) * spPk;
  const int PN = 8; float pl = 1.0 / float(PN); float pd = 0.0; vec2 pA = spXZ, pB = spXZ, pc = spXZ; float fA = 0.0, fB = 0.0; bool ph = false;
  for (int k = 0; k < PN; k++) { if (!ph) {
    float hh = 0.0, ws = 0.0; for (int i = 0; i < 6; i++) { float wi = i < 4 ? vSpW0[i] : (i == 4 ? vSpW1.x : vSpW1.y); if (wi < 0.06) continue; hh += wi * smoothstep(0.25, 1.0, textureGrad(uSpO, vec3(pc * uTile[i], float(i)), gx * uTile[i], gy * uTile[i]).r); ws += wi; }
    float f = (1.0 - hh / max(ws, 1e-3)) - pd;
    if (f <= 0.0) { ph = true; pB = pc; fB = f; } else { pA = pc; fA = f; pc += spStp * pl; pd += pl; } } }
  spXZ = ph ? pA + (pB - pA) * (fA / (fA - fB)) : pc;
}
vec3 spAlbT[6]; vec3 spOrmT[6]; vec3 spNrmT[6]; float spH[6];
float spMax = 0.0;
for (int i = 0; i < 6; i++) { spH[i] = 0.0; if (spW[i] < 0.012) continue; vec3 uvw = vec3(spXZ * uTile[i], float(i));
  spAlbT[i] = texture(uSpA, uvw).rgb; spOrmT[i] = texture(uSpO, uvw).rgb; spNrmT[i] = texture(uSpN, uvw).xyz * 2.0 - 1.0;
  spH[i] = clamp(spOrmT[i].r * 0.6 + dot(spAlbT[i], vec3(0.299, 0.587, 0.114)) * 0.4, 0.0, 1.0); spMax = max(spMax, spW[i] + spH[i] * uHB); }
vec3 spAlb = vec3(0.0); vec3 spOrm = vec3(0.0); vec3 spNrm = vec3(0.0); vec3 spNrmX = vec3(0.0); vec3 spNrmZ = vec3(0.0); vec3 spAlbX = vec3(0.0); vec3 spAlbZ = vec3(0.0); float spSum = 0.0;
for (int i = 0; i < 6; i++) { if (spW[i] < 0.012) continue;
  float wi = max(spW[i] + spH[i] * uHB - spMax + uBand, 0.0); if (wi <= 0.0) continue;
  spAlb += spAlbT[i] * wi; spOrm += spOrmT[i] * wi; spNrm += spNrmT[i] * wi; spSum += wi;
  if (spSteep) { vec3 uX = vec3(vSpWorld.zy * uTile[i], float(i)); vec3 uZ = vec3(vSpWorld.xy * uTile[i], float(i));
    spAlbX += texture(uSpA, uX).rgb * wi; spAlbZ += texture(uSpA, uZ).rgb * wi; spNrmX += (texture(uSpN, uX).xyz * 2.0 - 1.0) * wi; spNrmZ += (texture(uSpN, uZ).xyz * 2.0 - 1.0) * wi; } }
spSum = max(spSum, 1e-3); spAlb /= spSum; spOrm /= spSum; spNrm /= spSum;
if (spSteep) { float st = 1.0 - smoothstep(uTri * 0.78, uTri, abs(spGN.y)); spAlbX /= spSum; spAlbZ /= spSum; spNrmX /= spSum; spNrmZ /= spSum;
  vec3 sideA = (spAlbX * spTw.x + spAlbZ * spTw.z) / max(spTw.x + spTw.z, 1e-4); spAlb = mix(spAlb, sideA, st * smoothstep(0.0, 0.25, spTw.x + spTw.z)); }
diffuseColor.rgb *= mix(spAlb, vec3(dot(spAlb, vec3(0.299, 0.587, 0.114))), uDesat) * uGain;`;

const FRAG_NORMAL = `#include <normal_fragment_maps>
{ vec3 gN = spGN; vec3 nT = normalize(spNrm); vec3 top = vec3(gN.x + nT.x * uNS, gN.y * max(nT.z, 0.2), gN.z - nT.y * uNS);
  vec3 nw = top;
  if (spSteep) { vec3 nx = normalize(spNrmX), nz = normalize(spNrmZ); float st = 1.0 - smoothstep(uTri * 0.78, uTri, abs(gN.y));
    vec3 sx = vec3(gN.x * max(nx.z, 0.2), gN.y + nx.y * uNS, gN.z + nx.x * uNS); vec3 sz = vec3(gN.x + nz.x * uNS, gN.y + nz.y * uNS, gN.z * max(nz.z, 0.2));
    vec3 side = (sx * spTw.x + sz * spTw.z) / max(spTw.x + spTw.z, 1e-4); nw = mix(top, side, st * smoothstep(0.0, 0.25, spTw.x + spTw.z)); }
  normal = normalize((viewMatrix * vec4(normalize(nw), 0.0)).xyz); }`;

/** Mean linear albedo of each splat layer (the path tracer bakes the blend into vertex colours from these). */
export function layerMeans(albedo: THREE.Texture, layers = 6): THREE.Color[] {
  const img = albedo.image as { data?: ArrayLike<number>; width: number; height: number }; const out: THREE.Color[] = [];
  const stride = img.width * img.height * 4; const step = Math.max(1, Math.floor((img.width * img.height) / 4096));
  for (let l = 0; l < layers; l++) {
    let r = 0, g = 0, b = 0, c = 0; if (img.data) for (let i = 0; i < img.width * img.height; i += step) { const o = l * stride + i * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; c++; }
    const col = c ? new THREE.Color(r / c / 255, g / c / 255, b / c / 255) : new THREE.Color(0.5, 0.5, 0.4); out.push(col.convertSRGBToLinear());
  }
  return out;
}

/** Make `m` a splat terrain material (in place). The geometry must carry `aW0` (vec4) and `aW1` (vec2) layer weights. */
export function applyTerrainSplat(m: THREE.MeshStandardMaterial, set: TerrainSplatSet, o: TerrainSplatOptions = {}): THREE.MeshStandardMaterial {
  const u = {
    uSpA: { value: set.albedo }, uSpN: { value: set.normal }, uSpO: { value: set.orm }, uTile: { value: Array.from(set.tile) }, uNS: { value: o.normalStrength ?? 1 },
    uHB: { value: o.heightBlend ?? 0.7 }, uBand: { value: o.blendBand ?? 0.22 }, uTri: { value: o.triplanarBelow ?? 0.82 }, uDesat: { value: o.desaturate ?? 0.3 }, uGain: { value: o.albedoGain ?? 0.88 }, uPom: fxU.uParallax, uPomK: fxU.pomKT,
  };
  m.userData.splatUniforms = u; // lets a late-loading (compressed) texture set be swapped in without rebuilding the material
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r); Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + HEAD_V)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpW0 = aW0; vSpW1 = aW1; vSpWorld = (modelMatrix * vec4(position, 1.0)).xyz; vSpN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + HEAD_F).replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * spOrm.g;').replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= spOrm.r;');
  };
  m.customProgramCacheKey = () => o.key ?? 'terrain-splat'; m.needsUpdate = true;
  return m;
}
