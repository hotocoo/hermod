'use client';
import { useEffect, useRef } from 'react';
import type { QualityTier } from '@/config/scene';
import type { SpaceInfo, TownApi } from '@/scene/types';

export interface FrameStats { spikes: [number, number][]; avgFps: number; low1pctFps: number; p99Ms: number; maxMs: number; frames: number }
export const SCENES = ['island-t1-day', 'island-t1-night', 'island-t5-day', 'island-t5-night', 'archipelago', 'interior', 'panel-open'] as const;
export type SceneName = (typeof SCENES)[number];
export interface PerfApi { ready: Promise<void>; scenes: readonly SceneName[]; shot(hour: number, weather: string, quality: QualityTier): Promise<void>; run(scene: SceneName, ms: number, quality: QualityTier): Promise<FrameStats & { scene: string; quality: string; giSettleMs: number; giProgress: number; stillEngaged: boolean; gpu: string }> }
declare global { interface Window { __perf?: PerfApi } }

const SECTIONS = ['chat', 'hearth', 'feed', 'board', 'skein', 'desk'] as const;
const level = (n: number) => Object.fromEntries(SECTIONS.map((s) => [s, n]));
const STYLE = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('style') : null;
const info = (id: string, tier: number, members: number, lv: number): SpaceInfo => ({
  id, map_style: STYLE, sections: [...SECTIONS], online: 8,
  growth: { members, active7d: Math.ceil(members / 2), tier, radius: [12.6, 14.6, 16.8, 19, 21.4][tier - 1], houses: Array.from({ length: members }, (_, i) => ({ user_id: 'u' + i, plot_index: i })), buildings: level(lv) },
  people: Object.fromEntries(Array.from({ length: members }, (_, i) => ['u' + i, { name: 'Member ' + i, initials: String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + ((i * 7) % 26)) }])),
});
const gpuName = () => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return gl && e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Resolves once no `prep:*` mark (texture upload or shader compile slice in town.ts) was written for `quietMs`, or after `capMs`. */
async function prepQuiet(quietMs: number, capMs: number) {
  const t0 = performance.now(); const marks = () => performance.getEntriesByType('mark').filter((m) => m.name.startsWith('prep:'));
  const busy = () => { const m = marks(); return m.filter((x) => x.name.endsWith(':start')).length > m.filter((x) => x.name.endsWith(':end')).length || performance.now() - Math.max(0, ...m.map((x) => x.startTime)) < quietMs; };
  while (busy() && performance.now() - t0 < capMs) await sleep(250);
}

/** Frame time recorder with a synthetic pointer drag (orbit) or mouse sweep, so the measured frames are the interactive ones (stills never engage). */
function record(ms: number, canvas: HTMLElement | null, orbit: boolean): Promise<FrameStats> {
  return new Promise((res) => {
    const a: number[] = []; const spikes: [number, number][] = []; let last = performance.now(); const t0 = last; let x = 720; const y = 450; let k = 0;
    const fire = (type: string, cx: number, buttons: number) => canvas?.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons, bubbles: true }));
    if (orbit) fire('pointerdown', x, 1);
    const f = (now: number) => {
      if (now - last > 100) spikes.push([Math.round(now - t0), Math.round(now - last)]); a.push(now - last); last = now; k++;
      if (orbit) { x += 6 * Math.cos(k / 40); fire('pointermove', x, 1); } else fire('pointermove', 720 + Math.sin(k / 50) * 300, 0);
      if (now - t0 < ms) { requestAnimationFrame(f); return; }
      if (orbit) fire('pointerup', x, 0);
      a.shift(); const s = [...a].sort((p, q) => p - q); const avg = a.reduce((p, c) => p + c, 0) / a.length; const p99 = s[Math.floor(s.length * 0.99)];
      res({ spikes: spikes.slice(0, 12), avgFps: +(1000 / avg).toFixed(1), low1pctFps: +(1000 / p99).toFixed(1), p99Ms: +p99.toFixed(1), maxMs: +s[s.length - 1].toFixed(1), frames: a.length });
    };
    requestAnimationFrame(f);
  });
}

export default function PerfHarness() {
  const mount = useRef<HTMLDivElement>(null); const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let town: TownApi | null = null; let dead = false; let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((r) => { resolveReady = r; });
    const reset = async (t: TownApi) => { t.leave(); t.focus(null); t.setPanel(false); t.setArchipelago(false); await sleep(600); };
    const api: PerfApi = {
      ready, scenes: SCENES,
      async shot(hour, weather, quality) { const t = town!; await reset(t); t.setQuality(quality); t.setClockMode('manual'); t.setWeather(weather as never); t.setHour(hour, true); },
      async run(scene, ms, quality) {
        const t = town!; await reset(t); t.setQuality(quality); t.setClockMode('manual'); t.setWeather('clear'); await sleep(800); await prepQuiet(1500, 20000);
        const tier5 = scene.includes('t5'); t.setHour(scene.endsWith('night') ? 21.5 : 14, true);
        t.setSpace(tier5 ? info('perf5', 5, 44, 3) : info('perf1', 1, 6, 1));
        await sleep(tier5 ? 5000 : 2500); await prepQuiet(1500, 20000);
        if (scene === 'archipelago') { t.setArchipelago(true, [info('perf1', 1, 6, 1), info('a', 2, 12, 2), info('b', 3, 20, 2), info('c', 4, 30, 3)]); await sleep(3500); }
        if (scene === 'interior') { t.approach('chat'); await sleep(1800); t.enter('chat'); await sleep(3000); }
        if (scene === 'panel-open') { t.setPanel(true); t.focus('chat'); await sleep(2500); }
        // let the incremental probe GI settle first (steady state), then record while orbiting or sweeping the mouse
      const g0 = performance.now(); while (scene !== 'interior' && t.getQuality().giProgress < 1 && performance.now() - g0 < 90000) await sleep(250); const giSettleMs = Math.round(performance.now() - g0);
      const canvas = mount.current?.querySelector('canvas') ?? null; const stats = await record(ms, canvas, scene.startsWith('island') || scene === 'archipelago');
      return { scene, quality, giSettleMs, giProgress: t.getQuality().giProgress, stillEngaged: t.getQuality().stillEngaged, gpu: gpuName(), ...stats };
      },
    };
    window.__perf = api;
    import('@/scene/town').then(async ({ createTown }) => {
      const t = await createTown({ mount: mount.current!, overlay: overlay.current! }); if (dead) { t.dispose(); return; }
      town = t; (window as unknown as { __town?: TownApi }).__town = t; t.setSpace(info('perf1', 1, 6, 1)); await sleep(2500);
      // boot precompile (texture uploads, every tier's shader programs, interior rooms) must finish before anything is recorded; wait for the 'warm' measure, then for the prep marks to go quiet
      const w0 = performance.now(); while (!performance.getEntriesByName('warm').length && performance.now() - w0 < 120000) await sleep(500);
      await prepQuiet(4000, 150000 - (performance.now() - w0));
      resolveReady();
    });
    return () => { dead = true; town?.dispose(); delete window.__perf; };
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#dfe6ea' }}>
      <div ref={mount} style={{ position: 'absolute', inset: 0 }} />
      <div ref={overlay} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    </div>
  );
}
