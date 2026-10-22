import { QUALITY_DETECT as D, QUALITY_ORDER, type QualityTier } from '@/config/scene';

/** Unmasked GPU string, or '' when the browser hides it. */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
}

/** Saved choice: ?quality=low|medium|high|ultra in the URL, else localStorage. Returns null for auto. */
export function savedQuality(): QualityTier | null {
  const ok = (v: string | null): QualityTier | null => (v && (QUALITY_ORDER as readonly string[]).includes(v) ? (v as QualityTier) : null);
  try { const q = ok(new URLSearchParams(window.location.search).get(D.queryParam)); if (q) return q; } catch { /* no URL */ }
  try { return ok(window.localStorage.getItem(D.storageKey)); } catch { return null; }
}

/** Pick a starting tier from the GPU string, screen size, core count and device pixel ratio. */
export function detectTier(gpu: string, cores: number, dpr: number, minSide: number, touch: boolean): QualityTier {
  let tier: QualityTier = 'medium';
  if (D.lowGpu.test(gpu)) tier = 'low';
  else if (D.ultraGpu.test(gpu)) tier = 'ultra';
  else if (D.highGpu.test(gpu)) tier = 'high';
  else if (D.appleGpu.test(gpu) && cores >= D.appleHighCores) tier = 'high';
  else if (D.midGpu.test(gpu)) tier = 'medium';
  let i = QUALITY_ORDER.indexOf(tier);
  if (touch && minSide < D.smallScreenPx) i = Math.min(i, 0);
  if (cores > 0 && cores <= D.lowCores) i = Math.min(i, 1);
  if (dpr >= 3) i = Math.max(0, i - 1);
  return QUALITY_ORDER[i];
}

/** Next lower tier, or null at the bottom. */
export const lowerTier = (t: QualityTier): QualityTier | null => { const i = QUALITY_ORDER.indexOf(t); return i > 0 ? QUALITY_ORDER[i - 1] : null; };

/** Frame-time watcher: calls `onSlow` when the 1s average fps stays under the limit for several windows in a row. Downgrade only. */
export function createAdaptive(onSlow: () => void) {
  const A = D.adaptive; let acc = 0, frames = 0, slow = 0, age = 0, maxDt = 0;
  return {
    /** dt in seconds of real (unclamped) frame time. */
    push(dt: number) {
      age += dt * 1000; if (age < A.warmupMs) return;
      acc += dt * 1000; frames++; maxDt = Math.max(maxDt, dt);
      if (acc < A.windowMs) return;
      const fps = (frames * 1000) / acc; const stalled = maxDt > 0.6; acc = 0; frames = 0; maxDt = 0;
      if (stalled) { slow = 0; return; }
      slow = fps < A.fps ? slow + 1 : 0;
      if (slow >= A.windows) { slow = 0; onSlow(); }
    },
    reset() { acc = 0; frames = 0; slow = 0; age = 0; maxDt = 0; },
  };
}
