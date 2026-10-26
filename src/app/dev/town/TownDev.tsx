'use client';
// Full town (both map styles) without a backend. Query: ?style=village|sanctuary&tier=1..5&hour=0..24&houses=N&q=low|medium|high|ultra&level=1..3
import { useEffect, useRef } from 'react';
import type { SectionId } from '@/lib/data/types';

declare global { interface Window { __town?: { api: import('@/scene/types').TownApi; ready: boolean; error?: string } } }

const SECTIONS: SectionId[] = ['hearth', 'chat', 'feed', 'board', 'skein', 'desk', 'arcade'];

export default function TownDev() {
  const mount = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false; let dispose: (() => void) | null = null;
    (async () => {
      const { createTown } = await import('@/scene/town');
      const { GROWTH } = await import('@/config/scene');
      if (dead || !mount.current) return;
      const qs = new URLSearchParams(window.location.search);
      const tier = Math.min(5, Math.max(1, Number(qs.get('tier') ?? 1))); const n = Number(qs.get('houses') ?? [0, 4, 12, 24, 40][tier - 1]);
      const level = Math.min(3, Math.max(1, Number(qs.get('level') ?? Math.min(3, tier))));
      const style = qs.get('style'); if (style === 'village' || style === 'sanctuary') { try { window.localStorage.setItem('hermod.mapStyle', style); } catch { /* blocked */ } }
      try {
        const api = await createTown({ mount: mount.current, overlay: overlay.current, reduced: qs.get('motion') !== '1' });
        const q = qs.get('q'); if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') api.setQuality(q);
        const buildings = Object.fromEntries(SECTIONS.map((s) => [s, level])) as Record<SectionId, number>;
        const NAMES = ['Ada Lovelace', 'Bo Chen', 'Cleo Park', 'Dmitri Volkov', 'Esi Mensah', 'Farah Khan', 'Gus Olsen', 'Hana Sato', 'Ivo Marin', 'Jo Rivers'];
        const people = Object.fromEntries(Array.from({ length: n }, (_, i) => { const nm = NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + Math.floor(i / NAMES.length) : ''); return ['u' + i, { name: nm, initials: nm.split(' ').map((w) => w[0]).slice(0, 2).join('') }]; }));
        api.setSpace({ id: qs.get('seed') ?? 'ashgrove', sections: SECTIONS, name: 'Ashgrove', online: 6, people, growth: { members: n, active7d: n, tier, radius: GROWTH.coreRadiusByTier[tier - 1], houses: Array.from({ length: n }, (_, i) => ({ user_id: 'u' + i, plot_index: i })), buildings } });
        api.setHour(Number(qs.get('hour') ?? 12), true);
        window.__town = { api, ready: true }; dispose = () => api.dispose();
      } catch (e) { window.__town = { api: null as never, ready: false, error: String(e) }; }
    })();
    return () => { dead = true; dispose?.(); };
  }, []);
  return (<div style={{ position: 'fixed', inset: 0, background: '#9fb3c0' }}><div ref={mount} style={{ position: 'absolute', inset: 0 }} /><div ref={overlay} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} /></div>);
}
