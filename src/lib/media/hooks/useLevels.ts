'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { activeCall, subscribeActiveCall } from '../registry';
import type { Levels } from '../types';

const NONE: Levels = {};

/** Real audio levels (user id to { level 0..1, speaking }) of the active call, from WebAudio analysers. Empty when not in a call. */
export function useLevels(): Levels {
  const call = useSyncExternalStore(subscribeActiveCall, activeCall, () => null);
  const [levels, setLevels] = useState<Levels>(NONE);
  useEffect(() => {
    if (!call) return;
    const off = call.on('levels', setLevels);
    return () => { off(); setLevels(NONE); };
  }, [call]);
  return levels;
}
