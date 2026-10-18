import { MEDIA } from '../../config/media';
import type { BlobRef } from '../bridge/types';
import { MediaError } from './errors';
import type { MediaBridge } from './types';

export interface UploadProgress { loaded: number; total: number; phase: 'read' | 'store' }
export interface UploadOptions { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal; maxBytes?: number }

/** Size limit for a MIME type (config/media.ts). */
export function limitFor(mime: string): number {
  if (mime.startsWith('image/')) return MEDIA.upload.maxImageBytes;
  if (mime === 'text/vtt' || mime.startsWith('text/')) return MEDIA.upload.maxCaptionBytes;
  return MEDIA.upload.maxVideoBytes;
}

/** Reads a Blob in chunks (progress, abort between chunks) so the UI stays responsive on large files. */
export async function readChunked(file: Blob, opts: UploadOptions = {}): Promise<Uint8Array> {
  const out = new Uint8Array(file.size);
  for (let at = 0; at < file.size; at += MEDIA.upload.readChunkBytes) {
    if (opts.signal?.aborted) throw new MediaError('unknown', undefined, undefined, 'Upload cancelled.');
    const part = new Uint8Array(await file.slice(at, at + MEDIA.upload.readChunkBytes).arrayBuffer());
    out.set(part, at);
    opts.onProgress?.({ loaded: at + part.length, total: file.size, phase: 'read' });
  }
  return out;
}

/**
 * File or Blob to the blob store via blob_put_bytes. Progress covers reading; the store phase is one IPC call and reports
 * `loaded === total` when it finishes. For very large videos in Tauri prefer the native picker + `bridge.blobPut(path)`.
 */
export async function uploadBlob(bridge: Pick<MediaBridge, 'blobPutBytes'>, file: Blob, name: string, opts: UploadOptions = {}): Promise<BlobRef> {
  const max = opts.maxBytes ?? limitFor(file.type);
  if (file.size === 0 || file.size > max) throw new MediaError('file-too-large', undefined, undefined, file.size === 0 ? 'That file is empty.' : undefined);
  const bytes = await readChunked(file, opts);
  opts.onProgress?.({ loaded: 0, total: file.size, phase: 'store' });
  const ref = await bridge.blobPutBytes(name, bytes);
  opts.onProgress?.({ loaded: file.size, total: file.size, phase: 'store' });
  return ref;
}

/** Stores a finished call recording (CallSession.stopRecording). */
export function saveRecording(bridge: Pick<MediaBridge, 'blobPutBytes'>, rec: { blob: Blob; mime: string }, name: string, opts?: UploadOptions): Promise<BlobRef> {
  const ext = rec.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return uploadBlob(bridge, rec.blob, `${name}.${ext}`, { ...opts, maxBytes: MEDIA.upload.maxVideoBytes });
}
