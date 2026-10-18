import { describe, expect, it } from 'vitest';
import { resolveMapStyle } from './pref';

describe('resolveMapStyle', () => {
  it('local override beats the space default beats village', () => {
    expect(resolveMapStyle('sanctuary', 'village')).toBe('village');
    expect(resolveMapStyle('sanctuary', null)).toBe('sanctuary');
    expect(resolveMapStyle(undefined, null)).toBe('village');
    expect(resolveMapStyle('castle', null)).toBe('village');
  });
});
