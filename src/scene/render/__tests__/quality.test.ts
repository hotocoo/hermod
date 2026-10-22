import { describe, expect, it, vi } from 'vitest';
import { QUALITY_DETECT as D } from '@/config/scene';
import { createAdaptive, detectTier } from '../quality';

describe('detectTier', () => {
  it('treats a many-core "Apple GPU" (WKWebView hides the chip) as high', () => {
    expect(detectTier('Apple GPU', D.appleHighCores, 2, 1200, false)).toBe('high');
    expect(detectTier('Apple GPU', D.appleHighCores - 1, 2, 1200, false)).toBe('medium');
  });
});

describe('createAdaptive', () => {
  it('fires on sustained slow frames, and never when reset on every throttled frame', () => {
    const run = (resetOnSkip: boolean) => {
      const slow = vi.fn(); const a = createAdaptive(slow);
      for (let i = 0; i < 4000; i++) { if (resetOnSkip && i % 2) a.reset(); else a.push(1 / 30); }
      return slow.mock.calls.length;
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
  });
});
