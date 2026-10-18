import * as THREE from 'three';
import { waterU } from './waterReflect';

/** Shared uniforms for water and parallax shaders (written by the town loop). */
export const fxU = { uTime: { value: 0 }, uNight: { value: 0 }, uParallax: { value: 0.035 }, pomK: { value: 1 }, /** terrain splat parallax scale (0 = off): separate from `pomK` (stone, path, ground materials) so profiling can tell the two apart */ pomKT: { value: 1 } };
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') (window as unknown as { __fxu: unknown }).__fxu = fxU; // dev only: fx-shots A/B (pomK = 0 turns parallax off)

const GERSTNER = `
{ vec3 wp = cameraPosition - inverseTransformDirection(vViewPosition, viewMatrix); vec2 p = wp.xz; vec3 dn = vec3(0.0);
  for (int i = 0; i < 4; i++) { float fi = float(i); vec2 d = normalize(vec2(cos(fi * 1.7 + 0.4), sin(fi * 2.3 + 1.1))); float k = 2.4 + fi * 1.9; float a = 0.05 / (1.0 + fi * 0.9); float c = sqrt(9.8 / k) * 0.35;
    float ph = k * dot(d, p) - c * k * fxTime * 2.0; dn.xz -= d * k * a * cos(ph); }
  vec3 wN = normalize(vec3(dn.x, 1.0, dn.z)); normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz * 0.6 + normal * 0.4);
  vec3 vd = normalize(vViewPosition); float ndv = clamp(dot(normal, vd), 0.0, 1.0); float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // depth absorption (Beer-Lambert): clear shallows, tinted deep water; the bed shows through shallow parts, refracted by the wave normal
  float dpth = vWDepth; vec3 absorb = exp(-dpth * vec3(0.9, 0.28, 0.16) * (1.0 + fxNight * 0.5));
  vec2 refr = dn.xz * 3.0 * (1.0 - fres); float bed = 0.5 + 0.5 * sin((p.x + refr.x) * 6.0) * sin((p.y + refr.y) * 6.0);
  vec3 bedCol = mix(vec3(0.42, 0.36, 0.24), vec3(0.3, 0.27, 0.2), bed) * (1.0 - fxNight * 0.6);
  vec3 body = mix(diffuseColor.rgb, bedCol * absorb, clamp(1.0 - dpth * 0.55, 0.0, 1.0) * 0.55 * (uWOn > 0.5 ? 0.0 : 1.0)) * mix(vec3(1.0), absorb * 1.6, 0.5);
  diffuseColor.rgb = body; roughnessFactor = mix(0.04, 0.2, 1.0 - fres);
  // foam on steep crests and in the shallows at the shore
  float crest = smoothstep(0.28, 0.42, length(dn.xz)); float nz = sin(p.x * 9.0 + fxTime) * sin(p.y * 8.0 - fxTime * 0.7); float shore = smoothstep(0.35, 0.0, dpth) * (0.5 + 0.5 * nz);
  wFoam = clamp(crest * (0.2 + 0.2 * nz) + shore * 0.6, 0.0, 1.0) * (1.0 - fxNight * 0.6); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 0.96), wFoam); }
`;
const WATER_HEAD = `
varying float vWDepth; uniform float fxTime; uniform float fxNight;
uniform float uWOn; uniform float uWDbg; uniform vec2 uRes; uniform vec2 uNearFar; uniform sampler2D tWRefl; uniform sampler2D tWRefr; uniform sampler2D tWDepth; uniform mat4 uReflVP; uniform vec4 uRectR; uniform vec2 uScaleR; uniform vec4 uRectF; uniform vec2 uScaleF;
vec2 wUvF(vec2 u) { return clamp((u - uRectF.xy) / uRectF.zw, 0.002, 0.998) * uScaleF; }
vec2 wUvR(vec2 u) { return clamp((u - uRectR.xy) / uRectR.zw, 0.002, 0.998) * uScaleR; }
float wSceneDist(vec2 u) { float d = texture2D(tWDepth, wUvF(u)).x; return -(uNearFar.x * uNearFar.y) / (d * (uNearFar.y - uNearFar.x) - uNearFar.y); }
`;
/** Real refraction (scene colour and depth behind the water, Beer-Lambert on the true thickness) and a planar mirror, both from waterReflect's footprint passes. */
const WATER_PLANAR = `
#include <emissivemap_fragment>
vec4 wRefl = vec4(0.0); float wFr = 0.0; vec3 wDbgC = vec3(0.0);
if (uWOn > 0.5) {
  float ndv2 = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); wFr = 0.02 + 0.98 * pow(1.0 - ndv2, 5.0);
  vec2 slope = (normal - nonPerturbedNormal).xy; vec2 uvF = gl_FragCoord.xy / uRes; vec2 uvR = uvF + slope * 0.05 * (1.0 - wFr);
  float surf = vViewPosition.z; float d1 = wSceneDist(uvR); if (d1 < surf - 0.01) { uvR = uvF; d1 = wSceneDist(uvF); }
  float th = clamp(d1 - surf, 0.0, 3.0); diffuseColor.a *= smoothstep(0.0, 0.2, d1 - surf); // soft shore: fade over the true thickness, so the blocky terrain contour does not cut a hard stair-step edge
  vec3 refrC = texture2D(tWRefr, wUvF(uvR)).rgb;
  wDbgC = vec3(th * 2.0, refrC.g, wRefl.a); vec3 wT = exp(-th * vec3(2.6, 0.9, 0.55) * (1.0 + fxNight * 0.5));
  totalEmissiveRadiance += refrC * wT * (1.0 - wFr) * (1.0 - wFoam);
  diffuseColor.rgb *= mix(1.0 - 0.8 * dot(wT, vec3(0.3333)), 1.0, wFoam);
  vec3 wp2 = cameraPosition - inverseTransformDirection(vViewPosition, viewMatrix); vec4 cl = uReflVP * vec4(wp2, 1.0); vec2 uvM = cl.xy / cl.w * 0.5 + 0.5 + slope * vec2(0.06, 0.1);
  wRefl = texture2D(tWRefl, wUvR(uvM)); wRefl.a *= 1.0 - wFoam;
}
`;
const done = new WeakSet<THREE.Material>();

/** Gerstner wave normals, crest foam, Fresnel-driven look, planar reflection and scene refraction on water surfaces (flat meshes; waves are normal-space). `userData.noPlanar` keeps a mesh (waterfall) off the planar passes. */
export function waterFx(mat: THREE.Material): boolean {
  if (done.has(mat)) return false; done.add(mat); const m = mat as THREE.MeshPhysicalMaterial; const prev = m.onBeforeCompile; const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); sh.uniforms.fxTime = fxU.uTime; sh.uniforms.fxNight = fxU.uNight;
    sh.uniforms.uWOn = m.userData.noPlanar ? { value: 0 } : waterU.uOn; sh.uniforms.uWDbg = waterU.uDbg; sh.uniforms.uRes = waterU.uRes; sh.uniforms.uNearFar = waterU.uNearFar; sh.uniforms.tWRefl = waterU.tRefl; sh.uniforms.tWRefr = waterU.tRefr; sh.uniforms.tWDepth = waterU.tDepth;
    sh.uniforms.uReflVP = waterU.uReflVP; sh.uniforms.uRectR = waterU.uRectR; sh.uniforms.uScaleR = waterU.uScaleR; sh.uniforms.uRectF = waterU.uRectF; sh.uniforms.uScaleF = waterU.uScaleF;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vWDepth;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWDepth = aDepth;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WATER_HEAD).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat roughnessFactorW = roughnessFactor;').replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nfloat wFoam = 0.0;\n' + GERSTNER)
      .replace('#include <emissivemap_fragment>', WATER_PLANAR).replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nif (uWOn > 0.5) reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, wRefl.rgb * wFr, wRefl.a);\nif (uWDbg > 3.5) { vec3 keep = uWDbg < 4.5 ? totalEmissiveRadiance : (uWDbg < 5.5 ? reflectedLight.indirectSpecular : (uWDbg < 6.5 ? reflectedLight.directSpecular : reflectedLight.directDiffuse + reflectedLight.indirectDiffuse)); reflectedLight.directDiffuse = vec3(0.0); reflectedLight.indirectDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); totalEmissiveRadiance = vec3(0.0); reflectedLight.indirectSpecular = keep; } else if (uWDbg > 0.5) { reflectedLight.directDiffuse = vec3(0.0); reflectedLight.indirectDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); totalEmissiveRadiance = vec3(0.0); reflectedLight.indirectSpecular = uWDbg < 1.5 ? wDbgC : (uWDbg < 2.5 ? wRefl.rgb : texture2D(tWRefr, wUvF(gl_FragCoord.xy / uRes)).rgb); }'); };
  m.customProgramCacheKey = () => key() + '|water2'; m.needsUpdate = true; return true;
}

const POM = `
#ifdef USE_MAP
vec2 pomD = vec2(0.0);
float fxPomE = fxPom * fxPomK;
if (fxPomE > 0.0) {
  // tangent frame from screen derivatives (no tangent attribute needed): world-space view vector -> uv shift per unit of depth
  vec3 q0 = dFdx(vViewPosition), q1 = dFdy(vViewPosition); vec2 s0 = dFdx(vMapUv), s1 = dFdy(vMapUv);
  vec3 Vv = normalize(vViewPosition); vec3 Nc = cross(q0, q1); vec3 Ng = Nc / max(length(Nc), 1e-12); if (dot(Ng, Vv) < 0.0) Ng = -Ng;
  vec3 q1p = cross(q1, Ng), q0p = cross(Ng, q0); float pdet = dot(q0, q1p); float vn = max(dot(Vv, Ng), 0.12);
  vec3 Vt = Vv - Ng * dot(Vv, Ng); vec2 duv = abs(pdet) > 1e-12 ? (s0 * dot(Vt, q1p) + s1 * dot(Vt, q0p)) / pdet : vec2(0.0);
  vec2 stp = -duv / vn * fxPomE;
  // linear search of the height field (albedo luminance: mortar and cracks are low), then one secant refinement; fxPom is the relief depth in metres
  const int N = 12; float layer = 1.0 / float(N); float dd = 0.0; vec2 uvc = vMapUv, uvA = vMapUv, uvB = vMapUv; float fA = 0.0, fB = 0.0; bool hit = false;
  for (int i = 0; i < N; i++) { if (!hit) {
    float ds = 1.0 - smoothstep(0.08, 0.9, dot(textureGrad(map, uvc, s0, s1).rgb, vec3(0.299, 0.587, 0.114))); float f = ds - dd;
    if (f <= 0.0) { hit = true; uvB = uvc; fB = f; } else { uvA = uvc; fA = f; uvc += stp * layer; dd += layer; } } }
  pomD = (hit ? uvA + (uvB - uvA) * (fA / max(fA - fB, 1e-5)) : uvc) - vMapUv;
}
#define vNormalMapUv (vNormalMapUv + pomD)
#define vRoughnessMapUv (vRoughnessMapUv + pomD)
#define vMetalnessMapUv (vMetalnessMapUv + pomD)
#define vAoMapUv (vAoMapUv + pomD)
diffuseColor *= texture2D(map, vMapUv + pomD);
#endif
`;
/** Parallax occlusion approximation on map-based stone, ground and path materials; strength 0 disables it at runtime. */
export function parallaxFx(mat: THREE.Material): boolean {
  const m = mat as THREE.MeshStandardMaterial; if (done.has(mat) || !m.isMeshStandardMaterial || !m.map || m.transparent) return false; done.add(mat); const prev = m.onBeforeCompile; const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); sh.uniforms.fxPom = fxU.uParallax; sh.uniforms.fxPomK = fxU.pomK;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float fxPom;\nuniform float fxPomK;').replace('#include <map_fragment>', POM); };
  m.customProgramCacheKey = () => key() + '|pom'; m.needsUpdate = true; return true;
}
