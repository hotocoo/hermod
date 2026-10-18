'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from './store';
import { loadingViewModel, selectViewModel, type VmProps } from './viewModel';

const SSR_VIEWPORT = { w: 1440, h: 900 };

/** Viewport size, updated on resize (replaces the prototype's resize forceUpdate). */
export function useViewport(): VmProps['viewport'] {
  const [vp, setVp] = useState(SSR_VIEWPORT);
  useEffect(() => {
    let raf = 0; const read = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const w = window.innerWidth, h = window.innerHeight; setVp((v) => (v.w === w && v.h === h ? v : { w, h })); }); };
    read();
    window.addEventListener('resize', read);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', read); };
  }, []);
  return vp;
}

/** Keys the scene updates continuously (sky clock); a change touching only these is coalesced instead of re-rendering immediately. */
const AMBIENT = new Set(['hour', 'period', 'night']);
const AMBIENT_MS = 250;

/** The template's view model for the current store state (ambient sky ticks are rate limited, everything else updates at once). */
export function useViewModel() {
  const [state, setState] = useState(() => useAppStore.getState());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => { timer = null; setState(useAppStore.getState()); };
    const unsub = useAppStore.subscribe((s, p) => {
      let onlyAmbient = true;
      for (const k in s) if ((s as unknown as Record<string, unknown>)[k] !== (p as unknown as Record<string, unknown>)[k] && !AMBIENT.has(k)) { onlyAmbient = false; break; }
      if (!onlyAmbient) { if (timer) { clearTimeout(timer); timer = null; } setState(s); } else if (!timer) timer = setTimeout(flush, AMBIENT_MS);
    });
    flush();
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);
  const viewport = useViewport();
  return useMemo(() => (state.seed ? selectViewModel(state, state.seed, { viewport }) : loadingViewModel()), [state, viewport]);
}
