// Real public-domain paintings for room frames and easels (Art Institute of Chicago open access, CC0; scripts/assets/rooms/art.mjs ships them to rooms/art/).
import { rng } from '../../rng';
import list from './artworks.json';

export interface Artwork { file: string; title: string; artist: string; date: string; w: number; h: number }
export const ARTWORKS = list as Artwork[];

/** Deterministic, repeat-free painting order for one room (seeded shuffle); index past the list wraps. */
export function artOrder(seed: string): Artwork[] {
  const R = rng(`art|${seed}`); const a = [...ARTWORKS];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();
/** Decoded image or null (offline, missing file): the frame then keeps its plain first-paint face. */
export function loadArt(url: string): Promise<HTMLImageElement | null> {
  let p = cache.get(url);
  if (!p) { p = new Promise((res) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }); cache.set(url, p); }
  return p;
}

/** Cover-fit the painting into the canvas (centre crop, no stretch), then an optional caption plaque along the bottom edge. */
export function paintFrame(c: HTMLCanvasElement, img: HTMLImageElement, art: Artwork, caption: string) {
  const x = c.getContext('2d')!; const W = c.width, H = c.height; const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s; x.imageSmoothingQuality = 'high'; x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  if (!caption) return;
  const fs = Math.round(W / 17); const bar = Math.round(fs * 2.1); x.fillStyle = 'rgba(18,14,10,.62)'; x.fillRect(0, H - bar, W, bar);
  x.fillStyle = 'rgba(250,246,236,.95)'; x.font = `600 ${fs}px "Cormorant Garamond", Georgia, serif`; x.textBaseline = 'middle';
  let t = caption; while (t.length > 3 && x.measureText(t).width > W * 0.9) t = t.slice(0, -2); x.fillText(t === caption ? t : `${t}...`, W * 0.05, H - bar * 0.5);
}
