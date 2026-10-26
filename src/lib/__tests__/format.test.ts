import { describe, expect, it } from 'vitest';
import { anim, reduced, setMotionOverride } from '../format';

describe('W-006 reduced-motion override', () => {
  it('forces motion off and on regardless of the OS flag', () => {
    setMotionOverride('reduce');
    expect(reduced()).toBe(true);
    expect(anim(0)).toBe('none');
    setMotionOverride('full');
    expect(reduced()).toBe(false);
    expect(anim(0)).not.toBe('none');
    // 'system' falls back to the OS flag; node has none, so motion is allowed.
    setMotionOverride('system');
    expect(reduced()).toBe(false);
  });
});
