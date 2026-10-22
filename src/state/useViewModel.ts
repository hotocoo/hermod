'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from './store';
import { AMBIENT_MS, classifyChange } from './viewChange';
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

/** The template's view model for the current store state (ambient sky ticks are rate limited, everything else updates at once). */
export function useViewModel() {
  const [state, setState] = useState(() => useAppStore.getState());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => { timer = null; setState(useAppStore.getState()); };
    const unsub = useAppStore.subscribe((s, p) => {
      const kind = classifyChange(s, p);
      if (kind === 'now') { if (timer) { clearTimeout(timer); timer = null; } setState(s); } else if (kind === 'ambient' && !timer) timer = setTimeout(flush, AMBIENT_MS);
    });
    flush();
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);
  const viewport = useViewport();
  return useMemo(() => (state.seed ? selectViewModel(state, state.seed, { viewport }) : loadingViewModel()), [state, viewport]);
}
