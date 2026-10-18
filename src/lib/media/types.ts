import type { BlobRef, SignalEvent } from '../bridge/types';

/** Ephemeral gossip event (src-tauri emits `hermod://ephemeral`); payload is already JSON-decoded by Rust. */
export interface EphemeralEvent { from: string; space_id?: string; kind: string; payload: unknown }

/** The slice of Bridge the media engine uses. `mediaBridgeFrom` builds it from a real Bridge. */
export interface MediaBridge {
  mediaSignal(spaceId: string, payload: unknown, to?: string): Promise<void>;
  sendEphemeral(spaceId: string, kind: string, payload: unknown): Promise<void>;
  blobPutBytes(name: string, bytes: Uint8Array): Promise<BlobRef>;
  blobUrl(hash: string): string;
  onSignal(handler: (e: SignalEvent) => void): () => void;
  onEphemeral(handler: (e: EphemeralEvent) => void): () => void;
}

export type PeerState = 'new' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface PeerStats {
  /** Round trip time of the selected candidate pair, ms. */
  rttMs: number | null;
  /** Inbound and outbound media bitrate, bits per second, over the last interval. */
  inBps: number;
  outBps: number;
  /** Inbound packet loss over the last interval, percent. */
  lossPct: number;
}

export type Quality = 'good' | 'poor' | 'unknown';

export interface Level { level: number; speaking: boolean }
export type Levels = Record<string, Level>;

export interface DeviceList { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }
