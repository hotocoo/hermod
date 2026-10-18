import { MEDIA } from '../../config/media';
import { MediaError } from './errors';

/** First MediaRecorder container this browser supports, or null. */
export function recordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MEDIA.record.mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

interface Source { stream: MediaStream; video: HTMLVideoElement | null; node: MediaStreamAudioSourceNode | null }

/**
 * Records the whole call locally: every audio stream mixed through WebAudio plus the active speaker's video drawn
 * to a canvas. Nothing leaves the device; the caller stores the resulting Blob (bridge.blobPutBytes) if it wants.
 * Drawing runs on a timer, so browsers may throttle it while the tab is hidden (audio keeps recording).
 */
export class CallRecorder {
  private readonly dest: MediaStreamAudioDestinationNode;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly sources = new Map<string, Source>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private active: string | null = null;
  private mime: string;

  constructor(private readonly ctx: AudioContext) {
    const mime = recordingMime();
    const g = this.canvas.getContext('2d');
    if (!mime || !g) throw new MediaError('recording-unsupported');
    this.mime = mime;
    this.g = g;
    this.canvas.width = MEDIA.record.width;
    this.canvas.height = MEDIA.record.height;
    this.dest = ctx.createMediaStreamDestination();
  }

  /** Starts recording. `self` is the local stream (its audio is mixed in, its video is a fallback picture). */
  start(selfId: string, self: MediaStream): void {
    this.addSource(selfId, self);
    const out = new MediaStream([...this.canvas.captureStream(MEDIA.record.fps).getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    this.recorder = new MediaRecorder(out, { mimeType: this.mime, videoBitsPerSecond: MEDIA.record.videoBps, audioBitsPerSecond: MEDIA.record.audioBps });
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(MEDIA.record.timesliceMs);
    this.timer = setInterval(() => this.draw(), 1000 / MEDIA.record.fps);
  }

  addSource(id: string, stream: MediaStream): void {
    this.removeSource(id);
    const node = stream.getAudioTracks().length ? this.ctx.createMediaStreamSource(stream) : null;
    node?.connect(this.dest);
    let video: HTMLVideoElement | null = null;
    if (stream.getVideoTracks().length) {
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
    this.sources.set(id, { stream, video, node });
  }

  removeSource(id: string): void {
    const s = this.sources.get(id);
    if (!s) return;
    s.node?.disconnect();
    if (s.video) { s.video.srcObject = null; }
    this.sources.delete(id);
  }

  /** Active speaker whose video is drawn. */
  setActive(id: string | null): void { this.active = id; }

  private pick(): HTMLVideoElement | null {
    const live = (s?: Source) => (s?.video && s.stream.getVideoTracks().some((t) => t.readyState === 'live') ? s.video : null);
    const preferred = live(this.active ? this.sources.get(this.active) : undefined);
    if (preferred) return preferred;
    for (const s of this.sources.values()) { const v = live(s); if (v) return v; }
    return null;
  }

  private draw(): void {
    const { width: W, height: H } = this.canvas;
    this.g.fillStyle = '#111';
    this.g.fillRect(0, 0, W, H);
    const v = this.pick();
    if (!v || !v.videoWidth) return;
    const k = Math.min(W / v.videoWidth, H / v.videoHeight);
    const w = v.videoWidth * k;
    const h = v.videoHeight * k;
    this.g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
  }

  /** Stops and returns the recording. */
  stop(): Promise<Blob> {
    const rec = this.recorder;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const done = new Promise<Blob>((resolve) => {
      if (!rec || rec.state === 'inactive') { resolve(new Blob(this.chunks, { type: this.mime })); return; }
      rec.onstop = () => resolve(new Blob(this.chunks, { type: this.mime }));
      rec.stop();
    });
    return done.finally(() => {
      for (const id of [...this.sources.keys()]) this.removeSource(id);
      this.dest.disconnect();
      this.chunks = [];
    });
  }

  get mimeType(): string { return this.mime; }
}
