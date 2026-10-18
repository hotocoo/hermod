import { MEDIA } from '../../config/media';
import { Emitter } from './emitter';
import { MediaError, toMediaError } from './errors';
import type { DeviceList } from './types';

export interface LocalEvents {
  /** Outgoing audio or video track changed (device swap, cam on/off, screen share). Senders must replaceTrack. */
  tracks: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null };
  devices: DeviceList;
  /** The selected mic or camera disappeared; capture fell back to the default device. */
  fallback: { kind: 'audio' | 'video' };
  error: MediaError;
}

export type DeviceSelection = { micId?: string; camId?: string };

/** Pure: true when the chosen device id is no longer present (so capture must fall back). */
export const deviceGone = (list: MediaDeviceInfo[], id: string | undefined): boolean => !!id && id !== 'default' && !list.some((d) => d.deviceId === id);

const exact = (id?: string) => (id ? { deviceId: { exact: id } } : {});

/**
 * Local capture: mic, camera, screen share, device enumeration and hot-swap.
 * `stream` is a stable MediaStream for the self view; tracks inside it follow the current devices.
 */
export class LocalMedia extends Emitter<LocalEvents> {
  readonly stream = new MediaStream();
  micId: string | undefined;
  camId: string | undefined;
  speakerId: string | undefined;
  muted = false;
  private mic: MediaStreamTrack | null = null;
  private cam: MediaStreamTrack | null = null;
  private screen: MediaStreamTrack | null = null;
  private stopped = false;
  private readonly onDeviceChange = () => { void this.refreshDevices(); };

  constructor() {
    super();
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
  }

  get audioTrack(): MediaStreamTrack | null { return this.mic; }
  /** What peers should see: the screen when sharing, else the camera. */
  get videoTrack(): MediaStreamTrack | null { return this.screen ?? this.cam; }
  get camOn(): boolean { return !!this.cam; }
  get sharing(): boolean { return !!this.screen; }

  private requireMedia(): MediaDevices {
    if (!navigator.mediaDevices?.getUserMedia) throw new MediaError('unsupported');
    return navigator.mediaDevices;
  }

  async devices(): Promise<DeviceList> {
    const all = (await this.requireMedia().enumerateDevices()).filter((d) => d.deviceId);
    return { mics: all.filter((d) => d.kind === 'audioinput'), cams: all.filter((d) => d.kind === 'videoinput'), speakers: all.filter((d) => d.kind === 'audiooutput') };
  }

  private async refreshDevices(): Promise<void> {
    if (this.stopped) return;
    try {
      const list = await this.devices();
      this.emit('devices', list);
      if (this.mic && deviceGone(list.mics, this.micId)) { this.micId = undefined; await this.startAudio(); this.emit('fallback', { kind: 'audio' }); }
      if (this.cam && deviceGone(list.cams, this.camId)) { this.camId = undefined; await this.startVideo(); this.emit('fallback', { kind: 'video' }); }
    } catch (e) {
      this.emit('error', toMediaError(e));
    }
  }

  /** One track of `kind`; a vanished chosen device falls back to the default one. */
  private async capture(kind: 'audio' | 'video', id: string | undefined): Promise<MediaStreamTrack> {
    const base = kind === 'audio' ? MEDIA.call.audio : MEDIA.call.video;
    try {
      const s = await this.requireMedia().getUserMedia({ [kind]: { ...base, ...exact(id) } });
      return s.getTracks()[0];
    } catch (e) {
      if (id && (e as { name?: string })?.name === 'OverconstrainedError') {
        if (kind === 'audio') this.micId = undefined; else this.camId = undefined;
        return this.capture(kind, undefined);
      }
      throw toMediaError(e);
    }
  }

  private swap(kind: 'audio' | 'video', next: MediaStreamTrack | null): void {
    const prev = kind === 'audio' ? this.mic : this.cam;
    if (prev) { prev.onended = null; prev.stop(); this.stream.removeTrack(prev); }
    if (kind === 'audio') this.mic = next; else this.cam = next;
    if (next) {
      if (kind === 'audio') next.enabled = !this.muted;
      next.onended = () => { void this.refreshDevices(); };
      if (!this.screen || kind === 'audio') this.stream.addTrack(next);
    }
    this.publish();
  }

  private publish(): void { this.emit('tracks', { audio: this.mic, video: this.videoTrack }); }

  /** Starts or hot-swaps the microphone. */
  async startAudio(deviceId?: string): Promise<void> {
    if (deviceId !== undefined) this.micId = deviceId;
    const track = await this.capture('audio', this.micId);
    if (this.stopped) { track.stop(); return; }
    this.swap('audio', track);
  }

  /** Starts or hot-swaps the camera. */
  async startVideo(deviceId?: string): Promise<void> {
    if (deviceId !== undefined) this.camId = deviceId;
    const track = await this.capture('video', this.camId);
    if (this.stopped) { track.stop(); return; }
    if (this.screen) { // camera stays off the wire while sharing; keep it ready for when sharing ends
      this.cam?.stop();
      this.cam = track;
      return;
    }
    this.swap('video', track);
  }

  /** Camera off: the track is stopped so the camera light goes out. */
  stopVideo(): void {
    this.swap('video', null);
  }

  /** Mic mute keeps the track and sends silence (instant unmute, no permission prompt). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.mic) this.mic.enabled = !muted;
  }

  async startScreen(): Promise<void> {
    const md = navigator.mediaDevices;
    if (!md?.getDisplayMedia) throw new MediaError('unsupported');
    let track: MediaStreamTrack;
    try { track = (await md.getDisplayMedia({ video: true, audio: false })).getVideoTracks()[0]; } catch (e) { throw toMediaError(e); }
    if (this.stopped) { track.stop(); return; }
    if (this.screen) this.screen.stop();
    if (this.cam) this.stream.removeTrack(this.cam);
    this.screen = track;
    this.stream.addTrack(track);
    track.onended = () => this.stopScreen();
    this.publish();
  }

  stopScreen(): void {
    const s = this.screen;
    if (!s) return;
    s.onended = null;
    s.stop();
    this.stream.removeTrack(s);
    this.screen = null;
    if (this.cam) this.stream.addTrack(this.cam);
    this.publish();
  }

  /** Releases every device. The instance cannot be reused. */
  stop(): void {
    this.stopped = true;
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    for (const t of [this.mic, this.cam, this.screen]) { if (t) { t.onended = null; t.stop(); } }
    this.mic = this.cam = this.screen = null;
    for (const t of this.stream.getTracks()) this.stream.removeTrack(t);
    this.clearListeners();
  }
}

/** Routes an element's audio to a speaker (Chromium and Safari 18+; silently ignored elsewhere). */
export async function applySink(el: HTMLMediaElement, deviceId: string | undefined): Promise<void> {
  const e = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (e.setSinkId && deviceId) await e.setSinkId(deviceId);
}
