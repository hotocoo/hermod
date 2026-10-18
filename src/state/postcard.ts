/** Renders the town snapshot onto a captioned paper card and triggers a download. Browser only. */
import { POSTCARD } from '../config/app';
import { getBridge } from '../lib/bridge';

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('postcard image failed to load'));
  img.src = src;
});

export async function renderPostcard(snapshotUrl: string, title: string, subtitle: string): Promise<void> {
  const img = await loadImage(snapshotUrl);
  const W = img.width; const H = img.height;
  const pad = Math.round(W * POSTCARD.padFrac); const cap = Math.round(H * POSTCARD.capFrac);
  const canvas = document.createElement('canvas');
  canvas.width = W + pad * 2; canvas.height = H + pad * 2 + cap;
  const x = canvas.getContext('2d');
  if (!x) throw new Error('2d canvas unavailable');
  const css = getComputedStyle(document.documentElement);
  x.fillStyle = POSTCARD.paper; x.fillRect(0, 0, canvas.width, canvas.height);
  const g = x.createLinearGradient(0, pad, 0, pad + H);
  g.addColorStop(0, css.getPropertyValue('--h-sky-top').trim() || POSTCARD.skyTopFallback);
  g.addColorStop(0.72, css.getPropertyValue('--h-sky-bot').trim() || POSTCARD.skyBottomFallback);
  x.fillStyle = g; x.fillRect(pad, pad, W, H);
  x.drawImage(img, pad, pad);
  x.strokeStyle = POSTCARD.frame; x.lineWidth = 2; x.strokeRect(pad, pad, W, H);
  x.fillStyle = POSTCARD.ink; x.font = `${Math.round(cap * 0.42)}px ${POSTCARD.titleFont}`; x.fillText(title, pad, H + pad + cap * 0.62);
  x.fillStyle = POSTCARD.accentInk; x.font = `italic ${Math.round(cap * 0.22)}px ${POSTCARD.subFont}`; x.textAlign = 'right';
  x.fillText(subtitle, W + pad, H + pad + cap * 0.6);
  const bridge = getBridge();
  if (bridge.kind === 'tauri') {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('postcard could not be encoded');
    await bridge.saveFile(POSTCARD.fileName, new Uint8Array(await blob.arrayBuffer()));
    return;
  }
  const a = document.createElement('a');
  a.download = POSTCARD.fileName; a.href = canvas.toDataURL('image/png');
  document.body.appendChild(a); a.click(); a.remove();
}
