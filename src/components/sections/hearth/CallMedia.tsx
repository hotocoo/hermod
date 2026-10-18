'use client';
import { useEffect, useRef } from 'react';
import { useCall } from '@/lib/media/hooks/useCall';
import { useSelf } from '@/lib/media/hooks/useSelf';
import { useMediaRt } from '@/state/mediaRt';
import { useAppStore } from '@/state/store';

/**
 * The call's media session. Mounted by TownRoot for as long as `call` is set (so browsing away keeps the call alive; unmounting leaves it).
 * Joins on mount, publishes streams to `useMediaRt` for the tiles, and drives the speaking ring from real audio levels.
 */
export function CallMedia({ space, room }: { space: string; room: string }) {
  const self = useSelf();
  const c = useCall(space, room ? `voice-${room}` : 'hearth');
  const { join, joined, joining, error, peers, localStream, activeSpeaker, recordingBy } = c;
  const shown = useRef<unknown>(null);

  useEffect(() => { void join({ audio: true, video: false }); }, [join]);

  useEffect(() => {
    const streams: Record<string, MediaStream> = {};
    for (const p of peers) streams[p.id] = p.stream;
    if (self && localStream) streams[self] = localStream;
    useMediaRt.setState({ streams, recordingBy });
    return () => useMediaRt.setState({ streams: {}, recordingBy: [] });
  }, [peers, localStream, self, recordingBy]);

  useEffect(() => { useAppStore.getState().setSpeaking(activeSpeaker); }, [activeSpeaker]);

  useEffect(() => {
    if (!error || shown.current === error) return;
    shown.current = error;
    useAppStore.getState().showToast(error.message, undefined, 'error');
    // A call that never connected must not leave the room looking joined.
    if (!joined && !joining) void useAppStore.getState().leave();
  }, [error, joined, joining]);

  return null;
}
