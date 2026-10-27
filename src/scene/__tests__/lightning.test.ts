import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHTNING } from '@/config/scene';

// weather.ts paints its snowflake texture onto a canvas at creation; node has no canvas, so stub one.
(globalThis as { document?: unknown }).document = {
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' }),
  }),
};
const { createWeather } = await import('../weather');

/** Seconds of storm simulated, and the step (one 60 Hz frame). */
const SIM_S = 60, DT = 1 / 60;
/** WCAG 2.3.1 (three flashes): no more than three flashes in any one second. */
const MAX_FLASHES_PER_S = 3;

describe('storm lightning', () => {
  it('fades each bolt once instead of strobing, and stays under three flashes a second', () => {
    const scene = new THREE.Scene(); const world = new THREE.Group(); scene.add(world);
    const w = createWeather({ scene, world, reduced: false }); w.setWeather('storm');
    const hemi = new THREE.HemisphereLight(); const added: number[] = [];
    for (let i = 0; i < SIM_S / DT; i++) { hemi.intensity = 0; w.lightning(DT, hemi); added.push(hemi.intensity); }
    // a flash starts wherever the extra light rises: within one bolt it only ever falls
    const starts = added.flatMap((v, i) => (i > 0 && v > added[i - 1] ? [i * DT] : []));
    expect(starts.length).toBeGreaterThan(0);
    for (let i = 0; i < starts.length; i++) expect(starts.filter((t) => t >= starts[i] && t < starts[i] + 1).length).toBeLessThanOrEqual(MAX_FLASHES_PER_S);
    expect(Math.max(...added)).toBeLessThanOrEqual(LIGHTNING.hemi);
    w.dispose();
  });
});
