import * as THREE from 'three';
import { STILL } from '@/config/scene';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { buildTraceScene, resetMergeGroups, setTraceRenderer, warmTraceTextures } from './traceScene';
import { passProf } from './passProf';

/** Edge preserving denoise for the progressive path tracer: cross bilateral on luminance with firefly clamp, fades out as samples converge. */
export const DENOISE_SHADER = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 1 }, uSigma: { value: STILL.denoise.sigmaColor }, uClamp: { value: STILL.fireflyClamp } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uStrength; uniform float uSigma; uniform float uClamp; varying vec2 vUv;
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    void main(){
      vec4 c0 = texture2D(tDiffuse, vUv); vec3 k0 = min(c0.rgb, vec3(uClamp)); float l0 = dot(k0, LUMA);
      if (uStrength <= 0.002) { gl_FragColor = c0; return; }
      float R = ${STILL.denoise.radius.toFixed(1)}; vec4 acc = vec4(0.0); float ws = 0.0;
      for (int j = -${STILL.denoise.radius}; j <= ${STILL.denoise.radius}; j++) for (int i = -${STILL.denoise.radius}; i <= ${STILL.denoise.radius}; i++) {
        vec4 s = texture2D(tDiffuse, vUv + vec2(float(i), float(j)) * uTexel * 1.5); vec3 ks = min(s.rgb, vec3(uClamp));
        float dl = (dot(ks, LUMA) - l0) / (0.04 + l0 * uSigma + (1.0 - uStrength) * 0.5); float dd = float(i * i + j * j) / (R * R * 0.6);
        float w = exp(-dl * dl - dd) * (0.4 + 0.6 * s.a); acc += vec4(ks, s.a) * w; ws += w;
      }
      vec4 d = acc / max(ws, 1e-4); gl_FragColor = vec4(mix(c0.rgb, d.rgb, uStrength), mix(c0.a, d.a, uStrength));
    }`,
};

export interface StillDeps {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  /** Draw a linear HDR texture through tone mapping, sky composite and grade; `strength` is the denoise amount (0..1). */
  present: (tex: THREE.Texture, strength: number) => void;
  /** Sky radiance (linear) at the zenith and the horizon, replaces the PMREM environment, which the tracer cannot read. */
  sky: () => { top: THREE.Color; bottom: THREE.Color };
}
type PathTracer = import('three-gpu-pathtracer').WebGLPathTracer;

/**
 * Progressive GPU path tracer for stills (photo mode, postcard export, ultra idle refine). The library is lazy loaded on first use.
 * The scene is traced as is (BVH built once per capture); the result is shown through the normal sky composite with a denoise pass.
 */
export function createStill(d: StillDeps) {
  setTraceRenderer(d.renderer);
  let pt: PathTracer | null = null; let loading: Promise<PathTracer | null> | null = null; let failed = false;
  let bvhWorker: GenerateMeshBVHWorker | null = null; let built = false; let budget = 0; let grad: { tex: import('three-gpu-pathtracer').GradientEquirectTexture } | null = null;
  let engaged = false; let starting = false; let exporting: { n: number; res: (url: string) => void; rej: (e: Error) => void } | null = null;

  function load(): Promise<PathTracer | null> {
    if (pt || failed) return Promise.resolve(pt);
    loading ??= import('three-gpu-pathtracer').then((m) => {
      const t = new m.WebGLPathTracer(d.renderer);
      t.renderToCanvas = false; t.rasterizeScene = false; t.renderDelay = 0; t.minSamples = 0; t.fadeDuration = 0; t.dynamicLowRes = false; t.synchronizeRenderSize = true;
      t.bounces = STILL.bounces; t.multipleImportanceSampling = true; t.tiles.set(2, 2); t.textureSize.set(1024, 1024);
      grad = { tex: new m.GradientEquirectTexture(16) }; pt = t; if (process.env.NODE_ENV !== 'production') (window as unknown as { __pt: unknown }).__pt = t; // dev only: tracer table probes
      return t;
    }).catch((e: unknown) => { failed = true; console.error('Path tracer unavailable: ' + (e instanceof Error ? e.message : String(e))); return null; });
    return loading;
  }
  /** Build the BVH and light tables from the live scene. Heavy (blocks for a moment), so callers prepare once and only when the scene changed. */
  async function prepare(): Promise<boolean> {
    const t = await load(); if (!t || !grad) return false;
    const s = d.sky(); grad.tex.topColor.copy(s.top); grad.tex.bottomColor.copy(s.bottom); grad.tex.update();
    performance.mark('still:prepare:start'); const ts = buildTraceScene(d.scene); performance.mark('still:scene-built'); performance.measure('still:build-scene', 'still:prepare:start', 'still:scene-built'); ts.scene.environment = grad.tex; ts.scene.environmentIntensity = 1; ts.scene.background = null;
    resetMergeGroups(t); // stale merge groups from the previous build corrupt a rebuild (see traceScene.ts)
    try { // BVH build runs in a worker (no main-thread stall); falls back to the synchronous build if workers are unavailable
      try { if (process.env.NODE_ENV !== 'production' && (window as unknown as { __syncBvh?: boolean }).__syncBvh) throw new Error('sync BVH forced (dev A/B switch)'); if (!bvhWorker) { bvhWorker = new GenerateMeshBVHWorker(); t.setBVHWorker(bvhWorker); } await t.setSceneAsync(ts.scene, d.camera); console.info('[still] BVH built in worker'); } catch (e) { console.info('[still] BVH worker unavailable, sync fallback: ' + (e instanceof Error ? e.message : String(e))); t.setScene(ts.scene, d.camera); }
      built = true; performance.mark('still:bvh-tables'); performance.measure('still:bvh+tables', 'still:scene-built', 'still:bvh-tables'); return true; } catch (e) { failed = true; console.error('Path tracer scene build failed: ' + (e instanceof Error ? e.message : String(e))); return false; } finally { ts.owned.forEach((g) => g.dispose()); }
  }
  const strengthFor = (n: number) => Math.max(0, Math.min(1, 1 - n / STILL.denoise.fadeSamples));
  function show() { if (!pt) return; d.present(pt.target.texture, strengthFor(pt.samples)); }

  return {
    get engaged() { return engaged; },
    /** Idle-time prep: converts textures in small slices so the later engage has no burst. Returns true when done. */
    /** True when the BVH and material tables for the current scene are built (engage is then cheap). */
    get ready() { return built; },
    /** Build BVH (worker) and tables ahead of engage, once per scene change; the only synchronous part left is the library's table upload. */
    prepare(): Promise<boolean> { if (built || failed || starting) return Promise.resolve(built); starting = true; return prepare().finally(() => { starting = false; }); },
    prewarm(): boolean { return passProf(d.renderer, 'still:texture-warm', () => warmTraceTextures(d.scene, 3)); },
    get exporting() { return !!exporting; },
    get samples() { return pt?.samples ?? 0; },
    get available() { return !failed; },
    /** Warm the library (network or chunk load) ahead of the first use. */
    warm() { void load(); },
    /** Camera or scene moved: drop the converged image at once and fall back to the raster frame. */
    cancel() { if (!engaged) return; engaged = false; pt?.reset(); },
    /** The scene changed (space, buildings, hour): next engage rebuilds the BVH. */
    invalidate() { built = false; },
    /** Camera is still: advance one progressive step and show it. Returns true while it owns the frame. */
    async engage(samples: number, tiles: number = STILL.tilesPhoto): Promise<void> { if (engaged || failed || starting) return; starting = true; try { if (!built && !(await prepare())) return; engaged = true; budget = samples; pt!.tiles.set(tiles, tiles); pt!.updateCamera(); } finally { starting = false; } },
    /** One frame of tracing; call only while engaged or exporting. */
    step() { if (!pt || !(engaged || exporting)) return; const cap = exporting ? exporting.n : budget; if (pt.samples < cap) passProf(d.renderer, 'still:sample', () => pt!.renderSample()); show();
      if (exporting && pt.samples >= exporting.n) { const e = exporting; exporting = null; try { e.res(d.renderer.domElement.toDataURL('image/png')); } catch (err) { e.rej(err as Error); } pt.reset(); engaged = false; } },
    /** Trace `samples` samples of the current view and resolve with a PNG data URL. Rejects when the tracer is unavailable. */
    async capture(samples: number = STILL.exportSamples): Promise<string> {
      if (exporting) throw new Error('capture already running'); if (failed || !(built || await prepare())) throw new Error('path tracer unavailable');
      pt!.updateCamera(); engaged = false; return new Promise<string>((res, rej) => { exporting = { n: samples, res, rej }; });
    },
    dispose() { bvhWorker?.dispose(); bvhWorker = null; pt?.dispose(); grad?.tex.dispose(); pt = null; grad = null; engaged = false; exporting = null; },
  };
}
export type Still = ReturnType<typeof createStill>;
