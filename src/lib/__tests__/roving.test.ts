import { describe, expect, it } from 'vitest';
import { rovingIndex } from '../roving';

describe('roving focus over buildings (X-002)', () => {
  it('cycles forward and wraps', () => {
    expect(rovingIndex(4, 0, 'ArrowRight')).toBe(1);
    expect(rovingIndex(4, 3, 'ArrowDown')).toBe(0);
  });
  it('cycles backward and wraps', () => {
    expect(rovingIndex(4, 2, 'ArrowLeft')).toBe(1);
    expect(rovingIndex(4, 0, 'ArrowUp')).toBe(3);
  });
  it('jumps with Home and End', () => {
    expect(rovingIndex(4, 2, 'Home')).toBe(0);
    expect(rovingIndex(4, 1, 'End')).toBe(3);
  });
  it('ignores other keys and an empty row', () => {
    expect(rovingIndex(4, 1, 'Enter')).toBeNull();
    expect(rovingIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});
