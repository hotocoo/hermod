import { MEDIA } from '../../config/media';
import { Emitter } from './emitter';
import { MediaError, toMediaError } from './errors';
import { listenLive } from './liveShared';
import { PeerLink, capSender } from './peer';
import { gateSession, newSid, type SignalMsg, type SignalType } from './sessions';
import { Signaling } from './signaling';
import { attach, capacity, createTree, has, parentOf, remove, viewerCount, type Capacity, type Reassignment, type Tree, type TreeCaps } from './tree';
import type { MediaBridge, PeerState } from './types';

export interface LiveHostOptions {
  bridge: MediaBridge;
  space: string;
  liveId: string;
  /** Own user id; the host of the stream. */
  self: string;
  caps?: TreeCaps;
  signaling?: Signaling;
}

export type LiveSource = 'camera' | 'screen' | MediaStream;

export interface LiveHostEvents {
  viewers: Capacity;
  hearts: { from: string; n: number };
  /** State of the host's direct links (the first tier of the tree). */
  peers: { id: string; state: PeerState }[];
  error: MediaError;
  closed: undefined;
}

const ARR_MAX = 16;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length < 128).slice(0, ARR_MAX) : []);

/** Live broadcast host: captures, serves `maxDirect` viewers directly and assigns everyone else under forwarding viewers. */
export class LiveBroadcast extends Emitter<LiveHostEvents> {
  readonly scope: string;
  readonly sid = newSid();
  private readonly caps: TreeCaps;
  private readonly sig: Signaling;
  private readonly ownsSig: boolean;
  private tree: Tree;
  private readonly links = new Map<string, PeerLink>();
  private readonly sids = new Map<string, string>();
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private offSig: (() => void) | null = null;
  private offEph: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastErr = 0;

  constructor(private readonly o: LiveHostOptions) {
    super();
    this.scope = `live:${o.liveId}`;
    this.caps = o.caps ?? MEDIA.live;
    this.tree = createTree(o.self);
    this.ownsSig = !o.signaling;
    this.sig = o.signaling ?? new Signaling(o.bridge, o.space, o.self);
  }

  /** The stream being broadcast (for a local preview), null before `start`. */
  get preview(): MediaStream | null { return this.stream; }

  /** Viewer count, hard cap and free direct slots. */
  capacity(): Capacity { return capacity(this.tree, this.caps); }

  /** Captures (or adopts) the stream and opens the stream to viewers. */
  async start(source: LiveSource): Promise<MediaStream> {
    if (this.running) throw new MediaError('unknown', undefined, undefined, 'Already live.');
    this.running = true;
    try {
      if (source instanceof MediaStream) this.stream = source;
      else {
        const md = navigator.mediaDevices;
        if (!md) throw new MediaError('unsupported');
        this.stream = source === 'screen'
          ? await md.getDisplayMedia({ video: true, audio: true })
          : await md.getUserMedia({ audio: MEDIA.call.audio, video: MEDIA.call.video });
        this.ownsStream = true;
        this.stream.getVideoTracks()[0]?.addEventListener('ended', () => { void this.stop(); });
      }
    } catch (e) {
      this.running = false;
      throw toMediaError(e);
    }
    this.offSig = this.sig.subscribe(this.scope, (from, m) => this.onSignal(from, m));
    this.offEph = listenLive(this.o.bridge, this.o.space, this.o.liveId, this.o.self, this.o.self, {
      hearts: (from, n) => this.emit('hearts', { from, n }),
      state: () => undefined,
    });
    this.timer = setInterval(() => this.publish(), MEDIA.live.countEveryMs);
    this.publish();
    return this.stream;
  }

  /** Ends the broadcast: tells every viewer, closes links, releases devices. Idempotent. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    // Sent first, awaited last: everything below runs synchronously so a quick `start()` is not torn down by this stop.
    const bye = this.sig.send(this.scope, this.sid, 'live-leave').catch(() => undefined);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.offSig?.();
    this.offEph?.();
    for (const id of [...this.links.keys()]) this.closeLink(id);
    if (this.ownsStream) this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.tree = createTree(this.o.self);
    if (this.ownsSig) this.sig.dispose();
    this.emit('closed', undefined);
    this.clearListeners();
    await bye;
  }

  // ---- protocol -------------------------------------------------------------------------------

  private onSignal(from: string, m: SignalMsg): void {
    if (!this.running) return;
    const gate = gateSession(this.sids.get(from), m.type, m.sid);
    if (gate === 'drop') return;
    if (gate === 'reset') this.drop(from); // the viewer restarted: its old placement is dead
    this.sids.set(from, m.sid);
    switch (m.type) {
      case 'live-join': return this.onJoin(from, strings((m.data as { exclude?: unknown } | undefined)?.exclude));
      case 'live-leave': return this.drop(from);
      case 'live-forward': return this.onForward(from, m.data as { op?: string; peer?: unknown; parent?: unknown } | undefined);
      case 'offer': case 'answer': case 'ice': case 'renegotiate': void this.links.get(from)?.handle(m.type, m.data); return;
      default: return;
    }
  }

  private onJoin(viewer: string, exclude: string[]): void {
    const cur = parentOf(this.tree, viewer);
    if (cur && !exclude.includes(cur)) { this.send(viewer, 'assign', { parent: cur }); return; } // duplicate or late join: keep placement
    const r = attach(this.tree, this.caps, viewer, exclude);
    if (!r.ok) { this.send(viewer, 'reject', { reason: r.reason }); return; }
    this.tree = r.tree;
    if (r.from && r.from !== r.parent) this.release(r.from, viewer);
    this.place({ child: viewer, parent: r.parent });
    this.changed();
  }

  /** `child-lost` report from a forwarder: only honoured when the reporter is the child's current parent. */
  private onForward(from: string, d: { op?: string; peer?: unknown; parent?: unknown } | undefined): void {
    if (d?.op !== 'child-lost' || typeof d.peer !== 'string') return;
    if (parentOf(this.tree, d.peer) === from) this.drop(d.peer);
  }

  /** Removes a viewer (left, lost or failed) and reassigns its children. */
  private drop(id: string): void {
    if (!has(this.tree, id)) return;
    const r = remove(this.tree, this.caps, id);
    this.tree = r.tree;
    this.closeLink(id);
    this.sids.delete(id);
    if (r.from && r.from !== this.o.self) this.release(r.from, id);
    for (const mv of r.moves) this.place(mv);
    for (const d of r.dropped) { this.closeLink(d); this.send(d, 'reject', { reason: 'full' }); }
    this.changed();
  }

  /** Tells `parent` to stop serving `child`. */
  private release(parent: string, child: string): void {
    if (parent === this.o.self) this.closeLink(child);
    else this.send(parent, 'drop', { child });
  }

  /** Tells the child its parent and the parent its child. The host offers directly when it is the parent. */
  private place(mv: Reassignment): void {
    this.send(mv.child, 'assign', { parent: mv.parent });
    if (mv.parent === this.o.self) this.openLink(mv.child);
    else this.send(mv.parent, 'child', { child: mv.child });
  }

  private send(to: string, op: string, data: Record<string, unknown>): void {
    const type: SignalType = 'live-forward';
    this.sig.send(this.scope, this.sid, type, { op, ...data }, to).catch((e) => this.fail(toMediaError(e)));
  }

  private fail(e: MediaError): void {
    const now = Date.now();
    if (now - this.lastErr < 5_000) return;
    this.lastErr = now;
    this.emit('error', e);
  }

  // ---- links and state ------------------------------------------------------------------------

  private openLink(child: string): void {
    this.closeLink(child);
    const stream = this.stream;
    if (!stream) return;
    const pl = new PeerLink({
      peer: child,
      polite: false,
      stun: MEDIA.stun,
      send: (type, data) => { this.sig.send(this.scope, this.sid, type, data, child).catch((e) => this.fail(toMediaError(e))); },
      onState: (s) => this.onLinkState(child, pl, s),
      onTrack: () => undefined,
      onError: (e) => this.fail(toMediaError(e)),
      reconnect: { graceMs: MEDIA.call.disconnectGraceMs, max: MEDIA.call.iceRestartMax, backoffMs: MEDIA.call.iceRestartBackoffMs },
    });
    this.links.set(child, pl);
    for (const t of stream.getTracks()) {
      const sender = pl.pc.addTrack(t, stream);
      void capSender(sender, t.kind === 'video' ? MEDIA.live.videoBps : MEDIA.live.audioBps).catch(() => undefined);
    }
    this.emitPeers();
  }

  private closeLink(id: string): void {
    const pl = this.links.get(id);
    if (!pl) return;
    this.links.delete(id);
    pl.close();
    this.emitPeers();
  }

  private onLinkState(child: string, pl: PeerLink, s: PeerState): void {
    if (this.links.get(child) !== pl) return;
    if (s === 'failed') this.drop(child);
    else this.emitPeers();
  }

  private emitPeers(): void { this.emit('peers', [...this.links].map(([id, l]) => ({ id, state: l.state }))); }

  private changed(): void {
    this.emit('viewers', this.capacity());
    this.publish();
  }

  /** Viewer count for everyone (ephemeral gossip: droppable, rate limited by the node). */
  private publish(): void {
    if (!this.running) return;
    this.o.bridge.sendEphemeral(this.o.space, MEDIA.live.ephemeralKind.state, { live: this.o.liveId, viewers: viewerCount(this.tree), max: this.caps.maxViewers })
      .catch((e) => this.fail(toMediaError(e)));
  }
}
