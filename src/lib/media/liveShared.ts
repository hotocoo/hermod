import { MEDIA } from '../../config/media';
import type { MediaBridge } from './types';

export interface LiveState { viewers: number; max: number }

/** Heart count bounded per flush so a tap storm cannot flood the node's ephemeral rate limit. */
export class HeartBatcher {
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly flush: (n: number) => void) {}

  add(n: number): void {
    this.pending = Math.min(MEDIA.live.heartsMaxPerFlush, this.pending + Math.max(0, Math.floor(n)));
    this.timer ??= setTimeout(() => {
      const n2 = this.pending;
      this.pending = 0;
      this.timer = null;
      if (n2 > 0) this.flush(n2);
    }, MEDIA.live.heartsFlushMs);
  }

  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending = 0; }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000;

/** Validates an incoming ephemeral `live` state (host authored). */
export function parseLiveState(p: unknown, liveId: string): LiveState | null {
  const o = p as { live?: unknown; viewers?: unknown; max?: unknown } | null;
  if (!o || o.live !== liveId || !isCount(o.viewers) || !isCount(o.max)) return null;
  return { viewers: o.viewers, max: o.max };
}

/** Validates an incoming ephemeral `hearts` batch; clamps to the per-flush limit. */
export function parseHearts(p: unknown, liveId: string): number | null {
  const o = p as { live?: unknown; n?: unknown } | null;
  if (!o || o.live !== liveId || !isCount(o.n)) return null;
  return Math.min(MEDIA.live.heartsMaxPerFlush, Math.floor(o.n));
}

/** Subscribes to hearts and (host authored) viewer-state ephemerals of one stream. */
export function listenLive(
  bridge: MediaBridge, space: string, liveId: string, host: string, self: string,
  on: { hearts(from: string, n: number): void; state(s: LiveState): void },
): () => void {
  return bridge.onEphemeral((e) => {
    if (e.space_id !== undefined && e.space_id !== space) return;
    if (e.kind === MEDIA.live.ephemeralKind.hearts) {
      const n = parseHearts(e.payload, liveId);
      if (n !== null && e.from !== self) on.hearts(e.from, n);
    } else if (e.kind === MEDIA.live.ephemeralKind.state && e.from === host) {
      const s = parseLiveState(e.payload, liveId);
      if (s) on.state(s);
    }
  });
}
