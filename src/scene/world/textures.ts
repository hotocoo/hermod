import * as THREE from 'three';
import { rng } from '../rng';
import type { TextureKey } from '@/config/scene';

type Ctx = CanvasRenderingContext2D;
export type Draw = (x: Ctx, size: number) => void;
export type Textures = Record<TextureKey, THREE.CanvasTexture>;

/** Texture quality set by createTextures: canvas size, anisotropy. Draw code always works in a 512 unit space and is scaled up. */
const TQ = { size: 512, aniso: 8 };
const BASE = 512;
/** Paint a repeating canvas texture (client only: needs document). `size` is the logical size; the canvas is TQ.size / 512 times larger. */
export function tex(draw: Draw, size?: number, rep?: number): THREE.CanvasTexture { const logical = size || BASE; const px = Math.round(logical * (TQ.size / BASE)); const c = document.createElement('canvas'); c.width = c.height = px; const x = c.getContext('2d')!; x.scale(px / logical, px / logical); draw(x, logical); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = TQ.aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; if (rep) t.repeat.set(rep, rep); return t; }

let normalWorker: Worker | null | undefined; let jobId = 0; const jobs = new Map<number, (out: Uint8ClampedArray) => void>();
function worker(): Worker | null {
  if (normalWorker !== undefined) return normalWorker;
  try { normalWorker = new Worker(new URL('./normalWorker.ts', import.meta.url)); normalWorker.onmessage = (e: MessageEvent<{ id: number; out: Uint8ClampedArray }>) => { const f = jobs.get(e.data.id); jobs.delete(e.data.id); f?.(e.data.out); }; normalWorker.onerror = () => { normalWorker = null; }; } catch { normalWorker = null; }
  return normalWorker;
}
function sobelSync(grey: Uint8ClampedArray, n: number, k: number): Uint8ClampedArray {
  const h = new Float32Array(n * n); for (let i = 0; i < n * n; i++) h[i] = grey[i] / 255; const out = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) { const ym = ((y - 1 + n) % n) * n, yc = y * n, yp = ((y + 1) % n) * n; for (let x = 0; x < n; x++) { const xm = (x - 1 + n) % n, xp = (x + 1) % n;
    const dx = (h[ym + xp] + 2 * h[yc + xp] + h[yp + xp]) - (h[ym + xm] + 2 * h[yc + xm] + h[yp + xm]); const dy = (h[yp + xm] + 2 * h[yp + x] + h[yp + xp]) - (h[ym + xm] + 2 * h[ym + x] + h[ym + xp]);
    let nx = -dx * k, ny = dy * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; const o = (yc + x) * 4; out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (nz * 0.5 + 0.5) * 255; out[o + 3] = 255; } }
  return out;
}
/** Height canvas -> tangent-space normal map (tiles at the edges). The Sobel pass runs in a worker; the texture starts flat and fills in when it returns. */
export function normalFrom(height: THREE.CanvasTexture, strength: number): THREE.CanvasTexture {
  const src = height.image as HTMLCanvasElement; const n = src.width; const px = src.getContext('2d')!.getImageData(0, 0, n, n).data; const grey = new Uint8ClampedArray(n * n);
  for (let i = 0; i < n * n; i++) grey[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
  const k = strength * (n / BASE); const out = document.createElement('canvas'); out.width = out.height = n; const ox = out.getContext('2d')!;
  const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = TQ.aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  const apply = (rgba: Uint8ClampedArray) => { ox.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0); t.needsUpdate = true; };
  ox.fillStyle = 'rgb(128,128,255)'; ox.fillRect(0, 0, n, n);
  const w = worker(); if (!w) { apply(sobelSync(grey, n, k)); return t; }
  const id = ++jobId; jobs.set(id, apply); w.postMessage({ id, n, grey, k }, [grey.buffer]);
  return t;
}

/** Procedural surface textures (colour maps and their bump twins). */
export function createTextures(q?: { size: number; anisotropy: number }): Textures {
  if (q) { TQ.size = q.size; TQ.aniso = q.anisotropy; }
  const R0 = rng('tex');
  const speck = (x: Ctx, s: number, n: number, a: number) => { for (let i = 0; i < n; i++) { const v = Math.floor(R0() * 255); x.fillStyle = `rgba(${v},${v},${v},${a * R0()})`; x.fillRect(R0() * s, R0() * s, 1 + R0() * 2, 1 + R0() * 2); } };
  const shingles = (bump: boolean) => tex((x, s) => { x.fillStyle = bump ? '#808080' : '#fff'; x.fillRect(0, 0, s, s); const rows = 16, h = s / rows; for (let r = 0; r < rows; r++) { const w = s / 10; const off = (r % 2) * w / 2; for (let c = -1; c < 11; c++) { const sh = bump ? 150 + R0() * 60 : 205 + R0() * 50; x.fillStyle = `rgb(${sh},${sh},${sh})`; const xx = c * w + off; x.fillRect(xx + 1, r * h + 1, w - 2, h - 1); x.fillStyle = bump ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.28)'; x.fillRect(xx + 1, r * h + h - 3, w - 2, 3); } } speck(x, s, 4000, bump ? 0.25 : 0.12); });
  const ashlar = (bump: boolean) => tex((x, s) => { x.fillStyle = bump ? '#3a3a3a' : '#cfc8bb'; x.fillRect(0, 0, s, s); const rows = 8, h = s / rows; for (let r = 0; r < rows; r++) { let xx = -(r % 2) * 40; while (xx < s) { const w = 70 + R0() * 70; const sh = bump ? 180 + R0() * 50 : 228 + R0() * 22; x.fillStyle = `rgb(${sh},${sh - 4},${sh - 10})`; x.fillRect(xx + 3, r * h + 3, w - 6, h - 6); xx += w; } } speck(x, s, 9000, bump ? 0.35 : 0.1); });
  const brick = (bump: boolean) => tex((x, s) => { x.fillStyle = bump ? '#303030' : '#d8d0c6'; x.fillRect(0, 0, s, s); const rows = 22, h = s / rows, w = s / 8; for (let r = 0; r < rows; r++) for (let c = -1; c < 9; c++) { const sh = bump ? 175 + R0() * 55 : 0; if (bump) x.fillStyle = `rgb(${sh},${sh},${sh})`; else { const k = R0(); x.fillStyle = `rgb(${170 + k * 40},${92 + k * 30},${68 + k * 22})`; } x.fillRect(c * w + (r % 2) * w / 2 + 2, r * h + 2, w - 4, h - 3); } speck(x, s, 6000, 0.2); });
  const planks = (bump: boolean) => tex((x, s) => { const n = 9, w = s / n; for (let i = 0; i < n; i++) { const k = R0(); x.fillStyle = bump ? `rgb(${150 + k * 60},${150 + k * 60},${150 + k * 60})` : `rgb(${200 + k * 40},${185 + k * 35},${165 + k * 30})`; x.fillRect(i * w, 0, w, s); for (let g = 0; g < 14; g++) { x.strokeStyle = `rgba(0,0,0,${0.05 + R0() * 0.12})`; x.beginPath(); const gx = i * w + R0() * w; x.moveTo(gx, 0); x.bezierCurveTo(gx + 6, s * 0.3, gx - 6, s * 0.7, gx + 2, s); x.stroke(); } x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(i * w, 0, 2, s); } });
  const cobbles = (bump: boolean) => tex((x, s) => { x.fillStyle = bump ? '#2a2a2a' : '#b9ae9c'; x.fillRect(0, 0, s, s); for (let i = 0; i < 900; i++) { const cx = R0() * s, cy = R0() * s, r = 7 + R0() * 9; const sh = bump ? 160 + R0() * 80 : 205 + R0() * 40; const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); g.addColorStop(0, `rgb(${sh},${sh - 3},${sh - 8})`); g.addColorStop(1, `rgb(${sh - 40},${sh - 44},${sh - 50})`); x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, r, r * (0.7 + R0() * 0.3), R0() * 3, 0, Math.PI * 2); x.fill(); } });
  const grain = (bump: boolean, base?: string) => tex((x, s) => { x.fillStyle = bump ? '#808080' : base!; x.fillRect(0, 0, s, s); speck(x, s, 30000, bump ? 0.5 : 0.08); for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(0,0,0,${R0() * 0.06})`; x.beginPath(); x.ellipse(R0() * s, R0() * s, 6 + R0() * 30, 4 + R0() * 18, R0() * 3, 0, Math.PI * 2); x.fill(); } });
  const bark = (bump: boolean) => tex((x, s) => { x.fillStyle = bump ? '#808080' : '#d9cdbd'; x.fillRect(0, 0, s, s); for (let i = 0; i < 500; i++) { const gx = R0() * s; x.strokeStyle = `rgba(0,0,0,${0.15 + R0() * 0.35})`; x.lineWidth = 1 + R0() * 3; x.beginPath(); x.moveTo(gx, R0() * s); x.lineTo(gx + (R0() - 0.5) * 8, R0() * s); x.stroke(); } });
  const turf = (bump: boolean) => tex((x, s) => { x.fillStyle = bump ? '#808080' : '#d8d8d0'; x.fillRect(0, 0, s, s); for (let i = 0; i < 2600; i++) { const gx = R0() * s, gy = R0() * s, L = 5 + R0() * 11, a = -Math.PI / 2 + (R0() - 0.5) * 1.1; const v = bump ? 90 + R0() * 150 : 150 + R0() * 100; x.strokeStyle = `rgba(${v},${v},${v - (bump ? 0 : 14)},${0.5 + R0() * 0.4})`; x.lineWidth = 1 + R0() * 1.4; x.beginPath(); x.moveTo(gx, gy); x.quadraticCurveTo(gx + Math.cos(a) * L * 0.5 + (R0() - 0.5) * 3, gy + Math.sin(a) * L * 0.5, gx + Math.cos(a) * L, gy + Math.sin(a) * L); x.stroke(); } for (let i = 0; i < 90; i++) { x.fillStyle = bump ? `rgba(60,60,60,${0.25 + R0() * 0.3})` : `rgba(90,86,70,${0.08 + R0() * 0.1})`; x.beginPath(); x.ellipse(R0() * s, R0() * s, 6 + R0() * 18, 4 + R0() * 12, R0() * 3, 0, Math.PI * 2); x.fill(); } });
  const ripple = () => tex((x, s) => { x.fillStyle = '#808080'; x.fillRect(0, 0, s, s); for (let i = 0; i < 140; i++) { const cx = R0() * s, cy = R0() * s, r = 6 + R0() * 28; const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.5, 'rgba(70,70,70,.35)'); g.addColorStop(1, 'rgba(128,128,128,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); } });
  const base = { shingle: shingles(false), shingleB: shingles(true), ashlar: ashlar(false), ashlarB: ashlar(true), brick: brick(false), brickB: brick(true), plank: planks(false), plankB: planks(true), cob: cobbles(false), cobB: cobbles(true), plaster: grain(false, '#f1ebe1'), plasterB: grain(true), rock: grain(false, '#bdb3a4'), rockB: grain(true), bark: bark(false), barkB: bark(true), turf: turf(false), turfB: turf(true) };
  const rip = ripple();
  const T = { ...base, shingleN: normalFrom(base.shingleB, 4.5), ashlarN: normalFrom(base.ashlarB, 4), brickN: normalFrom(base.brickB, 4), plankN: normalFrom(base.plankB, 3), cobN: normalFrom(base.cobB, 5), plasterN: normalFrom(base.plasterB, 2.5), rockN: normalFrom(base.rockB, 3.5), barkN: normalFrom(base.barkB, 3.5), turfN: normalFrom(base.turfB, 3), waterN: normalFrom(rip, 2.2) };
  [T.shingleB, T.ashlarB, T.brickB, T.plankB, T.cobB, T.plasterB, T.rockB, T.barkB, T.turfB].forEach((t) => { t.colorSpace = THREE.NoColorSpace; });
  return T;
}
