import { onRemoteDescription } from './sessions';
import type { PeerState } from './types';

export type PeerOut = 'offer' | 'answer' | 'ice' | 'renegotiate';

export interface PeerLinkInit {
  peer: string;
  polite: boolean;
  stun: readonly string[];
  /** Ships one negotiation message to the remote peer (already addressed and scoped by the caller). */
  send(type: PeerOut, data: unknown): void;
  onState(state: PeerState): void;
  onTrack(stream: MediaStream, track: MediaStreamTrack): void;
  onError(error: unknown): void;
  reconnect: { graceMs: number; max: number; backoffMs: readonly number[] };
}

const MAX_SDP = 60_000;

const asDesc = (v: unknown): RTCSessionDescriptionInit | null => {
  const d = (v as { sdp?: RTCSessionDescriptionInit } | null)?.sdp;
  if (!d || (d.type !== 'offer' && d.type !== 'answer') || typeof d.sdp !== 'string' || d.sdp.length > MAX_SDP) return null;
  return { type: d.type, sdp: d.sdp };
};

/**
 * One RTCPeerConnection with W3C perfect negotiation (glare safe), buffered ICE, ICE restart with backoff, and a
 * remote MediaStream that collects whatever tracks arrive. Used by call mesh links and live tree links.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly remoteStream = new MediaStream();
  state: PeerState = 'new';
  /** Session id of the remote end bound to this link (see gateSession). */
  remoteSid: string | undefined;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private restarts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly init: PeerLinkInit) {
    this.pc = new RTCPeerConnection({ iceServers: init.stun.length ? [{ urls: [...init.stun] }] : [] });
    this.pc.onnegotiationneeded = () => { void this.offer(); };
    this.pc.onicecandidate = (e) => { if (e.candidate) init.send('ice', { candidate: e.candidate.toJSON() }); };
    this.pc.ontrack = (e) => {
      if (!this.remoteStream.getTracks().includes(e.track)) this.remoteStream.addTrack(e.track);
      e.track.onended = () => this.remoteStream.removeTrack(e.track);
      init.onTrack(this.remoteStream, e.track);
    };
    this.pc.onconnectionstatechange = () => this.onConnectionState();
  }

  private set(state: PeerState): void {
    if (this.state === state) return;
    this.state = state;
    this.init.onState(state);
  }

  private async offer(): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) this.init.send('offer', { sdp: this.pc.localDescription.toJSON() });
    } catch (e) {
      this.init.onError(e);
    } finally {
      this.makingOffer = false;
    }
  }

  /** Feed a remote offer, answer, ice or renegotiate message. Never throws; failures go to `onError`. */
  async handle(type: string, data: unknown): Promise<void> {
    if (this.closed) return;
    try {
      if (type === 'offer' || type === 'answer') await this.onDescription(type, data);
      else if (type === 'ice') await this.onIce(data);
      else if (type === 'renegotiate') this.restartIce((data as { iceRestart?: boolean } | null)?.iceRestart === true);
    } catch (e) {
      this.init.onError(e);
    }
  }

  private async onDescription(type: 'offer' | 'answer', data: unknown): Promise<void> {
    const desc = asDesc(data);
    if (!desc || desc.type !== type) return;
    const { ignore } = onRemoteDescription(
      { polite: this.init.polite, makingOffer: this.makingOffer, signalingState: this.pc.signalingState, settingRemoteAnswer: this.settingRemoteAnswer },
      type,
    );
    this.ignoreOffer = ignore;
    if (ignore) return;
    this.settingRemoteAnswer = type === 'answer';
    try { await this.pc.setRemoteDescription(desc); } finally { this.settingRemoteAnswer = false; }
    const queued = this.pendingIce.splice(0);
    for (const c of queued) await this.pc.addIceCandidate(c).catch((e) => this.init.onError(e));
    if (type === 'offer') {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) this.init.send('answer', { sdp: this.pc.localDescription.toJSON() });
    }
  }

  private async onIce(data: unknown): Promise<void> {
    const c = (data as { candidate?: RTCIceCandidateInit | null } | null)?.candidate;
    if (!c || typeof c.candidate !== 'string') return;
    if (!this.pc.remoteDescription) { if (this.pendingIce.length < 64) this.pendingIce.push(c); return; }
    try { await this.pc.addIceCandidate(c); } catch (e) { if (!this.ignoreOffer) throw e; }
  }

  private onConnectionState(): void {
    if (this.closed) return;
    const s = this.pc.connectionState;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (s === 'connected') { this.restarts = 0; this.set('connected'); return; }
    if (s === 'connecting') { this.set(this.restarts > 0 ? 'reconnecting' : 'connecting'); return; }
    if (s === 'closed') { this.set('closed'); return; }
    if (s === 'disconnected') {
      this.set('reconnecting');
      this.timer = setTimeout(() => this.recover(), this.init.reconnect.graceMs);
    } else if (s === 'failed') {
      this.recover();
    }
  }

  private recover(): void {
    if (this.closed) return;
    const { max, backoffMs } = this.init.reconnect;
    if (this.restarts >= max) { this.set('failed'); return; }
    const wait = backoffMs[Math.min(this.restarts, backoffMs.length - 1)] ?? 0;
    this.restarts += 1;
    this.set('reconnecting');
    this.timer = setTimeout(() => this.restartIce(true), wait);
  }

  /** Restarts ICE locally and asks the remote to do the same (both sides may notice a break at different times). */
  restartIce(askRemote = false): void {
    if (this.closed) return;
    this.pc.restartIce();
    if (askRemote) this.init.send('renegotiate', { iceRestart: true });
  }

  /** Marks the link failed (connect timeout); the owner decides whether to retry. */
  fail(): void { if (!this.closed) this.set('failed'); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.pc.onnegotiationneeded = this.pc.onicecandidate = this.pc.ontrack = this.pc.onconnectionstatechange = null;
    for (const t of this.remoteStream.getTracks()) this.remoteStream.removeTrack(t);
    try { this.pc.close(); } catch { /* already closed */ }
    this.set('closed');
  }
}

/** Caps the bitrate of one sender (no-op when the browser has no encodings yet). */
export async function capSender(sender: RTCRtpSender | undefined, maxBitrate: number): Promise<void> {
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  if (params.encodings[0].maxBitrate === maxBitrate) return;
  params.encodings[0].maxBitrate = maxBitrate;
  await sender.setParameters(params);
}
