'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallSession, type PeerInfo } from '../call';
import { MediaError, toMediaError } from '../errors';
import { setActiveCall } from '../registry';
import type { Levels, PeerStats, Quality } from '../types';
import { mediaBridge, useSelf } from './useSelf';

export interface CallView {
  joined: boolean;
  joining: boolean;
  peers: PeerInfo[];
  levels: Levels;
  activeSpeaker: string | null;
  stats: Record<string, PeerStats & { quality: Quality }>;
  muted: boolean;
  camOn: boolean;
  sharing: boolean;
  /** User ids currently recording (show REC while non-empty). */
  recordingBy: string[];
  /** Your own preview stream (muted element). */
  localStream: MediaStream | null;
  error: MediaError | null;
  session: CallSession | null;
  join(o?: { audio?: boolean; video?: boolean }): Promise<void>;
  leave(): Promise<void>;
  setMuted(m: boolean): void;
  setCamera(on: boolean): Promise<void>;
  setScreenShare(on: boolean): Promise<void>;
  startRecording(): Promise<void>;
  /** Stops and returns the file for the caller to store (see saveRecording). */
  stopRecording(): Promise<{ blob: Blob; mime: string } | null>;
}

/** React binding of CallSession for one Hearth room. Leaves (stops tracks, closes peers) on unmount or when space/room change. */
export function useCall(space: string | null, room: string | null): CallView {
  const self = useSelf();
  const ref = useRef<CallSession | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [levels, setLevels] = useState<Levels>({});
  const [active, setActive] = useState<string | null>(null);
  const [stats, setStats] = useState<CallView['stats']>({});
  const [flags, setFlags] = useState({ muted: false, camOn: false, sharing: false });
  const [rec, setRec] = useState<string[]>([]);
  const [session, setSession] = useState<CallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<MediaError | null>(null);

  const reset = useCallback(() => {
    setJoined(false); setJoining(false); setPeers([]); setLevels({}); setActive(null); setStats({}); setRec([]); setSession(null); setLocalStream(null);
    setFlags({ muted: false, camOn: false, sharing: false });
  }, []);

  const leave = useCallback(async () => {
    const s = ref.current;
    ref.current = null;
    setActiveCall(null);
    await s?.leave();
    reset();
  }, [reset]);

  useEffect(() => () => { void leave(); }, [space, room, leave]);

  const join = useCallback(async (o: { audio?: boolean; video?: boolean } = {}) => {
    if (!space || !room || !self || ref.current) return;
    setError(null);
    setJoining(true);
    const s = new CallSession({ bridge: mediaBridge(), space, room, self, ...o });
    ref.current = s;
    setSession(s);
    s.on('peers', setPeers);
    s.on('levels', setLevels);
    s.on('activeSpeaker', setActive);
    s.on('stats', setStats);
    s.on('recording', () => setRec(s.recordingBy()));
    s.on('error', setError);
    s.on('tracks', () => { setLocalStream(s.local.stream ?? null); setFlags((f) => ({ ...f, camOn: s.local.camOn, sharing: s.local.sharing })); });
    s.on('closed', () => { if (ref.current === s) { ref.current = null; setActiveCall(null); reset(); } });
    try {
      await s.join();
      setActiveCall(s);
      setJoined(true);
      setLocalStream(s.local.stream ?? null);
      setFlags({ muted: s.local.muted, camOn: s.local.camOn, sharing: s.local.sharing });
    } catch (e) {
      if (ref.current === s) { ref.current = null; setSession(null); }
      setError(toMediaError(e));
    } finally {
      setJoining(false);
    }
  }, [space, room, self, reset]);

  return {
    joined, joining, peers, levels, activeSpeaker: active, stats, ...flags, recordingBy: rec,
    localStream, error, session,
    join, leave,
    setMuted: (m) => { ref.current?.setMuted(m); setFlags((f) => ({ ...f, muted: m })); },
    setCamera: async (on) => { try { await ref.current?.setCamera(on); setFlags((f) => ({ ...f, camOn: on })); } catch (e) { setError(toMediaError(e)); } },
    setScreenShare: async (on) => { try { await ref.current?.setScreenShare(on); setFlags((f) => ({ ...f, sharing: on })); } catch (e) { setError(toMediaError(e)); } },
    startRecording: async () => { try { await ref.current?.startRecording(); } catch (e) { setError(toMediaError(e)); } },
    stopRecording: async () => { try { return (await ref.current?.stopRecording()) ?? null; } catch (e) { setError(toMediaError(e)); return null; } },
  };
}
