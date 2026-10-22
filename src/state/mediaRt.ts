/** Runtime media view (live MediaStreams, counts, hooks to stop a broadcast): not persisted, not part of the snapshot, so outside AppStore. */
import { create } from 'zustand';
import type { Quality } from '../lib/media/types';

export interface LiveCounts { viewers: number; max: number; full: boolean }

export interface MediaRt {
  /** User id to the stream carrying that person's audio and video (own id: local preview). */
  streams: Record<string, MediaStream>;
  recordingBy: string[];
  /** Link quality per remote user (from call stats). */
  quality: Record<string, Quality>;
  /** Ephemeral room signals by user id: raised hand, and the reaction currently showing. */
  hands: Record<string, boolean>;
  reactions: Record<string, string>;
  /** This session started this live (never inferred from the snapshot, so a restart does not reopen the camera). */
  hosting: { liveId: string; space: string } | null;
  liveStream: MediaStream | null;
  liveCounts: LiveCounts;
  /** Total hearts seen while hosting. */
  hearts: number;
  stopLive: (() => Promise<void>) | null;
}

export const useMediaRt = create<MediaRt>()(() => ({
  streams: {}, recordingBy: [], quality: {}, hands: {}, reactions: {}, hosting: null, liveStream: null, liveCounts: { viewers: 0, max: 0, full: false }, hearts: 0, stopLive: null,
}));
