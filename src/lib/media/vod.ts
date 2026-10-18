import { MEDIA } from '../../config/media';
import { fmtSec } from '../format';
import type { BlobRef } from '../bridge/types';
import { MediaError } from './errors';
import { isVtt, type Chapter } from './vtt';
import { uploadBlob, type UploadOptions } from './upload';
import type { MediaBridge } from './types';

/** Dev-host base URL: build-time env, overridable per page with `?devhost=` (same rule as the devhost bridge). */
export function devhostBase(): string {
  const fixed = process.env.NEXT_PUBLIC_HERMOD_DEVHOST ?? '';
  const q = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('devhost');
  return (q ?? fixed).replace(/\/$/, '');
}

/** `hermod-blob://<hash>` in Tauri, `${devhost}/blob/<hash>` when a devhost is configured. Pure given `devhost`. */
export function blobUrlFor(hash: string, devhost: string = devhostBase()): string {
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new MediaError('bad-media', undefined, undefined, 'Not a blob hash.');
  return devhost ? `${devhost}/blob/${hash}` : `hermod-blob://${hash}`;
}

export interface VideoMeta { duration: number; width: number; height: number }

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'auto'; v.muted = true; v.playsInline = true;
    const timer = setTimeout(() => reject(new MediaError('bad-media')), 20_000);
    v.onloadedmetadata = () => { clearTimeout(timer); resolve(v); };
    v.onerror = () => { clearTimeout(timer); reject(new MediaError('bad-media', v.error)); };
    v.src = src;
  });
}

/** MediaRecorder webm has no duration until the end is found; seeking far makes the browser compute it. */
async function resolveDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration)) return v.duration;
  await new Promise<void>((res) => { v.ontimeupdate = () => { v.ontimeupdate = null; res(); }; v.currentTime = 1e101; });
  return Number.isFinite(v.duration) ? v.duration : 0;
}

/** Duration and size of a video file or URL. */
export async function probeVideo(src: Blob | string): Promise<VideoMeta> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const v = await loadVideo(url);
    return { duration: await resolveDuration(v), width: v.videoWidth, height: v.videoHeight };
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

/** Label stored in post.create `dur` (m:ss). */
export const durLabel = (seconds: number): string => fmtSec(seconds);

function canvasBlob(c: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new MediaError('bad-media'))), mime, quality));
}

/** Poster frame: canvas grab at 1 s (or mid-clip for shorter videos), scaled to the configured max width. */
export async function extractPoster(file: Blob | string, atSeconds: number = MEDIA.poster.atSeconds): Promise<{ blob: Blob; width: number; height: number }> {
  const url = typeof file === 'string' ? file : URL.createObjectURL(file);
  try {
    const v = await loadVideo(url);
    const dur = await resolveDuration(v);
    await new Promise<void>((res, rej) => {
      v.onseeked = () => res();
      v.onerror = () => rej(new MediaError('bad-media', v.error));
      v.currentTime = dur > 0 ? Math.min(atSeconds, dur / 2) : 0;
    });
    const k = Math.min(1, MEDIA.poster.maxWidth / (v.videoWidth || 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * k));
    c.height = Math.max(1, Math.round(v.videoHeight * k));
    const g = c.getContext('2d');
    if (!g) throw new MediaError('unsupported');
    g.drawImage(v, 0, 0, c.width, c.height);
    return { blob: await canvasBlob(c, MEDIA.poster.mime, MEDIA.poster.quality), width: c.width, height: c.height };
  } finally {
    if (typeof file !== 'string') URL.revokeObjectURL(url);
  }
}

export interface VideoUploadInput {
  file: File;
  chapters?: readonly Chapter[];
  /** WebVTT text of the captions (see vtt.ts `srtToVtt`). */
  captionsVtt?: string;
  onProgress?: UploadOptions['onProgress'];
  signal?: AbortSignal;
}

export interface VideoUploadResult {
  /** Video first, poster second: feed straight into post.create `blobs`. */
  blobs: BlobRef[];
  dur: string;
  chapters: Chapter[];
  /** BlobRef of the WebVTT captions, for post.create `captions`. */
  captions?: BlobRef;
  meta: VideoMeta;
}

/**
 * Upload pipeline for a video post: probe, poster, store video, store poster, store captions. Returns exactly the pieces
 * post.create needs (`blobs`, `dur`, `chapters`, `captions`). Chapters are validated against the real duration.
 */
export async function uploadVideoPost(bridge: Pick<MediaBridge, 'blobPutBytes'>, input: VideoUploadInput): Promise<VideoUploadResult> {
  const { file } = input;
  if (!file.type.startsWith('video/')) throw new MediaError('bad-media');
  const meta = await probeVideo(file);
  if (!meta.duration) throw new MediaError('bad-media');
  const poster = await extractPoster(file).catch(() => null); // a failed poster must not block the upload
  const video = await uploadBlob(bridge, file, file.name, { onProgress: input.onProgress, signal: input.signal });
  return finishVideoPost(bridge, video, meta, poster, input);
}

/**
 * Same result for a video already in the blob store (Tauri: `blob_put(path)` from the native picker, no copy through the WebView).
 * The player URL is probed and sampled directly, so the file is never read into memory here.
 */
export async function storedVideoPost(bridge: Pick<MediaBridge, 'blobPutBytes' | 'blobUrl'>, video: BlobRef, input: Omit<VideoUploadInput, 'file'> = {}): Promise<VideoUploadResult> {
  if (!video.mime.startsWith('video/')) throw new MediaError('bad-media');
  const url = bridge.blobUrl(video.hash);
  const meta = await probeVideo(url);
  if (!meta.duration) throw new MediaError('bad-media');
  const poster = await extractPoster(url).catch(() => null);
  return finishVideoPost(bridge, video, meta, poster, input);
}

async function finishVideoPost(
  bridge: Pick<MediaBridge, 'blobPutBytes'>, video: BlobRef, meta: VideoMeta, poster: { blob: Blob } | null, input: Omit<VideoUploadInput, 'file'>,
): Promise<VideoUploadResult> {
  const blobs = [video];
  if (poster) blobs.push(await uploadBlob(bridge, poster.blob, `${video.name.replace(/\.[^.]+$/, '')}-poster.webp`, { signal: input.signal }));
  let captions: BlobRef | undefined;
  if (input.captionsVtt) {
    if (!isVtt(input.captionsVtt)) throw new MediaError('bad-media', undefined, undefined, 'Captions must be a WebVTT file.');
    captions = await uploadBlob(bridge, new Blob([input.captionsVtt], { type: 'text/vtt' }), 'captions.vtt', { signal: input.signal });
  }
  const chapters = (input.chapters ?? []).filter((c) => c.t >= 0 && c.t < meta.duration && c.title.trim()).map((c) => ({ t: Math.floor(c.t), title: c.title.trim() }));
  return { blobs, dur: durLabel(meta.duration), chapters, captions, meta };
}

/** Fetches a captions blob and returns its WebVTT text (null when it is not valid WebVTT). */
export async function loadCaptions(bridge: Pick<MediaBridge, 'blobUrl'>, hash: string): Promise<string | null> {
  const res = await fetch(bridge.blobUrl(hash));
  if (!res.ok) return null;
  const text = await res.text();
  return isVtt(text) ? text : null;
}
