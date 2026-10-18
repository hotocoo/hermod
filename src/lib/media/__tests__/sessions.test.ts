import { describe, expect, it } from 'vitest';
import { MEDIA } from '../../../config/media';
import { ENVELOPE, gateSession, isPolite, newSid, onRemoteDescription, parseSignal } from '../sessions';
import { Signaling } from '../signaling';
import type { MediaBridge } from '../types';
import type { SignalEvent } from '../../bridge/types';

const V = MEDIA.protocolVersion;
const msg = (o: Record<string, unknown> = {}) => ({ m: ENVELOPE, v: V, scope: 'call:r', sid: 'a', type: 'hello', ...o });

describe('parseSignal', () => {
  it('accepts a valid envelope', () => expect(parseSignal(msg(), V)?.type).toBe('hello'));
  it.each([
    ['null', null], ['string', 'x'], ['wrong tag', msg({ m: 'x' })], ['wrong version', msg({ v: 99 })], ['no scope', msg({ scope: '' })],
    ['long scope', msg({ scope: 'x'.repeat(129) })], ['no sid', msg({ sid: '' })], ['unknown type', msg({ type: 'boom' })], ['bad to', msg({ to: 5 })],
  ])('rejects %s', (_n, p) => expect(parseSignal(p, V)).toBeNull());
});

describe('session ids', () => {
  it('sort by creation time', () => {
    const a = newSid(1_700_000_000_000, () => 0.9);
    const b = newSid(1_700_000_000_001, () => 0.1);
    expect(a < b).toBe(true);
    expect(newSid(Date.now()).length).toBe(15);
  });
});

describe('gateSession', () => {
  it('accepts anything when no session is known', () => expect(gateSession(undefined, 'ice', 'b')).toBe('accept'));
  it('accepts the same session', () => expect(gateSession('b', 'answer', 'b')).toBe('accept'));
  it('drops stale sessions', () => expect(gateSession('b', 'hello', 'a')).toBe('drop'));
  it('resets on a newer establishing message', () => {
    for (const t of ['hello', 'hello-ack', 'offer', 'live-join', 'live-forward'] as const) expect(gateSession('b', t, 'c')).toBe('reset');
  });
  it('drops newer non-establishing messages (we never saw that session start)', () => {
    for (const t of ['ice', 'answer', 'hangup', 'rec', 'renegotiate'] as const) expect(gateSession('b', t, 'c')).toBe('drop');
  });
});

describe('perfect negotiation', () => {
  it('lower id is polite, and exactly one side of a pair is polite', () => {
    expect(isPolite('a', 'b')).toBe(true);
    expect(isPolite('b', 'a')).toBe(false);
  });
  const base = { polite: false, makingOffer: false, signalingState: 'stable', settingRemoteAnswer: false };
  it('takes an offer when stable', () => expect(onRemoteDescription(base, 'offer')).toEqual({ ignore: false, collision: false }));
  it('impolite peer ignores a colliding offer', () => {
    expect(onRemoteDescription({ ...base, makingOffer: true }, 'offer')).toEqual({ ignore: true, collision: true });
    expect(onRemoteDescription({ ...base, signalingState: 'have-local-offer' }, 'offer').ignore).toBe(true);
  });
  it('polite peer yields (rollback) on collision', () => {
    expect(onRemoteDescription({ ...base, polite: true, makingOffer: true }, 'offer')).toEqual({ ignore: false, collision: true });
  });
  it('answers are never collisions', () => expect(onRemoteDescription({ ...base, signalingState: 'have-local-offer' }, 'answer')).toEqual({ ignore: false, collision: false }));
  it('an offer while a remote answer is being applied is not a collision', () => {
    expect(onRemoteDescription({ ...base, signalingState: 'have-local-offer', settingRemoteAnswer: true }, 'offer').collision).toBe(false);
  });
});

function fakeBridge() {
  const sent: { space: string; payload: unknown; to?: string }[] = [];
  let handler: (e: SignalEvent) => void = () => undefined;
  let offCalls = 0;
  const bridge: MediaBridge = {
    mediaSignal: async (space, payload, to) => { sent.push({ space, payload, to }); },
    sendEphemeral: async () => undefined,
    blobPutBytes: async () => { throw new Error('unused'); },
    blobUrl: (h) => h,
    onSignal: (h) => { handler = h; return () => { offCalls += 1; }; },
    onEphemeral: () => () => undefined,
  };
  return { bridge, sent, deliver: (e: SignalEvent) => handler(e), offCalls: () => offCalls };
}

describe('Signaling', () => {
  it('sends enveloped messages, unicast when `to` is set', async () => {
    const f = fakeBridge();
    const s = new Signaling(f.bridge, 'sp', 'me');
    await s.send('call:r', 'sid1', 'offer', { sdp: 1 }, 'peer');
    expect(f.sent[0]).toMatchObject({ space: 'sp', to: 'peer', payload: { m: ENVELOPE, v: V, scope: 'call:r', sid: 'sid1', type: 'offer', to: 'peer', data: { sdp: 1 } } });
    await s.send('call:r', 'sid1', 'hello');
    expect(f.sent[1].to).toBeUndefined();
  });

  it('routes by scope and filters other spaces, own echoes, other recipients and garbage', () => {
    const f = fakeBridge();
    const s = new Signaling(f.bridge, 'sp', 'me');
    const got: string[] = [];
    s.subscribe('call:r', (from, m) => got.push(`${from}:${m.type}`));
    const ev = (o: Partial<SignalEvent>, p: unknown = msg()) => f.deliver({ from: 'x', space_id: 'sp', payload: p, ...o });
    ev({});
    ev({ space_id: 'other' });
    ev({ from: 'me' });
    ev({}, msg({ to: 'someone-else' }));
    ev({}, msg({ scope: 'call:other' }));
    ev({}, 'junk');
    ev({}, msg({ to: 'me', type: 'ice' }));
    expect(got).toEqual(['x:hello', 'x:ice']);
  });

  it('refuses to send after dispose and unsubscribes', async () => {
    const f = fakeBridge();
    const s = new Signaling(f.bridge, 'sp', 'me');
    s.dispose();
    expect(f.offCalls()).toBe(1);
    await expect(s.send('c', 's', 'hello')).rejects.toMatchObject({ code: 'signal-failed' });
  });

  it('wraps bridge failures as MediaError', async () => {
    const f = fakeBridge();
    f.bridge.mediaSignal = async () => { throw new Error('offline'); };
    await expect(new Signaling(f.bridge, 'sp', 'me').send('c', 's', 'hello', {}, 'p')).rejects.toMatchObject({ code: 'signal-failed', peer: 'p' });
  });
});
