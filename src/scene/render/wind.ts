import type * as THREE from 'three';
import { WIND } from '@/config/scene';

/** Shared wind uniforms; the town loop writes time, gust strength and the on/off switch (off for reduced motion). */
export const windU = { uTime: { value: 0 }, uWind: { value: 0.25 }, uOn: { value: 1 } };
export type WindKind = 'grass' | 'leaf' | 'flag';

const code = (kind: WindKind): string => {
  const P = WIND[kind];
  const k = `float amp = ${P.amp.toFixed(4)}; float fr = ${P.freq.toFixed(3)}; float sp = ${P.speed.toFixed(3)}; float gust = (0.55 + uWind * ${WIND.gust.toFixed(2)}) * uOn;`;
  if (kind === 'grass') {
    return `{ ${k} float h = clamp(position.y / 0.22, 0.0, 1.0); vec2 ip = vec2(0.0);
#ifdef USE_INSTANCING
  ip = instanceMatrix[3].xz;
#endif
  float ph = ip.x * 0.71 + ip.y * 0.93; float g = sin(uTime * sp + ph * fr) + 0.5 * sin(uTime * sp * 2.3 + ph * fr * 1.7);
  transformed.x += g * amp * h * h * gust; transformed.z += g * amp * 0.45 * h * h * gust; }`;
  }
  if (kind === 'leaf') {
    return `{ ${k} vec2 wp = modelMatrix[3].xz;
#ifdef USE_INSTANCING
  wp = instanceMatrix[3].xz;
#endif
  float h = clamp(position.y * 0.5, 0.0, 1.0); float ph = wp.x * 0.37 + wp.y * 0.53;
  float g = sin(uTime * sp + ph + position.x * fr + position.y * fr * 0.7) + 0.5 * sin(uTime * sp * 2.1 + position.z * fr * 1.3 + ph);
  transformed.x += g * amp * h * gust; transformed.z += cos(uTime * sp * 0.8 + ph + position.y * fr) * amp * 0.7 * h * gust; transformed.y += g * amp * 0.25 * h * gust; }`;
  }
  return `{ ${k} float h = 1.0 - uv.y; vec2 wp = modelMatrix[3].xz; float ph = wp.x * 0.4 + wp.y * 0.6;
  transformed.z += (sin(uTime * sp + position.y * fr + ph) + 0.4 * sin(uTime * sp * 2.2 + position.y * fr * 2.0)) * amp * h * gust; }`;
};

/** Add vertex wind sway to a standard or depth material (so shadows sway with the geometry). */
export function windify(mat: THREE.Material, kind: WindKind): void {
  const src = code(kind);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windU.uTime; sh.uniforms.uWind = windU.uWind; sh.uniforms.uOn = windU.uOn;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform float uOn;').replace('#include <begin_vertex>', `#include <begin_vertex>\n${src}`);
  };
  mat.customProgramCacheKey = () => 'wind-' + kind;
  mat.needsUpdate = true;
}
