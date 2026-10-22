import { describe, expect, it } from 'vitest';
import { MEDIA } from '../../../config/media';
import { LiveBroadcast } from '../liveHost';
import { parkEarly } from '../liveShared';
import type { SignalMsg } from '../sessions';
import type { MediaBridge } from '../types';

const sig = (data: unknown = {}): SignalMsg => ({ m: 'hermod.media', v: 1, scope: 'live:x', sid: 's', type: 'offer', data });
const caps = { ...MEDIA.live, earlyMaxPerSender: 2, earlyMaxSenders: 2, earlyMaxBytes: 40 };

describe('parkEarly', () => {
  it('bounds senders, messages per sender and total bytes', () => {
    let q = new Map<string, SignalMsg[]>();
    q = parkEarly(q, 'a', sig(), caps); q = parkEarly(q, 'a', sig(), caps); q = parkEarly(q, 'a', sig(), caps);
    expect(q.get('a')).toHaveLength(2);
    q = parkEarly(q, 'b', sig(), caps); q = parkEarly(q, 'c', sig(), caps);
    expect([...q.keys()]).toEqual(['a', 'b']);
    expect(parkEarly(new Map(), 'a', sig('x'.repeat(100)), caps).size).toBe(0);
  });
});

describe('LiveBroadcast.stop', () => {
  it('finishes its teardown before the leave signal settles, so a quick start() is not undone', () => {
    const bridge = { mediaSignal: () => new Promise<void>(() => undefined), onSignal: () => () => undefined, onEphemeral: () => () => undefined } as unknown as MediaBridge;
    const host = new LiveBroadcast({ bridge, space: 'sp', liveId: 'x', self: 'me' } as never);
    const h = host as unknown as { running: boolean; timer: unknown };
    h.running = true; h.timer = setInterval(() => undefined, 1000);
    void host.stop();
    expect(h.timer).toBeNull();
  });
});
