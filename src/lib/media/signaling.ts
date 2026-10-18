import { MEDIA } from '../../config/media';
import { MediaError } from './errors';
import { ENVELOPE, parseSignal, type SignalMsg, type SignalType } from './sessions';
import type { MediaBridge } from './types';

export type SignalHandler = (from: string, msg: SignalMsg) => void;

/**
 * Signalling over the Bridge: `media_signal` out (unicast when `to` is set, space gossip otherwise) and
 * `hermod://signal` in. One instance per (space, self); scopes (`call:<room>`, `live:<id>`) are multiplexed on it.
 */
export class Signaling {
  private handlers = new Map<string, Set<SignalHandler>>();
  private off: (() => void) | null;

  constructor(private readonly bridge: MediaBridge, readonly space: string, readonly self: string) {
    this.off = bridge.onSignal((e) => {
      if (e.space_id !== undefined && e.space_id !== space) return;
      if (e.from === self) return;
      const msg = parseSignal(e.payload, MEDIA.protocolVersion);
      if (!msg || (msg.to !== undefined && msg.to !== self)) return;
      for (const h of [...(this.handlers.get(msg.scope) ?? [])]) {
        try { h(e.from, msg); } catch (err) { console.error('signal handler threw', err); }
      }
    });
  }

  /** Subscribe to one scope. Returns unsubscribe. */
  subscribe(scope: string, handler: SignalHandler): () => void {
    let set = this.handlers.get(scope);
    if (!set) this.handlers.set(scope, (set = new Set()));
    set.add(handler);
    return () => { set.delete(handler); };
  }

  /** Send one message. `to` omitted means every member of the space listening on `scope`. */
  async send(scope: string, sid: string, type: SignalType, data?: unknown, to?: string): Promise<void> {
    if (!this.off) throw new MediaError('signal-failed', undefined, undefined, 'Signalling is closed.');
    const msg: SignalMsg = { m: ENVELOPE, v: MEDIA.protocolVersion, scope, sid, type, ...(to ? { to } : {}), ...(data === undefined ? {} : { data }) };
    try {
      await this.bridge.mediaSignal(this.space, msg, to);
    } catch (e) {
      throw new MediaError('signal-failed', e, to);
    }
  }

  dispose(): void {
    this.off?.();
    this.off = null;
    this.handlers.clear();
  }
}
