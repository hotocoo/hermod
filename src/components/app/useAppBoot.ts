'use client';
import { useEffect, useState } from 'react';

import { getBridge } from '@/lib/bridge';
import { getMount, getOverlay } from '@/state/domRefs';
import { startBridgeSync } from '@/state/bridgeSync';
import { startPresence } from '@/state/presenceSend';
import { useAppStore } from '@/state/store';
import { attachKeyboard, attachTown, startShell, startTimers, townHandlers } from '@/state/townSync';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** Last update version already offered, so the prompt shows once per release. */
const UPDATE_OFFERED_KEY = 'hermod.updateOffered';

/** Open Settings > Updates when GitHub has a newer stable release than this install. */
function offerUpdate(isCancelled: () => boolean): void {
  const bridge = getBridge();
  if (bridge.kind !== 'tauri') return; // the devhost has no updater
  bridge.updateCheck().then((u) => {
    // Never replace a dialog the user has open; the next launch offers again.
    if (isCancelled() || !u.available || !u.version || useAppStore.getState().modal) return;
    try { if (localStorage.getItem(UPDATE_OFFERED_KEY) === u.version) return; } catch { /* no storage: offer every launch */ }
    useAppStore.getState().openModal({ kind: 'appSettings', tab: 'updates' });
    try { localStorage.setItem(UPDATE_OFFERED_KEY, u.version); } catch { /* no storage */ }
  }).catch((e) => console.warn('update check failed', e)); // offline: Settings > Updates can retry
}

/** Walk the gates (Terms, profile, create/join), then start the app controllers and build the 3D town once the mount node exists. */
export function useAppBoot(): void {
  const live = useAppStore((s) => s.phase === 'app' && !!s.seed);
  const motion = useAppStore((s) => s.motion);
  // T-017: the OS flag is watched, not just read once, so changing the system setting rebuilds
  // the scene without a reload; the W-006 override rebuilds through the same dependency.
  const [mqReduce, setMqReduce] = useState(() => window.matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION);
    const on = () => setMqReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const reducedNow = motion === 'reduce' || (motion === 'system' && mqReduce);

  useEffect(() => {
    // Deep links can arrive while a gate is still open, so listen from the very start.
    const bridge = getBridge();
    const off = bridge.on('deeplink', (e) => useAppStore.getState().onDeeplink(e.code));
    // A cold-start link fired before this listener existed; Rust kept it for this one read.
    bridge.deeplinkPending()
      .then((code) => { if (code) useAppStore.getState().onDeeplink(code); })
      .catch((e) => console.warn('pending deep link unavailable', e));
    void useAppStore.getState().boot();
    return off;
  }, []);

  useEffect(() => {
    if (!live) return;
    void useAppStore.getState().loadMessaging();
    const cleanups = [startShell(useAppStore), attachKeyboard(useAppStore), startTimers(useAppStore), startBridgeSync(useAppStore), startPresence(useAppStore)];
    let detachTown: (() => void) | null = null;
    let cancelled = false;
    offerUpdate(() => cancelled);
    const mount = getMount();
    if (mount) {
      import('@/scene/town')
        .then(({ createTown }) => createTown({
          ...townHandlers(useAppStore),
          mount,
          overlay: getOverlay(),
          reduced: reducedNow,
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
    // reducedNow in the deps: an OS flag flip or a W-006 override rebuilds the scene with the new flag.
  }, [live, reducedNow]);
}
