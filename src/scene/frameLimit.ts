import { FRAME_LIMIT, type FrameCapId } from '@/config/scene';
import { STORAGE_KEYS } from '@/config/app';

/** Frame rate for a saved cap id; 0 means uncapped. Unknown or missing ids are uncapped. */
export function capFps(id: string | null | undefined): number {
  return FRAME_LIMIT.options.find((o) => o.id === id)?.fps ?? 0;
}

/** True when a frame at `now` (ms) comes too soon after the last drawn frame for a cap of `fps`. */
export function tooSoon(now: number, last: number, fps: number): boolean {
  if (fps <= 0) return false;
  return now - last < 1000 / fps - FRAME_LIMIT.slackMs;
}

/** The cap saved on this device (never throws when storage is blocked). */
export function savedFrameCap(): FrameCapId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.fpsCap);
    return FRAME_LIMIT.options.find((o) => o.id === raw)?.id ?? FRAME_LIMIT.defaultId;
  } catch { return FRAME_LIMIT.defaultId; }
}
