'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MEDIA } from '../../../config/media';
import { MediaError, toMediaError } from '../errors';
import { LiveBroadcast, type LiveSource } from '../liveHost';
import { LiveViewer, type ViewerState } from '../liveViewer';
import { mediaBridge, useSelf } from './useSelf';

export interface LiveView {
  role: 'host' | 'viewer';
  state: ViewerState | 'idle' | 'live' | 'ended';
  /** Host: local preview. Viewer: the stream to play. */
  stream: MediaStream | null;
  viewers: { viewers: number; max: number; full: boolean };
  error: MediaError | null;
  start(source: LiveSource): Promise<void>;
  stop(): Promise<void>;
  join(): Promise<void>;
  leave(): Promise<void>;
  sendHearts(n?: number): void;
  /** Subscribe to heart bursts (own hearts included for viewers); returns unsubscribe. Not state, so bursts do not re-render. */
  onHearts(fn: (h: { from: string; n: number }) => void): () => void;
}

export interface LiveHookOptions {
  space: string | null;
  /** Broadcaster user id (viewers only; media.live.host). */
  host?: string;
}

/** Host or viewer of one live stream. Cleans up links and devices on unmount. */
export function useLive(liveId: string | null, role: 'host' | 'viewer', o: LiveHookOptions): LiveView {
  const self = useSelf();
  const hostRef = useRef<LiveBroadcast | null>(null);
  const viewRef = useRef<LiveViewer | null>(null);
  const heartFns = useRef(new Set<(h: { from: string; n: number }) => void>());
  const [state, setState] = useState<LiveView['state']>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [viewers, setViewers] = useState<LiveView['viewers']>({ viewers: 0, max: MEDIA.live.maxViewers, full: false });
  const [error, setError] = useState<MediaError | null>(null);

  const closeAll = useCallback(async () => {
    const h = hostRef.current; const v = viewRef.current;
    hostRef.current = null; viewRef.current = null;
    await Promise.all([h?.stop(), v?.leave()]);
    setState('idle'); setStream(null);
  }, []);

  useEffect(() => () => { void closeAll(); }, [liveId, role, o.space, closeAll]);

  const fire = useCallback((h: { from: string; n: number }) => heartFns.current.forEach((f) => f(h)), []);

  const start = useCallback(async (source: LiveSource) => {
    if (role !== 'host' || !liveId || !o.space || !self || hostRef.current) return;
    setError(null);
    const b = new LiveBroadcast({ bridge: mediaBridge(), space: o.space, liveId, self });
    hostRef.current = b;
    b.on('viewers', (c) => setViewers({ viewers: c.viewers, max: c.max, full: c.full }));
    b.on('hearts', fire);
    b.on('error', setError);
    b.on('closed', () => { if (hostRef.current === b) { hostRef.current = null; setState('ended'); setStream(null); } });
    try {
      setStream(await b.start(source));
      setState('live');
      setViewers({ viewers: 0, max: b.capacity().max, full: false });
    } catch (e) {
      hostRef.current = null;
      setError(toMediaError(e));
    }
  }, [role, liveId, o.space, self, fire]);

  const join = useCallback(async () => {
    if (role !== 'viewer' || !liveId || !o.space || !self || !o.host || viewRef.current) return;
    setError(null);
    const v = new LiveViewer({ bridge: mediaBridge(), space: o.space, liveId, self, host: o.host });
    viewRef.current = v;
    v.on('state', setState);
    v.on('stream', () => setStream(v.stream));
    v.on('viewers', (c) => setViewers({ viewers: c.viewers, max: c.max, full: c.full }));
    v.on('hearts', fire);
    v.on('error', setError);
    v.on('closed', () => { if (viewRef.current === v) viewRef.current = null; });
    try { await v.join(); } catch (e) { viewRef.current = null; setError(toMediaError(e)); }
  }, [role, liveId, o.space, o.host, self, fire]);

  return {
    role, state, stream, viewers, error,
    start, stop: closeAll, join, leave: closeAll,
    sendHearts: (n = 1) => viewRef.current?.sendHearts(n),
    onHearts: (fn) => { heartFns.current.add(fn); return () => { heartFns.current.delete(fn); }; },
  };
}
