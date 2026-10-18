/** Getting user files into the blob store: native picker + path in Tauri, file input + bytes in the browser/devhost. */
import { UPLOAD } from '../config/app';
import { getBridge, type BlobRef } from './bridge';

export interface Stored { blob: BlobRef; /** Object URL for an instant local preview (browser path only). */ preview: string }

export class TooLarge extends Error { constructor(readonly file: string) { super(`${file} is larger than the upload limit`); } }

/** Opens a file input (works in every webview) and resolves with the chosen files, or [] when cancelled. */
export function chooseFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

const previewable = (mime: string) => mime.startsWith('image/') || mime.startsWith('video/');

export async function storeFile(f: File): Promise<Stored> {
  if (f.size > UPLOAD.maxBytes) throw new TooLarge(f.name);
  const blob = await getBridge().blobPutBytes(f.name, new Uint8Array(await f.arrayBuffer()));
  return { blob, preview: previewable(blob.mime) ? URL.createObjectURL(f) : '' };
}

/**
 * Pick files and store them. In Tauri the native dialog returns paths that Rust reads itself (no size limit, no copy through the WebView);
 * otherwise a file input feeds blob_put_bytes. `accept` is a MIME/extension list for the input.
 */
export async function pickAndStore(accept: string, multiple: boolean): Promise<Stored[]> {
  const bridge = getBridge();
  if (bridge.kind === 'tauri') {
    const paths = await bridge.pickFiles({ multiple, accept: accept.split(',').map((x) => x.trim()).filter(Boolean) });
    return Promise.all((paths ?? []).map(async (p) => ({ blob: await bridge.blobPut(p), preview: '' })));
  }
  return Promise.all((await chooseFiles(accept, multiple)).map(storeFile));
}

export const blobUrl = (hash: string): string => getBridge().blobUrl(hash);
export const isImage = (b: { mime: string }) => b.mime.startsWith('image/');
export const isVideo = (b: { mime: string }) => b.mime.startsWith('video/');
export const humanSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MiB` : `${(n / 1073741824).toFixed(2)} GiB`);
