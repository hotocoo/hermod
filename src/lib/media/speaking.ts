import { MEDIA } from '../../config/media';
import type { Levels } from './types';

/** Root-mean-square of a time-domain buffer in -1..1. */
export function rms(buf: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
  return buf.length ? Math.sqrt(sum / buf.length) : 0;
}

/** Hysteresis plus hold time so the speaking ring does not flicker on word gaps. */
export class SpeakingDetector {
  private speaking = false;
  private lastLoud = -Infinity;
  constructor(private readonly cfg: { onThreshold: number; offThreshold: number; holdMs: number } = MEDIA.speaking) {}

  update(level: number, now: number): boolean {
    if (level >= this.cfg.onThreshold || (this.speaking && level >= this.cfg.offThreshold)) this.lastLoud = now;
    this.speaking = now - this.lastLoud <= this.cfg.holdMs;
    return this.speaking;
  }
}

interface Tap { pin: HTMLAudioElement | null; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer>; detector: SpeakingDetector }

/** Real audio levels per participant from WebAudio analysers (not guessed from signalling). */
export class LevelMonitor {
  private taps = new Map<string, Tap>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = '';

  constructor(private readonly ctx: AudioContext, private readonly onLevels: (l: Levels) => void) {}

  /**
   * Starts metering `stream`. Remote WebRTC audio only feeds an analyser in Chromium while the stream is also attached to a media
   * element, so remote streams (`remote = true`) get a muted hidden element; the app plays the audible one.
   */
  add(id: string, stream: MediaStream, remote = false): void {
    this.remove(id);
    if (!stream.getAudioTracks().length) return;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = MEDIA.speaking.fftSize;
    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(analyser); // analysers need no destination connection, so there is no local echo
    let pin: HTMLAudioElement | null = null;
    if (remote) { pin = new Audio(); pin.muted = true; pin.srcObject = stream; void pin.play().catch(() => undefined); }
    this.taps.set(id, { pin, source, analyser, buf: new Float32Array(analyser.fftSize), detector: new SpeakingDetector() });
    this.timer ??= setInterval(() => this.tick(), MEDIA.speaking.pollMs);
  }

  remove(id: string): void {
    const t = this.taps.get(id);
    if (!t) return;
    t.source.disconnect();
    if (t.pin) t.pin.srcObject = null;
    this.taps.delete(id);
    if (!this.taps.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private tick(): void {
    const now = performance.now();
    const out: Levels = {};
    for (const [id, t] of this.taps) {
      t.analyser.getFloatTimeDomainData(t.buf);
      const level = rms(t.buf);
      out[id] = { level: Math.min(1, Math.round(level * 6 * 100) / 100), speaking: t.detector.update(level, now) };
    }
    const key = JSON.stringify(out);
    if (key === this.last) return;
    this.last = key;
    this.onLevels(out);
  }

  dispose(): void {
    for (const id of [...this.taps.keys()]) this.remove(id);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
