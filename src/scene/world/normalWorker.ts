/// <reference lib="webworker" />
// Sobel height -> tangent-space normal map, off the main thread. Input: grey height bytes (n*n); output RGBA bytes.
interface Job { id: number; n: number; grey: Uint8ClampedArray; k: number }
self.onmessage = (e: MessageEvent<Job>) => {
  const { id, n, grey, k } = e.data; const out = new Uint8ClampedArray(n * n * 4); const h = new Float32Array(n * n); for (let i = 0; i < n * n; i++) h[i] = grey[i] / 255;
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n, yc = y * n, yp = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const xm = (x - 1 + n) % n, xp = (x + 1) % n;
      const dx = (h[ym + xp] + 2 * h[yc + xp] + h[yp + xp]) - (h[ym + xm] + 2 * h[yc + xm] + h[yp + xm]); const dy = (h[yp + xm] + 2 * h[yp + x] + h[yp + xp]) - (h[ym + xm] + 2 * h[ym + x] + h[ym + xp]);
      let nx = -dx * k, ny = dy * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; const o = (yc + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (nz * 0.5 + 0.5) * 255; out[o + 3] = 255;
    }
  }
  (self as unknown as Worker).postMessage({ id, n, out }, [out.buffer]);
};
export {};
