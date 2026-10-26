import { describe, expect, it } from 'vitest';
import { safetyNumber } from '../safety';

describe('DM safety number (E-014)', () => {
  it('is symmetric, stable and six groups of five digits', async () => {
    const ab = await safetyNumber('userA', 'userB');
    expect(ab).toMatch(/^\d{5}( \d{5}){5}$/);
    expect(await safetyNumber('userB', 'userA')).toBe(ab);
    expect(await safetyNumber('userA', 'userB')).toBe(ab);
  });

  it('differs for a different peer', async () => {
    expect(await safetyNumber('userA', 'userB')).not.toBe(await safetyNumber('userA', 'userC'));
  });

  it('is empty when a side is missing', async () => {
    expect(await safetyNumber('', 'userB')).toBe('');
  });
});
