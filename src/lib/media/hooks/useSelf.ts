'use client';
import { useEffect, useState } from 'react';
import { getBridge } from '../../bridge';
import { mediaBridgeFrom } from '../bridge';
import type { MediaBridge } from '../types';

let selfPromise: Promise<string> | null = null;

/** Own user id (identity_get), cached for the page's lifetime. */
export const loadSelf = (): Promise<string> => (selfPromise ??= getBridge().identityGet().then((i) => i.user_id).catch((e) => { selfPromise = null; throw e; }));

export const mediaBridge = (): MediaBridge => mediaBridgeFrom(getBridge());

export function useSelf(): string | null {
  const [self, setSelf] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadSelf().then((id) => { if (live) setSelf(id); }).catch((e) => console.error('identity_get failed', e));
    return () => { live = false; };
  }, []);
  return self;
}
