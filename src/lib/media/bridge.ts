import type { Bridge } from '../bridge';
import type { SignalEvent } from '../bridge/types';
import { MediaError } from './errors';
import type { EphemeralEvent, MediaBridge } from './types';

type RawOn = (name: string, handler: (payload: unknown) => void) => () => void;

/**
 * Adapts the app Bridge. `sendEphemeral` and the `hermod://ephemeral` event exist in Rust (send_ephemeral command) but
 * the UI Bridge may not expose them yet: pass the bridge once it has `sendEphemeral`, otherwise ephemeral features
 * (live viewer count, hearts) fail with a clear MediaError while calls keep working.
 */
export function mediaBridgeFrom(bridge: Bridge & { sendEphemeral?: (spaceId: string, kind: string, payload: unknown) => Promise<void> }): MediaBridge {
  const on = bridge.on as unknown as RawOn;
  return {
    mediaSignal: (s, p, to) => bridge.mediaSignal(s, p, to),
    sendEphemeral: (s, k, p) => bridge.sendEphemeral
      ? bridge.sendEphemeral(s, k, p)
      : Promise.reject(new MediaError('unsupported', undefined, undefined, 'The bridge has no sendEphemeral.')),
    blobPutBytes: (n, b) => bridge.blobPutBytes(n, b),
    blobUrl: (h) => bridge.blobUrl(h),
    onSignal: (h) => bridge.on('signal', (e: SignalEvent) => h(e)),
    onEphemeral: (h) => on.call(bridge, 'ephemeral', (e) => h(e as EphemeralEvent)),
  };
}
