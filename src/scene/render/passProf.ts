import type * as THREE from 'three';

const f4 = new Float32Array(4), h4 = new Uint16Array(4), u4 = new Uint8Array(4);
/** Block until the GPU has finished everything queued so far: a 1px readback of the bound framebuffer in the type it supports (no GL error either way). gl.finish does not wait in Chromium on Metal. */
export function gpuSync(gl: WebGL2RenderingContext): void {
  gl.flush(); const t = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number; const f = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
  if (t === gl.FLOAT) gl.readPixels(0, 0, 1, 1, f, t, f4); else if (t === gl.HALF_FLOAT) gl.readPixels(0, 0, 1, 1, f, t, h4); else gl.readPixels(0, 0, 1, 1, f, t, u4);
}

/** Pass timing: while `window.__passProf` is truthy each call writes a `performance.measure('pass:<name>')` bracketed by GPU syncs, so the entry is the pass's real GPU plus CPU time in isolation. Off by default; production frames pay one property read. */
export function passProf<T>(r: THREE.WebGLRenderer, name: string, fn: () => T): T {
  if (typeof window === 'undefined') return fn(); const mode = (window as unknown as { __passProf?: boolean | 'gpu' }).__passProf; if (!mode) return fn();
  const gl = r.getContext() as WebGL2RenderingContext; if (mode === 'gpu') return gpuTimed(gl, name, fn); gpuSync(gl); const t0 = performance.now(); const out = fn(); gpuSync(gl); performance.measure('pass:' + name, { start: t0, end: performance.now() }); return out;
}

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
const pending: { name: string; q: WebGLQuery }[] = [];
/** `__passProf = 'gpu'`: EXT_disjoint_timer_query_webgl2 times each pass on the GPU with no sync, so the frame keeps its real pipelining; results land in `window.__gpuT[name]` (ms, one entry per frame) a frame or two later. Passes are not nested, so one query is open at a time. */
function gpuTimed<T>(gl: WebGL2RenderingContext, name: string, fn: () => T): T {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null; if (!ext) return fn();
  const w = window as unknown as { __gpuT?: Record<string, number[]> }; const acc = (w.__gpuT ??= {}); const dis = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
  for (let i = pending.length - 1; i >= 0; i--) { const e = pending[i]; if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) continue; if (!dis) (acc[e.name] ??= []).push((gl.getQueryParameter(e.q, gl.QUERY_RESULT) as number) / 1e6); gl.deleteQuery(e.q); pending.splice(i, 1); }
  const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); try { return fn(); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ name, q }); }
}
