'use client';
import { useEffect } from 'react';

import { getBridge } from '@/lib/bridge';
import { getMount, getOverlay } from '@/state/domRefs';
import { startBridgeSync } from '@/state/bridgeSync';
import { useAppStore } from '@/state/store';
import { attachKeyboard, attachTown, startShell, startTimers, townHandlers } from '@/state/townSync';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Walk the gates (Terms, profile, create/join), then start the app controllers and build the 3D town once the mount node exists. */
export function useAppBoot(): void {
  const live = useAppStore((s) => s.phase === 'app' && !!s.seed);

  useEffect(() => {
    // Deep links can arrive while a gate is still open, so listen from the very start.
    const off = getBridge().on('deeplink', (e) => useAppStore.getState().onDeeplink(e.code));
    void useAppStore.getState().boot();
    return off;
  }, []);

  useEffect(() => {
    if (!live) return;
    void useAppStore.getState().loadMessaging();
    const cleanups = [startShell(useAppStore), attachKeyboard(useAppStore), startTimers(useAppStore), startBridgeSync(useAppStore)];
    let detachTown: (() => void) | null = null;
    let cancelled = false;
    const mount = getMount();
    if (mount) {
      import('@/scene/town')
        .then(({ createTown }) => createTown({
          ...townHandlers(useAppStore),
          mount,
          overlay: getOverlay(),
          reduced: window.matchMedia(REDUCED_MOTION).matches,
        }))
        .then((town) => {
          if (cancelled) { town.dispose(); return; }
          detachTown = attachTown(town, useAppStore);
        })
        .catch((e) => { console.error('Town failed', e); useAppStore.getState().setTownStatus('error'); });
    } else {
      useAppStore.getState().setTownStatus('error');
    }
    return () => { cancelled = true; detachTown?.(); cleanups.forEach((c) => c()); };
  }, [live]);
}
