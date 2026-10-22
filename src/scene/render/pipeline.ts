import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { TexturePass } from 'three/examples/jsm/postprocessing/TexturePass.js';
import { DENOISE_SHADER } from './still';
import { DIRECTOR, LIGHT_TIERS, POST, QUALITY, SKY_DOME as SD, type QualitySpec, type QualityTier } from '@/config/scene';
import { FogPass, type FogInputs } from './froxelFog';
import { lfxOn } from './lightFx';
import './shaderGuards';
import { passProf } from './passProf';

/** Final composite: the sky is painted behind the (transparent) scene, then vignette, grade and dither on the tone mapped image. */
const COMPOSITE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }, uTop: { value: new THREE.Vector3() }, uBot: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Vector4() },
    uSun: { value: new THREE.Vector2(0.8, 0.2) }, uMoon: { value: new THREE.Vector2(0.2, 0.2) }, uSunCol: { value: new THREE.Vector3(1, 0.9, 0.7) }, uSunI: { value: 0 }, uMoonI: { value: 0 },
    uStars: { value: 0 }, uTime: { value: 0 }, uAz: { value: 0 }, uAspect: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uVig: { value: 0.2 }, uSat: { value: 1 }, uCon: { value: 1 }, uDither: { value: 0.004 }, uSkyOn: { value: 1 }, uGod: { value: 0 }, uExp: { value: 1 }, uCA: { value: DIRECTOR.lens.aberration }, uGrain: { value: DIRECTOR.lens.grain },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform float uGod; uniform float uExp; uniform sampler2D tDiffuse; uniform vec3 uTop; uniform vec3 uBot; uniform vec4 uGlow; uniform vec2 uSun; uniform vec2 uMoon; uniform vec3 uSunCol; uniform float uSunI; uniform float uMoonI;
uniform float uStars; uniform float uTime; uniform float uAz; uniform float uAspect; uniform vec3 uTint; uniform float uVig; uniform float uSat; uniform float uCon; uniform float uDither; uniform float uSkyOn; uniform float uCA; uniform float uGrain;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
vec3 sky(vec2 uv){
  float t = clamp((1.0 - uv.y) / ${SD.botAt.toFixed(2)}, 0.0, 1.0); vec3 c = mix(uTop, uBot, t);
  vec2 ad = vec2(uAspect, 1.0);
  float gl = 1.0 - smoothstep(0.0, 1.0, length((uv - uSun) * ad / vec2(${SD.glowRadius[0].toFixed(2)}, ${SD.glowRadius[1].toFixed(2)}) * 0.6));
  c = mix(c, uGlow.rgb, uGlow.a * gl * (1.0 - uMoonI));
  // stars: jittered cells, twinkle, denser near the top
  vec2 p = (uv + vec2(uAz * 0.02, 0.0)) * ad * ${SD.stars.cell.toFixed(1)}; vec2 ip = floor(p), fp = fract(p); float h = hash(ip);
  if (h < ${SD.stars.chance.toFixed(2)}) { vec2 sp = vec2(hash(ip + 3.1), hash(ip + 7.7)); float d = length(fp - sp); float tw = 0.65 + 0.35 * sin(uTime * (1.2 + h * 9.0) + h * 60.0); float br = 0.35 + hash(ip + 1.3) * 0.9;
    float s = smoothstep(${SD.stars.size.toFixed(3)} * (0.45 + h * 2.4), 0.0, d) * tw * br; c += vec3(1.0, 0.95, 0.86) * s * uStars * ${SD.stars.boost.toFixed(2)} * smoothstep(0.05, 0.85, uv.y + 0.1); }
  // sun disc and halo
  float ds = length((uv - uSun) * ad); c += uSunCol * uSunI * (smoothstep(${SD.sunDisc.toFixed(3)}, ${(SD.sunDisc * 0.55).toFixed(3)}, ds) * 1.4 + exp(-ds * 9.0) * ${SD.sunGlow.toFixed(2)});
  // moon: disc with soft maria and halo
  vec2 mv = (uv - uMoon) * ad; float dm = length(mv); float disc = smoothstep(${SD.moonDisc.toFixed(3)}, ${(SD.moonDisc * 0.9).toFixed(3)}, dm);
  float mar = 0.82 + 0.18 * noise(mv * 70.0) * noise(mv * 31.0 + 4.0); c = mix(c, vec3(0.93, 0.94, 0.88) * mar, disc * uMoonI);
  c += vec3(0.5, 0.62, 0.9) * uMoonI * (exp(-dm * 14.0) * 0.26 + exp(-dm * 40.0) * 0.12);
  return c;
}
void main(){
  vec2 cd = vUv - 0.5; vec2 co = cd * uCA * dot(cd, cd) * 4.0; vec4 s = texture2D(tDiffuse, vUv); s.r = texture2D(tDiffuse, vUv + co).r; s.b = texture2D(tDiffuse, vUv - co).b;
  vec3 col = s.rgb + uSkyOn * sky(vUv) * (1.0 - clamp(s.a, 0.0, 1.0));
  if (uGod > 0.001) { float toSun = 1.0 - clamp(length((uSun - vUv) * vec2(uAspect, 1.0)) * 0.9, 0.0, 1.0);
    if (toSun > 0.2) { vec2 dv = (uSun - vUv) / 8.0; float acc = 0.0, dec = 1.0; vec2 q2 = vUv + dv * hash(gl_FragCoord.xy + fract(uTime) * 17.0);
      for (int i = 0; i < 8; i++) { q2 += dv; acc += (1.0 - clamp(texture2D(tDiffuse, q2).a, 0.0, 1.0)) * dec; dec *= 0.9; }
      col += uSunCol * uSunI * uGod * acc / 8.0 * toSun * toSun * 0.5; } }
  col *= uExp;
  float l = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(l), col, uSat); col = (col - 0.5) * uCon + 0.5; col *= uTint;
  vec2 q = vUv - 0.5; q.x *= uAspect * 0.6; col *= 1.0 - uVig * smoothstep(${POST.vignette.softness.toFixed(2)} * 0.45, ${POST.vignette.softness.toFixed(2)} * 1.05, length(q));
  col += (hash(gl_FragCoord.xy * 1.7 + fract(uTime) * 91.0) - 0.5) * uGrain * (1.0 - l * 0.6);
  col += (hash(gl_FragCoord.xy + fract(uTime)) + hash(gl_FragCoord.yx * 1.37 + fract(uTime * 1.7)) - 1.0) * uDither;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`,
};

/** Depth of field: circle of confusion from the (resolved) depth buffer, disc blur with golden-angle taps. Alpha is blurred too so the sky composite stays soft. */
const DOF = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null }, uNear: { value: 0.5 }, uFar: { value: 300 }, uFocus: { value: 20 }, uAperture: { value: DIRECTOR.dof.aperture }, uMaxBlur: { value: DIRECTOR.dof.maxBlur }, uAspect: { value: 1 }, uNearK: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float uNearK; uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uAperture; uniform float uMaxBlur; uniform float uAspect; varying vec2 vUv;
float viewZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float coc(vec2 uv){ float d = texture2D(tDepth, uv).x; if (d >= 0.9999) return uMaxBlur * 0.5; float z = viewZ(d); return clamp(abs(1.0 / uFocus - 1.0 / z) * uFocus * uAperture * 0.05 * (z < uFocus ? uNearK : 1.0), 0.0, uMaxBlur); }
void main(){
  float c0 = coc(vUv); vec4 acc = texture2D(tDiffuse, vUv); float wsum = 1.0;
  if (c0 > 0.0004) { const int N = ${DIRECTOR.dof.taps}; for (int i = 1; i <= N; i++) { float fi = float(i); float a = fi * 2.399963; float r = sqrt(fi / float(N)); vec2 o = vec2(cos(a) * r / uAspect, sin(a) * r) * c0; vec2 uv = vUv + o; float ci = coc(uv); float w = smoothstep(0.0, 0.002, ci + 0.0006); acc += texture2D(tDiffuse, uv) * w; wsum += w; } }
  gl_FragColor = acc / wsum;
}`,
};
class DofPass extends ShaderPass {
  /** Depth of the target the scene pass drew into: after an earlier pass swaps buffers (AO on ultra) readBuffer.depthTexture is another, never-rendered clone, which read as depth 0 and blurred everything. */
  depthOf: (() => THREE.Texture | null) | null = null;
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) { this.uniforms.tDepth.value = this.depthOf?.() ?? readBuffer.depthTexture; super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); }
}

/** Camera motion blur: reproject each pixel's world position with last frame's view-projection and blur along the screen velocity. */
const MB = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uStrength: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform mat4 uPrevVP; uniform float uStrength; varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).x; vec4 col = texture2D(tDiffuse, vUv);
  if (d >= 0.9999 || uStrength <= 0.001) { gl_FragColor = col; return; }
  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uInvProj * ndc; v /= v.w; vec4 w = uCamWorld * v; vec4 pc = uPrevVP * w; vec2 prev = pc.xy / pc.w * 0.5 + 0.5;
  vec2 vel = (vUv - prev) * uStrength; float l = length(vel); if (l > 0.03) vel *= 0.03 / l;
  vec4 acc = col; for (int i = 1; i < ${DIRECTOR.motionBlur.taps}; i++) { float t = float(i) / float(${DIRECTOR.motionBlur.taps}) - 0.5; acc += texture2D(tDiffuse, vUv + vel * t); }
  gl_FragColor = acc / float(${DIRECTOR.motionBlur.taps});
}`,
};
class MotionBlurPass extends ShaderPass {
  depthOf: (() => THREE.Texture | null) | null = null; // see DofPass
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) { this.uniforms.tDepth.value = this.depthOf?.() ?? readBuffer.depthTexture; super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); }
}


/** Temporal anti-aliasing at 1x: Halton sub-pixel jitter, clamped history blend; the history is dropped while the camera moves so nothing ghosts. */
const TAA = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tHistory: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2() }, uBlend: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform sampler2D tHistory; uniform vec2 uTexel; uniform float uBlend; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv); if (uBlend >= 0.999) { gl_FragColor = c; return; }
  vec4 mn = c, mx = c;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec4 s = texture2D(tDiffuse, vUv + vec2(float(i), float(j)) * uTexel); mn = min(mn, s); mx = max(mx, s); }
  vec4 h = clamp(texture2D(tHistory, vUv), mn, mx); gl_FragColor = mix(h, c, uBlend);
}`,
};
const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
class TaaPass extends ShaderPass {
  history: THREE.WebGLRenderTarget | null = null; private copy = new ShaderPass({ uniforms: { tDiffuse: { value: null as THREE.Texture | null } }, vertexShader: TAA.vertexShader, fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }' });
  frame = 0; moved = true; cam: THREE.PerspectiveCamera | null = null;
  constructor() { super(TAA); this.needsSwap = true; }
  resetHistory() { this.moved = true; }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    const w = readBuffer.width, h = readBuffer.height;
    if (!this.history || this.history.width !== w || this.history.height !== h) { this.history?.dispose(); this.history = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace }); this.moved = true; }
    this.uniforms.tHistory.value = this.history.texture; (this.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h); this.uniforms.uBlend.value = this.moved ? 1 : 0.14;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.copy.uniforms.tDiffuse.value = writeBuffer.texture; this.copy.render(renderer, this.history, writeBuffer, deltaTime, false); this.moved = false;
  }
  dispose() { this.history?.dispose(); super.dispose(); }
}

/** AO reads the scene pass depth and rebuilds normals from it (GTAO shader NORMAL_VECTOR_TYPE 0), so AO re-renders nothing: the old normal pass drew every opaque mesh a second time. Transparent and additive meshes write no depth, so clouds and flames never occlude. */
function aoFromSceneDepth(ao: GTAOPass, depth: () => THREE.Texture | null) {
  (ao as unknown as { _renderGBuffer: boolean })._renderGBuffer = false;
  for (const m of [ao.gtaoMaterial, ao.pdMaterial]) { m.defines.NORMAL_VECTOR_TYPE = 0; m.defines.DEPTH_SWIZZLING = 'x'; m.needsUpdate = true; }
  const render = ao.render.bind(ao); ao.render = (...a: Parameters<GTAOPass['render']>) => { const d = depth(); ao.gtaoMaterial.uniforms.tDepth.value = d; ao.pdMaterial.uniforms.tDepth.value = d; render(...a); };
}

export interface SkyFrame {
  top: string; bot: string; glow: string; hour: number; night: number; time: number; az: number; archi: number; /** Camera is inside a room: no sun shafts. */ inside?: boolean; /** Weather fog and rain amounts 0..1 driving the froxel fog density. */ fog?: number; rain?: number;
}
const hex = (h: string, out: THREE.Vector3) => { const n = parseInt(h.slice(1), 16); out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

/** Post pipeline: HDR scene, optional GTAO and bloom, tone mapping, then the sky composite and grade. Falls back to a plain render at the low tier. */
export function createPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  let still: { c: EffectComposer; src: TexturePass; den: ShaderPass } | null = null; let spec: QualitySpec | null = null; let composer: EffectComposer | null = null; let bloom: UnrealBloomPass | null = null; let ao: GTAOPass | null = null;
  let fogPass: FogPass | null = null; let fogIn: FogInputs | null = null; let fogOn = false; const amb = new THREE.Color(); let wFog = 0, wRain = 0;
  let W = 1, H = 1, pr = 1; const comp = new ShaderPass(COMPOSITE); const U = comp.uniforms;
  const taa = new TaaPass(); const camSig = new THREE.Matrix4(); let jit = 0; let sigOff = 0, sigFov = 0;
  /** Horizontal panel shift as a fraction of the width (town); the TAA jitter is added on top of it, never replaces it. */
  let panOff = 0;
  const applyView = (jx: number, jy: number) => camera.setViewOffset(W * pr, H * pr, panOff * W * pr + jx, jy, W * pr, H * pr);
  const dof = new DofPass(DOF); dof.enabled = false; let dofOn = 0;
  let sceneRT: THREE.WebGLRenderTarget | null = null; const sceneDepth = () => sceneRT?.depthTexture ?? null; dof.depthOf = sceneDepth;
  const mb = new MotionBlurPass(MB); mb.enabled = false; mb.depthOf = sceneDepth; const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4(), prevPos = new THREE.Vector3(), prevQuat = new THREE.Quaternion();
  let expo = 1, lastT = 0; const tmp = new THREE.Vector3(); let lastTop = '', lastBot = '', lastGlow = '';

  function build() {
    composer?.dispose(); composer = null; bloom = null; ao = null; fogPass = null;
    if (!spec || !spec.post) return;
    const rt = new THREE.WebGLRenderTarget(W * pr, H * pr, { type: THREE.HalfFloatType, samples: spec.msaa, colorSpace: THREE.LinearSRGBColorSpace });
    if (spec.dof || spec.motionBlur || fogOn || spec.ao) { rt.depthTexture = new THREE.DepthTexture(W * pr, H * pr); rt.depthTexture.type = THREE.UnsignedIntType; }
    composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pr); composer.setSize(W, H);
    // the composer renders the scene into whichever of its two targets is the read buffer, and that alternates frame to frame when the pass count is odd: remember it for the depth readers
    const rp = new RenderPass(scene, camera); const rpRender = rp.render.bind(rp); rp.render = (r, wb, rb, ...rest) => { sceneRT = rb; rpRender(r, wb, rb, ...rest); }; composer.addPass(rp);
    if (fogOn && fogIn) { fogPass = new FogPass(camera, fogIn); composer.addPass(fogPass); } // HDR volumetric fog on the scene RT (needs its depth), before AO, DOF, bloom and tone mapping
    if (spec.ao) { ao = new GTAOPass(scene, camera, W * pr, H * pr); ao.blendIntensity = POST.ao.blend; ao.updateGtaoMaterial({ radius: POST.ao.radius, distanceExponent: POST.ao.distanceExponent, thickness: POST.ao.thickness, scale: POST.ao.scale, samples: POST.ao.samples, screenSpaceRadius: false }); aoFromSceneDepth(ao, sceneDepth); composer.addPass(ao); }
    if (spec.dof) composer.addPass(dof);
    if (spec.motionBlur) composer.addPass(mb);
    if (spec.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(W * pr, H * pr), POST.bloom.strengthDay, POST.bloom.radius, POST.bloom.thresholdDay); composer.addPass(bloom); }
    if (spec.taa) composer.addPass(taa);
    composer.addPass(new OutputPass()); composer.addPass(comp);
    composer.passes.forEach((p, i) => { const pr0 = p.render.bind(p); p.render = (...a) => passProf(renderer, `post:${i}:${p.constructor.name}`, () => pr0(...a)); }); if (process.env.NODE_ENV !== 'production') (window as unknown as { __passes: unknown }).__passes = composer.passes; // dev only: per-pass ablation (scripts/perf probes toggle `enabled`) // GPU time per pass while window.__passProf is set (dev A/B)
  }
  function applySize() { composer?.setPixelRatio(pr); composer?.setSize(W, H); ao?.setSize(W * pr, H * pr); }
  U.uDither.value = POST.grade.dither; U.uVig.value = POST.vignette.strength; U.uSat.value = POST.grade.saturation; U.uCon.value = POST.grade.contrast;

  return {
    /** True when the composite paints the sky (post tiers); the low tier keeps the transparent canvas and the page gradient. */
    get active() { return !!composer; },
    /** The froxel volume is built and composited this tier: it supplies all the fog, so `scene.fog` must stay at zero density or the two stack into a whiteout. */
    get froxel() { return !!fogPass; },
    /** Render target the scene pass draws into (null at the low tier). Program keys depend on it (linear output, no in-shader tone mapping), so shader warm-ups compile with it bound. */
    get sceneTarget(): THREE.WebGLRenderTarget | null { return composer ? composer.renderTarget1 : null; },
    /** Give the froxel fog its light sources (the sun/moon directional light with its shadow map, and the lamp lights); call before `configure`. */
    attachFog(inp: FogInputs) { fogIn = inp; },
    /** Weather amounts (0..1) for the froxel fog density, from the weather sampler. */
    setFogWeather(fog: number, rain: number) { wFog = fog; wRain = rain; },
    configure(q: QualitySpec) { const tn = (Object.keys(QUALITY) as QualityTier[]).find((k) => QUALITY[k] === q) ?? 'low'; const fo = LIGHT_TIERS[tn].froxel && lfxOn('froxel') && !!fogIn; const rebuild = fo !== fogOn || !spec || spec.dof !== q.dof || spec.motionBlur !== q.motionBlur || spec.post !== q.post || spec.msaa !== q.msaa || spec.ao !== q.ao || spec.bloom !== q.bloom || spec.taa !== q.taa; fogOn = fo; spec = q; if (rebuild) build(); },
    setSize(w: number, h: number) { W = w; H = h; pr = renderer.getPixelRatio(); // the tier cap, set on the renderer by town.applyQuality
      U.uAspect.value = w / h; if (composer) applySize(); },
    /** Panel shift (fraction of the width), applied to the camera view at once so overlays project with it. */
    setPanOffset(f: number) { panOff = f; applyView(0, 0); },
    /** Per frame sky/grade state. */
    update(f: SkyFrame) {
      if (f.top !== lastTop) { lastTop = f.top; hex(f.top, U.uTop.value as THREE.Vector3); }
      if (f.bot !== lastBot) { lastBot = f.bot; hex(f.bot, U.uBot.value as THREE.Vector3); }
      if (f.glow !== lastGlow) { lastGlow = f.glow; const m = f.glow.match(/[\d.]+/g)!.map(Number); (U.uGlow.value as THREE.Vector4).set(m[0] / 255, m[1] / 255, m[2] / 255, m[3]); }
      const k = f.night; const hr = f.hour; const dayU = Math.min(1, Math.max(0, (hr - 5.5) / 13)); const nightU = ((((hr - 18.5) % 24) + 24) % 24) / 11;
      (U.uSun.value as THREE.Vector2).set(SD.arc.x0 + (SD.arc.x1 - SD.arc.x0) * dayU, 1 - (SD.arc.yHorizon - (SD.arc.yHorizon - SD.arc.yPeak) * Math.sin(Math.PI * dayU)));
      const nu = Math.min(1, nightU); (U.uMoon.value as THREE.Vector2).set(SD.arc.x0 + (SD.arc.x1 - SD.arc.x0) * (1 - nu) * 0.9 + 0.04, 1 - (SD.arc.yHorizon - (SD.arc.yHorizon - SD.arc.yPeak) * Math.sin(Math.PI * Math.min(1, Math.max(0.05, nu)))));
      const sunK = Math.max(0, 1 - k * 1.6) * (1 - f.archi * 0.4); U.uSunI.value = sunK * 0.55; (U.uSunCol.value as THREE.Vector3).set(1, 0.92 - k * 0.3, 0.72 - k * 0.3);
      U.uMoonI.value = Math.max(0, k - 0.35) / 0.65; U.uStars.value = Math.max(0, k - 0.3) / 0.7;
      const tgt = 1 + k * 0.22; const dtA = Math.min(0.1, Math.max(0, f.time - lastT)); lastT = f.time; expo += (tgt - expo) * (1 - Math.exp(-dtA / 1.6)); U.uExp.value = expo; // eye adaptation: slow eased exposure toward the time of day target
      U.uGod.value = spec?.godRays && !f.inside ? Math.max(0, 1 - k * 1.6) * (1 - f.archi) : 0;
      if (fogPass) { const tt = U.uTop.value as THREE.Vector3, bb = U.uBot.value as THREE.Vector3; amb.setRGB(((tt.x + bb.x) / 2) ** 2.2, ((tt.y + bb.y) / 2) ** 2.2, ((tt.z + bb.z) / 2) ** 2.2); fogPass.set({ night: k, fog: f.fog ?? wFog, rain: f.rain ?? wRain, time: f.time, wind: 0, hemi: amb, inside: !!f.inside }); }
      U.uTime.value = f.time; U.uAz.value = f.az; U.uSkyOn.value = composer ? 1 : 0;
      tmp.set(1, 1, 1).lerp(tmp.set(POST.grade.nightTint[0], POST.grade.nightTint[1], POST.grade.nightTint[2]), k); (U.uTint.value as THREE.Vector3).copy(tmp);
      U.uVig.value = POST.vignette.strength * (1 + k * 0.5);
      if (bloom) { bloom.strength = POST.bloom.strengthDay + (POST.bloom.strengthNight - POST.bloom.strengthDay) * k; bloom.threshold = POST.bloom.thresholdDay + (POST.bloom.thresholdNight - POST.bloom.thresholdDay) * k; }
    },
    /** Depth of field strength 0..1 (0 skips the pass) and the focus distance in world units; only built on tiers with `dof`. */
    setDof(strength: number, focus: number, nearK = 1) { dofOn = strength; dof.uniforms.uNearK.value = nearK; dof.enabled = !!spec?.dof && strength > 0.02; dof.uniforms.uFocus.value = Math.max(0.5, focus); dof.uniforms.uAperture.value = DIRECTOR.dof.aperture * strength; dof.uniforms.uMaxBlur.value = DIRECTOR.dof.maxBlur * Math.min(1, strength / DIRECTOR.dof.strengthFocus); /* the blur radius scales with strength too: 14 taps at the full radius smear near objects */ },
    render(delta: number, warm = false) { if (composer) {
      if (spec?.motionBlur) {
        const B = DIRECTOR.motionBlur; const speed = camera.position.distanceTo(prevPos) * 0.4 + prevQuat.angleTo(camera.quaternion) * 14; const k = Math.min(1, Math.max(0, (speed - B.from) / (B.full - B.from)));
        mb.enabled = k > 0.02; mb.uniforms.uStrength.value = k * B.strength; mb.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse); mb.uniforms.uCamWorld.value.copy(camera.matrixWorld); mb.uniforms.uPrevVP.value.copy(prevVP);
        curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); prevPos.copy(camera.position); prevQuat.copy(camera.quaternion);
      } if (warm) { mb.enabled = !!spec?.motionBlur; dof.enabled = !!spec?.dof; } if (dofOn > 0.02 || warm) { dof.uniforms.uNear.value = camera.near; dof.uniforms.uFar.value = camera.far; dof.uniforms.uAspect.value = W / H; } if (spec?.taa) { const j = (++jit % 8) + 1; camera.updateMatrixWorld(); if (!camSig.equals(camera.matrixWorld) || sigOff !== panOff || sigFov !== camera.fov) taa.resetHistory(); camSig.copy(camera.matrixWorld); sigOff = panOff; sigFov = camera.fov;
        applyView(halton(j, 2) - 0.5, halton(j, 3) - 0.5); }
      composer.render(delta); if (warm) { mb.enabled = false; dof.enabled = !!spec?.dof && dofOn > 0.02; } if (spec?.taa) applyView(0, 0); if (spec?.motionBlur) prevVP.copy(curVP); } else renderer.render(scene, camera); },
    /** One frame with the optional passes (depth of field, motion blur) forced on, so their programs compile now (behind a gate or the boot splash) and not on first use mid-interaction. */
    warm() { this.render(0, true); },
    /** Show a linear HDR texture (path traced still) through denoise, tone mapping and the sky composite. */
    present(tex: THREE.Texture, strength: number) {
      if (!still) { const rt = new THREE.WebGLRenderTarget(W * pr, H * pr, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace }); still = { c: new EffectComposer(renderer, rt), src: new TexturePass(tex), den: new ShaderPass(DENOISE_SHADER) }; still.c.addPass(still.src); still.c.addPass(still.den); still.c.addPass(new OutputPass()); still.c.addPass(comp); }
      still.c.setPixelRatio(pr); still.c.setSize(W, H); still.src.map = tex; still.den.uniforms.uStrength.value = strength; (still.den.uniforms.uTexel.value as THREE.Vector2).set(1 / (W * pr), 1 / (H * pr)); U.uSkyOn.value = 1; still.c.render(0);
    },
    dispose() { composer?.dispose(); still?.c.dispose(); still = null; },
  };
}
export type Pipeline = ReturnType<typeof createPipeline>;
