import { MEDIA } from '../../config/media';
import { Emitter } from './emitter';
import { MediaError, toMediaError } from './errors';
import { HeartBatcher, listenLive, parkEarly, type LiveState } from './liveShared';
import { PeerLink, capSender } from './peer';
import { gateSession, newSid, type SignalMsg } from './sessions';
import { Signaling } from './signaling';
import type { MediaBridge } from './types';

export interface LiveViewerOptions {
  bridge: MediaBridge;
  space: string;
  liveId: string;
  self: string;
  /** User id of the broadcaster (media.live.host in the snapshot). */
  host: string;
  /** Children this viewer re-serves (default MEDIA.live.maxForward). */
  maxForward?: number;
  signaling?: Signaling;
}

export type ViewerState = 'idle' | 'joining' | 'live' | 'reconnecting' | 'ended';

export interface LiveViewerEvents {
  /** Stable stream: attach once to a <video>; tracks are swapped when the parent changes. */
  stream: MediaStream;
  state: ViewerState;
  viewers: { viewers: number; max: number; full: boolean };
  hearts: { from: string; n: number };
  error: MediaError;
  closed: undefined;
}

interface Child { pl: PeerLink; senders: Map<string, RTCRtpSender> }

const JOIN_TRIES = 3;

/** Live viewer: receives from the host or a forwarding viewer, re-forwards to up to `maxForward` children, rejoins elsewhere when its parent fails. */
export class LiveViewer extends Emitter<LiveViewerEvents> {
  readonly scope: string;
  readonly sid = newSid();
  /** What to play. Stable for the life of the viewer. */
  readonly stream = new MediaStream();
  private readonly sig: Signaling;
  private readonly ownsSig: boolean;
  private readonly maxForward: number;
  private up: PeerLink | null = null;
  private parent: string | undefined;
  private readonly children = new Map<string, Child>();
  private readonly sids = new Map<string, string>();
  private early = new Map<string, SignalMsg[]>();
  private readonly excluded = new Set<string>();
  private readonly hearts: HeartBatcher;
  private offSig: (() => void) | null = null;
  private offEph: (() => void) | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private tries = 0;
  private status: ViewerState = 'idle';
  private info: LiveState = { viewers: 0, max: MEDIA.live.maxViewers };
  private lastErr = 0;

  constructor(private readonly o: LiveViewerOptions) {
    super();
    this.scope = `live:${o.liveId}`;
    this.maxForward = o.maxForward ?? MEDIA.live.maxForward;
    this.ownsSig = !o.signaling;
    this.sig = o.signaling ?? new Signaling(o.bridge, o.space, o.self);
    this.hearts = new HeartBatcher((n) => {
      this.o.bridge.sendEphemeral(o.space, MEDIA.live.ephemeralKind.hearts, { live: o.liveId, n }).catch((e) => this.fail(toMediaError(e)));
    });
  }

  get state(): ViewerState { return this.status; }

  /** Last known viewer count and the hard cap, from the host's broadcasts. */
  capacity(): { viewers: number; max: number; free: number; full: boolean } {
    const { viewers, max } = this.info;
    return { viewers, max, free: Math.max(0, max - viewers), full: viewers >= max };
  }

  /** Asks the host for a place in the tree. Resolves once the request is sent; watch `state` and `stream`. */
  async join(): Promise<void> {
    if (this.status !== 'idle') return;
    this.setStatus('joining');
    this.offSig = this.sig.subscribe(this.scope, (from, m) => this.onSignal(from, m));
    this.offEph = listenLive(this.o.bridge, this.o.space, this.o.liveId, this.o.host, this.o.self, {
      hearts: (from, n) => this.emit('hearts', { from, n }),
      state: (s) => { this.info = s; this.emit('viewers', this.capacity()); },
    });
    try { await this.requestPlace(); } catch (e) { await this.leave(); throw toMediaError(e); }
  }

  /** Leaves the tree: tells the host, closes every link. Idempotent. */
  async leave(): Promise<void> {
    if (this.status === 'ended') return;
    const wasActive = this.status !== 'idle';
    this.setStatus('ended');
    this.teardown();
    if (wasActive) await this.sig.send(this.scope, this.sid, 'live-leave', undefined, this.o.host).catch(() => undefined);
    if (this.ownsSig) this.sig.dispose();
    this.emit('closed', undefined);
    this.clearListeners();
  }

  /** Sends hearts (batched). Your own hearts are echoed locally so the burst shows at once. */
  sendHearts(n = 1): void {
    if (this.status === 'ended' || this.status === 'idle') return;
    this.emit('hearts', { from: this.o.self, n });
    this.hearts.add(n);
  }

  // ---- joining and rejoining ------------------------------------------------------------------

  private async requestPlace(): Promise<void> {
    await this.sig.send(this.scope, this.sid, 'live-join', { exclude: [...this.excluded] }, this.o.host);
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => this.onJoinTimeout(), MEDIA.live.joinTimeoutMs / JOIN_TRIES);
  }

  private onJoinTimeout(): void {
    if (this.status !== 'joining' && this.status !== 'reconnecting') return;
    this.tries += 1;
    if (this.tries >= JOIN_TRIES) {
      this.emit('error', new MediaError(this.parent ? 'peer-unreachable' : 'live-ended', undefined, this.parent));
      void this.leave();
      return;
    }
    if (this.parent) this.excluded.add(this.parent); // assigned but never delivered: ask for another place
    this.requestPlace().catch((e) => this.fail(toMediaError(e)));
  }

  /** The upstream link broke for good: ask the host for another parent, excluding the failed one. */
  private rejoin(failed: string): void {
    this.closeUp();
    this.excluded.add(failed);
    this.tries = 0;
    this.setStatus('reconnecting');
    this.requestPlace().catch((e) => this.fail(toMediaError(e)));
  }

  // ---- signalling -----------------------------------------------------------------------------

  private onSignal(from: string, m: SignalMsg): void {
    if (this.status === 'ended' || this.status === 'idle') return;
    const gate = gateSession(this.sids.get(from), m.type, m.sid);
    if (gate === 'drop') return;
    if (gate === 'reset' && from === this.parent) { this.up?.close(); this.up = null; } // parent restarted: take its new offer
    else if (gate === 'reset' && from !== this.o.host) this.dropPeer(from);
    this.sids.set(from, m.sid);
    if (from === this.o.host && m.type === 'live-leave') { this.emit('error', new MediaError('live-ended')); void this.leave(); return; }
    if (m.type === 'live-forward') { if (from === this.o.host) this.onOrder(m.data as { op?: string; parent?: unknown; child?: unknown; reason?: unknown } | undefined, m.sid); return; }
    if (m.type === 'offer' || m.type === 'answer' || m.type === 'ice' || m.type === 'renegotiate') this.onRtc(from, m);
  }

  /** Orders from the host: place me, serve this child, stop serving, or refuse. */
  private onOrder(d: { op?: string; parent?: unknown; child?: unknown } | undefined, hostSid: string): void {
    if (d?.op === 'assign' && typeof d.parent === 'string') this.assign(d.parent, hostSid);
    else if (d?.op === 'child' && typeof d.child === 'string') this.openChild(d.child);
    else if (d?.op === 'drop' && typeof d.child === 'string') this.closeChild(d.child);
    else if (d?.op === 'reject') { this.emit('error', new MediaError('live-full')); void this.leave(); }
  }

  private assign(parent: string, hostSid: string): void {
    if (parent === this.parent) return;
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.closeUp();
    this.parent = parent;
    this.joinTimer = setTimeout(() => this.onJoinTimeout(), MEDIA.live.joinTimeoutMs / JOIN_TRIES);
    if (parent === this.o.host) this.sids.set(parent, hostSid);
    const parked = this.early.get(parent) ?? [];
    this.early.delete(parent);
    for (const m of parked) this.onRtc(parent, m);
  }

  private onRtc(from: string, m: SignalMsg): void {
    if (from === this.parent) {
      if (!this.up && m.type === 'offer') this.up = this.openUp(from, m.sid);
      void this.up?.handle(m.type, m.data);
      return;
    }
    const child = this.children.get(from);
    if (child) { void child.pl.handle(m.type, m.data); return; }
    // An offer can overtake the host's `assign`: keep a few messages and replay them if this peer becomes the parent.
    this.early = parkEarly(this.early, from, m);
  }

  private dropPeer(id: string): void {
    this.closeChild(id);
    this.early.delete(id);
  }

  private fail(e: MediaError): void {
    const now = Date.now();
    if (now - this.lastErr < 5_000) return;
    this.lastErr = now;
    this.emit('error', e);
  }

  // ---- upstream -------------------------------------------------------------------------------

  private openUp(parent: string, remoteSid: string): PeerLink {
    const pl = new PeerLink({
      peer: parent,
      polite: true,
      stun: MEDIA.stun,
      send: (type, data) => { this.sig.send(this.scope, this.sid, type, data, parent).catch((e) => this.fail(toMediaError(e))); },
      onState: (s) => {
        if (this.up !== pl) return;
        if (s === 'connected') { this.excluded.clear(); this.tries = 0; if (this.joinTimer) clearTimeout(this.joinTimer); this.setStatus('live'); }
        else if (s === 'reconnecting') this.setStatus('reconnecting');
        else if (s === 'failed') this.rejoin(parent);
      },
      onTrack: (_, track) => this.onUpTrack(track),
      onError: (e) => this.fail(toMediaError(e)),
      reconnect: { graceMs: MEDIA.call.disconnectGraceMs, max: MEDIA.call.iceRestartMax, backoffMs: MEDIA.call.iceRestartBackoffMs },
    });
    pl.remoteSid = remoteSid;
    return pl;
  }

  private closeUp(): void {
    const up = this.up;
    this.up = null;
    this.parent = undefined;
    up?.close();
    for (const t of this.stream.getTracks()) this.stream.removeTrack(t);
  }

  private onUpTrack(track: MediaStreamTrack): void {
    for (const t of this.stream.getTracks()) if (t.kind === track.kind) this.stream.removeTrack(t);
    this.stream.addTrack(track);
    this.emit('stream', this.stream);
    this.syncDownstream();
  }

  // ---- downstream -----------------------------------------------------------------------------

  private openChild(id: string): void {
    if (this.children.has(id) || this.children.size >= this.maxForward) return;
    const pl = new PeerLink({
      peer: id,
      polite: false,
      stun: MEDIA.stun,
      send: (type, data) => { this.sig.send(this.scope, this.sid, type, data, id).catch((e) => this.fail(toMediaError(e))); },
      onState: (s) => {
        if (this.children.get(id)?.pl !== pl) return;
        if (s === 'failed') { this.closeChild(id); this.reportLost(id); }
      },
      onTrack: () => undefined,
      onError: (e) => this.fail(toMediaError(e)),
      reconnect: { graceMs: MEDIA.call.disconnectGraceMs, max: MEDIA.call.iceRestartMax, backoffMs: MEDIA.call.iceRestartBackoffMs },
    });
    this.children.set(id, { pl, senders: new Map() });
    this.syncDownstream();
  }

  private closeChild(id: string): void {
    const c = this.children.get(id);
    if (!c) return;
    this.children.delete(id);
    c.pl.close();
  }

  private reportLost(child: string): void {
    this.sig.send(this.scope, this.sid, 'live-forward', { op: 'child-lost', peer: child, parent: this.o.self }, this.o.host).catch((e) => this.fail(toMediaError(e)));
  }

  /** Mirrors the current upstream tracks onto every child (replaceTrack when a sender of that kind exists, else addTrack). */
  private syncDownstream(): void {
    const tracks = this.stream.getTracks();
    for (const c of this.children.values()) {
      for (const t of tracks) {
        const sender = c.senders.get(t.kind);
        if (sender) { if (sender.track !== t) void sender.replaceTrack(t).catch((e) => this.fail(toMediaError(e))); continue; }
        const s = c.pl.pc.addTrack(t, this.stream);
        c.senders.set(t.kind, s);
        void capSender(s, t.kind === 'video' ? MEDIA.live.videoBps : MEDIA.live.audioBps).catch(() => undefined);
      }
    }
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  private setStatus(s: ViewerState): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('state', s);
  }

  private teardown(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
    this.offSig?.();
    this.offEph?.();
    this.hearts.dispose();
    for (const id of [...this.children.keys()]) this.closeChild(id);
    this.closeUp();
    this.early = new Map();
  }
}
