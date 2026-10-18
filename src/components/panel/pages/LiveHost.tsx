'use client';
import { useEffect } from 'react';
import { useLive } from '@/lib/media/hooks/useLive';
import { useMediaRt } from '@/state/mediaRt';
import { useAppStore } from '@/state/store';

/** Broadcasts the camera for a live this session started. Mounted by TownRoot while `hosting` is set, so the stream outlives the Live tab. */
export function LiveHost({ liveId, space }: { liveId: string; space: string }) {
  const l = useLive(liveId, 'host', { space });
  const { start, stop, onHearts, stream, viewers, error } = l;

  useEffect(() => { void start('camera'); }, [start]);
  useEffect(() => onHearts((h) => useMediaRt.setState((s) => ({ hearts: s.hearts + h.n }))), [onHearts]);
  useEffect(() => {
    useMediaRt.setState({ liveStream: stream, liveCounts: viewers, stopLive: stop });
    return () => useMediaRt.setState({ liveStream: null, stopLive: null });
  }, [stream, viewers, stop]);
  useEffect(() => {
    if (!error) return;
    useAppStore.getState().showToast(error.message, undefined, 'error');
    void useAppStore.getState().endLive();
  }, [error]);
  return null;
}
