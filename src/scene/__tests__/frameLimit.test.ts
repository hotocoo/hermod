import { describe, expect, it } from 'vitest';
import { FRAME_LIMIT } from '@/config/scene';
import { capFps, tooSoon } from '../frameLimit';

describe('frame limiter (T-018)', () => {
  it('maps saved ids to rates and treats unknown ids as uncapped', () => {
    expect(capFps('off')).toBe(0);
    expect(capFps(null)).toBe(0);
    expect(capFps('nonsense')).toBe(0);
    for (const o of FRAME_LIMIT.options) expect(capFps(o.id)).toBe(o.fps);
    expect(capFps('low')).toBeGreaterThan(0);
    expect(capFps('low')).toBeLessThan(capFps('30'));
  });

  it('never skips when uncapped', () => {
    expect(tooSoon(1, 1, 0)).toBe(false);
  });

  it('skips frames that arrive early and draws the ones on time', () => {
    const fps = 30; const step = 1000 / fps;
    expect(tooSoon(step / 2, 0, fps)).toBe(true);
    expect(tooSoon(step, 0, fps)).toBe(false);
  });

  it('a 60 Hz display under a 60 fps cap still draws every frame despite jitter', () => {
    const frame = 1000 / 60; let last = 0; let drawn = 0;
    for (let i = 1; i <= 120; i++) {
      const now = i * frame + (i % 2 ? -0.4 : 0.4);
      if (!tooSoon(now, last, 60)) { last = now; drawn++; }
    }
    expect(drawn).toBe(120);
  });

  it('a 30 fps cap on a 60 Hz display draws about half the frames', () => {
    const frame = 1000 / 60; let last = 0; let drawn = 0;
    for (let i = 1; i <= 120; i++) {
      const now = i * frame;
      if (!tooSoon(now, last, 30)) { last = now; drawn++; }
    }
    expect(drawn).toBeGreaterThanOrEqual(58);
    expect(drawn).toBeLessThanOrEqual(62);
  });
});
