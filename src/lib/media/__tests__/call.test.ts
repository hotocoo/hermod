import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA } from '../../../config/media';
import { CallSession } from '../call';
import { MediaError } from '../errors';
import { ENVELOPE } from '../sessions';
import type { MediaBridge } from '../types';
import type { SignalEvent } from '../../bridge/types';

/**
 * CallSession over fake WebRTC globals (node has none): the mesh logic, ICE failure reporting, stats classification and the
 * participant cap run as in production; only RTCPeerConnection, MediaStream, AudioContext and window are stand-ins.
 */

class FakeStream {
  private tracks: MediaStreamTrack[] = [];
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  addTrack(t: MediaStreamTrack) { this.tracks.push(t); }
  removeTrack(t: MediaStreamTrack) { this.tracks = this.tracks.filter((x) => x !== t); }
}

let pcs: FakePc[] = [];
let statsRows: Record<string, unknown>[] = [];
class FakePc {
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription = null;
  remoteDescription = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: (() => void) | null = null;
  ontrack: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  restartIce = vi.fn();
  constructor() { pcs.push(this); }
  addTransceiver() {
    return { sender: { replaceTrack: async () => undefined, getParameters: () => ({ encodings: [] }), setParameters: async () => undefined } };
  }
  async setLocalDescription() { /* no SDP in node */ }
  async getStats() { return statsRows; }
  close() { this.connectionState = 'closed'; }
  /** What the browser does when the transport changes state. */
  fire(state: RTCPeerConnectionState) { this.connectionState = state; this.onconnectionstatechange?.(); }
}

function fakeBridge() {
  const sent: { payload: { type: string; data?: unknown }; to?: string }[] = [];
  let handler: (e: SignalEvent) => void = () => undefined;
  const bridge: MediaBridge = {
    mediaSignal: async (_space, payload, to) => { sent.push({ payload: payload as { type: string; data?: unknown }, to }); },
    sendEphemeral: async () => undefined,
    blobPutBytes: async () => { throw new Error('unused'); },
    blobUrl: (h) => h,
    onSignal: (h) => { handler = h; return () => undefined; },
    onEphemeral: () => () => undefined,
  };
  const deliver = (from: string, type: string, data?: unknown) => handler({
    from, space_id: 'sp', payload: { m: ENVELOPE, v: MEDIA.protocolVersion, scope: 'call:r', sid: `sid-${from}`, type, ...(data === undefined ? {} : { data }) },
  });
  return { bridge, sent, deliver };
}

async function joined() {
  const f = fakeBridge();
  const call = new CallSession({ bridge: f.bridge, space: 'sp', room: 'r', self: 'me', audio: false });
  const errors: MediaError[] = [];
  call.on('error', (e) => errors.push(e));
  await call.join();
  return { ...f, call, errors };
}

beforeEach(() => {
  pcs = []; statsRows = [];
  vi.useFakeTimers();
  vi.stubGlobal('RTCPeerConnection', FakePc);
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('AudioContext', class { async resume() { /* running */ } async close() { /* closed */ } });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('ICE failure without a relay (H-013)', () => {
  it('restarts ICE iceRestartMax times, then reports peer-unreachable with the no-relay message', async () => {
    const { call, deliver, errors } = await joined();
    deliver('p', 'hello');
    expect(pcs).toHaveLength(1);
    const pc = pcs[0];
    const { iceRestartMax, iceRestartBackoffMs } = MEDIA.call;
    for (let i = 0; i < iceRestartMax; i++) {
      pc.fire('failed');
      await vi.advanceTimersByTimeAsync(iceRestartBackoffMs[Math.min(i, iceRestartBackoffMs.length - 1)]);
      expect(errors).toHaveLength(0);
    }
    expect(pc.restartIce).toHaveBeenCalledTimes(iceRestartMax);
    pc.fire('failed');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'peer-unreachable', peer: 'p', message: new MediaError('peer-unreachable').message });
    expect(errors[0].message).toMatch(/no relay server/);
    expect(call.peers()[0].state).toBe('failed');
    await call.leave();
  });

  it('a link that comes back resets the restart budget', async () => {
    const { call, deliver, errors } = await joined();
    deliver('p', 'hello');
    const pc = pcs[0];
    pc.fire('failed');
    await vi.advanceTimersByTimeAsync(MEDIA.call.iceRestartBackoffMs[0]);
    pc.fire('connected');
    for (let i = 0; i < MEDIA.call.iceRestartMax; i++) {
      pc.fire('failed');
      await vi.advanceTimersByTimeAsync(MEDIA.call.iceRestartBackoffMs[Math.min(i, MEDIA.call.iceRestartBackoffMs.length - 1)]);
    }
    expect(errors).toHaveLength(0);
    await call.leave();
  });
});

describe('call quality (H-013)', () => {
  it('classifies a slow round trip as poor in the stats event the tiles read', async () => {
    const { call, deliver } = await joined();
    deliver('p', 'hello');
    const seen: Record<string, { quality: string }>[] = [];
    call.on('stats', (s) => seen.push(s));
    statsRows = [{ type: 'candidate-pair', id: 'c', nominated: true, state: 'succeeded', currentRoundTripTime: (MEDIA.call.poorRttMs * 2) / 1000 }];
    await vi.advanceTimersByTimeAsync(MEDIA.call.statsEveryMs);
    expect(seen.at(-1)?.p.quality).toBe('poor');
    statsRows = [{ type: 'candidate-pair', id: 'c', nominated: true, state: 'succeeded', currentRoundTripTime: MEDIA.call.poorRttMs / 4 / 1000 }];
    await vi.advanceTimersByTimeAsync(MEDIA.call.statsEveryMs);
    expect(seen.at(-1)?.p.quality).toBe('good');
    await call.leave();
  });
});

describe('participant cap (H-014)', () => {
  const max = MEDIA.call.maxParticipants;

  it('a full room answers the next hello with full and opens no link for it', async () => {
    const { call, deliver, sent } = await joined();
    for (let i = 1; i < max; i++) deliver(`p${i}`, 'hello');
    expect(call.peers()).toHaveLength(max - 1);
    deliver('late', 'hello');
    expect(call.peers()).toHaveLength(max - 1);
    expect(sent.find((m) => m.to === 'late')?.payload).toMatchObject({ type: 'hello-ack', data: { full: true } });
    await call.leave();
  });

  it('joining a full room ends the join with room-full', async () => {
    const { call, deliver, errors } = await joined();
    deliver('host', 'hello-ack', { full: true });
    expect(errors.map((e) => e.code)).toEqual(['room-full']);
    await vi.runOnlyPendingTimersAsync();
    expect(call.joined).toBe(false);
    expect(pcs).toHaveLength(0);
  });
});
