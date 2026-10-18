import { MEDIA } from '../../config/media';
import type { StoryItemIn } from '../bridge/types';
import { MediaError } from './errors';
import { uploadBlob, type UploadOptions } from './upload';
import { probeVideo } from './vod';
import type { MediaBridge } from './types';

/** Pure: size scaled so the longest edge is at most `max` (never upscales). */
export function fitEdge(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Decodes (honouring EXIF rotation), downsizes to `maxImageEdge` and re-encodes as WebP. Animated images are flattened to one frame. */
export async function downscaleImage(file: Blob): Promise<Blob> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { throw new MediaError('bad-media', e); }
  try {
    const { width, height } = fitEdge(bmp.width, bmp.height, MEDIA.story.maxImageEdge);
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const g = c.getContext('2d');
    if (!g) throw new MediaError('unsupported');
    g.drawImage(bmp, 0, 0, width, height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new MediaError('bad-media'))), MEDIA.story.mime, MEDIA.story.quality));
  } finally {
    bmp.close();
  }
}

/** One story item ready for `story.create`: images are downscaled first, videos are checked against the story limits. */
export async function prepareStoryItem(bridge: Pick<MediaBridge, 'blobPutBytes'>, file: File, caption: string, opts: UploadOptions = {}): Promise<StoryItemIn> {
  if (file.type.startsWith('image/')) {
    const small = await downscaleImage(file);
    const blob = await uploadBlob(bridge, small, `${file.name.replace(/\.[^.]+$/, '')}.webp`, opts);
    return { blob, caption };
  }
  if (file.type.startsWith('video/')) {
    if (file.size > MEDIA.story.maxVideoBytes) throw new MediaError('file-too-large');
    const { duration } = await probeVideo(file);
    if (!duration || duration > MEDIA.story.maxVideoSeconds) {
      throw new MediaError('bad-media', undefined, undefined, `Story videos can be up to ${MEDIA.story.maxVideoSeconds} seconds.`);
    }
    return { blob: await uploadBlob(bridge, file, file.name, { ...opts, maxBytes: MEDIA.story.maxVideoBytes }), caption };
  }
  throw new MediaError('bad-media');
}
