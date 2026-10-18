import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { LIGHT_FX as LF } from '@/config/scene';

/**
 * Froxel volumetric fog (ultra). A camera-aligned grid of froxels (GRID[0] x GRID[1] x GRID[2], depth slices exponentially spaced) stored as a tiled 2D atlas
 * (one draw writes every slice; WebGL2 has no layered 3D render without a draw per slice):
 *   1. scatter: per froxel, extinction (weather driven, height falling, wind moved noise) and in-scattered radiance from the sun/moon directional light (with the
 *      shadow map, so buildings and trees cut real light shafts), the hemisphere ambient and the lamp point lights; jittered each frame and blended with last
 *      frame's volume reprojected through the previous view projection (temporal reprojection).
 *   2. integrate: front to back through the slices, accumulated in-scatter and transmittance per froxel (exact slab integral).
 *   3. composite (in the HDR chain, before bloom and tone mapping): one trilinear lookup per pixel at the full-resolution scene depth, color * T + in-scatter.
 * Everything composites at the 1x render size.
 */
const F = LF.froxel; const [GX, GY, GZ] = F.grid; const TILES_X = 8; const TILES_Y = Math.ceil(GZ / TILES_X);
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
/** NaN / Inf test on the exponent bits: isnan() is dropped under fast math on Metal, and one NaN in the history would stay in the volume (mix keeps it) and bleed through bloom into the whole frame. */
const FINITE = /* glsl */ `
bool badf(float x){ return (floatBitsToUint(x) & 0x7F800000u) == 0x7F800000u; }
bool bad4(vec4 v){ return badf(v.x) || badf(v.y) || badf(v.z) || badf(v.w); }`;
const ATLAS = /* glsl */ `
uniform vec2 uGrid; uniform vec2 uTiles; uniform float uD; uniform float uNear; uniform float uFar;
vec2 tileOrigin(float s){ float ty = floor(s / uTiles.x); return vec2(s - ty * uTiles.x, ty) * uGrid; }
vec4 atlasTap(sampler2D t, vec2 uv, float s){ vec2 px = tileOrigin(s) + clamp(uv * uGrid, vec2(0.5), uGrid - 0.5); return texture2D(t, px / (uGrid * uTiles)); }
vec4 atlas3(sampler2D t, vec3 uvw){ float s = clamp(uvw.z * uD - 0.5, 0.0, uD - 1.0); float s0 = floor(s); float s1 = min(s0 + 1.0, uD - 1.0); return mix(atlasTap(t, uvw.xy, s0), atlasTap(t, uvw.xy, s1), s - s0); }
float sliceDepth(float s){ return uNear * pow(uFar / uNear, s / uD); }
${FINITE}
`;
const SCATTER = /* glsl */ `
${ATLAS}
uniform sampler2D tHist; uniform float uHist; uniform vec3 uJit; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform mat4 uPrevVP;
uniform float uSigma; uniform float uTime; uniform vec3 uWind; uniform float uScaleH; uniform float uAniso;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform mat4 uShadowM; uniform sampler2D tShadow; uniform float uShadowOn; uniform vec3 uAmb;
uniform int uNL; uniform vec4 uLP[${F.maxLights}]; uniform vec4 uLC[${F.maxLights}]; uniform float uLampGain; uniform float uSunGain;
varying vec2 vUv;
float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float hg(float g, float c){ float g2 = g * g; return (1.0 - g2) / (12.566370614 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main(){
  vec2 p = gl_FragCoord.xy; vec2 tile = floor(p / uGrid); float s = tile.y * uTiles.x + tile.x;
  if (s >= uD || tile.x >= uTiles.x) { gl_FragColor = vec4(0.0); return; }
  vec2 local = p - tile * uGrid; vec2 uv = (local + 0.5 + uJit.xy) / uGrid; float zv = sliceDepth(s + 0.5 + uJit.z);
  vec4 vf = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); vec3 dirv = vf.xyz / vf.w; vec3 vpos = dirv * (zv / -dirv.z);
  vec3 wp = (uCamWorld * vec4(vpos, 1.0)).xyz; vec3 rd = normalize((uCamWorld * vec4(vpos, 0.0)).xyz);
  float hgt = wp.y; float hf = exp(-max(hgt, 0.0) / uScaleH) * smoothstep(-5.0, 0.5, hgt);
  vec3 q = wp * 0.11 + uWind * uTime; float nz = 0.65 * vn(q) + 0.35 * vn(q * 2.3 + 7.1);
  float sigma = uSigma * hf * mix(0.55, 1.45, nz);
  vec3 L = uAmb;
  float vis = 1.0;
  if (uShadowOn > 0.5) { vec4 sc = uShadowM * vec4(wp, 1.0); vec3 sp = sc.xyz / sc.w; if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0 && sp.z < 1.0) vis = step(sp.z - 0.002, texture2D(tShadow, sp.xy).r); }
  L += uSunCol * uSunGain * hg(uAniso, dot(rd, uSunDir)) * vis;
  for (int i = 0; i < ${F.maxLights}; i++) { if (i >= uNL) break; vec3 d = uLP[i].xyz - wp; float r2 = dot(d, d) + 0.05; float rr = sqrt(r2); float cone = mix(1.0, smoothstep(-0.25, 0.7, d.y / rr), uLP[i].w);
    float att = uLC[i].w > 0.0 ? clamp(1.0 - r2 / (uLC[i].w * uLC[i].w), 0.0, 1.0) : 1.0; L += uLC[i].rgb * att * att / r2 * 0.0795775 * uLampGain * cone; }
  vec4 cur = vec4(L * sigma, sigma);
  vec4 pc = uPrevVP * vec4(wp, 1.0);
  if (uHist > 0.0 && pc.w > 0.0) { vec3 pu = vec3(pc.xy / pc.w * 0.5 + 0.5, log(pc.w / uNear) / log(uFar / uNear)); if (all(greaterThanEqual(pu, vec3(0.0))) && all(lessThanEqual(pu, vec3(1.0)))) { vec4 h = atlas3(tHist, pu); if (!bad4(h)) cur = mix(cur, h, uHist); } }
  gl_FragColor = bad4(cur) ? vec4(0.0) : cur;
}`;
const INTEGRATE = /* glsl */ `
${ATLAS}
uniform sampler2D tScatter; uniform mat4 uInvProj; varying vec2 vUv;
void main(){
  vec2 p = gl_FragCoord.xy; vec2 tile = floor(p / uGrid); float s = tile.y * uTiles.x + tile.x;
  if (s >= uD || tile.x >= uTiles.x) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 local = p - tile * uGrid; vec2 uv = (local + 0.5) / uGrid; vec4 vf = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); vec3 dirv = vf.xyz / vf.w; float scale = length(dirv) / -dirv.z;
  vec3 I = vec3(0.0); float T = 1.0;
  for (int k = 0; k < ${GZ}; k++) { float fk = float(k); if (fk > s) break;
    vec4 c = texelFetch(tScatter, ivec2(tileOrigin(fk) + local), 0); float dl = (sliceDepth(fk + 1.0) - sliceDepth(fk)) * scale * (fk == s ? 0.5 : 1.0);
    float tr = exp(-c.a * dl); I += T * (c.a > 1e-5 ? c.rgb * (1.0 - tr) / c.a : c.rgb * dl); T *= tr; }
  vec4 o = vec4(I, T); gl_FragColor = bad4(o) ? vec4(0.0, 0.0, 0.0, 1.0) : o;
}`;
const COMPOSITE = /* glsl */ `
${ATLAS}
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform sampler2D tAccum; uniform float uCamNear; uniform float uCamFar; varying vec2 vUv;
void main(){
  vec4 col = texture2D(tDiffuse, vUv); float d = texture2D(tDepth, vUv).x;
  if (d >= 0.9999) { gl_FragColor = col; return; }
  float z = d * 2.0 - 1.0; float zv = 2.0 * uCamNear * uCamFar / (uCamFar + uCamNear - z * (uCamFar - uCamNear));
  float sc = clamp(log(max(zv, uNear) / uNear) / log(uFar / uNear), 0.0, 1.0); vec4 a = atlas3(tAccum, vec3(vUv, sc)); if (bad4(a)) { gl_FragColor = col; return; }
  float f = clamp(log(max(zv, 1e-3) / uNear) / log(uFar / uNear) * uD / 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col.rgb * mix(1.0, a.a, f) + a.rgb * f, col.a);
}`;
const COPY = 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }';

/** Test hook: the fog shader sources. */
export const FOG_GLSL = { scatter: SCATTER, integrate: INTEGRATE, composite: COMPOSITE } as const;
/** True when every number in every list is finite (a NaN or Inf uniform would poison the temporal history). */
export const allFinite = (...lists: ArrayLike<number>[]): boolean => { for (const l of lists) for (let i = 0; i < l.length; i++) if (!Number.isFinite(l[i])) return false; return true; };
export interface FogInputs { sun: THREE.DirectionalLight; lights: () => readonly (THREE.PointLight | THREE.SpotLight)[] }
export interface FogFrame { night: number; fog: number; rain: number; time: number; wind: number; hemi: THREE.Color; inside: boolean }
/** Extinction (1/unit) at the volume's ground layer: base haze, night mist, fog and rain weather add; zero inside a room. */
export const fogSigma = (f: Pick<FogFrame, 'night' | 'fog' | 'rain' | 'inside'>): number => (f.inside ? 0 : F.base + F.night * f.night + F.fog * f.fog + F.rain * f.rain);
/** Atlas size in texels: GRID[2] depth slices tiled TILES_X wide. */
export const froxelAtlas = { tilesX: TILES_X, tilesY: TILES_Y, width: GX * TILES_X, height: GY * TILES_Y } as const;
/** View-space depth of the centre of slice `s` (exponentially spaced between near and far), as in the shader's sliceDepth. */
export const sliceDepth = (s: number): number => F.near * Math.pow(F.far / F.near, s / GZ);
const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class FogPass extends Pass {
  private rt = [0, 1].map(() => new THREE.WebGLRenderTarget(GX * TILES_X, GY * TILES_Y, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace }));
  private acc = new THREE.WebGLRenderTarget(GX * TILES_X, GY * TILES_Y, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace });
  private tmp = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace });
  private cur = 0; private frame = 0; private reset = true; private prevVP = new THREE.Matrix4(); private vp = new THREE.Matrix4();
  private common = { uGrid: { value: new THREE.Vector2(GX, GY) }, uTiles: { value: new THREE.Vector2(TILES_X, TILES_Y) }, uD: { value: GZ }, uNear: { value: F.near }, uFar: { value: F.far } };
  private mScatter: THREE.ShaderMaterial; private mInt: THREE.ShaderMaterial; private mComp: THREE.ShaderMaterial; private mCopy: THREE.ShaderMaterial;
  private qScatter: FullScreenQuad; private qInt: FullScreenQuad; private qComp: FullScreenQuad; private qCopy: FullScreenQuad;
  private sunDir = new THREE.Vector3(); private v = new THREE.Vector3(); private tgt = new THREE.Vector3(); private frameIn: FogFrame | null = null; private sigma = 0;
  constructor(private camera: THREE.PerspectiveCamera, private inp: FogInputs) {
    super(); this.needsSwap = false;
    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ uniforms: { ...this.common, ...uniforms }, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    const lp = Array.from({ length: F.maxLights }, () => new THREE.Vector4()), lc = Array.from({ length: F.maxLights }, () => new THREE.Vector4());
    this.mScatter = mat(SCATTER, { tHist: { value: null }, uHist: { value: 0 }, uJit: { value: new THREE.Vector3() }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uSigma: { value: 0 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector3(0.02, 0, 0.012) }, uScaleH: { value: F.scaleH }, uAniso: { value: F.anisotropy }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3() }, uShadowM: { value: new THREE.Matrix4() }, tShadow: { value: null }, uShadowOn: { value: 0 }, uAmb: { value: new THREE.Vector3() }, uNL: { value: 0 }, uLP: { value: lp }, uLC: { value: lc }, uLampGain: { value: F.lampGain }, uSunGain: { value: F.sunGain } });
    this.mInt = mat(INTEGRATE, { tScatter: { value: null }, uInvProj: { value: new THREE.Matrix4() } });
    this.mComp = mat(COMPOSITE, { tDiffuse: { value: null }, tDepth: { value: null }, tAccum: { value: this.acc.texture }, uCamNear: { value: 0.1 }, uCamFar: { value: 500 } });
    this.mCopy = mat(COPY, { tDiffuse: { value: null } });
    this.qScatter = new FullScreenQuad(this.mScatter); this.qInt = new FullScreenQuad(this.mInt); this.qComp = new FullScreenQuad(this.mComp); this.qCopy = new FullScreenQuad(this.mCopy);
  }
  /** Weather and time of day inputs for this frame; `inside` or zero density disables the pass. */
  set(f: FogFrame) {
    this.frameIn = f; this.sigma = fogSigma(f); this.enabled = this.sigma > 1e-4;
    this.mScatter.uniforms.uWind.value.set(0.02 + f.wind * 0.01, 0, 0.012 + f.wind * 0.006);
  }
  invalidate() { this.reset = true; }
  setSize(w: number, h: number) { this.tmp.setSize(w, h); }
  private lights() {
    const u = this.mScatter.uniforms; const ls = this.inp.lights(); const cam = this.camera.position; const picked: { l: THREE.PointLight | THREE.SpotLight; d: number }[] = [];
    for (const l of ls) { if (!l.visible || l.intensity < 0.02) continue; l.getWorldPosition(this.v); const d = this.v.distanceToSquared(cam); if (Number.isFinite(d + l.intensity + (l.distance || 0))) picked.push({ l, d }); }
    picked.sort((a, b) => a.d - b.d); const n = Math.min(F.maxLights, picked.length); u.uNL.value = n;
    for (let i = 0; i < n; i++) { const { l } = picked[i]; l.getWorldPosition(this.v); const spot = (l as THREE.SpotLight).isSpotLight ? 1 : 0; u.uLP.value[i].set(this.v.x, this.v.y, this.v.z, spot); u.uLC.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, l.distance || 0); }
  }
  private volumes(renderer: THREE.WebGLRenderer) {
    const f = this.frameIn!; const cam = this.camera; const sun = this.inp.sun; const u = this.mScatter.uniforms; const next = 1 - this.cur;
    cam.updateMatrixWorld(); this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frame++;
    const j = (this.frame % 16) + 1; u.uJit.value.set(halton(j, 2) - 0.5, halton(j, 3) - 0.5, halton(j, 5) - 0.5);
    u.uInvProj.value.copy(cam.projectionMatrixInverse); u.uCamWorld.value.copy(cam.matrixWorld); u.uPrevVP.value.copy(this.prevVP); u.tHist.value = this.rt[this.cur].texture; u.uHist.value = this.reset ? 0 : F.history;
    u.uSigma.value = this.sigma; u.uTime.value = f.time;
    sun.getWorldPosition(this.sunDir); sun.target.getWorldPosition(this.tgt); this.sunDir.sub(this.tgt).normalize(); u.uSunDir.value.copy(this.sunDir);
    const si = sun.intensity; u.uSunCol.value.set(sun.color.r * si, sun.color.g * si, sun.color.b * si);
    u.uAmb.value.set(f.hemi.r, f.hemi.g, f.hemi.b).multiplyScalar(F.ambient * 0.0795775);
    const sm = sun.shadow.map; const depthTex = sm && (sm as THREE.WebGLRenderTarget).depthTexture; const basic = renderer.shadowMap.type === THREE.BasicShadowMap;
    u.uShadowOn.value = basic && sm && depthTex && sun.castShadow ? 1 : 0; if (u.uShadowOn.value) { u.tShadow.value = depthTex; u.uShadowM.value.copy(sun.shadow.matrix); }
    const sd = this.sunDir, sc = u.uSunCol.value as THREE.Vector3, am = u.uAmb.value as THREE.Vector3;
    if (!Number.isFinite(sd.x + sd.y + sd.z + sc.x + sc.y + sc.z + am.x + am.y + am.z) || !allFinite(cam.projectionMatrixInverse.elements, cam.matrixWorld.elements, this.vp.elements)) { this.reset = true; return; } // skip: keep the last good volume, drop history
    this.lights();
    renderer.setRenderTarget(this.rt[next]); this.qScatter.render(renderer);
    this.mInt.uniforms.tScatter.value = this.rt[next].texture; this.mInt.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    renderer.setRenderTarget(this.acc); this.qInt.render(renderer);
    this.cur = next; this.prevVP.copy(this.vp); this.reset = false;
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.frameIn || !read.depthTexture) return;
    const prevAuto = renderer.autoClear; renderer.autoClear = false; this.volumes(renderer);
    const u = this.mComp.uniforms; u.tDiffuse.value = read.texture; u.tDepth.value = read.depthTexture; u.uCamNear.value = this.camera.near; u.uCamFar.value = this.camera.far;
    renderer.setRenderTarget(this.tmp); this.qComp.render(renderer);
    this.mCopy.uniforms.tDiffuse.value = this.tmp.texture; renderer.setRenderTarget(read); this.qCopy.render(renderer);
    renderer.autoClear = prevAuto;
  }
  dispose() { this.rt.forEach((r) => r.dispose()); this.acc.dispose(); this.tmp.dispose(); [this.mScatter, this.mInt, this.mComp, this.mCopy].forEach((m) => m.dispose()); [this.qScatter, this.qInt, this.qComp, this.qCopy].forEach((q) => q.dispose()); super.dispose(); }
}
