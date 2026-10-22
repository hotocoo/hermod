import { MEDIA } from '../../config/media';
import { videoBitrate } from './bandwidth';
import { Emitter } from './emitter';
import { MediaError, toMediaError } from './errors';
import { LocalMedia, applySink } from './local';
import { PeerLink, capSender } from './peer';
import { CallRecorder } from './recorder';
import { HelloLedger, gateSession, isPolite, newSid, type SignalMsg } from './sessions';
import { Signaling } from './signaling';
import { LevelMonitor } from './speaking';
import { classify, diffSamples, sampleFromReport, type StatSample } from './stats';
import type { DeviceList, Levels, MediaBridge, PeerState, PeerStats, Quality } from './types';

export interface CallOptions {
  bridge: MediaBridge;
  /** Space label as used with the bridge (`home` or hex id). */
  space: string;
  /** Room id inside the space; the Hearth room of a space uses a fixed id (INTEGRATION.md). */
  room: string;
  /** Own user id (identity_get().user_id). */
  self: string;
  /** Join with a microphone (default true). With false the session is listen-only until `setMic`. */
  audio?: boolean;
  video?: boolean;
  micId?: string;
  camId?: string;
  /** Reuse one Signaling for several sessions; otherwise the session owns one. */
  signaling?: Signaling;
}

export interface PeerInfo { id: string; state: PeerState; stream: MediaStream; stats?: PeerStats; quality: Quality }

export interface CallEvents {
  peers: PeerInfo[];
  /** A remote stream gained a track (re-attach srcObject only if it changed). */
  stream: { id: string; stream: MediaStream };
  levels: Levels;
  activeSpeaker: string | null;
  stats: Record<string, PeerStats & { quality: Quality }>;
  devices: DeviceList;
  tracks: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null };
  /** Recording state of a participant (including you). Show a REC badge while any is on. */
  recording: { by: string; on: boolean };
  /** Delivered when a recording ended because you left the call; the caller should store it. */
  recorded: { blob: Blob; mime: string };
  error: MediaError;
  closed: undefined;
}

interface Link { id: string; pl: PeerLink; audio: RTCRtpTransceiver; video: RTCRtpTransceiver; timeout: ReturnType<typeof setTimeout> | null; stat: StatSample | null; stats?: PeerStats }

const ERROR_EVERY_MS = 5_000;

/** Hearth voice/video room: full mesh of RTCPeerConnections, up to `MEDIA.call.maxParticipants`. */
export class CallSession extends Emitter<CallEvents> {
  readonly local = new LocalMedia();
  readonly scope: string;
  readonly sid = newSid();
  private readonly sig: Signaling;
  private readonly ownsSig: boolean;
  private readonly links = new Map<string, Link>();
  private readonly recording = new Set<string>();
  private readonly hellos = new HelloLedger();
  private monitor: LevelMonitor | null = null;
  private ctx: AudioContext | null = null;
  private recorder: CallRecorder | null = null;
  private offSig: (() => void) | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private active: string | null = null;
  private lastErr = 0;
  private state: 'idle' | 'joined' | 'closed' = 'idle';
  private readonly onHide = () => { void this.leave(); };

  constructor(private readonly o: CallOptions) {
    super();
    this.scope = `call:${o.room}`;
    this.ownsSig = !o.signaling;
    this.sig = o.signaling ?? new Signaling(o.bridge, o.space, o.self);
  }

  get joined(): boolean { return this.state === 'joined'; }
  get speakerId(): string | undefined { return this.local.speakerId; }

  peers(): PeerInfo[] {
    return [...this.links.values()].map((l) => ({ id: l.id, state: l.pl.state, stream: l.pl.remoteStream, stats: l.stats, quality: classify(l.stats, MEDIA.call.poorRttMs, MEDIA.call.poorLossPct) }));
  }

  /** Acquires devices and announces yourself. Throws MediaError (permission-denied, no-device, ...). Safe to call once. */
  async join(): Promise<void> {
    if (this.state !== 'idle') return;
    if (typeof RTCPeerConnection === 'undefined') throw new MediaError('unsupported');
    this.state = 'joined';
    try {
      this.local.on('tracks', (t) => { this.emit('tracks', t); void this.replaceTracks(t.audio, t.video); });
      this.local.on('devices', (d) => this.emit('devices', d));
      this.local.on('error', (e) => this.emit('error', e));
      if (this.o.audio !== false) await this.local.startAudio(this.o.micId);
      if (this.o.video) await this.local.startVideo(this.o.camId);
      this.ctx = new AudioContext();
      void this.ctx.resume();
      this.monitor = new LevelMonitor(this.ctx, (l) => this.onLevels(l));
      if (this.local.stream.getAudioTracks().length) this.monitor.add(this.o.self, this.local.stream);
      this.offSig = this.sig.subscribe(this.scope, (from, m) => this.onSignal(from, m));
      this.statsTimer = setInterval(() => { void this.pollStats(); }, MEDIA.call.statsEveryMs);
      window.addEventListener('pagehide', this.onHide);
      this.hellos.broadcast(Date.now(), MEDIA.call.helloAckWindowMs);
      await this.sig.send(this.scope, this.sid, 'hello', {});
    } catch (e) {
      await this.leave();
      throw toMediaError(e);
    }
  }

  /** Hangs up, stops every track and closes every connection. Idempotent. */
  async leave(): Promise<void> {
    if (this.state === 'closed') return;
    const wasJoined = this.state === 'joined';
    this.state = 'closed';
    window.removeEventListener('pagehide', this.onHide);
    if (this.recorder) await this.finishRecording(true);
    if (wasJoined) {
      await this.sig.send(this.scope, this.sid, 'hangup').catch(() => undefined);
    }
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.offSig?.();
    for (const id of [...this.links.keys()]) this.drop(id);
    this.monitor?.dispose();
    this.monitor = null;
    this.local.stop();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    if (this.ownsSig) this.sig.dispose();
    this.emit('closed', undefined);
    this.clearListeners();
  }

  // ---- local controls -------------------------------------------------------------------------

  setMuted(muted: boolean): void { this.local.setMuted(muted); }

  async setCamera(on: boolean): Promise<void> {
    if (on) await this.local.startVideo(); else this.local.stopVideo();
  }

  async setScreenShare(on: boolean): Promise<void> {
    if (on) await this.local.startScreen(); else this.local.stopScreen();
    this.rebalance();
  }

  async setMic(deviceId: string): Promise<void> { await this.local.startAudio(deviceId); }
  async setCam(deviceId: string): Promise<void> { await this.local.startVideo(deviceId); }
  /** Remember the speaker and route `el` (your remote <audio>/<video> elements) to it. */
  async setSpeaker(deviceId: string, ...els: HTMLMediaElement[]): Promise<void> {
    this.local.speakerId = deviceId;
    await Promise.all(els.map((e) => applySink(e, deviceId)));
  }
  devices(): Promise<DeviceList> { return this.local.devices(); }

  /** Tears down one failed link and starts it over (hello is sent to that peer only). */
  async retry(peer: string): Promise<void> {
    this.drop(peer);
    this.hellos.to(peer);
    await this.sig.send(this.scope, this.sid, 'hello', {}, peer);
  }

  // ---- recording ------------------------------------------------------------------------------

  /** Tells everyone first (they show REC), then records the mixed call locally. */
  async startRecording(): Promise<void> {
    if (this.state !== 'joined' || this.recorder || !this.ctx) return;
    const rec = new CallRecorder(this.ctx);
    await this.sig.send(this.scope, this.sid, 'rec', { on: true });
    rec.start(this.o.self, this.local.stream);
    for (const l of this.links.values()) rec.addSource(l.id, l.pl.remoteStream);
    rec.setActive(this.active);
    this.recorder = rec;
    this.setRec(this.o.self, true);
  }

  /** Stops recording, tells everyone, returns the file. The caller stores it (bridge.blobPutBytes) or discards it. */
  async stopRecording(): Promise<{ blob: Blob; mime: string }> {
    if (!this.recorder) throw new MediaError('unknown', undefined, undefined, 'Not recording.');
    return this.finishRecording(false);
  }

  get isRecording(): boolean { return !!this.recorder; }
  /** Participants currently recording (others and you). */
  recordingBy(): string[] { return [...this.recording]; }

  private async finishRecording(emitResult: boolean): Promise<{ blob: Blob; mime: string }> {
    const rec = this.recorder;
    if (!rec) throw new MediaError('unknown');
    this.recorder = null;
    const blob = await rec.stop();
    const out = { blob, mime: rec.mimeType };
    this.setRec(this.o.self, false);
    await this.sig.send(this.scope, this.sid, 'rec', { on: false }).catch(() => undefined);
    if (emitResult) this.emit('recorded', out);
    return out;
  }

  private setRec(by: string, on: boolean): void {
    const had = this.recording.has(by);
    if (on === had) return;
    if (on) this.recording.add(by); else this.recording.delete(by);
    this.emit('recording', { by, on });
  }

  // ---- signalling -----------------------------------------------------------------------------

  private onSignal(from: string, m: SignalMsg): void {
    if (this.state !== 'joined') return;
    const link = this.links.get(from);
    const gate = gateSession(link?.pl.remoteSid, m.type, m.sid);
    if (gate === 'drop') return;
    if (gate === 'reset') this.drop(from);
    switch (m.type) {
      case 'hello': return this.onHello(from, m);
      case 'hello-ack': return this.onAck(from, m);
      case 'offer': case 'answer': case 'ice': case 'renegotiate': {
        const l = this.links.get(from) ?? (m.type === 'offer' ? this.open(from, m.sid) : undefined);
        if (l) void l.pl.handle(m.type, m.data);
        return;
      }
      case 'hangup': this.drop(from); this.setRec(from, false); return;
      case 'rec': this.setRec(from, (m.data as { on?: boolean } | undefined)?.on === true); return;
      default: return; // live-* types belong to LiveBroadcast / LiveViewer
    }
  }

  private full(from: string): boolean {
    return !this.links.has(from) && this.links.size + 1 >= MEDIA.call.maxParticipants;
  }

  private onHello(from: string, m: SignalMsg): void {
    if (this.full(from)) { void this.send('hello-ack', { full: true }, from); return; }
    this.open(from, m.sid);
    void this.send('hello-ack', { rec: this.recorder !== null }, from);
  }

  private onAck(from: string, m: SignalMsg): void {
    if (!this.hellos.accepts(from, Date.now())) return;
    const d = m.data as { full?: boolean; rec?: boolean } | undefined;
    if (d?.full) {
      if (this.links.size > 0) return; // a room we are already in cannot be full for us
      this.emit('error', new MediaError('room-full', undefined, from));
      void this.leave();
      return;
    }
    this.open(from, m.sid);
    if (d?.rec) this.setRec(from, true);
  }

  private send(type: Parameters<Signaling['send']>[2], data: unknown, to?: string): Promise<void> {
    return this.sig.send(this.scope, this.sid, type, data, to).catch((e) => this.fail(toMediaError(e)));
  }

  private fail(e: MediaError): void {
    const now = Date.now();
    if (now - this.lastErr < ERROR_EVERY_MS) return;
    this.lastErr = now;
    this.emit('error', e);
  }

  // ---- links ----------------------------------------------------------------------------------

  private open(id: string, remoteSid: string): Link | undefined {
    const existing = this.links.get(id);
    if (existing) { existing.pl.remoteSid ??= remoteSid; return existing; }
    if (this.full(id)) return undefined;
    const pl = new PeerLink({
      peer: id,
      polite: isPolite(this.o.self, id),
      stun: MEDIA.stun,
      send: (type, data) => { void this.send(type, data, id); },
      onState: (s) => this.onPeerState(id, s),
      onTrack: (stream, track) => this.onRemoteTrack(id, stream, track),
      onError: (e) => this.fail(toMediaError(e)),
      reconnect: { graceMs: MEDIA.call.disconnectGraceMs, max: MEDIA.call.iceRestartMax, backoffMs: MEDIA.call.iceRestartBackoffMs },
    });
    pl.remoteSid = remoteSid;
    const a = this.local.audioTrack;
    const v = this.local.videoTrack;
    const audio = pl.pc.addTransceiver(a ?? 'audio', { direction: 'sendrecv', streams: [this.local.stream] });
    const video = pl.pc.addTransceiver(v ?? 'video', { direction: 'sendrecv', streams: [this.local.stream] });
    const link: Link = { id, pl, audio, video, stat: null, timeout: null };
    link.timeout = setTimeout(() => { if (pl.state !== 'connected') pl.fail(); }, MEDIA.call.connectTimeoutMs);
    this.links.set(id, link);
    this.rebalance();
    this.emitPeers();
    return link;
  }

  private drop(id: string): void {
    const l = this.links.get(id);
    if (!l) return;
    if (l.timeout) clearTimeout(l.timeout);
    l.pl.close();
    this.links.delete(id);
    this.monitor?.remove(id);
    this.recorder?.removeSource(id);
    this.emit('peers', this.peers());
    this.rebalance();
  }

  private onPeerState(id: string, s: PeerState): void {
    const l = this.links.get(id);
    if (!l) return;
    if (s === 'connected' || s === 'closed' || s === 'failed') { if (l.timeout) clearTimeout(l.timeout); l.timeout = null; }
    if (s === 'connected') this.rebalance();
    if (s === 'failed') this.emit('error', new MediaError('peer-unreachable', undefined, id));
    this.emitPeers();
  }

  private onRemoteTrack(id: string, stream: MediaStream, track: MediaStreamTrack): void {
    if (track.kind === 'audio') this.monitor?.add(id, stream, true);
    this.recorder?.addSource(id, stream);
    this.emit('stream', { id, stream });
    this.emitPeers();
  }

  private emitPeers(): void { this.emit('peers', this.peers()); }

  private async replaceTracks(audio: MediaStreamTrack | null, video: MediaStreamTrack | null): Promise<void> {
    if (audio) this.monitor?.add(this.o.self, this.local.stream);
    await Promise.all([...this.links.values()].flatMap((l) => [
      l.audio.sender.replaceTrack(audio).catch((e) => this.fail(toMediaError(e))),
      l.video.sender.replaceTrack(video).catch((e) => this.fail(toMediaError(e))),
    ]));
    this.rebalance();
  }

  private rebalance(): void {
    const bps = videoBitrate(this.links.size, this.local.sharing);
    for (const l of this.links.values()) {
      void capSender(l.video.sender, bps).catch(() => undefined);
      void capSender(l.audio.sender, MEDIA.call.audioBps).catch(() => undefined);
    }
  }

  private onLevels(levels: Levels): void {
    this.emit('levels', levels);
    const speaking = Object.entries(levels).filter(([, v]) => v.speaking);
    const next = speaking.some(([id]) => id === this.active) ? this.active
      : (speaking.sort((a, b) => b[1].level - a[1].level)[0]?.[0] ?? this.active);
    if (next !== this.active) { this.active = next; this.recorder?.setActive(next); this.emit('activeSpeaker', next); }
  }

  private async pollStats(): Promise<void> {
    const out: Record<string, PeerStats & { quality: Quality }> = {};
    await Promise.all([...this.links.values()].map(async (l) => {
      try {
        const cur = sampleFromReport(await l.pl.pc.getStats(), performance.now());
        l.stats = diffSamples(l.stat, cur);
        l.stat = cur;
        out[l.id] = { ...l.stats, quality: classify(l.stats, MEDIA.call.poorRttMs, MEDIA.call.poorLossPct) };
      } catch { /* connection closing */ }
    }));
    if (Object.keys(out).length) this.emit('stats', out);
  }
}
